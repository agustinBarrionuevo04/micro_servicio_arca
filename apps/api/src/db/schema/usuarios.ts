import { pgTable, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { arcaAmbienteEnum } from './enums.js';

/**
 * Un repartidor monotributista de EPSA. Reemplaza a `tenants` (comercio
 * B2B genérico) — este producto tiene un solo tipo de usuario final, dueño
 * de su propia cuenta (login CUIT + contraseña, ver `feature/usuarios-auth`),
 * no un cliente administrado por un tercero vía API key.
 *
 * `cert`/`key` viajan cifrados en reposo (AES-256-GCM, ver
 * `config/crypto.ts`) — mismo esquema que en `tenants`, no se toca
 * `crypto.ts` en esta rama.
 */
export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  cuit: varchar('cuit', { length: 13 }).notNull().unique(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  domicilio: text('domicilio').notNull(),
  // Fijo a Monotributo en este producto: es un dato de display en la
  // factura/perfil del usuario, no algo que el código branchee (a
  // diferencia del viejo `condicionFiscal`, que sí decidía el tipo de
  // comprobante). Ver PLAN.md — "Qué se reemplaza".
  condicionIva: text('condicion_iva').notNull().default('Responsable Monotributo'),
  puntoVenta: integer('punto_venta').notNull().default(1),
  cert: text('cert').notNull(),
  key: text('key').notNull(),
  // Por usuario, nunca global (ver arcaAmbienteEnum / PLAN.md "Seguridad").
  ambiente: arcaAmbienteEnum('ambiente').notNull().default('homologacion'),
  // Hash argon2; la propia autenticación (alta/login/verify) es de
  // `feature/usuarios-auth`, acá solo reservamos la columna.
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Usuario = typeof usuarios.$inferSelect;
export type NewUsuario = typeof usuarios.$inferInsert;
