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
import type { Usuario } from '../../db/schema/index.js';

export type AuthenticatedUsuario = Omit<Usuario, 'passwordHash' | 'cert' | 'key'>;

export function toAuthenticatedUsuario(usuario: Usuario): AuthenticatedUsuario {
  const { passwordHash: _passwordHash, cert: _cert, key: _key, ...rest } = usuario;
  return rest;
}

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
