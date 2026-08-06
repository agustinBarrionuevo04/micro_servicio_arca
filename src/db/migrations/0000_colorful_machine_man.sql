CREATE TYPE "public"."condicion_fiscal" AS ENUM('monotributo', 'resp_inscripto', 'exento');--> statement-breakpoint
CREATE TYPE "public"."estado_factura" AS ENUM('pendiente', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razon_social" varchar(255) NOT NULL,
	"cuit" varchar(13) NOT NULL,
	"condicion_fiscal" "condicion_fiscal" NOT NULL,
	"punto_venta" integer NOT NULL,
	"cert" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_cuit_unique" UNIQUE("cuit")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contadores" (
	"tenant_id" uuid NOT NULL,
	"pto_vta" integer NOT NULL,
	"cbte_tipo" integer NOT NULL,
	"ultimo_numero" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "contadores_tenant_id_pto_vta_cbte_tipo_pk" PRIMARY KEY("tenant_id","pto_vta","cbte_tipo")
);
--> statement-breakpoint
CREATE TABLE "facturas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"cae" varchar(20),
	"vencimiento_cae" varchar(10),
	"numero" varchar(20),
	"cbte_tipo" integer NOT NULL,
	"estado" "estado_factura" DEFAULT 'pendiente' NOT NULL,
	"payload_enviado" jsonb NOT NULL,
	"respuesta_arca" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_idempotency_idx" ON "facturas" USING btree ("tenant_id","idempotency_key");