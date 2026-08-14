import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { usuarios, type ArcaAmbiente } from '../../src/db/schema/index.js';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
}

export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE facturas, contadores, precios_base, usuarios RESTART IDENTITY CASCADE`
  );
}

let cuitCounter = 20000000;

export function nextCuit(): string {
  cuitCounter += 1;
  return `20-${cuitCounter}-9`;
}

export interface TestUsuario {
  usuarioId: string;
  cuit: string;
  puntoVenta: number;
}

/**
 * No hay todavía un endpoint de alta self-service (`POST /v1/usuarios` o
 * equivalente) en esta rama — `feature/usuarios-onboarding` lo agrega más
 * adelante junto con la validación del cert contra ARCA antes de persistir.
 * Hasta entonces, los tests de integración insertan el usuario directo en
 * la tabla vía `db.insert(usuarios)`. Cuando ese endpoint exista, este
 * helper debería pasar a usar `app.inject('POST', '/v1/usuarios', ...)`
 * como hacía `createTestTenant` con `/admin/tenants`, para que los tests
 * ejerciten el flujo real de alta y no solo el estado final en DB.
 */
export async function createTestUsuario(
  overrides: Partial<{
    razonSocial: string;
    cuit: string;
    domicilio: string;
    puntoVenta: number;
    cert: string;
    key: string;
    ambiente: ArcaAmbiente;
    passwordHash: string;
  }> = {}
): Promise<TestUsuario> {
  const puntoVenta = overrides.puntoVenta ?? 1;
  const cuit = overrides.cuit ?? nextCuit();

  const [usuario] = await db
    .insert(usuarios)
    .values({
      razonSocial: overrides.razonSocial ?? 'Juan Repartidor',
      cuit,
      domicilio: overrides.domicilio ?? 'Calle Falsa 123, CABA',
      puntoVenta,
      cert: overrides.cert ?? 'fake-cert-content',
      key: overrides.key ?? 'fake-key-content',
      ambiente: overrides.ambiente ?? 'homologacion',
      // Hash de relleno: en esta rama la columna solo existe para que el
      // login (`feature/usuarios-auth`) tenga dónde escribir/leer; ningún
      // test de esta rama ejercita autenticación real todavía.
      passwordHash: overrides.passwordHash ?? 'fake-argon2-hash',
    })
    .returning();

  if (!usuario) {
    throw new Error('Failed to create test usuario');
  }

  return {
    usuarioId: usuario.id,
    cuit: usuario.cuit,
    puntoVenta,
  };
}
