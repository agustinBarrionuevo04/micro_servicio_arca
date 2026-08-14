# Fase 3 — Etapa 3 completa, esperando merge

Este documento reemplazó a `FASE2.md` y ahora refleja el cierre de Etapa 3.
Leer junto con `PLAN.md`. Las instrucciones originales del usuario (branch
naming, revisión cruzada obligatoria, patrón de `@arcasdk/core`) siguen
vigentes tal cual — están en `FASE2.md` si hace falta repasarlas, no se
repiten acá.

## Estado actual — Etapa 3 100% completa

**9 PRs abiertos contra `develop`, todos revisados con `/code-review high
<pr> --comment` y con los hallazgos reales ya corregidos y pusheados.**
Nada mergeado todavía salvo lo que el usuario haya hecho manualmente
(confirmar con `gh pr list --state all` antes de seguir).

| PR | Rama | Notas |
|----|------|-------|
| [#1](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/1) | `fix/ci-workflow` | Revisado y corregido |
| [#2](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/2) | `feature/monorepo-restructure` | Revisado y corregido |
| [#3](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/3) | `feature/pwa-scaffold` | Revisado y corregido |
| [#4](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/4) | `feature/db-schema-v2` | Revisado y corregido. Migración verificada contra base vacía **y** contra base con datos del esquema viejo (usa un `TRUNCATE` documentado a propósito — el modelo de negocio cambió por completo, no hay migración de datos válida de las filas viejas). |
| [#5](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/5) | `feature/fiscal-rules-v2` | Revisado y corregido (validación de `precioBase>0` y `ptoVta`) |
| [#6](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/6) | `feature/precios-base-service` | Revisado y corregido (advisory lock por race condition, redondeo de precio, validación de fecha real) |
| [#7](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/7) | `feature/arca-service-per-user` | Revisado y corregido (invalidación de cache documentada). **`@arcasdk/core` confirmado**: `production` es una propiedad de instancia, cada `new Arca(...)` es independiente — dos usuarios con distinto `ambiente` en el mismo proceso nunca se cruzan (ver el PR y el comentario en `services/arca/index.ts`). |
| [#8](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/8) | `feature/usuarios-auth` | Revisado exhaustivamente (7 ángulos de review en paralelo) y corregido: índice único en `refresh_tokens.token_hash` (el hallazgo más corroborado, full table scan bajo lock), allowlist en vez de denylist para los campos seguros de usuario, `DUMMY_PASSWORD_HASH` calculado en vez de hardcodeado, límite de tamaño en `password`, `Bearer` case-insensitive, `security: []` en las rutas públicas, clase de error muerta eliminada. |
| [#9](https://github.com/agustinBarrionuevo04/micro_servicio_arca/pull/9) | `feature/pdf-generation` | Revisado y corregido (timeout de 30s en la generación, comentario incorrecto sobre `Buffer.from`). **Puppeteer/PDF confirmado funcionando** end-to-end, incluso en Docker real — necesitó un patch (`patches/@arcasdk__pdf@0.2.0.patch`, agrega `--no-sandbox`) documentado en el código y en el `Dockerfile`. **Gap de auth deliberadamente sin cerrar y marcado como bloqueante para producción** — la ruta `GET /v1/facturas/:id/pdf` no tiene JWT todavía porque se construyó en paralelo a `usuarios-auth`; hay que cerrarlo en `feature/facturas-service-v2` (Etapa 4). |

**Ningún PR tiene hallazgos de review pendientes de aplicar.**

## Antes de arrancar Etapa 3b

1. Confirmar si el usuario mergeó algo (`gh pr list --state all`). Si mergeó
   `feature/db-schema-v2` (#4) a `develop`, conviene mergear también #5-#9
   en orden antes de seguir, o al menos rebasar las próximas ramas contra
   `develop` en vez de `feature/db-schema-v2` directo.
2. **Recordar el gap de auth de PR #9** cuando se arranque
   `feature/facturas-service-v2` (Etapa 4): la ruta del PDF necesita el
   middleware `authenticate` de `feature/usuarios-auth` (PR #8) wireado.

## Lo que sigue — Etapa 3b, 4, 5, 6 (sin cambios respecto a `PLAN.md`)

### Etapa 3b — 2 ramas en paralelo, dependen solo de `feature/pwa-scaffold` (PR #3, ya listo)
- `feature/pwa-onboarding-auth-screens` — alta guiada (sin jerga técnica) + login, contra el cliente mock.
- `feature/pwa-factura-flows` — carga de unidades, preview, confirmar/emitir, historial, compartir PDF, contra el cliente mock.

### Etapa 4 — 2 ramas secuenciales, integran Etapa 3
- `feature/usuarios-onboarding` — alta self-service, valida el certificado contra ARCA antes de persistir (usa `getArcaClientForUsuario` de PR #7), siembra `contadores`. Depende de `usuarios-auth` (#8) y `arca-service-per-user` (#7).
- `feature/facturas-service-v2` — orquesta `precios-base` (#6) → `fiscal-rules-v2` (#5) → `arca-service-per-user` (#7) → `pdf` (#9), idempotencia natural `(usuario_id, periodo)`. **Acá se cierra el gap de auth del PDF** (ver arriba).

### Etapa 5
- `feature/pwa-api-integration` — reemplaza el mock del frontend por el API real, prueba e2e manual contra homologación.

### Etapa 6
- `feature/readme-rewrite` — README del producto real (el actual sigue describiendo el viejo API B2B genérico).
- `fix/final-cleanup` — grep de referencias muertas, corrida final de suite + coverage.

## Cómo retomar

Lanzar las 2 ramas de Etapa 3b en paralelo (isolation: worktree, cada una
basada en `origin/feature/pwa-scaffold` o `origin/develop` si ese PR ya
mergeó), con el mismo nivel de detalle de contexto que se usó para las
ramas de Etapa 3 — eso es lo que permitió que salieran bien documentadas y
casi sin hallazgos de review desde el primer intento. Cuando cada una
termine: `/code-review high <pr> --comment`, aplicar los hallazgos reales,
push, y recién ahí avisar que está lista para mergear.
