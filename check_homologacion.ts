/**
 * Script de verificación de credenciales ARCA (ambiente de homologación).
 *
 * Hace dos cosas:
 *   1. Pide un Ticket de Acceso (TA) al WSAA firmando un LoginTicketRequest con OpenSSL.
 *   2. Usa ese TA para llamar a FEDummy en wsfev1 (chequeo de que el servicio responde,
 *      no requiere datos de negocio).
 *
 * Requisitos:
 *   - Node 18+ (usa fetch nativo)
 *   - OpenSSL instalado y accesible en el PATH
 *   - Archivos: privada.key y facturate.crt en la misma carpeta (ajustá las rutas abajo)
 *
 * Uso:
 *   npx tsx verificar-homologacion.ts
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { randomInt } from "node:crypto";

process.loadEnvFile();

// ---- Configuración (ver .env / .env.example) ----
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (revisá tu .env)`);
  }
  return value;
}

const CERT_PATH = requireEnv("CERT_PATH");
const KEY_PATH = requireEnv("KEY_PATH");
const WSAA_URL = requireEnv("WSAA_URL");
const WSFEV1_URL = requireEnv("WSFEV1_URL");
const CUIT = requireEnv("CUIT"); // CUIT que representa el certificado

// ---- Paso 1: generar el LoginTicketRequest.xml ----
function buildLoginTicketRequest(): string {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000); // -10 min de margen de reloj
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000); // +10 min de validez del TRA

  const fmt = (d: Date) =>
    new Date(d.getTime() - 3 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "-03:00");

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${randomInt(1, 2_147_483_647)}</uniqueId>
    <generationTime>${fmt(generationTime)}</generationTime>
    <expirationTime>${fmt(expirationTime)}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
}

// ---- Paso 2: firmar el XML con OpenSSL (CMS/PKCS#7) ----
function signTRA(xml: string): string {
  const tmpXml = "./_tra_tmp.xml";
  const tmpCms = "./_tra_tmp.cms";
  writeFileSync(tmpXml, xml);

  try {
    execSync(
      `openssl cms -sign -in ${tmpXml} -out ${tmpCms} -signer ${CERT_PATH} -inkey ${KEY_PATH} -nodetach -outform PEM`,
    );
    const cms = readFileSync(tmpCms, "utf-8");
    // Nos quedamos solo con el contenido base64, sin las líneas BEGIN/END CMS
    return cms
      .replace("-----BEGIN CMS-----", "")
      .replace("-----END CMS-----", "")
      .trim();
  } finally {
    unlinkSync(tmpXml);
    unlinkSync(tmpCms);
  }
}

// ---- Paso 3: mandar el CMS al WSAA y extraer Token/Sign ----
async function loginCms(cmsBase64: string): Promise<{ token: string; sign: string }> {
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(WSAA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soapEnvelope,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`WSAA respondió ${res.status}: ${text}`);
  }

  // La respuesta viene con el TA escapado dentro del SOAP body. Lo extraemos.
  const loginCmsReturnMatch = text.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!loginCmsReturnMatch) {
    throw new Error(`No se encontró loginCmsReturn en la respuesta:\n${text}`);
  }

  const taXml = loginCmsReturnMatch[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');

  const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1];
  const sign = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1];

  if (!token || !sign) {
    throw new Error(`No se pudo extraer token/sign del TA:\n${taXml}`);
  }

  return { token, sign };
}

// ---- Paso 4: llamar a FEDummy con el TA obtenido ----
async function feDummy(): Promise<string> {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" />
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(WSFEV1_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://ar.gov.afip.dif.FEV1/FEDummy",
    },
    body: soapEnvelope,
  });

  return await res.text();
}

// ---- Main ----
async function main() {
  console.log("1) Generando y firmando LoginTicketRequest...");
  const tra = buildLoginTicketRequest();
  const cms = signTRA(tra);

  console.log("2) Solicitando TA al WSAA (homologación)...");
  const { token, sign } = await loginCms(cms);
  console.log("   ✔ TA obtenido correctamente.");
  console.log("   Token (primeros 30 chars):", token.slice(0, 30) + "...");
  console.log("   Sign  (primeros 30 chars):", sign.slice(0, 30) + "...");

  console.log("\n3) Llamando a FEDummy en wsfev1 (no requiere el TA, solo confirma que el servicio está arriba)...");
  const dummyResponse = await feDummy();
  console.log(dummyResponse);

  console.log("\nSi ves <AppServer>OK</AppServer>, <DbServer>OK</DbServer> y <AuthServer>OK</AuthServer> arriba, todo el circuito de credenciales funciona.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
