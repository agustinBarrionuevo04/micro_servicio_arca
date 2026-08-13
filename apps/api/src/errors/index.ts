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
 * `GET /v1/facturas/:id/pdf` reconstruye el PDF a partir del CAE + datos del
 * comprobante (ver PLAN.md, "PDF") — una factura `pendiente` o `error`
 * todavía no tiene CAE, así que no hay nada fiscalmente válido que renderizar
 * todavía (mostrar un PDF sin CAE sería un comprobante trucho). 409 porque el
 * recurso (`factura`) existe y se identificó correctamente — el conflicto es
 * de estado, no de identidad (eso ya lo cubre `FacturaNotFoundError` / 404).
 */
export class FacturaNoEmitidaError extends AppError {
  constructor(estado: string) {
    super('FACTURA_NOT_EMITIDA', `La factura no está emitida (estado actual: ${estado})`, 409, {
      estado,
    });
  }
}
