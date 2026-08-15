# Probar la API con Postman

Guía paso a paso para comunicarte con `ARCA Billing API` desde Postman, sin tener que escribir
`curl` a mano.

## 0. Requisitos previos

El servidor tiene que estar corriendo localmente:

```bash
docker compose up -d   # levanta Postgres
pnpm dev                # levanta la API en http://localhost:3000
```

## 1. (Atajo) Importar la colección automáticamente desde el OpenAPI

La API expone su spec OpenAPI en `/docs/json`. Postman puede generar una colección completa a
partir de esa URL, con todos los endpoints y schemas ya cargados:

1. En Postman: **File → Import**.
2. Pestaña **Link**, pegar: `http://localhost:3000/docs/json`.
3. Importar. Vas a tener una colección "ARCA Billing API" con todas las rutas.

Con eso ya podés saltar directo al paso 3 (configurar el entorno) y usar los requests generados.
Si preferís armarlos a mano para entender mejor el flujo, seguí leyendo desde el paso 2.

## 2. Crear un Environment en Postman

Creá un Environment (ícono del ojo, arriba a la derecha → "+") con estas variables:

| Variable   | Valor inicial           | Se completa en el paso... |
|------------|--------------------------|----------------------------|
| `base_url` | `http://localhost:3000` | ahora                      |
| `api_key`  | *(vacío)*                | paso 3                     |
| `tenant_id`| *(vacío)*                | paso 3 (opcional)          |
| `factura_id`| *(vacío)*               | paso 5 (opcional)          |

Seleccioná este Environment como activo antes de seguir.

## 3. Crear un tenant de prueba

Este endpoint es interno (no lleva `Authorization`) — sirve para dar de alta un comercio y generar
su API key.

- **Method**: `POST`
- **URL**: `{{base_url}}/admin/tenants`
- **Headers**: `Content-Type: application/json`
- **Body** (raw, JSON):

```json
{
  "razonSocial": "Comercio de Prueba SRL",
  "cuit": "20-12345678-9",
  "condicionFiscal": "monotributo",
  "puntoVenta": 1,
  "cert": "<contenido del certificado PEM>",
  "key": "<contenido de la clave privada PEM>"
}
```

> Sin certificados reales de ARCA, la creación del tenant funciona igual — el certificado/clave
> recién se usan cuando se intenta emitir una factura de verdad.

**Respuesta (201)**:

```json
{
  "tenant": { "id": "...", "razonSocial": "...", "cuit": "...", "...": "..." },
  "apiKey": "ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Copiá el valor de `apiKey` y pegalo en la variable de entorno `api_key` (y `tenant.id` en
`tenant_id` si querés). En Postman podés automatizar esto agregando en la pestaña **Tests** del
request:

```javascript
const body = pm.response.json();
pm.environment.set("api_key", body.apiKey);
pm.environment.set("tenant_id", body.tenant.id);
```

Así, cada vez que corras este request, las variables se actualizan solas.

## 4. Emitir una factura

- **Method**: `POST`
- **URL**: `{{base_url}}/v1/facturas`
- **Headers**:
  - `Authorization`: `Bearer {{api_key}}`
  - `Idempotency-Key`: cualquier string único por venta, ej. `order-001` (cambialo en cada request
    nueva; si repetís el mismo valor, la API te devuelve la factura ya creada en vez de procesar
    de nuevo)
  - `Content-Type`: `application/json`
- **Body** (raw, JSON):

```json
{
  "cliente": { "tipo_doc": "CF", "nro_doc": null },
  "items": [
    { "descripcion": "Producto de prueba", "cantidad": 1, "precio_unitario": 100 }
  ],
  "total": 100
}
```

**Respuesta (201, si ARCA aprueba)**:

```json
{
  "id": "fac_...",
  "cae": "...",
  "vencimiento_cae": "YYYYMMDD",
  "numero": "0001-00000001",
  "estado": "aprobada"
}
```

Si repetís el request con el mismo `Idempotency-Key`, la respuesta es **200** con la misma
factura (no se crea una nueva). Si ARCA rechaza el comprobante, la respuesta es **422** con el
detalle del rechazo.

> Sin certificados de ARCA reales y homologados para el CUIT del tenant, este request va a fallar
> en el paso de autenticación contra ARCA (esperado). Ver `README.md` para más contexto.

Tip: en la pestaña **Tests**, para guardar el id de la factura creada:

```javascript
if (pm.response.code === 201 || pm.response.code === 200) {
  pm.environment.set("factura_id", pm.response.json().id);
}
```

## 5. Consultar una factura por id

- **Method**: `GET`
- **URL**: `{{base_url}}/v1/facturas/{{factura_id}}`
- **Headers**: `Authorization`: `Bearer {{api_key}}`

## 6. Listar facturas (paginado y filtrable)

- **Method**: `GET`
- **URL**: `{{base_url}}/v1/facturas`
- **Headers**: `Authorization`: `Bearer {{api_key}}`
- **Query params** (todos opcionales), en la pestaña **Params** de Postman:
  - `desde` — fecha ISO, ej. `2026-01-01`
  - `hasta` — fecha ISO
  - `estado` — `pendiente` | `aprobada` | `rechazada`
  - `page` — default `1`
  - `limit` — default `20`, máximo `100`

## 7. Health checks (sin autenticación)

- `GET {{base_url}}/v1/health` — estado propio de la API.
- `GET {{base_url}}/v1/arca/status` — estado de los servicios de ARCA (WSAA/WSFE).

## Formato de errores

Cualquier error de la API (validación, auth, rechazo de ARCA, etc.) responde con este shape:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "descripción humana",
    "details": {}
  }
}
```

Códigos más comunes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FACTURA_NOT_FOUND` /
`TENANT_NOT_FOUND` (404), `ARCA_REJECTION` (422), `INTERNAL_ARCA_ERROR` / `INTERNAL_ERROR` (500).

## Orden sugerido para probar todo el flujo en Postman

1. `POST /admin/tenants` (guarda `api_key` automáticamente si configuraste el script de Tests)
2. `POST /v1/facturas` con un `Idempotency-Key` nuevo
3. Repetir el mismo `POST /v1/facturas` con el **mismo** `Idempotency-Key` → confirmar que devuelve
   200 y el mismo `id`
4. `GET /v1/facturas/{{factura_id}}`
5. `GET /v1/facturas` para ver el listado
