/**
 * In-memory + localStorage-backed fake "database" used by src/api/client.ts when mock mode is
 * on (see that file's header). Kept in its own module so client.ts stays focused on the
 * per-endpoint request/response shape.
 *
 * Design notes for downstream branches (feature/pwa-onboarding-auth-screens,
 * feature/pwa-factura-flows):
 * - State persists in localStorage across reloads (key below) so a facturas list you build up
 *   while developing the "nueva factura" flow is still there when you refresh to work on the
 *   historial screen. Call `resetMockData()` (exported) to start clean, e.g. from a dev-only
 *   "reset demo data" button or the browser console.
 * - CUIT "00000000000" is a reserved sentinel for exercising the login error path
 *   (401 INVALID_CREDENTIALS) — see client.ts `login()`.
 * - CUIT "20345678901" is a reserved sentinel for exercising the signup conflict path
 *   (409 CUIT_ALREADY_REGISTERED) — it's also the example CUIT used in api-contract.md.
 */

import type { Ambiente, EstadoFactura, FacturaDetalle, Usuario } from './types';

const STORAGE_KEY = 'epsa:mockFacturas';

export const RESERVED_BAD_LOGIN_CUIT = '00000000000';
export const RESERVED_TAKEN_SIGNUP_CUIT = '20345678901';

export const MOCK_PRECIO_BASE_VIGENTE = 95000;

export const MOCK_USUARIO: Usuario = {
  id: 'mock-usuario-1',
  cuit: '20345678901',
  razonSocial: 'Juan Pérez',
  ambiente: 'homologacion' as Ambiente,
};

function seedFacturas(): FacturaDetalle[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return [
    {
      id: 'mock-factura-1',
      periodo: '2026-06-01',
      unidades: 310,
      precioBaseUsado: 90000,
      importeTotal: 310 * 90000,
      cae: '75239812345678',
      vencimientoCae: '20260710',
      numero: '0001-00000121',
      estado: 'emitida' as EstadoFactura,
      createdAt: new Date(now - 60 * day).toISOString(),
    },
    {
      id: 'mock-factura-2',
      periodo: '2026-07-01',
      unidades: 298,
      precioBaseUsado: 92000,
      importeTotal: 298 * 92000,
      cae: '75239887654321',
      vencimientoCae: '20260810',
      numero: '0001-00000122',
      estado: 'emitida' as EstadoFactura,
      createdAt: new Date(now - 30 * day).toISOString(),
    },
  ];
}

function readStore(): FacturaDetalle[] {
  if (typeof localStorage === 'undefined') return seedFacturas();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedFacturas();
    writeStore(seeded);
    return seeded;
  }
  try {
    return JSON.parse(raw) as FacturaDetalle[];
  } catch {
    const seeded = seedFacturas();
    writeStore(seeded);
    return seeded;
  }
}

function writeStore(facturas: FacturaDetalle[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(facturas));
  } catch {
    // Quota exceeded / storage disabled (e.g. iOS Safari private browsing gives a 0-byte quota):
    // the mock keeps working for the rest of this session via readStore's in-memory fallback,
    // it just won't persist across reloads. Not worth surfacing to the caller — this is fake
    // data, not a real save the user is trusting us with.
  }
}

export function getMockFacturas(): FacturaDetalle[] {
  return readStore();
}

export function saveMockFactura(factura: FacturaDetalle): void {
  const facturas = readStore();
  const idx = facturas.findIndex((f) => f.id === factura.id);
  if (idx >= 0) {
    facturas[idx] = factura;
  } else {
    facturas.push(factura);
  }
  writeStore(facturas);
}

/**
 * Excludes `estado: 'error'` on purpose, mirroring the backend's planned partial unique index
 * `(usuario_id, periodo) WHERE estado <> 'error'` (see PLAN.md): a rejected attempt must not
 * block retrying the same período, so it shouldn't count as "already emitted" for idempotency.
 * Nothing in this scaffold creates an `'error'` factura yet — feature/pwa-factura-flows is
 * expected to exercise this path once it builds the ARCA-rejection UI.
 */
export function findMockFacturaByPeriodo(periodo: string): FacturaDetalle | undefined {
  return readStore().find((f) => f.periodo === periodo && f.estado !== 'error');
}

/** Starts one past the highest existing `numero` (not a count) so the seeded 121/122 don't leave a gap. */
export function nextMockNumero(): string {
  const highest = readStore().reduce((max, f) => {
    if (!f.numero) return max;
    const n = Number(f.numero.split('-')[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 122);
  return `0001-${String(highest + 1).padStart(8, '0')}`;
}

/**
 * `crypto.randomUUID()` requires a secure context (HTTPS or localhost). This is a mobile-first
 * PWA meant to be tested from a real phone during development, typically via
 * `http://<lan-ip>:5173`, where `crypto.randomUUID` is `undefined` — fall back to a
 * non-cryptographic v4-shaped id, which is fine here since this is throwaway mock data, not a
 * real secret or a real ARCA-facing identifier.
 */
export function mockId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'mock-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function resetMockData(): void {
  writeStore(seedFacturas());
}
