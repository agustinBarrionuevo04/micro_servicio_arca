/**
 * `services/precios-base` es fundamentalmente un problema de corrección de
 * query contra fechas reales de Postgres, no de lógica pura — por eso estos
 * son tests de integración contra una DB real (ver `tests/integration/helpers.ts`)
 * en vez de unitarios con mocks. El entorno de CI/dev de este repo corre en
 * una zona horaria distinta de UTC (América/Córdoba, UTC-3, ver
 * `date +%Z` al escribir este archivo) — eso es intencional: si algún día
 * alguien reintroduce un `toISOString()` en vez de los getters locales que
 * usa `formatDateOnly` (ver el módulo), estos tests de límite lo van a
 * agarrar acá, no en producción con un usuario real.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { preciosBase } from '../../src/db/schema/index.js';
import { getPrecioVigente, crearPrecioBase } from '../../src/services/precios-base/index.js';
import {
  PrecioBaseAmbiguoError,
  PrecioBaseNoVigenteError,
  PrecioBaseSolapadoError,
  ValidationError,
} from '../../src/errors/index.js';
import { runMigrations, truncateAll } from './helpers.js';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await truncateAll();
});

/** Inserta directo, sin pasar por `crearPrecioBase` — para armar fixtures de solo-lectura o simular estados corruptos a propósito (caso ambiguo). */
async function insertarFila(precio: string, vigenteDesde: string, vigenteHasta: string | null) {
  const [fila] = await db
    .insert(preciosBase)
    .values({ precio, vigenteDesde, vigenteHasta })
    .returning();
  if (!fila) throw new Error('fixture insert failed');
  return fila;
}

describe('getPrecioVigente - límites de rango (inclusive en ambos extremos)', () => {
  it('matchea un período exactamente igual a vigenteDesde', async () => {
    await insertarFila('95000.00', '2026-01-01', '2026-06-30');

    const resultado = await getPrecioVigente(new Date(2026, 0, 1));

    expect(resultado.precio).toBe('95000.00');
  });

  it('matchea un período exactamente igual a vigenteHasta (extremo inclusive)', async () => {
    await insertarFila('95000.00', '2026-01-01', '2026-06-30');

    const resultado = await getPrecioVigente(new Date(2026, 5, 30));

    expect(resultado.precio).toBe('95000.00');
  });

  it('un período un día después de vigenteHasta NO matchea esa fila', async () => {
    await insertarFila('95000.00', '2026-01-01', '2026-06-30');

    await expect(getPrecioVigente(new Date(2026, 6, 1))).rejects.toThrow(PrecioBaseNoVigenteError);
  });

  it('un período un día antes de vigenteDesde NO matchea esa fila', async () => {
    await insertarFila('95000.00', '2026-01-01', '2026-06-30');

    await expect(getPrecioVigente(new Date(2025, 11, 31))).rejects.toThrow(PrecioBaseNoVigenteError);
  });

  it('una fila abierta (vigenteHasta null) matchea indefinidamente hacia el futuro', async () => {
    await insertarFila('100000.00', '2026-07-01', null);

    const cercano = await getPrecioVigente(new Date(2026, 6, 1));
    const lejano = await getPrecioVigente(new Date(2099, 0, 1));

    expect(cercano.precio).toBe('100000.00');
    expect(lejano.precio).toBe('100000.00');
  });

  it('respeta la hora local al normalizar el período (no corre un día por UTC)', async () => {
    // vigenteDesde = 2026-08-01. Un `Date` construido con getters locales
    // para esa misma fecha calendario debe matchear sin importar la zona
    // horaria del proceso — si `getPrecioVigente` usara `toISOString()`
    // acá, en un proceso corriendo en UTC-3 esto se rompería silenciosamente.
    await insertarFila('95000.00', '2026-08-01', null);

    const resultado = await getPrecioVigente(new Date(2026, 7, 1, 0, 0, 0));

    expect(resultado.precio).toBe('95000.00');
  });
});

describe('getPrecioVigente - hueco sin fila que cubra el período', () => {
  it('tira PrecioBaseNoVigenteError con el período en los details cuando no hay ninguna fila', async () => {
    await expect(getPrecioVigente(new Date(2026, 0, 1))).rejects.toThrow(PrecioBaseNoVigenteError);

    try {
      await getPrecioVigente(new Date(2026, 0, 1));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PrecioBaseNoVigenteError);
      expect((error as PrecioBaseNoVigenteError).details?.['periodo']).toBe('2026-01-01');
      expect((error as PrecioBaseNoVigenteError).statusCode).toBe(422);
    }
  });

  it('tira PrecioBaseNoVigenteError para un hueco entre dos rangos cerrados', async () => {
    await insertarFila('90000.00', '2026-01-01', '2026-03-31');
    // Hueco: abril no tiene fila (alguien se olvidó de sembrarlo).
    await insertarFila('95000.00', '2026-05-01', null);

    await expect(getPrecioVigente(new Date(2026, 3, 15))).rejects.toThrow(PrecioBaseNoVigenteError);
  });
});

describe('getPrecioVigente - caso defensivo: más de una fila vigente', () => {
  it('tira PrecioBaseAmbiguoError en vez de elegir una fila arbitraria', async () => {
    // Estado corrupto simulado a propósito (insert directo, sin pasar por
    // crearPrecioBase, que es justo lo que esta validación defensiva cubre:
    // alguien insertó por fuera de la función y rompió la invariante).
    const filaA = await insertarFila('90000.00', '2026-01-01', '2026-12-31');
    const filaB = await insertarFila('95000.00', '2026-06-01', null);

    try {
      await getPrecioVigente(new Date(2026, 6, 15));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PrecioBaseAmbiguoError);
      const ids = (error as PrecioBaseAmbiguoError).details?.['precioBaseIds'] as string[];
      expect(ids).toEqual(expect.arrayContaining([filaA.id, filaB.id]));
      expect((error as PrecioBaseAmbiguoError).statusCode).toBe(500);
    }
  });
});

describe('crearPrecioBase - alta simple', () => {
  it('crea la primera fila sin ninguna fila previa', async () => {
    const creado = await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 0, 1) });

    expect(creado.precio).toBe('95000.00');
    expect(creado.vigenteDesde).toBe('2026-01-01');
    expect(creado.vigenteHasta).toBeNull();
  });

  it('rechaza precio <= 0', async () => {
    await expect(crearPrecioBase({ precio: 0, vigenteDesde: new Date(2026, 0, 1) })).rejects.toThrow(
      ValidationError
    );
    await expect(crearPrecioBase({ precio: -100, vigenteDesde: new Date(2026, 0, 1) })).rejects.toThrow(
      ValidationError
    );
  });

  it('rechaza vigenteHasta anterior a vigenteDesde', async () => {
    await expect(
      crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 5, 1), vigenteHasta: new Date(2026, 0, 1) })
    ).rejects.toThrow(ValidationError);
  });
});

describe('crearPrecioBase - cierre automático de la fila "actual" anterior', () => {
  it('cierra la fila abierta anterior al crear una nueva fila abierta (nuevo precio actual)', async () => {
    const anterior = await crearPrecioBase({ precio: 90000, vigenteDesde: new Date(2026, 0, 1) });
    expect(anterior.vigenteHasta).toBeNull();

    const nueva = await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 7, 1) });

    const [anteriorActualizada] = await db.select().from(preciosBase).where(eq(preciosBase.id, anterior.id));

    // Se cierra el día anterior a la nueva vigenteDesde (2026-08-01 → 2026-07-31),
    // no el mismo día ni ningún otro offset — así los dos rangos quedan
    // adyacentes sin hueco y sin solaparse un solo día.
    expect(anteriorActualizada?.vigenteHasta).toBe('2026-07-31');
    expect(nueva.vigenteDesde).toBe('2026-08-01');
    expect(nueva.vigenteHasta).toBeNull();

    // El nuevo período (agosto) ahora resuelve al precio nuevo, y un período
    // anterior (ej. marzo) sigue resolviendo al precio viejo — la vigencia
    // histórica del precio anterior no se pierde, solo se acota su fin.
    expect((await getPrecioVigente(new Date(2026, 7, 1))).precio).toBe('95000.00');
    expect((await getPrecioVigente(new Date(2026, 2, 1))).precio).toBe('90000.00');
  });

  it('cruza de mes/año correctamente al calcular el día de cierre (1 de enero - 1 día = 31 de diciembre del año anterior)', async () => {
    const anterior = await crearPrecioBase({ precio: 90000, vigenteDesde: new Date(2025, 5, 1) });

    await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 0, 1) });

    const [anteriorActualizada] = await db.select().from(preciosBase).where(eq(preciosBase.id, anterior.id));
    expect(anteriorActualizada?.vigenteHasta).toBe('2025-12-31');
  });

  it('NO cierra ninguna fila cuando la nueva tiene vigenteHasta explícito (backfill histórico, no es "el precio actual")', async () => {
    const actual = await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 0, 1) });

    // Backfill: un precio histórico de un rango acotado, insertado después,
    // que no toca para nada la fila "actual" (por ejemplo, corrigiendo un
    // período previo a la fila actual, sin relación con "hoy").
    await crearPrecioBase({
      precio: 80000,
      vigenteDesde: new Date(2025, 5, 1),
      vigenteHasta: new Date(2025, 11, 31),
    });

    const [actualSinTocar] = await db.select().from(preciosBase).where(eq(preciosBase.id, actual.id));
    expect(actualSinTocar?.vigenteHasta).toBeNull();
  });

  it('no auto-cierra cuando hay más de una fila abierta anterior (estado ya inconsistente) — rechaza por solapamiento en su lugar', async () => {
    // Estado corrupto simulado a propósito, ver el mismo patrón en el
    // describe de getPrecioVigente para el caso ambiguo.
    await insertarFila('90000.00', '2026-01-01', null);
    await insertarFila('91000.00', '2026-02-01', null);

    await expect(crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 7, 1) })).rejects.toThrow(
      PrecioBaseSolapadoError
    );
  });
});

describe('crearPrecioBase - validación de solapamiento al insertar', () => {
  it('rechaza un rango que se superpone con una fila existente', async () => {
    await crearPrecioBase({
      precio: 90000,
      vigenteDesde: new Date(2026, 0, 1),
      vigenteHasta: new Date(2026, 5, 30),
    });

    await expect(
      crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 4, 1), vigenteHasta: new Date(2026, 8, 30) })
    ).rejects.toThrow(PrecioBaseSolapadoError);
  });

  it('rechaza cuando el nuevo rango empieza el mismo día en que termina uno existente (el fin es inclusive)', async () => {
    await crearPrecioBase({
      precio: 90000,
      vigenteDesde: new Date(2026, 0, 1),
      vigenteHasta: new Date(2026, 6, 31),
    });

    await expect(
      crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 6, 31), vigenteHasta: null })
    ).rejects.toThrow(PrecioBaseSolapadoError);
  });

  it('permite rangos adyacentes (sin solaparse) — el nuevo empieza el día siguiente al fin del anterior', async () => {
    await crearPrecioBase({
      precio: 90000,
      vigenteDesde: new Date(2026, 0, 1),
      vigenteHasta: new Date(2026, 6, 31),
    });

    await expect(
      crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 7, 1), vigenteHasta: null })
    ).resolves.toMatchObject({ vigenteDesde: '2026-08-01' });
  });

  it('rechaza un rango nuevo abierto que empieza antes o el mismo día que una fila abierta existente (no se puede auto-cerrar de forma segura)', async () => {
    await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 0, 1) });

    await expect(crearPrecioBase({ precio: 90000, vigenteDesde: new Date(2025, 5, 1) })).rejects.toThrow(
      PrecioBaseSolapadoError
    );
  });

  it('el error incluye el rango nuevo y las filas en conflicto en los details', async () => {
    const existente = await crearPrecioBase({
      precio: 90000,
      vigenteDesde: new Date(2026, 0, 1),
      vigenteHasta: new Date(2026, 5, 30),
    });

    try {
      await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 2, 1), vigenteHasta: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PrecioBaseSolapadoError);
      const details = (error as PrecioBaseSolapadoError).details as {
        nuevo: { vigenteDesde: string; vigenteHasta: string | null };
        conflictos: Array<{ id: string }>;
      };
      expect(details.nuevo).toEqual({ vigenteDesde: '2026-03-01', vigenteHasta: null });
      expect(details.conflictos.map((c) => c.id)).toEqual([existente.id]);
      expect((error as PrecioBaseSolapadoError).statusCode).toBe(409);
    }
  });
});

describe('crearPrecioBase + getPrecioVigente - integración end-to-end', () => {
  it('un precio recién creado resuelve correctamente para su período', async () => {
    await crearPrecioBase({ precio: 90000, vigenteDesde: new Date(2026, 0, 1), vigenteHasta: new Date(2026, 5, 30) });
    await crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 6, 1) });

    expect((await getPrecioVigente(new Date(2026, 2, 15))).precio).toBe('90000.00');
    expect((await getPrecioVigente(new Date(2026, 6, 1))).precio).toBe('95000.00');
    expect((await getPrecioVigente(new Date(2026, 11, 31))).precio).toBe('95000.00');
  });
});

/**
 * Regresión de code review: `input.precio.toFixed(2)` redondeaba mal cerca
 * de bordes `.xx5` por el error de representación binaria del `number` (ej.
 * `(1.005).toFixed(2)` da `'1.00'`, no `'1.01'`). Ver el comentario de
 * `formatPrecio` en `services/precios-base/index.ts` para el detalle.
 */
describe('crearPrecioBase - redondeo de precio a centavos', () => {
  it('redondea 1.005 hacia arriba a 1.01 (toFixed(2) nativo daba 1.00)', async () => {
    const creado = await crearPrecioBase({ precio: 1.005, vigenteDesde: new Date(2026, 0, 1) });
    expect(creado.precio).toBe('1.01');
  });

  it('redondea 95000.555 hacia arriba a 95000.56', async () => {
    const creado = await crearPrecioBase({ precio: 95000.555, vigenteDesde: new Date(2026, 0, 1) });
    expect(creado.precio).toBe('95000.56');
  });

  it('un precio ya exacto a 2 decimales no se ve afectado', async () => {
    const creado = await crearPrecioBase({ precio: 95000.5, vigenteDesde: new Date(2026, 0, 1) });
    expect(creado.precio).toBe('95000.50');
  });

  it('el acarreo de centavos redondeados sube también la parte entera (99.995 -> 100.00)', async () => {
    const creado = await crearPrecioBase({ precio: 99.995, vigenteDesde: new Date(2026, 0, 1) });
    expect(creado.precio).toBe('100.00');
  });
});

/**
 * Regresión de code review: `SELECT ... FOR UPDATE` no bloquea filas que
 * todavía no existen, así que dos `crearPrecioBase` concurrentes para
 * rangos que no pisan ninguna fila commiteada (pero sí se pisan entre sí)
 * podían pasar la validación ambas y dejar un solapamiento real en la
 * tabla. La corrección es un `pg_advisory_xact_lock` — ver el comentario de
 * `crearPrecioBase` ("Concurrencia: advisory lock, no SELECT ... FOR
 * UPDATE").
 */
describe('crearPrecioBase - concurrencia (regresión: inserts fantasma solapados)', () => {
  it('de dos llamadas concurrentes con rangos abiertos solapados, una crea y la otra rechaza por solapamiento', async () => {
    // Ambas son "el precio actual" (vigenteHasta abierto) arrancando el
    // mismo día — sobre una tabla vacía, así que ninguna fila existente
    // puede protegerlas vía FOR UPDATE. Sin el advisory lock, las dos
    // podían leer 0 filas conflictivas y las dos insertaban.
    const resultados = await Promise.allSettled([
      crearPrecioBase({ precio: 95000, vigenteDesde: new Date(2026, 0, 1) }),
      crearPrecioBase({ precio: 96000, vigenteDesde: new Date(2026, 0, 1) }),
    ]);

    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');

    expect(exitosas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(PrecioBaseSolapadoError);

    // La tabla queda con una sola fila — la corrupción que este test
    // regresiona dejaba dos filas abiertas solapadas.
    const filas = await db.select().from(preciosBase);
    expect(filas).toHaveLength(1);
  });
});
