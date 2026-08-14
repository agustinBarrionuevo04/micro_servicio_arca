import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/modules/usuarios-auth/passwords.js';

describe('hashPassword / verifyPassword', () => {
  it('produce un hash distinto del texto plano, con formato argon2id', async () => {
    const hash = await hashPassword('correcthorsebatterystaple');
    expect(hash).not.toBe('correcthorsebatterystaple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('genera un hash distinto en cada llamada para la misma password (salt aleatorio)', async () => {
    const [hashA, hashB] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(hashA).not.toBe(hashB);
  });

  it('verifica correctamente una password contra su propio hash', async () => {
    const hash = await hashPassword('mi-password-segura');
    await expect(verifyPassword(hash, 'mi-password-segura')).resolves.toBe(true);
  });

  it('rechaza una password incorrecta', async () => {
    const hash = await hashPassword('mi-password-segura');
    await expect(verifyPassword(hash, 'otra-password')).resolves.toBe(false);
  });

  it('devuelve false (no lanza) ante un hash con formato corrupto', async () => {
    await expect(verifyPassword('esto-no-es-un-hash-argon2', 'cualquier-password')).resolves.toBe(false);
  });

  it('devuelve false (no lanza) ante un hash vacío', async () => {
    await expect(verifyPassword('', 'cualquier-password')).resolves.toBe(false);
  });
});
