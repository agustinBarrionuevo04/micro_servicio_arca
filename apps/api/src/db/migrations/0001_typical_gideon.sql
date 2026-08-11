CREATE TYPE "public"."arca_ambiente" AS ENUM('homologacion', 'produccion');--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cuit" varchar(13) NOT NULL,
	"razon_social" varchar(255) NOT NULL,
	"domicilio" text NOT NULL,
	"condicion_iva" text DEFAULT 'Responsable Monotributo' NOT NULL,
	"punto_venta" integer DEFAULT 1 NOT NULL,
	"cert" text NOT NULL,
	"key" text NOT NULL,
	"ambiente" "arca_ambiente" DEFAULT 'homologacion' NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_cuit_unique" UNIQUE("cuit")
);
--> statement-breakpoint
CREATE TABLE "precios_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"precio" numeric(12, 2) NOT NULL,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date
);
--> statement-breakpoint
ALTER TABLE "tenants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tenants" CASCADE;--> statement-breakpoint
DROP TABLE "api_keys" CASCADE;--> statement-breakpoint
-- Ajuste manual (no generado por drizzle-kit): el modelo de negocio cambió
-- por completo en este pivot (ventas genéricas por ítems, con un tenant
-- B2B por API key -> unidades x precio_base para un receptor fijo, con un
-- usuario final logueado). Una fila vieja de "facturas" no tiene ningún
-- valor válido para representar en periodo/unidades/precio_base_usado/
-- pto_vta (NOT NULL sin default más abajo), y su "tenant_id" apunta a una
-- fila de "tenants" que el DROP TABLE de arriba ya borró, así que tampoco
-- hay un "usuario_id" válido al que repuntar el rename de abajo. No existe
-- una migración de datos correcta acá — se descartan explícitamente en vez
-- de inventar valores falsos o dejar que el ALTER TABLE falle a mitad de
-- camino contra cualquier base que no esté vacía (una de staging con datos
-- de prueba del backend B2B viejo, por ejemplo).
TRUNCATE TABLE "contadores", "facturas" CASCADE;--> statement-breakpoint
ALTER TABLE "contadores" RENAME COLUMN "tenant_id" TO "usuario_id";--> statement-breakpoint
ALTER TABLE "facturas" RENAME COLUMN "tenant_id" TO "usuario_id";--> statement-breakpoint
-- Nota: drizzle-kit generó acá un `DROP CONSTRAINT` explícito para
-- "contadores_tenant_id_tenants_id_fk" y "facturas_tenant_id_tenants_id_fk",
-- pero el `DROP TABLE "tenants" CASCADE` de arriba ya los eliminó (son
-- constraints que referencian a "tenants"), así que el DROP CONSTRAINT
-- explícito fallaba con "constraint ... does not exist" contra una base
-- limpia. Se removieron esas dos líneas redundantes (verificado migrando
-- contra una base nueva) — es el único ajuste manual a la salida de
-- `drizzle-kit generate` en esta migración, el resto es 100% generado.
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DEFAULT 'pendiente'::text;--> statement-breakpoint
DROP TYPE "public"."estado_factura";--> statement-breakpoint
CREATE TYPE "public"."estado_factura" AS ENUM('pendiente', 'emitida', 'error');--> statement-breakpoint
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DEFAULT 'pendiente'::"public"."estado_factura";--> statement-breakpoint
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DATA TYPE "public"."estado_factura" USING "estado"::"public"."estado_factura";--> statement-breakpoint
DROP INDEX "tenant_idempotency_idx";--> statement-breakpoint
ALTER TABLE "contadores" DROP CONSTRAINT "contadores_tenant_id_pto_vta_cbte_tipo_pk";--> statement-breakpoint
ALTER TABLE "facturas" ALTER COLUMN "cbte_tipo" SET DEFAULT 11;--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_usuario_id_pto_vta_cbte_tipo_pk" PRIMARY KEY("usuario_id","pto_vta","cbte_tipo");--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "periodo" date NOT NULL;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "unidades" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "precio_base_usado" numeric(12, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "importe_total" numeric(12, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "pto_vta" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "cbte_nro" integer;--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "cae_fch_vto" varchar(10);--> statement-breakpoint
ALTER TABLE "facturas" ADD COLUMN "pdf_url" text;--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_periodo_idx" ON "facturas" USING btree ("usuario_id","periodo") WHERE "facturas"."estado" <> 'error';--> statement-breakpoint
ALTER TABLE "facturas" DROP COLUMN "idempotency_key";--> statement-breakpoint
ALTER TABLE "facturas" DROP COLUMN "vencimiento_cae";--> statement-breakpoint
ALTER TABLE "facturas" DROP COLUMN "numero";--> statement-breakpoint
DROP TYPE "public"."condicion_fiscal";