/**
 * Autodetección del curso del cliente — REEMPLAZA la fórmula rota (#REF!) de
 * Persons!I del Excel.
 *
 * Excel original (roto en varias filas):
 *   index(Club!O4:P8, ... filter(Club!O4:O8, P4:P8 <= 24·Σ horas de "Class" del cliente))
 *
 * Reescrito de forma robusta y determinista: se acumulan las horas de clases
 * ("Class") del cliente por id estable y se ubica el nivel más alto cuyo umbral
 * de horas ha sido alcanzado. Nunca produce error; si el cliente no tiene horas,
 * devuelve el curso inicial.
 */
import { realHours } from './pricing'

export interface CourseLevel {
  id: number
  name: string
  thresholdHours: number // umbral de horas acumuladas para alcanzar el nivel (Club!P)
}

export interface ClassLike {
  chosenServiceIsClass: boolean
  durationMin: number | null
  txDate?: string
}

/** Horas reales acumuladas de clases ("Class") del cliente, opcionalmente hasta `asOf`. */
export function accumulatedClassHours(txs: ClassLike[], asOf?: string): number {
  let total = 0
  for (const t of txs) {
    if (!t.chosenServiceIsClass) continue
    if (asOf && t.txDate && t.txDate > asOf) continue
    const h = realHours(t.durationMin)
    if (h != null) total += h
  }
  return total
}

/** Nivel más alto alcanzado según las horas acumuladas. */
export function detectCourse(hours: number, courses: CourseLevel[]): CourseLevel | null {
  if (!courses.length) return null
  const ladder = [...courses].sort((a, b) => a.thresholdHours - b.thresholdHours)
  let reached: CourseLevel | null = ladder[0] // curso inicial por defecto (0 horas)
  for (const c of ladder) {
    if (c.thresholdHours <= hours) reached = c
  }
  return reached
}

/** Conveniencia: detecta el curso a partir de las transacciones del cliente. */
export function detectCourseForClient(
  txs: ClassLike[],
  courses: CourseLevel[],
  asOf?: string
): CourseLevel | null {
  return detectCourse(accumulatedClassHours(txs, asOf), courses)
}
