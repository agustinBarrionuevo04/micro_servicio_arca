import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { usuarios } from './usuarios.js';

/**
 * Refresh tokens de sesión (login CUIT + contraseña, ver
 * `modules/usuarios-auth`). El access token (JWT, corta duración) nunca se
 * persiste — se verifica con la firma (`JWT_SECRET`) y listo, O(1) por
 * request. El refresh token sí se persiste porque necesita poder
 * **revocarse** (logout, rotación, sesión robada) antes de su expiración
 * natural, algo que un JWT autocontenido no permite sin mantener además una
 * blocklist — que es, en esencia, esta misma tabla.
 *
 * El refresh token es un string opaco (`randomBytes`, ver
 * `modules/usuarios-auth/tokens.ts`), nunca un JWT: no necesita viajar
 * ningún claim, solo ser impredecible. Se guarda **hasheado**
 * (`tokenHash`, SHA-256 — no argon2: es alta entropía generada por
 * nosotros, no una contraseña de usuario elegida por un humano, así que no
 * hace falta un hash lento con salt para resistir fuerza bruta offline; ver
 * `modules/usuarios-auth/tokens.ts` para el detalle) para que un dump de
 * esta tabla no alcance para robar sesiones activas, igual que
 * `usuarios.passwordHash`.
 *
 * Rotación en cada uso (`POST /v1/auth/refresh`): el token usado se marca
 * `revokedAt` y se inserta una fila nueva, en vez de reutilizar la misma
 * fila con un `expiresAt` corrido. Guardar el historial completo (en vez de
 * pisar la fila) es lo que permite detectar reuso de un token ya rotado —
 * señal de robo de sesión — si en el futuro se quiere agregar esa
 * protección; por ahora esta rama solo lo registra, no actúa sobre eso.
 *
 * `onDelete: 'cascade'`: si se borra un usuario, sus refresh tokens no
 * tienen ningún sentido remanente (no hay a quién dejar loggeado).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // NULL = todavía vigente. Se setea al rotar (uso normal) o en un eventual
    // logout explícito (no hay endpoint de logout en esta rama, ver PR).
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // `service.ts#refresh` busca por `tokenHash` en CADA llamada a
    // POST /v1/auth/refresh (con SELECT ... FOR UPDATE, ver ese archivo) —
    // sin este índice es un full table scan bajo un row lock, que empeora
    // linealmente a medida que crece la tabla (no hay job de limpieza de
    // filas revocadas/expiradas todavía). Único, no solo indexado: un
    // SHA-256 duplicado no debería poder existir nunca (sería una colisión
    // o un bug de generación), así que el índice único además actúa como
    // chequeo de integridad, no solo de performance (hallazgo de code
    // review, corroborado por varios ángulos de revisión independientes).
    tokenHashIdx: uniqueIndex('refresh_tokens_token_hash_idx').on(table.tokenHash),
  })
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
