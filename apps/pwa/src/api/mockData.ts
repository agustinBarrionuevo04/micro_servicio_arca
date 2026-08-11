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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(facturas));
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

export function findMockFacturaByPeriodo(periodo: string): FacturaDetalle | undefined {
  return readStore().find((f) => f.periodo === periodo && f.estado !== 'error');
}

export function nextMockNumero(): string {
  const count = readStore().filter((f) => f.numero).length;
  return `0001-${String(123 + count).padStart(8, '0')}`;
}

export function resetMockData(): void {
  writeStore(seedFacturas());
}
