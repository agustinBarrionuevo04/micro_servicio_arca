# Fase 2 — continuación pendiente

Este documento existe para no tener que repetir el contexto original ni las
instrucciones de proceso la próxima vez que se retome el trabajo. Léelo junto
con `PLAN.md` (el plan completo del producto) antes de seguir.

## Por qué se cortó acá

Se llegó al ~50% del presupuesto de tokens de la sesión y se decidió frenar
ahí en vez de seguir gastando, dejando el resto para otro día. **Etapa 3 se
lanzó dos veces y se frenó ambas** (primero por límite de sesión del
proveedor, después a propósito por presupuesto): de las 5 ramas de Etapa 3,
4 no llegaron a commitear nada (hay que lanzarlas de cero) y **una,
`feature/fiscal-rules-v2`, se terminó a mano** (sin sub agente, reusando el
trabajo que había dejado el intento cortado) con el margen de tokens que
quedaba — ver el PR #5 en la tabla de abajo.

## Instrucciones originales del usuario (no repetir, ya están incorporadas al proceso)

Dadas al arrancar este trabajo, textuales en espíritu:

- Podés largar varios sub agentes para ir trabajando en distintas branches.
- Uno de los agentes siempre tiene que chequear el código escrito por otro —
  es no negociable, sobre todo por lo legal (facturación electrónica real
  ante ARCA/AFIP). Ningún agente mergea su propia rama.
- Las branches van con prefijo `feature/` o `fix/`, **sin** el índice
  `t3code/` que usa el harness por default.
- Usar el SDK de ARCA (`@arcasdk/core`) para conectarse a su sistema siempre
  que se pueda, con esta forma (ya está implementado así en
  `apps/api/src/services/arca/index.ts`, no hay que rehacerlo, solo
  adaptarlo por rama según corresponda):

  ```ts
  import { Arca } from "@arcasdk/core";
  import fs from "fs";

  const arca = new Arca({
    cuit: 27311238677,
    cert: fs.readFileSync("./facturate.crt", "utf-8"),
    key: fs.readFileSync("./privada.key", "utf-8"),
    production: false, // homologación
  });
  ```

- Plan primero, verificado por el usuario, después implementación. Ya
  cumplido para todo lo que hay hasta acá — lo que sigue (Etapa 3 en
  adelante) ya está aprobado como parte del mismo plan, no hace falta
  volver a pedir luz verde salvo que algo cambie.
- Rama base: `develop` (creada desde `t3code/fix/facturas-code-review-bugs`,
  ya pusheada a origin). **`main` no se toca** hasta validar el MVP
  end-to-end.
- Política de push: cada rama hace push + abre PR (`gh pr create --base
  develop`) al terminar. El usuario aprueba el merge, ningún agente ni el
  orquestador mergea sin su ok.
- Flujo de revisión (ya aplicado en las 4 ramas hechas hasta acá): después de
  que una rama abre PR, correr `/code-review high <numero-de-pr> --comment`
  (skill `code-review`), y aplicar los hallazgos directamente sobre la misma
  rama (commit + push adicional) antes de darla por lista — no dejar
  hallazgos sin resolver esperando una segunda vuelta de agente.

## Estado actual (qué ya está hecho)

Rama base de todo: `develop` (commit `52f4e7e`, tiene `PLAN.md`).

4 PRs abiertos contra `develop`, revisados y con los hallazgos de review ya
corregidos y pusheados — **pendientes de que el usuario los mergee**:

| PR | Rama | Contenido |
|----|------|-----------|
| [#1](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/1) | `fix/ci-workflow` | GitHub Actions: build + test contra Postgres real |
| [#2](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/2) | `feature/monorepo-restructure` | Backend movido a `apps/api/`, `apps/pwa/` placeholder, `docs/api-contract.md`, `pnpm-workspace.yaml` |
| [#3](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/3) | `feature/pwa-scaffold` | Vite+React+vite-plugin-pwa, layout mobile-first, rutas placeholder, cliente API mockeable (`VITE_API_MOCK`) |
| [#4](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/4) | `feature/db-schema-v2` | Schema nuevo: `usuarios`, `precios_base`, `facturas` v2, `contadores` renombrado, `api_keys` eliminado. Migración verificada contra base vacía **y** contra base con datos del esquema viejo (usa `TRUNCATE` documentado, ver el PR). Módulos incompatibles con el modelo nuevo (`modules/auth`, `modules/tenants`, `modules/facturas`, `services/fiscal-rules`, `services/idempotency`) fueron **eliminados** con TODOs explícitos para las ramas que los recrean. |
| [#5](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/5) | `feature/fiscal-rules-v2` | `calcularComprobante(unidades, precioBase, ptoVta)`, 100% coverage. **Ojo: esta es la única de las 5 ramas de Etapa 3 completada, y NO pasó por `/code-review`** (se priorizó cerrar el presupuesto) — correr la revisión antes de mergear. |

**Importante sobre PR #4**: dejó `apps/api/vitest.config.ts` con
`coverage.include: []` y sin `thresholds` (el coverage quedó desactivado a
propósito porque los módulos que cubría se borraron). Cada rama de Etapa 3
que toque un módulo nuevo debe agregar su propio path a `include` y
reinstalar un threshold — está comentado en el archivo.

**Antes de arrancar Etapa 3 la próxima vez**: revisar si el usuario ya
mergeó algún PR. Si `develop` ya tiene `feature/db-schema-v2` mergeado, las
ramas de Etapa 3 deben basarse en `origin/develop` directamente. Si no,
seguir basándose en `origin/feature/db-schema-v2` (commit `8647f2a` o
posterior) como se venía haciendo, y avisar que el diff de los PRs se va a
ver inflado hasta que la base mergee (es esperado, ya pasó con los 4 PRs
anteriores).

## Lo que falta (en orden, ver `PLAN.md` para el detalle completo de cada rama)

### Etapa 3 — dependen solo de `feature/db-schema-v2`

- ~~`feature/fiscal-rules-v2`~~ — **hecho, PR #5, falta pasar `/code-review high 5 --comment` y aplicar los hallazgos antes de mergear.**
- `feature/usuarios-auth` — login CUIT+contraseña, JWT access+refresh, tabla `refresh_tokens`, middleware de auth (reemplaza el viejo modelo de API key). No arrancó, lanzar de cero.
- `feature/precios-base-service` — `getPrecioVigente(periodo)`, lookup por rango de fechas, validación de solapamiento al insertar. No arrancó, lanzar de cero.
- `feature/arca-service-per-user` — `ambiente` por usuario en vez de `env.ARCA_MODE` global, con test de regresión probando aislamiento real entre dos usuarios. **Ojo**: hay que verificar leyendo el código instalado de `@arcasdk/core` cómo el flag `production` elige host WSAA/WSFEV1 — no asumir. No arrancó, lanzar de cero.
- `feature/pdf-generation` — `@arcasdk/pdf`, `GET /v1/facturas/:id/pdf` on-demand, Dockerfile con Chromium headless. Esta rama va a necesitar un stub de auth (todavía no existe `usuarios-auth`) — documentar el gap como bloqueante para producción. No arrancó, lanzar de cero.

Los prompts completos y detallados para relanzar las 4 ramas que faltan ya
están redactados (se usaron para los dos intentos fallidos) — están en el
historial de esta conversación si se retoma la misma sesión; si es una
sesión nueva, `PLAN.md` tiene el resumen suficiente para reconstruirlos.
Todas deben basarse en `origin/feature/db-schema-v2` (commit `8647f2a` o
posterior, o `origin/develop` si ya mergeaste ese PR) — **no** en
`feature/fiscal-rules-v2`, que es una rama hermana, no una base.

### Etapa 3b — 2 ramas en paralelo, dependen solo de `feature/pwa-scaffold`

- `feature/pwa-onboarding-auth-screens` — alta guiada (sin jerga técnica) + login, contra el cliente mock.
- `feature/pwa-factura-flows` — carga de unidades, preview, confirmar/emitir, historial, compartir PDF, contra el cliente mock.

### Etapa 4 — 2 ramas secuenciales, integran Etapa 3

- `feature/usuarios-onboarding` — alta self-service, valida el certificado contra ARCA antes de persistir, siembra `contadores`.
- `feature/facturas-service-v2` — orquesta precios-base → fiscal-rules-v2 → arca-service-per-user → pdf, idempotencia natural `(usuario_id, periodo)`.

### Etapa 5

- `feature/pwa-api-integration` — reemplaza el mock del frontend por el API real, prueba e2e manual contra homologación.

### Etapa 6

- `feature/readme-rewrite` — README del producto real.
- `fix/final-cleanup` — grep de referencias muertas, corrida final de suite + coverage.

## Cómo retomar

1. Ver si el usuario mergeó los PRs #1-#4. Si sí, actualizar `develop` local
   (`git pull origin develop`) y usarla como base de Etapa 3 en vez de
   `feature/db-schema-v2` directamente.
2. Relanzar las 5 ramas de Etapa 3 en paralelo (isolation: worktree cada
   una), con el mismo nivel de detalle de contexto que se les dio en los dos
   intentos anteriores — no escatimar contexto en el prompt, es lo que
   permitió que las 4 ramas ya hechas salieran bien documentadas y
   correctas al primer intento (salvo los hallazgos menores que corrigió la
   revisión).
3. Para cada rama que termine: correr `/code-review high <pr> --comment`,
   aplicar los hallazgos reales (no solo nits) directamente sobre la rama,
   volver a pushear, y recién ahí avisarle al usuario que está lista para
   mergear.
4. Seguir el orden de etapas de `PLAN.md` — no adelantar una etapa antes de
   que sus dependencias estén al menos abiertas como PR (no hace falta que
   estén mergeadas a `develop` para que la siguiente etapa arranque, como se
   vio en esta sesión, pero si el usuario ya mergeó, mejor partir de ahí).
