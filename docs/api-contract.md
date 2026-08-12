# API contract (borrador) — Facturador PWA EPSA

> **Esto es un boceto de planificación, no una especificación final.** Se escribe en
> `feature/monorepo-restructure` (Etapa 1) únicamente para que ramas de frontend que arrancan
> en paralelo sin backend nuevavía (`feature/pwa-scaffold`, `feature/pwa-onboarding-auth-screens`,
> `feature/pwa-factura-flows`) tengan algo concreto contra qué construir un cliente mockeado.
>
> La fuente de verdad real es el código, a medida que aterricen las ramas de backend:
> `feature/db-schema-v2` (esquema de `usuarios`, `precios_base`, `facturas`, `contadores`),
> `feature/usuarios-auth` (login/refresh), `feature/precios-base-service`,
> `feature/fiscal-rules-v2`, `feature/arca-service-per-user`, `feature/pdf-generation` y
> `feature/facturas-service-v2` (orquesta todo lo anterior en los endpoints de `facturas`).
> Cualquier discrepancia entre este documento y esas ramas, gana el código — actualizar este
> archivo (o borrarlo) en `feature/readme-rewrite` (Etapa 6) una vez que el contrato real esté
> estable.
>
> Contexto de producto completo en [`PLAN.md`](../PLAN.md).

## Convenciones generales

- Base path: `/v1`.
- Content-Type: `application/json` en todos los requests/responses excepto
  `GET /v1/facturas/:id/pdf` (`application/pdf`).
- Auth: `Authorization: Bearer <accessToken>` (JWT de corta duración). Ver
  [`POST /v1/auth/login`](#post-v1authlogin) y [`POST /v1/auth/refresh`](#post-v1authrefresh).
- Todas las rutas autenticadas resuelven el `usuario` desde el JWT — nunca desde un parámetro
  de la URL o del body. Un usuario nunca puede ver/operar sobre facturas de otro usuario
  (`GET /v1/facturas/:id` de una factura ajena responde `404`, no `403`, para no filtrar
  existencia).
- `periodo` es siempre un string `YYYY-MM-DD` normalizado al primer día del mes facturado
  (ej. `"2026-08-01"` para agosto 2026) — ver PLAN.md, sección "`periodo`". El cliente puede
  construirlo a partir de un selector mes/año, pero el body siempre lleva la fecha completa.
- Errores: shape uniforme `{ "error": { "code": "STRING_CODE", "message": "texto legible" } }`,
  siguiendo la jerarquía `AppError` ya existente en `apps/api/src/errors/index.ts` (se extiende,
  no se reemplaza, en las ramas de Etapa 3/4).
- Montos (`precioBaseVigente`, `importeTotal`, etc.) viajan como number en pesos con hasta 2
  decimales (no centavos enteros) — a confirmar en `feature/precios-base-service` /
  `feature/fiscal-rules-v2`, que son quienes fijan el tipo real en el schema de Zod.

---

## `POST /v1/auth/login`

Login de usuario final con CUIT + contraseña (reemplaza la autenticación por API key del backend
B2B original — ver PLAN.md "Qué se reemplaza").

- **Auth**: ninguna.
- **Request body**:
  ```json
  {
    "cuit": "20345678901",
    "password": "..."
  }
  ```
- **Response `200`**:
  ```json
  {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "usuario": {
      "id": "uuid",
      "cuit": "20345678901",
      "razonSocial": "...",
      "ambiente": "homologacion"
    }
  }
  ```
- **Errores**: `401 INVALID_CREDENTIALS` (CUIT inexistente o password incorrecta — mismo código
  para ambos casos, no distinguir para no filtrar qué CUITs están registrados).

## `POST /v1/auth/refresh`

Renueva el `accessToken` a partir de un `refreshToken` válido. Tabla `refresh_tokens` nueva
(PLAN.md) — se espera rotación (el refresh token usado se invalida y se emite uno nuevo) para
poder revocar sesiones robadas.

- **Auth**: ninguna (el `refreshToken` en el body es la credencial).
- **Request body**:
  ```json
  { "refreshToken": "eyJ..." }
  ```
- **Response `200`**:
  ```json
  { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
  ```
- **Errores**: `401 INVALID_REFRESH_TOKEN` (expirado, revocado, o inexistente).

## `POST /v1/usuarios` (signup)

Alta self-service de un repartidor: reemplaza el endpoint interno `POST /admin/tenants` del
backend actual. Incluye subir cert/key de ARCA — el flujo guiado en la PWA (Etapa 3b,
`feature/pwa-onboarding-auth-screens`) explica en lenguaje simple cómo generarlos antes de este
paso.

- **Auth**: ninguna.
- **Request body**:
  ```json
  {
    "cuit": "20345678901",
    "razonSocial": "Juan Pérez",
    "domicilio": "Calle Falsa 123, CABA",
    "condicionIva": "monotributo",
    "password": "...",
    "cert": "-----BEGIN CERTIFICATE-----...",
    "key": "-----BEGIN PRIVATE KEY-----..."
  }
  ```
- **Response `201`**:
  ```json
  {
    "id": "uuid",
    "cuit": "20345678901",
    "razonSocial": "Juan Pérez",
    "domicilio": "Calle Falsa 123, CABA",
    "condicionIva": "monotributo",
    "ambiente": "homologacion",
    "createdAt": "2026-08-10T12:00:00.000Z"
  }
  ```
  `cert`/`key` nunca se devuelven (se cifran en reposo con AES-256-GCM, ver PLAN.md
  "Seguridad").
- **Errores**: `409 CUIT_ALREADY_REGISTERED`, `422 VALIDATION_ERROR` (CUIT con dígito
  verificador inválido, password débil, etc.). `feature/usuarios-onboarding` (Etapa 4) puede
  agregar una validación síncrona contra ARCA (WSAA) antes de persistir el cert — a confirmar
  en esa rama si eso implica un código de error adicional (ej. `422 ARCA_CERT_INVALID`).

## `POST /v1/facturas/preview`

Calcula el importe sin emitir nada ni tocar ARCA — para que el repartidor vea el monto antes de
confirmar. No persiste una factura ni consume el período.

- **Auth**: Bearer.
- **Request body**:
  ```json
  { "periodo": "2026-08-01", "unidades": 340 }
  ```
- **Response `200`**:
  ```json
  {
    "periodo": "2026-08-01",
    "unidades": 340,
    "precioBaseVigente": 95000,
    "importeTotal": 32300000
  }
  ```
  (`importeTotal = unidades × precioBaseVigente`, ver PLAN.md "Regla de negocio central".)
- **Errores**: `404 PRECIO_BASE_NOT_FOUND` (no hay `precios_base` vigente para ese `periodo` —
  recordar que se siembra a mano, sin UI de admin en el MVP), `422 VALIDATION_ERROR`
  (`unidades <= 0`, `periodo` futuro más allá de lo permitido, etc. — regla exacta la define
  `feature/fiscal-rules-v2`).

## `POST /v1/facturas` (emitir)

Emite la factura C real contra ARCA para el período dado. Idempotencia por clave natural
`(usuario_id, periodo)` (PLAN.md "Decisiones de diseño nuevas") — reintentar para un período ya
`emitida` devuelve esa factura sin volver a llamar a ARCA.

- **Auth**: Bearer.
- **Request body**:
  ```json
  { "periodo": "2026-08-01", "unidades": 340 }
  ```
- **Response `201`** (primera emisión) o **`200`** (reintento de un período ya `emitida`):
  ```json
  {
    "id": "uuid",
    "periodo": "2026-08-01",
    "unidades": 340,
    "precioBaseUsado": 95000,
    "importeTotal": 32300000,
    "cae": "75239...",
    "vencimientoCae": "20260820",
    "numero": "0001-00000123",
    "estado": "emitida"
  }
  ```
- **Errores**:
  - `422 VALIDATION_ERROR` — mismo criterio que `preview`.
  - `404 PRECIO_BASE_NOT_FOUND` — igual que `preview`.
  - `409 ARCA_REJECTED` — ARCA rechazó el comprobante (`cae: ""` traducido a
    `ArcaRejectionError`, patrón ya existente en `apps/api/src/services/arca/`); la factura
    queda persistida en `estado: "error"` y el índice único parcial
    `(usuario_id, periodo) WHERE estado <> 'error'` permite reintentar sin quedar bloqueado
    para siempre en ese período.
  - `502 ARCA_UNAVAILABLE` — WSAA/WSFE caídos o timeout.

## `GET /v1/facturas` (historial)

Listado paginado de las facturas del usuario autenticado.

- **Auth**: Bearer.
- **Query params**: `desde` (fecha, opcional), `hasta` (fecha, opcional), `estado`
  (`pendiente|emitida|error`, opcional), `page` (default `1`), `limit` (default a definir en
  `feature/facturas-service-v2`, ej. `20`).
- **Response `200`**:
  ```json
  {
    "data": [
      {
        "id": "uuid",
        "periodo": "2026-08-01",
        "importeTotal": 32300000,
        "estado": "emitida",
        "numero": "0001-00000123"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 7 }
  }
  ```

## `GET /v1/facturas/:id`

Detalle completo de una factura del usuario autenticado.

- **Auth**: Bearer.
- **Response `200`**:
  ```json
  {
    "id": "uuid",
    "periodo": "2026-08-01",
    "unidades": 340,
    "precioBaseUsado": 95000,
    "importeTotal": 32300000,
    "cae": "75239...",
    "vencimientoCae": "20260820",
    "numero": "0001-00000123",
    "estado": "emitida",
    "createdAt": "2026-08-10T12:00:00.000Z"
  }
  ```
- **Errores**: `404 FACTURA_NOT_FOUND` (no existe, o pertenece a otro usuario).

## `GET /v1/facturas/:id/pdf`

Genera el PDF del comprobante on-demand con `@arcasdk/pdf` (incluye QR de ARCA) — sin storage
persistente, se reconstruye siempre desde los datos de la factura + CAE (PLAN.md "PDF").
Requiere Chromium headless en el runtime (`feature/pdf-generation` agrega el `Dockerfile`).

- **Auth**: Bearer.
- **Response `200`**: binario `application/pdf` (`Content-Disposition: inline` o `attachment`
  a definir en `feature/pdf-generation` — la PWA necesita poder tanto previsualizar como
  compartir el archivo).
- **Errores**: `404 FACTURA_NOT_FOUND`, `409 FACTURA_NOT_EMITIDA` (no tiene CAE todavía, no hay
  nada que renderizar).

---

## Cosas explícitamente sin definir acá (decidir en las ramas de backend correspondientes)

- Formato exacto de expiración de `accessToken`/`refreshToken` y si el refresh rota o no en
  cada uso.
- Si `condicionIva` en `POST /v1/usuarios` es un enum fijo o libre (el receptor fijo es
  Responsable Inscripto, pero el *emisor* — el repartidor — es típicamente monotributista).
- `limit` máximo/default de `GET /v1/facturas` y si soporta `sort`.
- Códigos de error específicos de validación de cert/key ARCA en el alta.
- Si `POST /v1/facturas/preview` requiere que el usuario ya tenga cert/key cargado y validado, o
  si el preview es puramente aritmético y no toca `usuarios` en absoluto.
