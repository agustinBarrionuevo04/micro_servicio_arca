import { describe, it, expect } from 'vitest';
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from '../../../src/modules/usuarios-auth/tokens.js';

describe('generateRefreshToken', () => {
  it('genera un string no vacío, distinto en cada llamada', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();

    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('genera 32 bytes de entropía (base64url de 32 bytes -> 43 caracteres sin padding)', () => {
    const token = generateRefreshToken();
    expect(token).toHaveLength(43);
    // base64url no debe contener '+', '/' ni '=' de padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashRefreshToken', () => {
  it('es determinístico: el mismo token siempre hashea igual', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produce hashes distintos para tokens distintos', () => {
    const tokenA = generateRefreshToken();
    const tokenB = generateRefreshToken();
    expect(hashRefreshToken(tokenA)).not.toBe(hashRefreshToken(tokenB));
  });

  it('produce un hex de 64 caracteres (SHA-256)', () => {
    const hash = hashRefreshToken(generateRefreshToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('REFRESH_TOKEN_TTL_MS', () => {
  it('es 30 días en milisegundos', () => {
    expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
