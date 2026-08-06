import { pgTable, uuid, varchar, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { condicionFiscalEnum } from './enums.js';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  cuit: varchar('cuit', { length: 13 }).notNull().unique(),
  condicionFiscal: condicionFiscalEnum('condicion_fiscal').notNull(),
  puntoVenta: integer('punto_venta').notNull(),
  cert: text('cert').notNull(),
  key: text('key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
