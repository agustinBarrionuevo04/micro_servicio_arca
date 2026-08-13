/**
 * Errores de dominio tipados. El handler global de Fastify (`app.ts`)
 * atrapa cualquier `AppError` y responde con `toJSON()` + `statusCode`,
 * así que cada subclase nueva solo necesita definir su `code`/status/HTTP —
 * no hace falta tocar el handler para que se traduzca correctamente.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details ?? {},
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class TenantNotFoundError extends AppError {
  constructor(message = 'Tenant not found') {
    super('TENANT_NOT_FOUND', message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing API key') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ArcaRejectionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('ARCA_REJECTION', message, 422, details);
  }
}

export class DuplicateIdempotencyKeyError extends AppError {
  constructor() {
    super('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key already used', 409);
  }
}

export class InternalArcaError extends AppError {
  constructor(message = 'Internal error communicating with ARCA') {
    super('INTERNAL_ARCA_ERROR', message, 500);
  }
}

export class FacturaNotFoundError extends AppError {
  constructor() {
    super('FACTURA_NOT_FOUND', 'Factura not found', 404);
  }
}

/**
 * `POST /v1/auth/login` con CUIT inexistente o contraseña incorrecta.
 * Deliberadamente el mismo código/mensaje para ambos casos (ver
 * `modules/usuarios-auth/service.ts` — `login`): distinguirlos permitiría a
 * un atacante enumerar qué CUITs están registrados en la plataforma
 * probando contraseñas al voleo, algo que no aporta nada al usuario
 * legítimo (que de cualquier forma tiene que volver a intentar) pero sí
 * filtra información. Ver también docs/api-contract.md.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid CUIT or password', 401);
  }
}

/**
 * `POST /v1/auth/refresh` con un refresh token inexistente, ya rotado
 * (`revokedAt` seteado), o vencido (`expiresAt` pasado). Un único código
 * para los tres casos por el mismo motivo que `InvalidCredentialsError`: no
 * darle a quien prueba tokens al voleo ninguna señal de cuál de los tres
 * casos fue (ej. "vencido" vs "no existe" filtraría si el token alguna vez
 * fue válido).
 */
export class InvalidRefreshTokenError extends AppError {
  constructor() {
    super('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
  }
}

/**
 * JWT de acceso ausente, mal formado, con firma inválida, o vencido en una
 * ruta protegida por `authenticate` (ver
 * `modules/usuarios-auth/middleware.ts`). Se usa el mismo código para las
 * cuatro variantes: el cliente (PWA) siempre debe reaccionar igual (limpiar
 * el token guardado e intentar `POST /v1/auth/refresh` o mandar al usuario
 * a loguearse de nuevo), así que no gana nada distinguiéndolas, y no
 * queremos filtrarle a quien esté probando tokens ajenos cuál de los casos
 * fue.
 */
export class InvalidTokenError extends AppError {
  constructor(message = 'Invalid or expired token') {
    super('INVALID_TOKEN', message, 401);
  }
}
