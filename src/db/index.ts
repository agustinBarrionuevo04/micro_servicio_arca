/** Singleton de conexión a Postgres (pool + instancia de Drizzle), compartido por toda la app. */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
// Tipo del `tx` que recibe el callback de `db.transaction(async (tx) => ...)`.
// Se deriva del propio `db` en vez de importarlo de drizzle-orm para no
// desincronizarse si cambia la config (schema, driver) con la que se creó.
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export { schema };
