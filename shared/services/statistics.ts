/**
 * Estadísticas — porta la hoja Statistics.
 *
 *   edad    = (check-in - nacimiento) / 365
 *   bucket  = edad - (edad mod 5)      (histograma por múltiplos de 5)
 *
 * Corrige el defecto del Excel: fechas inválidas o edades negativas se excluyen.
 */
import type { AgeBucket, ISODate } from '@shared/types/domain'

const MS_PER_DAY = 86400000

/** Edad en años entre nacimiento y una fecha de referencia (por defecto check-in). */
export function ageAt(birthISO: ISODate | null, refISO: ISODate | null): number | null {
  if (!birthISO || !refISO) return null
  const b = Date.parse(birthISO)
  const r = Date.parse(refISO)
  if (isNaN(b) || isNaN(r)) return null
  const years = (r - b) / (365 * MS_PER_DAY)
  if (years < 0 || years > 120) return null // fecha implausible -> se descarta
  return years
}

/** Bucket de edad redondeado hacia abajo a múltiplos de 5. */
export function ageBucket(age: number): number {
  return age - (age % 5)
}

/** Histograma de edades por múltiplos de 5, ignorando edades inválidas. */
export function ageHistogram(ages: (number | null)[]): AgeBucket[] {
  const counts = new Map<number, number>()
  for (const a of ages) {
    if (a == null || !isFinite(a) || a < 0) continue
    const b = ageBucket(Math.floor(a))
    counts.set(b, (counts.get(b) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([bucket, count]) => ({ bucket, count }))
}
