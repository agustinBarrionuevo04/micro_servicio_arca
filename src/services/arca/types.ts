/** Formas de request/response propias de nuestro dominio (camelCase), independientes del SDK de ARCA. */
export interface ArcaCredentials {
  cert: string;
  key: string;
  cuit: string;
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
