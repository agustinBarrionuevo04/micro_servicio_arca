import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../../../src/config/env.js';
import { signAccessToken, verifyAccessToken } from '../../../src/modules/usuarios-auth/jwt.js';
import { InvalidTokenError } from '../../../src/errors/index.js';

describe('signAccessToken / verifyAccessToken', () => {
  it('el token firmado es verificable y devuelve el mismo usuarioId', () => {
    const token = signAccessToken({ usuarioId: 'usuario-123' });
    const payload = verifyAccessToken(token);
    expect(payload.usuarioId).toBe('usuario-123');
  });

  it('el token es HS256 y expira en 15 minutos', () => {
    const token = signAccessToken({ usuarioId: 'usuario-123' });
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded?.header.alg).toBe('HS256');

    const payload = decoded?.payload as jwt.JwtPayload;
    const ttlSeconds = payload.exp! - payload.iat!;
    expect(ttlSeconds).toBe(15 * 60);
  });

  it('rechaza un token firmado con un secret distinto', () => {
    const tokenAjeno = jwt.sign({ usuarioId: 'usuario-123' }, 'otro-secret-de-al-menos-32-caracteres', {
      algorithm: 'HS256',
      expiresIn: '15m',
    });

    expect(() => verifyAccessToken(tokenAjeno)).toThrow(InvalidTokenError);
  });

  it('rechaza un token vencido', () => {
    const tokenVencido = jwt.sign({ usuarioId: 'usuario-123' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '-1s',
    });

    expect(() => verifyAccessToken(tokenVencido)).toThrow(InvalidTokenError);
  });

  it('rechaza un token tamperado (payload alterado sin resignar)', () => {
    const token = signAccessToken({ usuarioId: 'usuario-123' });
    const [header, payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ usuarioId: 'otro-usuario' })).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${tamperedPayload}.${signature}`)).toThrow(InvalidTokenError);
  });

  it('rechaza un string que no es un JWT', () => {
    expect(() => verifyAccessToken('no-soy-un-jwt')).toThrow(InvalidTokenError);
  });

  it('rechaza un token firmado con un algoritmo distinto de HS256 (alg confusion)', () => {
    // `none` es el caso clásico de "alg confusion": si `verifyAccessToken`
    // no fijara `algorithms: ['HS256']` explícitamente, un atacante podría
    // forjar un token sin firma y hacerlo pasar. jsonwebtoken exige pasar
    // `algorithm: 'none'` explícitamente para firmar así.
    const tokenSinFirma = jwt.sign({ usuarioId: 'usuario-123' }, '', {
      algorithm: 'none',
      expiresIn: '15m',
    });

    expect(() => verifyAccessToken(tokenSinFirma)).toThrow(InvalidTokenError);
  });

  it('rechaza un token válido cuyo payload no tiene usuarioId', () => {
    const tokenSinUsuarioId = jwt.sign({ algo: 'distinto' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });

    expect(() => verifyAccessToken(tokenSinUsuarioId)).toThrow(InvalidTokenError);
  });
});
