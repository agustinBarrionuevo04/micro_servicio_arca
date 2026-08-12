# Fase 3 — continuación pendiente

Este documento reemplaza a `FASE2.md` como punto de partida (esa fase ya se
completó del todo). Leer junto con `PLAN.md` antes de seguir. No repetir acá
lo que ya dice `FASE2.md` sobre instrucciones originales del usuario — siguen
vigentes tal cual, léelas ahí si hace falta.

## Por qué se cortó acá

Se pidió cortar la ejecución a mitad de la segunda tanda de Etapa 3. Las 3
ramas que faltaban (`usuarios-auth`, `arca-service-per-user`,
`pdf-generation`) se lanzaron en paralelo y **ninguna llegó a commitear**,
pero las tres tienen trabajo real sin guardar en sus worktrees (que siguen
en disco, no se borraron). Ver el detalle de cada una más abajo — conviene
retomarlas apuntando al worktree existente (mismo patrón que se usó para
retomar `feature/pwa-scaffold` en la sesión anterior), no relanzarlas de
cero.

## Estado actual — Etapa 3 casi completa

**6 PRs abiertos contra `develop`, todos revisados con `/code-review` y con
los hallazgos ya corregidos y pusheados** — pendientes de que el usuario los
mergee (nada mergeado todavía, confirmado):

| PR | Rama | Estado |
|----|------|--------|
| [#1](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/1) | `fix/ci-workflow` | Revisado y corregido |
| [#2](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/2) | `feature/monorepo-restructure` | Revisado y corregido |
| [#3](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/3) | `feature/pwa-scaffold` | Revisado y corregido |
| [#4](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/4) | `feature/db-schema-v2` | Revisado y corregido (migración verificada contra base vacía y con datos) |
| [#5](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/5) | `feature/fiscal-rules-v2` | **Revisado y corregido en esta sesión** (faltaba validar `precioBase>0` y `ptoVta`) |
| [#6](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/6) | `feature/precios-base-service` | **Revisado y corregido en esta sesión** (race condition con advisory lock, redondeo de precio, validación de fecha real en el seed script) |

**Ya no queda ningún PR con hallazgos de review pendientes de aplicar.** A
diferencia de `FASE2.md`, acá no hace falta ningún paso 0 de limpieza antes
de seguir — se puede ir directo a terminar las 3 ramas que faltan.

## Las 3 ramas que faltan de Etapa 3 — retomar, no relanzar

Todas basadas en `origin/feature/db-schema-v2` (commit `8647f2a`) o
`origin/develop` si para cuando se retome esto el usuario ya mergeó ese PR.

### `feature/usuarios-auth` — ~30-40% hecho
Worktree: `/home/agustin/Documentos/proyectos/micro_servicio_arca/.claude/worktrees/agent-a484c69c91f1f4b6f`
(rama local `feature/usuarios-auth` ya creada ahí, sobre `8647f2a`).

Ya hecho (sin commitear):
- Migración de Drizzle generada para `refresh_tokens`
  (`apps/api/src/db/migrations/0002_chief_killer_shrike.sql` +
  `meta/0002_snapshot.json`, ambos **untracked**).
- `apps/api/src/config/env.ts` + `.env.example`: agregado `JWT_SECRET`.
- `apps/api/src/db/schema/index.ts`: barrel actualizado (probablemente ya
  exporta `refresh_tokens.ts` — confirmar que ese archivo de schema exista,
  puede haber quedado a mitad de camino).
- `apps/api/src/errors/index.ts`: +45 líneas, nuevas clases de error
  (`InvalidCredentialsError`, etc. — confirmar nombres exactos).
- `apps/api/package.json` + `pnpm-lock.yaml`: `jsonwebtoken` agregado.

Falta (el agente estaba por acá cuando se cortó, mensaje: *"Now let's create
the module files. Starting with `passwords.ts`"*):
- El módulo de auth en sí: `passwords.ts` (hash/verify con argon2), la
  lógica de JWT (sign/verify, rotación de refresh token), las rutas
  `POST /v1/auth/login` y `POST /v1/auth/refresh`, el middleware que
  resuelve `request.usuario`.
- Registrar las rutas en `apps/api/src/routes/index.ts` (tiene un TODO
  marcando dónde).
- Tests (unitarios de los helpers, integración del flujo completo).
- Agregar el path del módulo a `coverage.include` en `vitest.config.ts`.
- Confirmar `pnpm build` y `pnpm test` en verde, commit, push, PR contra
  `develop`.

### `feature/arca-service-per-user` — ~85-90% hecho, el más cerca de terminar
Worktree: `/home/agustin/Documentos/proyectos/micro_servicio_arca/.claude/worktrees/agent-a5b54df9e900bda97`
(rama local `feature/arca-service-per-user` ya creada ahí, sobre `8647f2a`).

Ya hecho (sin commitear):
- `apps/api/src/services/arca/index.ts` (+42 líneas) y `types.ts` (+8
  líneas): `ambiente` por usuario en `ArcaCredentials`, cache por
  `usuarioId`, rename de `getArcaClientForTenant` → `...ForUsuario` (a
  confirmar el nombre final).
- `apps/api/src/routes/health.ts` (+26/-4 líneas): `/v1/arca/status`
  adaptado.
- `apps/api/src/config/env.ts` + `.env.example`: probablemente ya sacó
  `ARCA_MODE` (confirmar).
- `apps/api/tests/unit/arca.test.ts` (**untracked**, nuevo) — debería tener
  el test de regresión de aislamiento entre ambientes, que es el
  entregable más importante de esta rama.
- `apps/api/vitest.config.ts` (+25/-4): agregado `services/arca` a
  `coverage.include`.

Falta (el agente estaba por acá cuando se cortó, mensaje: *"Now let's
verify coverage thresholds pass for the `services/arca` include"*):
- Correr `pnpm test:coverage` y ajustar si no llega al umbral.
- **Confirmar que el PR body vaya a documentar explícitamente qué encontró
  sobre cómo `@arcasdk/core` elige host WSAA/WSFEV1 según el flag
  `production`** — esto era un requisito explícito del prompt original, no
  asumir que ya está escrito en ningún lado, revisar el código para ver si
  dejó un comentario con el hallazgo.
- Commit, push, PR contra `develop`.

### `feature/pdf-generation` — ~15-20% hecho, encontró un obstáculo real de entorno
Worktree: `/home/agustin/Documentos/proyectos/micro_servicio_arca/.claude/worktrees/agent-a36cb39773634dc97`
(rama local `feature/pdf-generation` ya creada ahí, sobre `8647f2a`).

Ya hecho (sin commitear):
- `@arcasdk/pdf` agregado a `apps/api/package.json` (`pnpm-lock.yaml` con
  +1229 líneas de resolución de dependencias — Puppeteer trae bastante).
- `pnpm-workspace.yaml`: agregó un campo de `patches` (**nuevo**, no existía
  antes).
- Un directorio `patches/` **untracked** con al menos un patch ya aplicado
  ("Patch committed correctly" en el último mensaje del agente antes de
  cortarlo) — **importante**: esto sugiere que Puppeteer/Chromium necesitó
  un patch para funcionar en este entorno sandboxeado. Revisar qué patch es
  exactamente antes de seguir, y si el mismo problema va a aparecer en CI/
  producción (el Dockerfile que pide el plan todavía no se escribió).

Falta (mensaje del agente al cortarlo: *"Now let's re-run the manual
generation test to confirm it works"*):
- Confirmar que la generación de PDF realmente funciona en este entorno
  después del patch (el agente estaba en eso cuando se cortó).
- Todo el código en sí: `apps/api/src/services/pdf/index.ts`
  (`generateFacturaPdf`), la ruta `GET /v1/facturas/:id/pdf` con el stub de
  auth documentado como bloqueante, el `Dockerfile` con Chromium headless.
- Tests, agregar `services/pdf` a `coverage.include`.
- Commit, push, PR contra `develop`, con el patch de Puppeteer explicado en
  el body si terminó siendo necesario.

## Cómo retomar

1. Ver si el usuario mergeó algún PR (`gh pr list --state all`). Si mergeó
   `feature/db-schema-v2` a `develop`, más fácil rebasar las 3 ramas de
   arriba contra `develop` antes de seguir; si no, seguir tal como están
   (sobre `feature/db-schema-v2` directo).
2. Para cada una de las 3 ramas de arriba: lanzar un agente **sin
   isolation: worktree**, apuntado directo al path del worktree existente
   (mismo patrón que se usó para retomar `feature/pwa-scaffold` en la
   sesión anterior — instruirlo a `cd` ahí primero y correr `git status`/
   `git diff` antes de tocar nada, para que entienda qué ya está hecho
   antes de continuar). No relanzar con `isolation: worktree` de cero,
   sería tirar el trabajo ya hecho.
3. Cuando cada una termine y abra PR: `/code-review high <pr> --comment`,
   aplicar los hallazgos reales directamente sobre la rama, push, recién
   ahí avisarle al usuario que está lista.
4. Con las 5 ramas de Etapa 3 completas y con PR, seguir con Etapa 3b
   (`feature/pwa-onboarding-auth-screens`, `feature/pwa-factura-flows` —
   dependen solo de `feature/pwa-scaffold`, PR #3, que ya está listo) y
   después Etapa 4, 5, 6 en orden — ver `PLAN.md` para el detalle completo
   de cada una.

## Ramas restantes después de Etapa 3 (sin cambios respecto a `PLAN.md`)

- Etapa 3b: `feature/pwa-onboarding-auth-screens`, `feature/pwa-factura-flows`.
- Etapa 4: `feature/usuarios-onboarding`, `feature/facturas-service-v2`.
- Etapa 5: `feature/pwa-api-integration`.
- Etapa 6: `feature/readme-rewrite`, `fix/final-cleanup`.
