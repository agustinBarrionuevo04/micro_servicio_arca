/**
 * Cifrado at-rest de `cert`/`key` de cada tenant (AES-256-GCM), con la clave
 * de aplicación tomada de `ENCRYPTION_KEY` — nunca hardcodeada ni derivada
 * del contenido a cifrar.
 *
 * `encrypt` empaqueta todo lo necesario para poder desencriptar después en
 * un solo string: `iv (16 bytes) + auth tag (16 bytes) + ciphertext`,
 * codificado en base64. `decrypt` deshace ese mismo layout. Si cambia el
 * layout acá, hay que migrar todos los `cert`/`key` ya cifrados en DB.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const data = Buffer.from(ciphertext, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
