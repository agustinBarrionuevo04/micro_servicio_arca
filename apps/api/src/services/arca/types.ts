import type { ArcaAmbiente } from '../../db/schema/enums.js';

/** Formas de request/response propias de nuestro dominio (camelCase), independientes del SDK de ARCA. */
export interface ArcaCredentials {
  cert: string;
  key: string;
  cuit: string;
  // Resuelto por usuario (columna `usuarios.ambiente`), nunca desde una
  // variable de entorno global — ver `createArcaClient` en `index.ts` y
  // PLAN.md "Seguridad (no negociable)". Reusamos el tipo de
  // `db/schema/enums.ts` en vez de redefinirlo acá para que no puedan
  // divergir.
  ambiente: ArcaAmbiente;
}

export interface ArcaFacturaRequest {
  cbteTipo: number;
  ptoVta: number;
  cbteFecha: string;
  cbteDesde: number;
  cbteHasta: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  condicionIvaReceptorId: number;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impIVA: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
}

export interface ArcaFacturaResponse {
  cae: string;
  caeFchVto: string;
  cbteNro: number;
}

export interface ArcaStatus {
  wsfe: 'ok' | 'error';
  wsaa: 'ok' | 'error';
  message?: string;
}

export interface ArcaErrorDetail {
  code: number;
  message: string;
}
