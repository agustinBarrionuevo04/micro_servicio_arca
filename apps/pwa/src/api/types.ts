/**
 * TypeScript types mirroring docs/api-contract.md (v1). Keep this file in lockstep with that
 * doc — it's a shared draft, so when a backend branch (feature/usuarios-auth,
 * feature/facturas-service-v2, etc.) settles a shape for real, update both.
 */

export type Ambiente = 'homologacion' | 'produccion';

export type EstadoFactura = 'pendiente' | 'emitida' | 'error';

/**
 * The API contract leaves `condicionIva` undecided between a fixed enum and free text
 * (see api-contract.md "Cosas explícitamente sin definir acá"). Typed as `string` until
 * feature/usuarios-onboarding settles it.
 */
export type CondicionIva = string;

export interface Usuario {
  id: string;
  cuit: string;
  razonSocial: string;
  ambiente: Ambiente;
}

// -- POST /v1/auth/login ----------------------------------------------------

export interface LoginRequest {
  cuit: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  usuario: Usuario;
}

// -- POST /v1/auth/refresh ---------------------------------------------------

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

// -- POST /v1/usuarios (signup) ----------------------------------------------

export interface SignupRequest {
  cuit: string;
  razonSocial: string;
  domicilio: string;
  condicionIva: CondicionIva;
  password: string;
  /** PEM-encoded ARCA certificate. Never echoed back by the API. */
  cert: string;
  /** PEM-encoded ARCA private key. Never echoed back by the API. */
  key: string;
}

export interface SignupResponse {
  id: string;
  cuit: string;
  razonSocial: string;
  domicilio: string;
  condicionIva: CondicionIva;
  ambiente: Ambiente;
  createdAt: string;
}

// -- POST /v1/facturas/preview -----------------------------------------------

export interface PreviewFacturaRequest {
  /** Normalized to the first day of the billed month, e.g. "2026-08-01". */
  periodo: string;
  unidades: number;
}

export interface PreviewFacturaResponse {
  periodo: string;
  unidades: number;
  precioBaseVigente: number;
  importeTotal: number;
}

// -- POST /v1/facturas (emitir) ----------------------------------------------

export interface CreateFacturaRequest {
  periodo: string;
  unidades: number;
}

export interface CreateFacturaResponse {
  id: string;
  periodo: string;
  unidades: number;
  precioBaseUsado: number;
  importeTotal: number;
  cae: string;
  vencimientoCae: string;
  numero: string;
  estado: EstadoFactura;
}

// -- GET /v1/facturas (historial) --------------------------------------------

export interface ListFacturasQuery {
  desde?: string;
  hasta?: string;
  estado?: EstadoFactura;
  page?: number;
  limit?: number;
}

export interface FacturaResumen {
  id: string;
  periodo: string;
  importeTotal: number;
  estado: EstadoFactura;
  numero: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface ListFacturasResponse {
  data: FacturaResumen[];
  pagination: Pagination;
}

// -- GET /v1/facturas/:id ------------------------------------------------------

export interface FacturaDetalle {
  id: string;
  periodo: string;
  unidades: number;
  precioBaseUsado: number;
  importeTotal: number;
  cae: string | null;
  vencimientoCae: string | null;
  numero: string | null;
  estado: EstadoFactura;
  createdAt: string;
}

// -- Errors -------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
