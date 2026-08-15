# Facturador EPSA

PWA mobile-first para que repartidores monotributistas de EPSA (logística de última milla para
Mercado Libre) emitan su factura C mensual a **Envío Postal SA** ante ARCA (ex-AFIP, Argentina)
sin contador.

> Este repo era hasta hace poco un API B2B genérico multi-tenant (comercios con API key, ítems
> arbitrarios). Se decidió **pivotar y evolucionar ese backend** en vez de empezar de cero, porque
> ya resolvía lo más difícil (wrapper de `@arcasdk/core`, cifrado de cert/key, numeración segura de
> comprobantes). Ver `PLAN.md` para el detalle completo de esa decisión y `FASE2.md`/`FASE3.md`
> para el historial de las etapas ya completadas.

## Regla de negocio central

```
importe_total = unidades × precio_base_vigente(periodo)
```

- Receptor fijo para todos los usuarios: **Envío Postal SA**, CUIT `30677857516`, Responsable
  Inscripto.
- `unidades`: la carga el usuario a mano cada mes (no hay OCR en el MVP).
- `precio_base`: cambia por inflación. Se busca por rango de vigencia según el **período
  facturado** (no "el precio actual a secas") — ver `services/precios-base`.
- Único comprobante que emite este producto: **Factura C** (`CbteTipo=11`).

## Stack y estructura

Monorepo pnpm (`pnpm-workspace.yaml`, `packages: ['apps/*']`):

- **`apps/api`** — backend: Node.js 20+, TypeScript estricto, Fastify + Zod
  (`fastify-type-provider-zod`), Drizzle ORM + PostgreSQL, Vitest. `@arcasdk/core` (ARCA
  WSAA/WSFE) y `@arcasdk/pdf` (generación de PDF con QR) encapsulados en `src/services/`.
- **`apps/pwa`** — frontend: Vite + React + `vite-plugin-pwa`, mobile-first.
- **`docker-compose.yml`** (raíz) — Postgres, infraestructura compartida entre ambas apps.

## Qué hace el backend hoy

Por cada usuario (repartidor), el flujo es:

1. **Login** (`POST /v1/auth/login`, CUIT + contraseña) devuelve un JWT de acceso corto (15 min)
   más un refresh token (30 días, rotación en cada uso, tabla `refresh_tokens`).
2. Cada mes el usuario carga sus `unidades` entregadas.
3. `calcularComprobante` (`services/fiscal-rules`) aplica la regla de negocio de arriba con
   receptor y `CondicionIVAReceptorId` fijos — no hay ramas por condición fiscal como en el
   modelo B2B viejo.
4. El precio vigente se resuelve con `getPrecioVigente(periodo)` (`services/precios-base`), por
   rango de fechas, nunca "el actual".
5. Se asigna el próximo número de comprobante de forma segura ante concurrencia (patrón
   `contadores`, `INSERT ... ON CONFLICT DO UPDATE`).
6. Se llama a ARCA (WSAA + WSFE) vía `@arcasdk/core`, resolviendo **homologación/producción por
   usuario** (columna `usuarios.ambiente`), nunca por una variable de entorno global.
7. La factura queda persistida con su CAE; el PDF (con QR de ARCA) se genera on-demand vía
   `GET /v1/facturas/:id/pdf` con `@arcasdk/pdf` (sin storage persistente — siempre se puede
   reconstruir desde los datos de la factura + CAE).

**Idempotencia**: en vez del header `Idempotency-Key` del modelo B2B viejo, se usa la clave natural
`(usuario_id, periodo)` — este producto es una acción mensual desde el celular de un repartidor,
no una integración servidor-a-servidor. Índice único parcial `WHERE estado <> 'error'`, para poder
reintentar tras un rechazo de ARCA sin bloquear el período para siempre.

### Endpoints implementados actualmente

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| `POST` | `/v1/auth/login` | — | CUIT + contraseña → `accessToken` + `refreshToken` |
| `POST` | `/v1/auth/refresh` | — | Rota el refresh token, devuelve un `accessToken` nuevo |
| `GET` | `/v1/facturas/:id/pdf` | ⚠️ ver nota | PDF on-demand con QR de ARCA |
| `GET` | `/v1/health` | — | Health check propio |
| `GET` | `/v1/arca/status` | — | Estado de WSAA/WSFE (FEDummy, fijo a homologación) |

> ⚠️ **Gap de seguridad conocido, marcado como bloqueante para producción**:
> `GET /v1/facturas/:id/pdf` todavía no valida `Authorization: Bearer` — se construyó en paralelo a
> `feature/usuarios-auth` y ambas ramas partían de la misma base sin haberse mergeado entre sí
> todavía. Cualquiera que adivine un `id` de factura puede descargar su PDF (CAE, razón social,
> domicilio) sin autenticarse. Se cierra en `feature/facturas-service-v2` (ver "Qué falta" abajo).

**Todavía no existen** (quedan para las próximas etapas, ver "Qué falta"): alta self-service de
usuarios, `POST /v1/facturas/preview`, `POST /v1/facturas` (emitir), `GET /v1/facturas` (historial).
El contrato completo, incluido lo que falta implementar, está en `docs/api-contract.md`.

## Decisiones de diseño relevantes

- **`periodo`**: columna `date` normalizada al primer día del mes facturado (no un string
  `"YYYY-MM"`), para que la búsqueda de vigencia y el índice único sean comparaciones triviales de
  Postgres.
- **`precios_base`**: sin UI de administración en el MVP, se siembra a mano con
  `pnpm seed:precio-base` (ver abajo) — un panel de admin queda fuera de alcance.
- **PDF**: generación on-demand, sin persistir el archivo. La imagen de despliegue necesita
  Chromium headless (dependencia de `puppeteer` vía `@arcasdk/pdf`) — `Dockerfile` en
  `apps/api/`, con un patch (`patches/@arcasdk__pdf@0.2.0.patch`) que agrega `--no-sandbox`.
- **Homologación/producción**: se resuelven **por usuario** (`usuarios.ambiente`), nunca por una
  env var global — un error de configuración no puede terminar emitiendo un comprobante real
  durante pruebas. Confirmado por código que `@arcasdk/core` trata `production` como propiedad de
  instancia (cada `new Arca(...)` es independiente, sin cruce entre usuarios en el mismo proceso).
- **Fuera de alcance del MVP**: OCR de planilla, notas de crédito/débito, múltiples puntos de venta
  o ítems por usuario, integraciones con sistemas de terceros, automatización del alta en
  producción.

Ver `PLAN.md` para el detalle completo de estas decisiones y por qué se tomaron.

## Levantar el proyecto localmente

### 1. Requisitos

- Node.js 20+
- pnpm
- Docker (para Postgres)

### 2. Base de datos (Postgres)

Desde la raíz del repo:

```bash
docker compose up -d
```

Levanta Postgres 16 en `localhost:5432` (usuario/contraseña `postgres`, DB `arca_billing`).

### 3. Instalar dependencias

Desde la raíz del repo (instala todo el workspace: `apps/api` + `apps/pwa`):

```bash
pnpm install
```

### 4. Backend (`apps/api`)

```bash
cd apps/api
cp .env.example .env
```

Completar en `.env`:

- `ENCRYPTION_KEY` — clave AES-256-GCM de 32 bytes para cifrar `cert`/`key` de cada usuario:
  ```bash
  openssl rand -hex 32
  ```
- `JWT_SECRET` — mínimo 32 caracteres, usada para firmar los access tokens:
  ```bash
  openssl rand -base64 48
  ```

El resto de las variables (`DATABASE_URL`, `PORT`, `HOST`, `RATE_LIMIT_*`) ya vienen con defaults
razonables para desarrollo local. **No hay `ARCA_MODE` global**: homologación/producción se
resuelven por usuario (columna `usuarios.ambiente`), nunca por variable de entorno.

Generar y aplicar las migraciones:

```bash
pnpm db:generate   # genera SQL a partir de src/db/schema (ya versionado en el repo)
pnpm db:migrate    # aplica las migraciones contra Postgres
```

(Opcional) Sembrar un precio base para poder emitir facturas de prueba una vez que
`facturas-service-v2` aterrice:

```bash
pnpm seed:precio-base -- 95000 2026-08-01
```

Levantar el servidor:

```bash
pnpm dev
```

Queda en `http://localhost:3000`. Documentación OpenAPI (Swagger UI) en
`http://localhost:3000/docs`.

### 5. Frontend (`apps/pwa`)

```bash
cd apps/pwa
cp .env.example .env
```

Por defecto `VITE_API_MOCK=true`: el cliente API (`src/api/client.ts`) usa datos mockeados
(`src/api/mockData.ts`) en vez de pegarle al backend real, para poder construir pantallas antes de
que el API esté completo. `VITE_API_MOCK=false` + `VITE_API_BASE_URL=http://localhost:3000/v1`
apunta al backend local, pero hoy no cambia mucho lo que ves: las pantallas de login/alta/factura
son todavía placeholders (`PageStub`, ver "Qué falta") — solo el shell (layout + ruteo) está
implementado.

```bash
pnpm dev
```

Queda en `http://localhost:5173`.

## Tests

Dentro de `apps/api/`:

```bash
pnpm test              # unit + integration
pnpm test:coverage      # con reporte de cobertura
```

Los tests de integración corren contra una base Postgres real (usan el mismo contenedor de
`docker-compose.yml`, deben tenerlo levantado) y mockean `@arcasdk/core` por completo — nunca
pegan contra ARCA real, ni siquiera homologación.

Dentro de `apps/pwa/`:

```bash
pnpm typecheck
pnpm build
```

CI (`.github/workflows/ci.yml`) corre build + test contra Postgres real en cada PR/push a
`develop`/`main`.

## Qué falta (estado del pivot a la fecha)

Etapas 1, 2 y 3 del plan completas y mergeadas a `develop` (monorepo, schema v2, auth,
precios-base, fiscal-rules-v2, ARCA por usuario, generación de PDF). El frontend (`apps/pwa`) hoy
es solo el scaffold: layout, ruteo y cliente API mockeable ya armados, pero las pantallas en sí
(`LoginPage`, `SignupPage`, `FacturaNuevaPage`, `FacturasHistorialPage`) son placeholders
(`PageStub`) sin implementar. Queda, en orden:

- **`feature/pwa-onboarding-auth-screens`** — alta guiada (sin jerga técnica) + login, contra el
  cliente mock. No arrancó.
- **`feature/pwa-factura-flows`** — carga de unidades, preview, confirmar/emitir, historial,
  compartir PDF, contra el cliente mock. No arrancó.
- **`feature/usuarios-onboarding`** — alta self-service de usuarios en el backend, valida el
  certificado contra ARCA antes de persistir.
- **`feature/facturas-service-v2`** — orquesta `precios-base` → `fiscal-rules-v2` →
  `arca-service-per-user` → `pdf` en `POST /v1/facturas/preview` y `POST /v1/facturas`, más
  `GET /v1/facturas` (historial) y `GET /v1/facturas/:id`. Acá se cierra el gap de auth del PDF
  señalado arriba.
- **`feature/pwa-api-integration`** — reemplaza los mocks del frontend por el API real, prueba e2e
  manual contra homologación.
- **`fix/final-cleanup`** — grep de referencias muertas al modelo B2B viejo (`tenant`, `api_key`,
  `idempotency-key`), corrida final de suite + coverage.

Ver `PLAN.md` para el detalle de cada etapa y `docs/api-contract.md` para el contrato completo de
los endpoints que todavía no existen.

## Seguridad

- `cert`/`key` de ARCA de cada usuario se cifran at-rest con AES-256-GCM (`ENCRYPTION_KEY`), nunca
  se devuelven después de subirlos.
- Contraseñas hasheadas con argon2; refresh tokens hasheados en `refresh_tokens.token_hash`
  (índice único), nunca en texto plano.
- Homologación/producción resueltas por usuario, nunca por variable de entorno global.
- Los logs no imprimen certificados, contraseñas ni tokens (`Authorization` redactado en el logger
  de Fastify).
- Rate limiting básico vía `@fastify/rate-limit`.
- Gap conocido pendiente de cerrar: ver la nota sobre `GET /v1/facturas/:id/pdf` arriba.
