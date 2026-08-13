/**
 * Access tokens (JWT, HS256, firmados con `JWT_SECRET`). Nunca se persisten
 * — se verifican con la firma y listo, O(1) por request (a diferencia del
 * refresh token, ver `tokens.ts`, que sí vive en `refresh_tokens` porque
 * necesita poder revocarse).
 *
 * ## Expiración: 15 minutos
 *
 * Se eligió el extremo corto del rango usual (15-30 min) porque el costo de
 * que expire "de más" es bajísimo (la PWA llama `POST /v1/auth/refresh` en
 * silencio con el refresh token, sin interrumpir al usuario — ver
 * `docs/api-contract.md`) mientras que el costo de que viva "de más" es
 * real: un access token robado (ej. de un dispositivo perdido con la PWA
 * abierta) queda utilizable hasta que expira, sin ninguna forma de
 * revocarlo antes (a diferencia del refresh token). Minimizar esa ventana
 * es la única palanca que tenemos para un token que, por diseño, no se
 * puede invalidar server-side.
 *
 * ## Payload: solo `usuarioId`
 *
 * Nunca `passwordHash`, `cert`/`key` ni ningún otro dato de `usuarios` — un
 * JWT no está cifrado, solo firmado: cualquiera que lo intercepte puede
 * decodificar el payload (`atob` sobre la segunda parte) aunque no pueda
 * falsificarlo. `middleware.ts` resuelve el resto de los datos del usuario
 * con un lookup a DB en cada request autenticado, así que no hace falta (ni
 * conviene) viajar más que el id acá.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { InvalidTokenError } from '../../errors/index.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const ALGORITHM = 'HS256';

export interface AccessTokenPayload {
  usuarioId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    algorithm: ALGORITHM,
  });
}

/**
 * Lanza `InvalidTokenError` para cualquier motivo de falla (firma
 * inválida, vencido, malformado, o con un payload que no tiene la forma
 * esperada) — nunca deja escapar el error nativo de `jsonwebtoken`
 * (`TokenExpiredError`, `JsonWebTokenError`, etc.), ver el comentario de
 * `InvalidTokenError` en `errors/index.ts` sobre por qué un único código
 * cubre todas las variantes.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: string | jwt.JwtPayload;

  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  } catch {
    throw new InvalidTokenError();
  }

  if (typeof decoded === 'string' || typeof decoded['usuarioId'] !== 'string') {
    throw new InvalidTokenError();
  }

  return { usuarioId: decoded['usuarioId'] };
}
