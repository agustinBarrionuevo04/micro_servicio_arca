/**
 * Lógica de negocio de `POST /v1/auth/login` y `POST /v1/auth/refresh` (ver
 * `routes.ts` para el binding HTTP y `docs/api-contract.md` para el
 * contrato). Separado de `routes.ts` para poder testear login/refresh sin
 * pasar por Fastify (`app.inject`) cuando conviene, igual que
 * `services/precios-base` y `services/fiscal-rules`.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, type Database, type Transaction } from '../../db/index.js';
import { usuarios, refreshTokens } from '../../db/schema/index.js';
import { InvalidCredentialsError, InvalidRefreshTokenError } from '../../errors/index.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken } from './jwt.js';
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from './tokens.js';
import { authenticatedUsuarioColumns, type LoginInput, type LoginResult, type RefreshResult } from './types.js';

/**
 * Hash de relleno que no corresponde a ninguna contraseña real ni a ningún
 * usuario — se usa como si fuera `usuario.passwordHash` cuando el CUIT no
 * existe, para que `login` siempre haga un `argon2.verify` real (mismo
 * costo de cómputo, ~mismo tiempo) exista o no ese CUIT en la tabla. Sin
 * esto, un atacante podría medir la latencia del response (con vs. sin el
 * `argon2.verify`) y usarla como oráculo para enumerar qué CUITs están
 * registrados, incluso devolviendo siempre el mismo `401
 * INVALID_CREDENTIALS` — ver `InvalidCredentialsError` en `errors/index.ts`
 * y `docs/api-contract.md`.
 *
 * El valor en sí es irrelevante (nunca va a matchear ninguna contraseña
 * real): lo único que importa es que tenga el formato real de un hash
 * argon2id vigente. Por eso se calcula acá con `hashPassword` (el mismo
 * helper que hashea contraseñas reales) en vez de ser un string
 * hardcodeado: un string fijo, generado una sola vez "afuera", queda con
 * los parámetros de costo (`m`/`t`/`p`) de argon2 vigentes en el momento en
 * que se generó — si la librería `argon2` se actualiza y cambia sus
 * defaults, cada hash real nuevo usaría los parámetros nuevos mientras este
 * string congelado seguiría con los viejos, y `argon2.verify` contra un
 * hash con distinto costo tarda distinto, reabriendo en silencio el mismo
 * oráculo de timing que esto existe para cerrar (hallazgo de code review).
 * Top-level await: el proyecto es ESM (`"type": "module"`), así que este
 * módulo termina de inicializarse una sola vez al arrancar el proceso,
 * antes de que cualquier request pueda llegar a `login`.
 */
const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString('hex'));

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
  // Select acotado (no `.select()` completo): `login` necesita `passwordHash`
  // para verificar, pero no `cert`/`key` — nunca se usan acá, así que no
  // hace falta traer esos blobs cifrados solo para descartarlos (mismo
  // razonamiento que `middleware.ts#authenticate`, ver el comentario de
  // `authenticatedUsuarioColumns` en `types.ts`).
  const [usuario] = await db
    .select({ ...authenticatedUsuarioColumns, passwordHash: usuarios.passwordHash })
    .from(usuarios)
    .where(eq(usuarios.cuit, input.cuit))
    .limit(1);

  const passwordHash = usuario?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await verifyPassword(passwordHash, input.password);

  if (!usuario || !passwordValid) {
    throw new InvalidCredentialsError();
  }

  const accessToken = signAccessToken({ usuarioId: usuario.id });
  const refreshToken = await issueRefreshToken(usuario.id, db);
  const { passwordHash: _passwordHash, ...usuarioSafe } = usuario;

  return {
    accessToken,
    refreshToken,
    usuario: usuarioSafe,
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
