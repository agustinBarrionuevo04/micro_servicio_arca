/**
 * Refresh tokens: string opaco de alta entropía (nunca un JWT — no necesita
 * viajar ningún claim, ver `db/schema/refresh_tokens.ts`), generado con un
 * CSPRNG (`randomBytes`, no `Math.random()`) y persistido **hasheado**
 * (`tokenHash`) en la tabla `refresh_tokens`.
 *
 * ## Por qué SHA-256 y no argon2 acá
 *
 * `passwords.ts` usa argon2 (hash lento, con salt) porque una contraseña la
 * elige un humano y tiene entropía baja — hay que resistir fuerza bruta
 * offline sobre un dump de la tabla. Un refresh token es exactamente lo
 * opuesto: 256 bits de entropía generados por nosotros con un CSPRNG, cuyo
 * único requisito es ser impredecible. Un hash lento acá solo agregaría
 * latencia real (argon2 se diseña para tardar) sin ganar nada — SHA-256 ya
 * hace inviable ir de `tokenHash` de vuelta al token original (fuerza
 * bruta sobre 256 bits de entropía real, no un diccionario de contraseñas
 * humanas), y además permite un lookup determinístico por
 * `WHERE token_hash = ?` en `service.ts` (con argon2, salado y no
 * determinístico, habría que traer todas las filas y probar una por una —
 * el patrón que sí hace falta en el viejo `modules/auth/index.ts` para las
 * API keys, ver `git show origin/feature/monorepo-restructure:...`, pero
 * que ahí es aceptable solo porque el volumen de tenants es chico).
 */
import { randomBytes, createHash } from 'crypto';

const REFRESH_TOKEN_BYTES = 32;

/**
 * 30 días. Bastante más largo que el access token (15 min, ver `jwt.ts`) a
 * propósito: es lo que separa "el usuario tiene que volver a loguearse cada
 * 15 minutos" de "solo cuando no abre la PWA durante un mes" — y a
 * diferencia del access token, este sí se puede revocar antes de tiempo
 * (rotación en cada uso, ver `service.ts` — `refresh`), así que una vida
 * larga acá no deja la misma ventana de riesgo abierta que en un JWT
 * autocontenido.
 */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
