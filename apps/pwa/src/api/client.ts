/**
 * Typed client for the v1 API described in docs/api-contract.md.
 *
 * MOCK MODE
 * ---------
 * Controlled by `VITE_API_MOCK` (see .env.example). It defaults to **on** — any value other
 * than the literal string "false" is treated as mocked — because at the time this scaffold was
 * built, none of the backend branches (feature/db-schema-v2, feature/usuarios-auth,
 * feature/facturas-service-v2, ...) had landed yet. This lets feature/pwa-onboarding-auth-screens
 * and feature/pwa-factura-flows build real screens against realistic fake data without waiting.
 *
 * `feature/pwa-api-integration` (Etapa 5 in PLAN.md) is the branch that flips this off for good
 * (or removes the mock branch entirely) once the real API is ready end-to-end. Until then, set
 * `VITE_API_MOCK=false` locally if you want to point a screen at a real running `apps/api`.
 *
 * Every exported function below has the exact same signature and return shape in both modes —
 * callers never need to know which mode is active.
 *
 * AUTH TOKEN
 * ----------
 * Authenticated endpoints don't take a token parameter. Call `setAccessToken()` (src/auth
 * AuthContext does this automatically on login/logout) and the client attaches
 * `Authorization: Bearer <token>` to every subsequent authenticated request.
 */

import type {
  CreateFacturaRequest,
  CreateFacturaResponse,
  FacturaDetalle,
  ListFacturasQuery,
  ListFacturasResponse,
  LoginRequest,
  LoginResponse,
  PreviewFacturaRequest,
  PreviewFacturaResponse,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  SignupResponse,
} from './types';
import {
  MOCK_PRECIO_BASE_VIGENTE,
  MOCK_USUARIO,
  RESERVED_BAD_LOGIN_CUIT,
  RESERVED_TAKEN_SIGNUP_CUIT,
  findMockFacturaByPeriodo,
  getMockFacturas,
  mockId,
  nextMockNumero,
  saveMockFactura,
} from './mockData';

const IS_MOCK = import.meta.env.VITE_API_MOCK !== 'false';
// `||` (not `??`) on purpose: an env pipeline that exports an unset var as `""` rather than
// omitting it should still fall back to the default, not silently turn every real-mode request
// into a same-origin relative fetch.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let currentAccessToken: string | null = null;

/** Registers the token attached to authenticated requests. Pass `null` to clear it (logout). */
export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

// -- real-mode HTTP plumbing --------------------------------------------------

/** Reads `{ error: { code, message } }` off a failed response, falling back to a generic error
 * if the body isn't JSON (e.g. an upstream proxy/502 page) — shared by both the JSON and blob
 * request paths so a caller (like getFacturaPdf) can't end up with a real backend's specific
 * error `code` silently downgraded to a generic one just because its response body is a PDF. */
async function throwForErrorResponse(res: Response): Promise<never> {
  let code = 'UNKNOWN_ERROR';
  let message = `Error ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    // response body wasn't JSON — fall back to the generic message above
  }
  throw new ApiError(res.status, code, message);
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; responseType?: 'json' | 'blob' } = {},
): Promise<T> {
  const { auth = false, responseType = 'json', headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  if (auth) {
    if (!currentAccessToken) {
      throw new ApiError(401, 'MISSING_ACCESS_TOKEN', 'No hay sesión activa.');
    }
    finalHeaders.Authorization = `Bearer ${currentAccessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...rest, headers: finalHeaders });

  if (!res.ok) return throwForErrorResponse(res);

  return (responseType === 'blob' ? await res.blob() : await res.json()) as T;
}

// -- mock-mode helpers ---------------------------------------------------------

/** Simulated network latency so loading states downstream get exercised realistically. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockDelay<T>(value: T, ms = 400): Promise<T> {
  await wait(ms);
  return value;
}

async function mockError(status: number, code: string, message: string, ms = 400): Promise<never> {
  await wait(ms);
  throw new ApiError(status, code, message);
}

function isValidCuit(cuit: string): boolean {
  return /^\d{11}$/.test(cuit);
}

// ============================================================================
// POST /v1/auth/login
// ============================================================================

export function login(body: LoginRequest): Promise<LoginResponse> {
  if (!IS_MOCK) return request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) });

  if (body.cuit === RESERVED_BAD_LOGIN_CUIT || !body.password) {
    return mockError(401, 'INVALID_CREDENTIALS', 'CUIT o contraseña incorrectos.');
  }
  return mockDelay({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    usuario: { ...MOCK_USUARIO, cuit: body.cuit },
  });
}

// ============================================================================
// POST /v1/auth/refresh
// ============================================================================

export function refresh(body: RefreshRequest): Promise<RefreshResponse> {
  if (!IS_MOCK) return request<RefreshResponse>('/auth/refresh', { method: 'POST', body: JSON.stringify(body) });

  if (!body.refreshToken) {
    return mockError(401, 'INVALID_REFRESH_TOKEN', 'El refresh token es inválido o expiró.');
  }
  return mockDelay({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' });
}

// ============================================================================
// POST /v1/usuarios (signup)
// ============================================================================

export function signup(body: SignupRequest): Promise<SignupResponse> {
  if (!IS_MOCK) return request<SignupResponse>('/usuarios', { method: 'POST', body: JSON.stringify(body) });

  if (body.cuit === RESERVED_TAKEN_SIGNUP_CUIT) {
    return mockError(409, 'CUIT_ALREADY_REGISTERED', 'Ya existe una cuenta con ese CUIT.');
  }
  if (!isValidCuit(body.cuit) || !body.password) {
    return mockError(422, 'VALIDATION_ERROR', 'Revisá los datos ingresados.');
  }
  return mockDelay({
    id: 'mock-usuario-new',
    cuit: body.cuit,
    razonSocial: body.razonSocial,
    domicilio: body.domicilio,
    condicionIva: body.condicionIva,
    ambiente: 'homologacion',
    createdAt: new Date().toISOString(),
  });
}

// ============================================================================
// POST /v1/facturas/preview
// ============================================================================

export function previewFactura(body: PreviewFacturaRequest): Promise<PreviewFacturaResponse> {
  if (!IS_MOCK) {
    return request<PreviewFacturaResponse>('/facturas/preview', {
      method: 'POST',
      body: JSON.stringify(body),
      auth: true,
    });
  }

  // `!(unidades > 0)` (not `<= 0`) so that a non-numeric `unidades` (NaN — e.g. from an empty or
  // unparsed form field) is rejected too: `NaN <= 0` is false and would silently slip through.
  if (!(body.unidades > 0)) {
    return mockError(422, 'VALIDATION_ERROR', 'Las unidades deben ser un número mayor a 0.');
  }
  return mockDelay({
    periodo: body.periodo,
    unidades: body.unidades,
    precioBaseVigente: MOCK_PRECIO_BASE_VIGENTE,
    importeTotal: body.unidades * MOCK_PRECIO_BASE_VIGENTE,
  });
}

// ============================================================================
// POST /v1/facturas (emitir)
// ============================================================================

export function createFactura(body: CreateFacturaRequest): Promise<CreateFacturaResponse> {
  if (!IS_MOCK) {
    return request<CreateFacturaResponse>('/facturas', {
      method: 'POST',
      body: JSON.stringify(body),
      auth: true,
    });
  }

  // Idempotency check runs BEFORE validation on purpose: per api-contract.md, retrying
  // POST /v1/facturas for an already-emitida período must return the existing invoice
  // regardless of what the retried body happens to contain (e.g. a stale/cleared `unidades`
  // field) — the natural key is (usuarioId, periodo), the body is only used the first time.
  const existing = findMockFacturaByPeriodo(body.periodo);
  if (existing) {
    return mockDelay({
      id: existing.id,
      periodo: existing.periodo,
      unidades: existing.unidades,
      precioBaseUsado: existing.precioBaseUsado,
      importeTotal: existing.importeTotal,
      cae: existing.cae ?? '',
      vencimientoCae: existing.vencimientoCae ?? '',
      numero: existing.numero ?? '',
      estado: existing.estado,
    });
  }

  if (!(body.unidades > 0)) {
    return mockError(422, 'VALIDATION_ERROR', 'Las unidades deben ser un número mayor a 0.');
  }

  const vencimiento = new Date();
  vencimiento.setDate(vencimiento.getDate() + 10);
  const vencimientoCae = vencimiento.toISOString().slice(0, 10).replace(/-/g, '');

  const factura: FacturaDetalle = {
    id: mockId(),
    periodo: body.periodo,
    unidades: body.unidades,
    precioBaseUsado: MOCK_PRECIO_BASE_VIGENTE,
    importeTotal: body.unidades * MOCK_PRECIO_BASE_VIGENTE,
    cae: String(Math.floor(70000000000000 + Math.random() * 9999999999999)),
    vencimientoCae,
    numero: nextMockNumero(),
    estado: 'emitida',
    createdAt: new Date().toISOString(),
  };
  saveMockFactura(factura);

  return mockDelay({
    id: factura.id,
    periodo: factura.periodo,
    unidades: factura.unidades,
    precioBaseUsado: factura.precioBaseUsado,
    importeTotal: factura.importeTotal,
    cae: factura.cae ?? '',
    vencimientoCae: factura.vencimientoCae ?? '',
    numero: factura.numero ?? '',
    estado: factura.estado,
  });
}

// ============================================================================
// GET /v1/facturas (historial)
// ============================================================================

export function listFacturas(query: ListFacturasQuery = {}): Promise<ListFacturasResponse> {
  if (!IS_MOCK) {
    const params = new URLSearchParams();
    if (query.desde) params.set('desde', query.desde);
    if (query.hasta) params.set('hasta', query.hasta);
    if (query.estado) params.set('estado', query.estado);
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return request<ListFacturasResponse>(`/facturas${qs ? `?${qs}` : ''}`, { auth: true });
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  let facturas = getMockFacturas().slice().sort((a, b) => b.periodo.localeCompare(a.periodo));
  if (query.estado) facturas = facturas.filter((f) => f.estado === query.estado);
  if (query.desde) facturas = facturas.filter((f) => f.periodo >= query.desde!);
  if (query.hasta) facturas = facturas.filter((f) => f.periodo <= query.hasta!);

  const total = facturas.length;
  const start = (page - 1) * limit;
  const pageItems = facturas.slice(start, start + limit);

  return mockDelay({
    data: pageItems.map((f) => ({
      id: f.id,
      periodo: f.periodo,
      importeTotal: f.importeTotal,
      estado: f.estado,
      numero: f.numero,
    })),
    pagination: { page, limit, total },
  });
}

// ============================================================================
// GET /v1/facturas/:id
// ============================================================================

export function getFactura(id: string): Promise<FacturaDetalle> {
  if (!IS_MOCK) return request<FacturaDetalle>(`/facturas/${id}`, { auth: true });

  const factura = getMockFacturas().find((f) => f.id === id);
  if (!factura) return mockError(404, 'FACTURA_NOT_FOUND', 'No se encontró la factura.');
  return mockDelay(factura);
}

// ============================================================================
// GET /v1/facturas/:id/pdf
// ============================================================================

export function getFacturaPdf(id: string): Promise<Blob> {
  if (!IS_MOCK) {
    return request<Blob>(`/facturas/${id}/pdf`, { auth: true, responseType: 'blob' });
  }

  const factura = getMockFacturas().find((f) => f.id === id);
  if (!factura) return mockError(404, 'FACTURA_NOT_FOUND', 'No se encontró la factura.');
  if (factura.estado !== 'emitida') {
    return mockError(409, 'FACTURA_NOT_EMITIDA', 'La factura todavía no tiene CAE.');
  }
  // Minimal well-formed (if content-free) PDF so `URL.createObjectURL` / share sheets downstream
  // have something real to work with.
  const fakePdf = `%PDF-1.4\n% Mock PDF for factura ${id} — feature/pwa-scaffold placeholder.\n%%EOF`;
  return mockDelay(new Blob([fakePdf], { type: 'application/pdf' }));
}
