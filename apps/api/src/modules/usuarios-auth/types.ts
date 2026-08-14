/**
 * Forma de `usuario` que viaja fuera de este módulo: en `request.usuario`
 * (ver `middleware.ts`, module augmentation de Fastify) y en la respuesta
 * de `POST /v1/auth/login`. Deliberadamente **no** es el tipo `Usuario`
 * completo de `db/schema/usuarios.ts` — excluye a propósito `passwordHash`,
 * `cert` y `key`: son datos sensibles que ninguna ruta downstream (ni un
 * log accidental de `request.usuario`, ni un `reply.send(request.usuario)`
 * apurado en una rama futura) debería poder filtrar ni por descuido. Que
 * sea imposible de expresar en el tipo es más fuerte que confiar en que
 * cada handler futuro recuerde no serializar esos campos.
 */
import { usuarios, type Usuario } from '../../db/schema/index.js';

/**
 * Proyección de columnas "seguras" de `usuarios`, para usar directo en
 * `.select(authenticatedUsuarioColumns)` en vez de traer la fila entera con
 * `.select()` y descartar los campos sensibles después. Dos razones:
 *
 * 1. Eficiencia: `cert`/`key` son blobs cifrados — traerlos en cada request
 *    autenticado (`middleware.ts`) para tirarlos sin usarlos es I/O
 *    desperdiciado en el hot path del servicio.
 * 2. Seguridad — allowlist, no denylist: la versión anterior traía la fila
 *    completa y la pasaba por una función que *excluía* `passwordHash`/
 *    `cert`/`key` por nombre. Eso falla *abierto*: una columna sensible
 *    nueva que se agregue a `usuarios.ts` en el futuro (ej. un secreto de
 *    2FA) viajaría por default a menos que alguien recuerde actualizar esa
 *    lista de exclusión. Filtrar en el `SELECT` mismo falla *cerrado*: una
 *    columna nueva simplemente no aparece hasta que alguien la agregue acá
 *    a propósito (hallazgo de code review).
 */
export const authenticatedUsuarioColumns = {
  id: usuarios.id,
  cuit: usuarios.cuit,
  razonSocial: usuarios.razonSocial,
  domicilio: usuarios.domicilio,
  condicionIva: usuarios.condicionIva,
  puntoVenta: usuarios.puntoVenta,
  ambiente: usuarios.ambiente,
  createdAt: usuarios.createdAt,
  updatedAt: usuarios.updatedAt,
} as const;

export type AuthenticatedUsuario = Omit<Usuario, 'passwordHash' | 'cert' | 'key'>;

export interface LoginInput {
  cuit: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  usuario: AuthenticatedUsuario;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}
