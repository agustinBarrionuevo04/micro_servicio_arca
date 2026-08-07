/**
 * Config tipada de la app: leemos y validamos `process.env` una sola vez acá
 * (con Zod) para que el resto del código importe `env` con tipos, en vez de
 * leer `process.env.X` disperso y sin garantías por todos lados. Si falta o
 * es inválida alguna variable requerida, el proceso no arranca.
 */
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // 64 chars hex = 32 bytes, tamaño de clave que exige AES-256-GCM (ver
  // config/crypto.ts). Validamos que sean caracteres hex acá y no solo la
  // longitud: un valor de 64 chars no-hex pasaría esta validación pero
  // Buffer.from(str, 'hex') trunca en el primer par inválido y produce una
  // clave más corta, rompiendo createCipheriv recién en el primer uso real
  // (crear un tenant) en vez de fallar rápido al arrancar el proceso.
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'debe ser hex de 64 caracteres (32 bytes)'),
  ARCA_MODE: z.enum(['homologacion', 'produccion']).default('homologacion'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_TIME_WINDOW: z.coerce.number().default(60000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
