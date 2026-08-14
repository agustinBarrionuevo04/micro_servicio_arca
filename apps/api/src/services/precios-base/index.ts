/**
 * Historial de `precios_base` por rango de vigencia (ver PLAN.md, "Regla de
 * negocio central" y `db/schema/precios_base.ts`). Dos operaciones:
 *
 * - `getPrecioVigente(periodo)`: lookup de lectura, usado por
 *   `feature/facturas-service-v2` para resolver el `precioBase` que le pasa
 *   a `calcularComprobante` (ver `services/fiscal-rules`). Debe poder correr
 *   dentro de la misma transacción que orquesta la creación de una factura,
 *   por eso acepta `Database | Transaction` (ver `db/index.ts`) en vez de
 *   usar siempre el singleton `db`.
 * - `crearPrecioBase(input)`: única vía de escritura pensada para sembrar
 *   esta tabla a mano (no hay endpoint HTTP en el MVP, ver PLAN.md
 *   "precios_base: sin UI de administración"). Valida solapamiento de
 *   rangos en la aplicación — la tabla deliberadamente no tiene un
 *   `EXCLUDE` constraint de Postgres (ver el comentario en
 *   `db/schema/precios_base.ts` para el razonamiento completo).
 *
 * ## Corrección de límites (lo más importante de este módulo)
 *
 * `vigenteDesde` y `vigenteHasta` son **ambos inclusive**: un `periodo`
 * exactamente igual a `vigenteDesde` matchea, y un `periodo` exactamente
 * igual a `vigenteHasta` también matchea (la fila cubre ese día completo).
 * `vigenteHasta = null` significa "vigente hasta nuevo aviso" — cubre
 * cualquier período futuro sin límite.
 *
 * Las columnas `date` de Postgres/Drizzle en este proyecto viajan como
 * string `'YYYY-MM-DD'` (mode por defecto, sin hora ni zona horaria — ver
 * cómo se insertan en `tests/integration/schema.test.ts`). El parámetro
 * `periodo` de estas funciones sí es un `Date` de JS (más cómodo para quien
 * llama, p. ej. `new Date(2026, 7, 1)` para agosto 2026), así que hay que
 * convertirlo a ese mismo formato antes de comparar. Se hace con
 * `getFullYear`/`getMonth`/`getDate` (hora **local**), nunca con
 * `toISOString()` (que normaliza a UTC): si el proceso corre en una zona
 * horaria distinta de UTC-0, `new Date(2026, 7, 1).toISOString()` puede dar
 * `'2026-07-31T...'` en vez de `'2026-08-01'`, corriendo el período un día
 * para atrás — exactamente el tipo de bug de límite silencioso que le
 * cobraría a un usuario con el precio del mes equivocado.
 */
import { and, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db, type Database, type Transaction } from '../../db/index.js';
import { preciosBase, type PrecioBase } from '../../db/schema/index.js';
import {
  PrecioBaseAmbiguoError,
  PrecioBaseNoVigenteError,
  PrecioBaseSolapadoError,
  ValidationError,
} from '../../errors/index.js';

/** Ver el comentario del módulo sobre por qué se usan los getters locales y no `toISOString()`. */
function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Día calendario anterior a `date`, en hora local. `Date` normaliza correctamente cruces de mes/año (día 1 - 1 día → último día del mes anterior). */
function diaAnterior(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

/**
 * Formatea `precio` a 2 decimales para la columna `numeric` de Postgres,
 * SIN pasar por `precio.toFixed(2)`. `toFixed` redondea sobre la aritmética
 * de punto flotante del `number`, que arrastra el error de representación
 * binaria del literal: `1.005` en realidad se guarda como
 * `1.00499999999999989...`, así que `(1.005).toFixed(2)` da `'1.00'` en vez
 * de `'1.01'` — un precio mal persistido en silencio, sin ningún error que
 * lo delate (hallazgo de code review, confirmado con `node -e
 * "console.log((1.005).toFixed(2))"`).
 *
 * En cambio, esta función redondea sobre la representación decimal en
 * string más corta que reproduce exactamente ese `number` (`precio.toString()`
 * — la que coincide con lo que un humano tipeó, ej. `"1.005"`), mirando el
 * tercer dígito decimal para decidir si el centavo sube. Asume que `precio`
 * no cae en notación exponencial al convertirlo a string, lo cual vale para
 * cualquier monto de moneda real (JS solo usa notación exponencial fuera de
 * `[1e-6, 1e21)`, muy por fuera de cualquier precio base plausible).
 *
 * No maneja signo negativo a propósito: el único caller (`crearPrecioBase`)
 * ya rechaza `precio <= 0` antes de llegar acá, así que un negativo nunca
 * puede pasar por esta función — manejarlo igual sería código defensivo
 * para un caso que la validación de arriba ya hace imposible.
 */
function formatPrecio(precio: number): string {
  const [enterosStr, decimalesStr = ''] = precio.toString().split('.');
  const decimales = decimalesStr.padEnd(3, '0');
  const centavos = Number(decimales.slice(0, 2));
  const tercerDigito = Number(decimales[2]);

  let enteros = Number(enterosStr);
  let centavosRedondeados = tercerDigito >= 5 ? centavos + 1 : centavos;
  if (centavosRedondeados === 100) {
    enteros += 1;
    centavosRedondeados = 0;
  }

  return `${enteros}.${String(centavosRedondeados).padStart(2, '0')}`;
}

/**
 * Clave arbitraria para `pg_advisory_xact_lock` (ver su uso en
 * `crearPrecioBase`). No colisiona con nada más en esta app: no hay otro uso
 * de advisory locks en el código hoy (confirmado por grep antes de agregar
 * este). Si en el futuro se agrega otro advisory lock, elegir una clave
 * distinta.
 */
const PRECIOS_BASE_LOCK_KEY = 823_451_007n;

/**
 * Busca la fila de `precios_base` vigente para `periodo`. Nunca devuelve
 * "el precio actual a secas": si se pide el período de un mes pasado, hay
 * que obtener el precio que regía ese mes, aunque hoy ya haya cambiado (ver
 * PLAN.md, "Regla de negocio central") — esto es lo que permite recalcular o
 * emitir tarde una factura de un período viejo sin que le cobre de más (o de
 * menos) al usuario.
 *
 * @param periodo  Primer día del mes facturado (o cualquier fecha dentro de
 *                 ese mes — la comparación es por rango, no exige que sea
 *                 el día 1 exacto, aunque `facturas.periodo` sí se normaliza
 *                 así, ver PLAN.md).
 * @param executor `db` (default) o un `tx` abierto por quien orquesta (p.
 *                 ej. `feature/facturas-service-v2`), para que este lookup
 *                 participe de la misma transacción que reserva numeración
 *                 y persiste la factura.
 *
 * @throws {PrecioBaseNoVigenteError} si ninguna fila cubre el período (un
 *         hueco en el historial — falta sembrar un precio).
 * @throws {PrecioBaseAmbiguoError} si más de una fila cubre el período. Esto
 *         no debería poder pasar si todos los inserts pasaron por
 *         `crearPrecioBase`, pero es un caso defensivo real: un `.limit(1)`
 *         acá elegiría una fila arbitraria en silencio, que es exactamente
 *         el tipo de bug fiscal silencioso que este proyecto no se puede
 *         permitir (factura con el precio equivocado, sin ningún error que
 *         lo delate).
 */
export async function getPrecioVigente(
  periodo: Date,
  executor: Database | Transaction = db
): Promise<PrecioBase> {
  const periodoStr = formatDateOnly(periodo);

  const filas = await executor
    .select()
    .from(preciosBase)
    .where(
      and(
        lte(preciosBase.vigenteDesde, periodoStr),
        or(isNull(preciosBase.vigenteHasta), gte(preciosBase.vigenteHasta, periodoStr))
      )
    );

  if (filas.length === 0) {
    throw new PrecioBaseNoVigenteError(periodoStr);
  }

  if (filas.length > 1) {
    throw new PrecioBaseAmbiguoError(
      periodoStr,
      filas.map((fila) => fila.id)
    );
  }

  return filas[0]!;
}

export interface CrearPrecioBaseInput {
  precio: number;
  vigenteDesde: Date;
  /** `undefined`/`null` (default) = vigente hasta nuevo aviso (el precio "actual"). */
  vigenteHasta?: Date | null;
}

/**
 * Inserta una nueva fila de `precios_base`, validando que su rango de
 * vigencia no se superponga con ninguna fila existente.
 *
 * ## Decisión: cierre automático de la fila "actual" anterior
 *
 * Cuando la fila nueva es **abierta** (`vigenteHasta` no provisto — el caso
 * típico de "hoy cambió el precio, este es el nuevo actual"), esta función
 * cierra automáticamente la fila abierta anterior (si existe), poniéndole
 * `vigenteHasta = vigenteDesde_nueva - 1 día`, en la misma transacción que
 * el insert.
 *
 * Se eligió automático y no "el caller cierra la vieja explícitamente antes"
 * por cómo se opera esta tabla en la realidad: no hay UI de administración
 * en el MVP, se siembra a mano con un script o SQL directo (ver PLAN.md,
 * "precios_base: sin UI de administración"). Exigir dos pasos manuales
 * coordinados (cerrar la fila vieja con la fecha exacta correcta, y recién
 * después abrir la nueva) es más trabajo y más superficie de error humano
 * -- un desfasaje de un día entre el cierre y la apertura crea exactamente
 * el tipo de hueco o superposición que este módulo existe para prevenir --
 * que hacer que la función haga las dos cosas atómicamente. El propio
 * comentario de `db/schema/precios_base.ts` ya documenta esta expectativa
 * ("la fila anterior debería cerrarse... en la misma operación que abre la
 * nueva").
 *
 * El auto-cierre **solo** aplica cuando la fila nueva es abierta. Si el
 * caller pasa un `vigenteHasta` explícito (backfill de un precio histórico
 * que no es "el actual"), no se toca ninguna fila existente: cerrar la fila
 * "actual" en ese caso sería incorrecto (dejaría un hueco de vigencia entre
 * el fin del rango histórico insertado y la fecha real en la que ese precio
 * cambió), así que ese caso pasa directo a la validación de solapamiento de
 * abajo, que lo rechaza si corresponde.
 *
 * Si hay más de una fila abierta con `vigenteDesde` anterior a la nueva
 * (estado ya inconsistente — no debería ser posible si todos los inserts
 * pasaron por esta función), no se adivina cuál cerrar: se deja tal cual, y
 * la validación de solapamiento de abajo va a rechazar el insert igual
 * (`PrecioBaseSolapadoError`), porque cualquiera de esas filas abiertas se
 * superpone con la nueva.
 *
 * ## Concurrencia: advisory lock, no `SELECT ... FOR UPDATE`
 *
 * La primera versión de esta función usaba `SELECT ... FOR UPDATE` sobre las
 * filas existentes para serializar inserts concurrentes — pero `FOR UPDATE`
 * solo bloquea filas que **ya existen** y matchean el `WHERE`. No protege
 * contra un insert "fantasma" concurrente: dos llamadas simultáneas para la
 * primera fila de una tabla vacía, o dos rangos nuevos que no pisan ninguna
 * fila ya commiteada pero sí se pisan entre sí, pasan ambas la validación
 * bajo `READ COMMITTED` y las dos insertan — dejando un solapamiento real en
 * la tabla (hallazgo de code review, confirmado).
 *
 * La corrección es un `pg_advisory_xact_lock` al principio de la
 * transacción: la segunda llamada concurrente queda bloqueada hasta que la
 * primera haga commit/rollback, así que siempre ve el estado ya consistente
 * antes de leer/validar. El volumen de escritura de esta tabla es
 * bajísimo (se siembra a mano, cambia unas pocas veces al año, ver
 * PLAN.md), así que serializar *todos* los inserts (no solo los que
 * realmente se superponen) es una simplificación aceptable, no un cuello de
 * botella real.
 */
export async function crearPrecioBase(input: CrearPrecioBaseInput, executor: Database = db): Promise<PrecioBase> {
  if (!Number.isFinite(input.precio) || input.precio <= 0) {
    throw new ValidationError('precio debe ser un número finito mayor a 0', { precio: input.precio });
  }

  const vigenteDesdeStr = formatDateOnly(input.vigenteDesde);
  const vigenteHastaStr = input.vigenteHasta ? formatDateOnly(input.vigenteHasta) : null;

  if (vigenteHastaStr !== null && vigenteHastaStr < vigenteDesdeStr) {
    throw new ValidationError('vigenteHasta no puede ser anterior a vigenteDesde', {
      vigenteDesde: vigenteDesdeStr,
      vigenteHasta: vigenteHastaStr,
    });
  }

  return executor.transaction(async (tx) => {
    // Serializa TODAS las llamadas concurrentes a crearPrecioBase antes de
    // leer nada — ver el comentario de la función ("Concurrencia: advisory
    // lock"). Tiene que ser lo primero en la transacción: si se leyera algo
    // antes de tomar el lock, una segunda transacción podría colarse entre
    // esa lectura y el insert de la primera.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PRECIOS_BASE_LOCK_KEY})`);

    // Cierre automático de la fila "actual" — ver el comentario de la
    // función para el razonamiento completo. Solo cuando la nueva fila es
    // abierta.
    if (vigenteHastaStr === null) {
      const abiertasAnteriores = await tx
        .select()
        .from(preciosBase)
        .where(and(isNull(preciosBase.vigenteHasta), lt(preciosBase.vigenteDesde, vigenteDesdeStr)));

      if (abiertasAnteriores.length === 1) {
        const cierre = formatDateOnly(diaAnterior(input.vigenteDesde));
        await tx
          .update(preciosBase)
          .set({ vigenteHasta: cierre })
          .where(eq(preciosBase.id, abiertasAnteriores[0]!.id));
      }
    }

    // Solapamiento: dos rangos [aDesde,aHasta] / [bDesde,bHasta] (con
    // `null` = infinito) se superponen sii aDesde <= bHasta_o_infinito Y
    // bDesde <= aHasta_o_infinito. Acá "a" es cada fila existente y "b" es
    // la fila nueva, evaluado *después* del cierre de arriba (para que la
    // fila recién cerrada, si corresponde, ya no cuente como abierta).
    const condicionesSolapamiento = [
      or(isNull(preciosBase.vigenteHasta), gte(preciosBase.vigenteHasta, vigenteDesdeStr)),
    ];
    if (vigenteHastaStr !== null) {
      condicionesSolapamiento.push(lte(preciosBase.vigenteDesde, vigenteHastaStr));
    }

    const solapadas = await tx
      .select()
      .from(preciosBase)
      .where(and(...condicionesSolapamiento));

    if (solapadas.length > 0) {
      throw new PrecioBaseSolapadoError(
        { vigenteDesde: vigenteDesdeStr, vigenteHasta: vigenteHastaStr },
        solapadas.map((fila) => ({
          id: fila.id,
          vigenteDesde: fila.vigenteDesde,
          vigenteHasta: fila.vigenteHasta,
        }))
      );
    }

    const [creado] = await tx
      .insert(preciosBase)
      .values({
        precio: formatPrecio(input.precio),
        vigenteDesde: vigenteDesdeStr,
        vigenteHasta: vigenteHastaStr,
      })
      .returning();

    if (!creado) {
      throw new Error('Failed to create precio_base');
    }

    return creado;
  });
}
