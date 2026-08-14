import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/env.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/arca_billing',
  ENCRYPTION_KEY: 'a'.repeat(64),
  // Irrelevante para los tests de ENCRYPTION_KEY, pero requerido por
  // envSchema desde que se agregó JWT_SECRET (ver `src/config/env.ts`,
  // `feature/usuarios-auth`) — sin esto, safeParse fallaría por un motivo
  // distinto al que cada test intenta probar.
  JWT_SECRET: 'a'.repeat(32),
};

describe('envSchema - ENCRYPTION_KEY', () => {
  it('acepta una key hex de 64 caracteres', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      ENCRYPTION_KEY: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it('rechaza una key de 64 caracteres que no es hex', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      ENCRYPTION_KEY: 'z'.repeat(64), // 'z' no es un dígito hex válido
    });
    expect(result.success).toBe(false);
  });

  it('rechaza una key con longitud correcta pero caracteres mixtos no-hex', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      ENCRYPTION_KEY: `${'a'.repeat(63)}g`, // 'g' rompe el patrón hex
    });
    expect(result.success).toBe(false);
  });

  it('rechaza una key más corta que 64 caracteres', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      ENCRYPTION_KEY: 'a'.repeat(32),
    });
    expect(result.success).toBe(false);
  });
});

describe('envSchema - JWT_SECRET', () => {
  it('acepta un secret de exactamente 32 caracteres', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it('acepta un secret más largo que 32 caracteres', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      JWT_SECRET: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it('rechaza un secret más corto que 32 caracteres', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      JWT_SECRET: 'a'.repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un secret ausente', () => {
    const { JWT_SECRET: _omit, ...envSinJwtSecret } = baseEnv;
    const result = envSchema.safeParse(envSinJwtSecret);
    expect(result.success).toBe(false);
  });
});
