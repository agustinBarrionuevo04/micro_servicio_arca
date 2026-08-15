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

/*
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

/*
 * No existe una fila de `precios_base` vigente para el período pedido —
 * un "agujero" en el historial de precios (p. ej. alguien olvidó sembrar
 * el precio de un mes, ver PLAN.md "precios_base: sin UI de
 * administración... se siembra a mano").
 *
 * 422 y no 404: esto no es "recurso no encontrado por id" (no hay ningún
 * id de `precio_base` en juego en el lookup por período), es un request
 * bien formado (`periodo` es una fecha válida) que no se puede procesar
 * con el estado actual de los datos — el mismo criterio que ya usa
 * `ArcaRejectionError` más arriba en este archivo.
 */
export class PrecioBaseNoVigenteError extends AppError {
  constructor(periodo: string) {
    super('PRECIO_BASE_NO_VIGENTE', `No hay un precio_base vigente para el período ${periodo}`, 422, {
      periodo,
    });
  }
}

/**
 * Más de una fila de `precios_base` resultó vigente para el mismo período —
 * viola la invariante de no-superposición que `crearPrecioBase` (ver
 * `services/precios-base`) garantiza en el insert. Si esto pasa es porque
 * alguien insertó filas solapadas por fuera de esa función (el único otro
 * camino de escritura a esta tabla en el MVP es SQL directo a mano, ver
 * PLAN.md).
 *
 * 500 porque no es un error causado por el request del cliente: es un dato
 * corrupto del lado del servidor que necesita intervención manual. Nunca
 * hay que "adivinar" cuál de las filas usar (p. ej. con un `.limit(1)`
 * arbitrario) — un precio equivocado elegido en silencio es exactamente el
 * tipo de bug fiscal que este chequeo existe para prevenir.
 */
export class PrecioBaseAmbiguoError extends AppError {
  constructor(periodo: string, precioBaseIds: string[]) {
    super(
      'PRECIO_BASE_AMBIGUO',
      `Se encontraron ${precioBaseIds.length} filas de precios_base vigentes para el período ${periodo}; se esperaba a lo sumo una`,
      500,
      { periodo, precioBaseIds }
    );
  }
}

/**
 * `crearPrecioBase` detectó que el rango `[vigenteDesde, vigenteHasta]`
 * pedido se superpone con una fila ya existente.
 *
 * 409 (Conflict): mismo criterio que `DuplicateIdempotencyKeyError` más
 * arriba — el request en sí es válido, pero choca con el estado actual de
 * la tabla, así que el caller tiene que decidir cómo resolverlo (ajustar
 * las fechas, o cerrar/editar la fila existente a mano) en vez de que el
 * servicio elija algo por su cuenta.
 */
export class PrecioBaseSolapadoError extends AppError {
  constructor(
    nuevo: { vigenteDesde: string; vigenteHasta: string | null },
    conflictos: Array<{ id: string; vigenteDesde: string; vigenteHasta: string | null }>
  ) {
    super(
      'PRECIO_BASE_SOLAPADO',
      `El rango [${nuevo.vigenteDesde}, ${nuevo.vigenteHasta ?? 'sin fin'}] de precios_base se superpone con ${conflictos.length} fila(s) existente(s)`,
      409,
      { nuevo, conflictos }
    );
  }
}

