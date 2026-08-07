/** Script de `pnpm db:migrate`: aplica los SQL generados en db/migrations contra `DATABASE_URL`. Se lee `process.env` directo (no `config/env.ts`) para no exigir el resto de las variables de la app solo para migrar. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);

  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('Migrations complete');

  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
