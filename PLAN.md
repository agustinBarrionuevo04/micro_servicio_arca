# Plan de implementación — Facturador PWA EPSA

## Contexto

`main` está prácticamente vacía. El backend real (Fastify + Drizzle + Postgres + TS,
`@arcasdk/core` ya integrado) vive en `t3code/fix/facturas-code-review-bugs` y es un API
B2B multi-tenant genérico (comercios con API key, ítems arbitrarios). El circuito completo
de autenticación y emisión ante ARCA (WSAA + FEDummy + FECAESolicitar) ya está validado en
homologación.

El objetivo ahora es un producto distinto y más acotado: una PWA mobile-first para que
repartidores monotributistas de EPSA (logística de última milla para Mercado Libre) emitan
su factura C mensual a Envío Postal SA sin contador. Se decidió **evolucionar el backend
existente** en vez de empezar de cero, porque ya resuelve exactamente lo más difícil
(wrapper de `@arcasdk/core`, cifrado de cert/key, manejo de errores, numeración segura de
comprobantes) con un patrón claro y ya revisado.

`develop` (esta rama, creada desde `t3code/fix/facturas-code-review-bugs`) es la base de
todo el trabajo nuevo. `main` no se toca hasta que el MVP esté validado end-to-end.

## Regla de negocio central

```
importe_total = unidades × precio_base_vigente(periodo)
```

- Receptor fijo para todos los usuarios: Envío Postal SA, CUIT 30677857516, Responsable Inscripto.
- `unidades`: la carga el usuario a mano cada mes (no hay OCR en el MVP).
- `precio_base`: ~$95.000, cambia por inflación. Se busca por rango de vigencia según el
  período facturado, nunca "el precio actual a secas".

## Integración ARCA (decisiones ya tomadas)

- Servicio: `wsfev1` (`FECAESolicitar`). El id de servicio para WSAA es `wsfe`, no `wsfev1`.
- `wsfev1` no requiere homologación formal de ARCA — solo que cada usuario genere su
  certificado (WSASS en testing, Administrador de Relaciones en prod) y delegue `wsfe` al
  CUIT del backend.
- Factura C: `CbteTipo=11`, `Concepto=2`, `DocTipo=80`, `DocNro=30677857516` (fijo),
  `ImpNeto=ImpTotal`, `ImpTotConc/ImpOpEx/ImpTrib/ImpIVA=0`, `MonId="PES"`, `MonCotiz=1`,
  `CondicionIVAReceptorId=1` (obligatorio desde abril 2026).
- El SDK **no** resuelve numeración internamente (`createVoucher` recibe `CbteDesde`/`CbteHasta`
  explícitos) — se confirma que el patrón local de `contadores` (ya existente, con el bug de
  "se traba en 1" ya corregido) es el correcto y se mantiene.
- Homologación y producción usan hosts y certificados distintos — **por usuario**, no una
  variable de entorno global como hoy (`env.ARCA_MODE`).
- Paquetes npm confirmados: `@arcasdk/core` (dependencia ya presente, se mantiene en `^1.0.0`
  durante este pivot, no se sube a `2.0.0` todavía) y `@arcasdk/pdf@0.2.0` (generador de PDF
  específico para comprobantes ARCA, incluye QR — se usa para el paso de PDF).

## Qué se reusa tal cual del backend actual

- `apps/api/src/services/arca/index.ts` + `types.ts` — wrapper de `@arcasdk/core`, incluida la
  traducción del rechazo silencioso de ARCA (`cae: ""`) a `ArcaRejectionError`. Solo cambia
  para leer `ambiente` por usuario en vez de `env.ARCA_MODE` global.
- `apps/api/src/config/crypto.ts` — AES-256-GCM para cert/key en reposo.
- `apps/api/src/errors/index.ts` — jerarquía `AppError` + handler global.
- `apps/api/src/db/index.ts`, `docker-compose.yml`, patrón de migraciones con drizzle-kit.
- Patrón de registro de rutas (`apps/api/src/app.ts` / `apps/api/src/routes/index.ts`).
- Patrón de tests: `vi.mock('@arcasdk/core', ...)` vía `apps/api/tests/integration/arca-mock.ts`,
  testcontainers, `apps/api/tests/unit/schemas.test.ts` con Zod puro.
- Patrón de `contadores` (`INSERT ... ON CONFLICT DO UPDATE`) para numeración segura.

## Qué se reemplaza

- `apps/api/src/modules/auth/index.ts` (API key B2B) → login de usuario final CUIT + contraseña,
  JWT de acceso corto + refresh token (tabla `refresh_tokens` nueva). Se eligió JWT en vez de
  cookie de sesión porque funciona igual sea la PWA same-origin o no con el API, sin asumir
  nada sobre el despliegue.
- `apps/api/src/services/fiscal-rules/index.ts` (reglas genéricas multi-condición) → función pura
  `calcularComprobante({unidades, precioBase, ptoVta, periodo})` con receptor y
  `CondicionIVAReceptorId` fijos.
- `apps/api/src/db/schema/tenants.ts` → `usuarios.ts` (+ password_hash, ambiente, domicilio, condicion_iva).
- `apps/api/src/db/schema/facturas.ts` → agrega `periodo`, `unidades`, `precio_base_usado`,
  `importe_total`, `pdf_url`; `estado` pasa a `pendiente|emitida|error`; se elimina
  `idempotency_key` (ver más abajo).
- `apps/api/src/db/schema/api-keys.ts` → se elimina (no hay API keys B2B en este producto).
- `apps/api/src/modules/tenants/` (alta admin) → `apps/api/src/modules/usuarios/` (alta self-service: CUIT,
  razón social, domicilio, contraseña, cert/key, con instrucciones guiadas en lenguaje simple
  para generar el certificado y delegar `wsfe`).

## Decisiones de diseño nuevas

- **Idempotencia**: se reemplaza el header `Idempotency-Key` por la clave natural
  `(usuario_id, periodo)` — este producto es una acción mensual desde el celular de un
  repartidor, no una integración servidor-a-servidor. Reintentar `POST /v1/facturas` para un
  período ya `emitida` devuelve esa factura. Índice único parcial
  `(usuario_id, periodo) WHERE estado <> 'error'` para permitir reintentar tras un rechazo sin
  bloquear el período para siempre.
- **PDF**: generación on-demand (`GET /v1/facturas/:id/pdf`) con `@arcasdk/pdf`, sin storage
  persistente — se puede reconstruir siempre desde los datos de la factura + CAE. Implica que
  la imagen de despliegue necesita Chromium headless (dependencia de `puppeteer` vía
  `@arcasdk/pdf`); se agrega un `Dockerfile` mínimo en la rama de PDF.
- **precios_base**: sin UI de administración en el MVP — se siembra a mano (script/SQL
  directo). Construir un panel de admin queda fuera de alcance.
- **`periodo`**: columna `date` normalizada al primer día del mes facturado (no un string
  `"YYYY-MM"`), para que la búsqueda de vigencia y el índice único sean triviales.
- **Layout del monorepo**: `apps/api` (backend existente, movido tal cual) + `apps/pwa`
  (Vite + React + `vite-plugin-pwa`, nuevo), `pnpm-workspace.yaml` con `packages: ['apps/*']`.
  `docker-compose.yml` queda en la raíz (infra compartida).
- **CI**: se agrega un workflow mínimo de GitHub Actions (lint + typecheck + tests) para que
  el flujo de revisión entre ramas tenga un check objetivo, no solo el reporte del agente autor.

## Fuera de alcance (MVP)

OCR de la planilla Excel, notas de crédito/débito, múltiples puntos de venta o ítems por
usuario, integraciones con sistemas de gestión de terceros, automatización del alta en
producción (delegación vía Administrador de Relaciones) — todo eso queda para después de
validar el flujo completo en homologación con un usuario real.

## Seguridad (no negociable)

- Cert/key de cada usuario cifrados en reposo (AES-256-GCM, reusando `crypto.ts`), nunca se
  devuelven después de subirlos.
- Nunca se loguean `Token`/`Sign` de WSAA ni claves privadas, ni en logs de debug.
- Homologación y producción se resuelven **por usuario**, nunca desde una variable de entorno
  global — un error de configuración no puede terminar emitiendo un comprobante real durante
  pruebas.

## Ramas y orden de ejecución

Convención: `feature/...` / `fix/...`, sin prefijo `t3code/`. Todas parten de `develop`.

```
Etapa 1 (paralelo)
  feature/monorepo-restructure   — apps/api + apps/pwa, pnpm-workspace.yaml, docs/api-contract.md
  feature/ci-workflow            — GitHub Actions: lint + typecheck + test

Etapa 1b (paralelo, apenas mergea monorepo-restructure)
  feature/pwa-scaffold           — Vite+React+vite-plugin-pwa, cliente API mockeable

Etapa 2 (bloqueante, la más riesgosa — se revisa con más cuidado)
  feature/db-schema-v2           — usuarios, precios_base, facturas v2, contadores (rename),
                                    elimina api-keys, migración, helpers de test actualizados

Etapa 3 (paralelo, todas dependen solo de db-schema-v2)
  feature/usuarios-auth          — CUIT+contraseña, JWT access+refresh, refresh_tokens
  feature/precios-base-service   — getPrecioVigente(periodo), lookup por rango de fechas
  feature/fiscal-rules-v2        — calcularComprobante(unidades, precioBase, ptoVta, periodo)
  feature/arca-service-per-user  — ambiente por usuario en vez de env.ARCA_MODE global
  feature/pdf-generation         — @arcasdk/pdf, GET /v1/facturas/:id/pdf, Dockerfile+Chromium

Etapa 3b (paralelo con Etapa 3, depende solo de pwa-scaffold, contra mocks)
  feature/pwa-onboarding-auth-screens  — alta guiada + login
  feature/pwa-factura-flows            — carga de unidades, preview, confirmar, historial, compartir PDF

Etapa 4 (secuencial, integra Etapa 3)
  feature/usuarios-onboarding    — alta self-service, valida cert contra ARCA antes de persistir
  feature/facturas-service-v2    — preview/crear/listar/detalle, orquesta precios+fiscal+arca+pdf

Etapa 5
  feature/pwa-api-integration    — reemplaza mocks del frontend por el API real, e2e manual

Etapa 6
  feature/readme-rewrite         — README nuevo del producto real
  fix/final-cleanup              — grep de referencias muertas (tenant, api_key, idempotency-key),
                                    corrida final de test suite + coverage
```

## Flujo de revisión

- Ningún agente mergea su propia rama. Cada rama la revisa un agente distinto antes de mergear.
- El autor pushea y abre PR (`gh pr create`) con: qué cambió, qué decisiones tomó que no
  estaban en este plan, y confirmación de que tests/build pasan localmente.
- El revisor corre los tests él mismo (no confía en la descripción), y chequea en orden:
  correctitud sobre los casos límite del dominio de esa rama, **calidad de documentación**
  (todo lo fiscal-crítico — `precios-base`, `fiscal-rules-v2`, `arca` service, `facturas`
  service — debe explicar el *por qué* de cada constante fiscal hardcodeada, no solo el qué;
  esto es no negociable porque toca obligaciones legales reales), cobertura de tests, y un
  checklist de seguridad (cert/key nunca en logs ni en responses, homologación/producción
  resueltas por usuario).
- Ante desacuerdo: el autor tiene una ronda para responder: si no se resuelve, se escala al
  humano con ambas posiciones — ningún agente pisa unilateralmente al otro en algo que toca
  presentaciones fiscales reales.
- Cada rama se pushea a origin y abre PR al terminar (no se mergea sin aprobación humana).
