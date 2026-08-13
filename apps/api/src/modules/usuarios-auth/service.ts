/**
 * Lógica de negocio de `POST /v1/auth/login` y `POST /v1/auth/refresh` (ver
 * `routes.ts` para el binding HTTP y `docs/api-contract.md` para el
 * contrato). Separado de `routes.ts` para poder testear login/refresh sin
 * pasar por Fastify (`app.inject`) cuando conviene, igual que
 * `services/precios-base` y `services/fiscal-rules`.
 */
import { eq } from 'drizzle-orm';
import { db, type Database, type Transaction } from '../../db/index.js';
import { usuarios, refreshTokens } from '../../db/schema/index.js';
import { InvalidCredentialsError, InvalidRefreshTokenError } from '../../errors/index.js';
import { verifyPassword } from './passwords.js';
import { signAccessToken } from './jwt.js';
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from './tokens.js';
import { toAuthenticatedUsuario, type LoginInput, type LoginResult, type RefreshResult } from './types.js';

/**
 * Hash de relleno precalculado con `argon2.hash` sobre un valor aleatorio
 * que no corresponde a ninguna contraseña real ni a ningún usuario — se usa
 * como si fuera `usuario.passwordHash` cuando el CUIT no existe, para que
 * `login` siempre haga un `argon2.verify` real (mismo costo de cómputo,
 * ~mismo tiempo) exista o no ese CUIT en la tabla. Sin esto, un atacante
 * podría medir la latencia del response (con vs. sin el `argon2.verify`) y
 * usarla como oráculo para enumerar qué CUITs están registrados, incluso
 * devolviendo siempre el mismo `401 INVALID_CREDENTIALS` — ver
 * `InvalidCredentialsError` en `errors/index.ts` y `docs/api-contract.md`.
 *
 * El valor en sí es irrelevante (nunca va a matchear ninguna contraseña
 * real): lo único que importa es que tenga el formato real de un hash
 * argon2id, para que `verifyPassword` recorra el mismo camino de cómputo
 * que con un hash genuino. Generado una única vez fuera de este código con
 * `argon2.hash('dummy-password-never-used-' + randomBytes(16).toString('hex'))`.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$tI+tDBTwpLplWEjsnU8wJw$8KJjneVSN/pVfacOwIkWwgu4M9mS9kOcorqUdE/qCuY';

async function issueRefreshToken(
  usuarioId: string,
  executor: Database | Transaction
): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await executor.insert(refreshTokens).values({ usuarioId, tokenHash, expiresAt });

  return token;
}

/**
 * `cuit` inexistente y `password` incorrecta devuelven el mismo
 * `InvalidCredentialsError` (mismo código, mismo mensaje, mismo status) —
 * ver el comentario de esa clase en `errors/index.ts`. `verifyPassword`
 * corre siempre, contra un hash real o contra `DUMMY_PASSWORD_HASH`, nunca
 * se hace early-return antes de esa llamada (ver el comentario de
 * `DUMMY_PASSWORD_HASH` arriba).
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const [usuario] = await db.select().from(usuarios).where(eq(usuarios.cuit, input.cuit)).limit(1);

  const passwordHash = usuario?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await verifyPassword(passwordHash, input.password);

  if (!usuario || !passwordValid) {
    throw new InvalidCredentialsError();
  }

  const accessToken = signAccessToken({ usuarioId: usuario.id });
  const refreshToken = await issueRefreshToken(usuario.id, db);

  return {
    accessToken,
    refreshToken,
    usuario: toAuthenticatedUsuario(usuario),
  };
}

/**
 * Rota el refresh token: el usado se marca `revokedAt` y se inserta uno
 * nuevo, todo dentro de la misma transacción que además toma un lock de
 * fila (`.for('update')`) sobre la fila leída — sin ese lock, dos llamadas
 * concurrentes con el mismo `refreshToken` podrían leer ambas
 * `revokedAt: null` antes de que cualquiera de las dos escriba, y las dos
 * pasarían la validación y rotarían "exitosamente" (una reutilización de
 * token que la rotación existe justamente para detectar/evitar). El lock
 * serializa la segunda llamada hasta que la primera commitea, así que
 * siempre ve el estado ya actualizado.
 *
 * Un único `InvalidRefreshTokenError` cubre token inexistente, ya rotado
 * (`revokedAt` seteado) y vencido (`expiresAt` pasado) — ver el comentario
 * de esa clase en `errors/index.ts`.
 */
export async function refresh(refreshTokenPlain: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(refreshTokenPlain);

  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update');

    if (!stored || stored.revokedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRefreshTokenError();
    }

    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));

    const newRefreshToken = await issueRefreshToken(stored.usuarioId, tx);
    const accessToken = signAccessToken({ usuarioId: stored.usuarioId });

    return { accessToken, refreshToken: newRefreshToken };
  });
}
