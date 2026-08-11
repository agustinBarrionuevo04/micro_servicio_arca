# ARCA Billing API

API HTTP multi-tenant para la emisión de facturas electrónicas ante ARCA (ex-AFIP, Argentina).
Centraliza la integración de bajo nivel con ARCA (WSAA + WSFE, vía `@arcasdk/core`) detrás de un
contrato REST simple, con autenticación por API key, idempotencia y numeración segura de
comprobantes por tenant.

## Qué hace

Es un backend que varios sistemas (POS, e-commerce, formularios web), cada uno con su propia
autenticación, pueden usar para emitir facturas electrónicas sin tener que integrar ellos mismos
contra los web services de ARCA. Por cada request a `POST /v1/facturas`:

1. Resuelve qué tenant (comercio) está haciendo la request a partir de su API key.
2. Valida el body (cliente, items, total) con Zod.
3. Aplica las reglas fiscales del tenant (`resolverComprobante`) para determinar el tipo de
   comprobante correcto — hoy soporta **Monotributo → Consumidor Final → Factura C**, con la
   lógica preparada para sumar Responsable Inscripto (Factura A/B) y Exento sin reescribirla.
4. Asigna el próximo número de comprobante para ese tenant/punto de venta de forma segura ante
   concurrencia (`SELECT ... FOR UPDATE` dentro de una transacción).
5. Llama a ARCA (WSAA + WSFE) a través del wrapper interno de `@arcasdk/core` — ningún consumidor
   externo de la API sabe que ese SDK existe.
6. Persiste la factura con su CAE y devuelve el resultado.

Si la misma request se reintenta con el mismo header `Idempotency-Key`, se devuelve la factura ya
creada en vez de reprocesarla contra ARCA. Los datos de cada tenant (facturas, contadores,
certificados) están completamente aislados entre sí.

## Stack

- Node.js 20+, TypeScript estricto
- Fastify + Zod (`fastify-type-provider-zod`) para validación y OpenAPI
- Drizzle ORM + PostgreSQL
- Vitest (unit + integration)
- `@arcasdk/core` encapsulado en `src/services/arca/` — ningún consumidor externo lo conoce

## Levantar el proyecto localmente

Este backend vive en `apps/api/` (repo organizado como pnpm workspace, junto a `apps/pwa/`).
Los pasos 2, 4, 5 y 6 se ejecutan dentro de `apps/api/`; el paso 3 (Postgres, vía
`docker-compose.yml`) se ejecuta desde la raíz del repo.

### 1. Requisitos

- Node.js 20+
- pnpm
- Docker (para Postgres)

### 2. Variables de entorno

```bash
cd apps/api
cp .env.example .env
```

Generar una clave de cifrado de 32 bytes para `ENCRYPTION_KEY` (usada para cifrar `cert`/`key` de
cada tenant con AES-256-GCM):

```bash
openssl rand -hex 32
```

Pegar el valor generado en `.env`.

### 3. Levantar Postgres

Desde la raíz del repo:

```bash
docker compose up -d
```

### 4. Instalar dependencias

Desde la raíz del repo (instala todo el workspace, incluido `apps/api`):

```bash
pnpm install
```

### 5. Generar y aplicar migraciones

Dentro de `apps/api/`:

```bash
pnpm db:generate   # genera SQL a partir de src/db/schema (ya versionado en el repo)
pnpm db:migrate    # aplica las migraciones contra Postgres
```

### 6. Levantar el servidor

Dentro de `apps/api/`:

```bash
pnpm dev
```

El servidor queda en `http://localhost:3000`. La documentación OpenAPI (Swagger UI) está en
`http://localhost:3000/docs`.

## Crear un tenant + API key de prueba

El endpoint `POST /admin/tenants` es un endpoint interno de administración (no forma parte de la
API pública v1, no requiere API key) que crea un tenant, cifra su certificado/clave de ARCA, genera
su primera API key y siembra el contador de comprobantes.

```bash
curl -s -X POST http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "razonSocial": "Comercio de Prueba SRL",
    "cuit": "20-12345678-9",
    "condicionFiscal": "monotributo",
    "puntoVenta": 1,
    "cert": "<contenido del certificado X.509 en PEM>",
    "key": "<contenido de la clave privada en PEM>"
  }'
```

Respuesta:

```json
{
  "tenant": {
    "id": "…",
    "razonSocial": "Comercio de Prueba SRL",
    "cuit": "20-12345678-9",
    "condicionFiscal": "monotributo",
    "puntoVenta": 1,
    "createdAt": "…"
  },
  "apiKey": "ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Guardar `apiKey`: solo se devuelve en texto plano en este momento; en la base de datos se almacena
únicamente su hash (argon2).

> Nota: `cert`/`key` deben ser un certificado y clave privada reales, emitidos y homologados por
> ARCA para el CUIT del tenant. Sin credenciales válidas, la llamada a ARCA fallará en el paso de
> autenticación WSAA (esperado en un entorno sin certificados registrados).

## Emitir una factura

```bash
curl -s -X POST http://localhost:3000/v1/facturas \
  -H "Authorization: Bearer ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Idempotency-Key: order-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "cliente": { "tipo_doc": "CF", "nro_doc": null },
    "items": [{ "descripcion": "Producto de prueba", "cantidad": 1, "precio_unitario": 100 }],
    "total": 100
  }'
```

Respuesta (201):

```json
{
  "id": "…",
  "cae": "…",
  "vencimiento_cae": "YYYYMMDD",
  "numero": "0001-00000001",
  "estado": "aprobada"
}
```

Repetir la misma request con el mismo `Idempotency-Key` devuelve la factura ya creada (200, sin
reprocesar contra ARCA).

Otros endpoints:

- `GET /v1/facturas/:id` — estado de una factura
- `GET /v1/facturas?desde=&hasta=&estado=&page=&limit=` — listado paginado
- `GET /v1/health` — health check propio
- `GET /v1/arca/status` — estado de los servicios de ARCA (WSAA/WSFE)

## Tests

Dentro de `apps/api/`:

```bash
pnpm test              # unit + integration
pnpm test:coverage      # con reporte de cobertura
```

Los tests de integración levantan el servidor con `app.inject` (sin abrir puerto TCP) contra una
base Postgres real (`arca_billing_test` en el mismo contenedor de `docker-compose.yml`) y mockean
`@arcasdk/core` por completo — nunca pegan contra ARCA real, ni siquiera homologación.

Cobertura mínima exigida en `services/fiscal-rules` y `services/idempotency`: 80% (actualmente
~98%).

## Alcance de las reglas fiscales

`resolverComprobante` (`src/services/fiscal-rules/`) hoy solo cubre **Monotributo → Consumidor
Final → Factura C**. Está estructurada con un `switch` por `condicionFiscal` para agregar
Responsable Inscripto (Factura A/B, discriminación de IVA) y Exento sin reescribir la función.

## Seguridad

- `cert`/`key` de ARCA se cifran at-rest con AES-256-GCM (`ENCRYPTION_KEY`).
- Las API keys se guardan como hash argon2, nunca en texto plano.
- Los logs no imprimen certificados ni API keys (el header `Authorization` está redactado en el
  logger de Fastify).
- Rate limiting básico vía `@fastify/rate-limit`.
