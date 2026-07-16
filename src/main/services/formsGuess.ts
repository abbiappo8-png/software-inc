/**
 * Parte PURA de la integración con Google Forms (sin BD): hash de fila para el
 * dedupe, y auto-detección de campos por encabezados. Testeable en domain.test.ts.
 */
import { createHash } from 'node:crypto'
import type { FormGuess } from '@shared/types/domain'
import { normalize } from './text'
import { parseFlexibleDate } from './dates'

/** Hash estable de una fila (independiente del orden de columnas) para dedupe. */
export function rowHash(formKey: string, row: Record<string, string>): string {
  const canonical = Object.keys(row)
    .sort()
    .map((k) => `${k}=${row[k]}`)
    .join('')
  return createHash('sha256').update(formKey + '' + canonical).digest('hex')
}

/** Marca temporal del form (si existe), como ISO si se puede parsear. */
export function findTimestamp(row: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(row)) {
    const nk = normalize(k)
    if (nk.includes('marca temporal') || nk.includes('timestamp')) {
      const d = parseFlexibleDate(v)
      return d.iso ?? v ?? null
    }
  }
  return null
}

/** Encuentra el valor de la primera columna cuyo encabezado matchee alguna palabra clave. */
function pick(row: Record<string, string>, keys: string[], exclude: string[] = []): string | null {
  for (const [k, v] of Object.entries(row)) {
    const nk = normalize(k)
    if (exclude.some((e) => nk.includes(e))) continue
    if (keys.some((key) => nk.includes(key)) && v?.trim()) return v.trim()
  }
  return null
}

/** Convierte "8:30", "08:30", "8:30 p. m." en minutos desde medianoche. */
export function parseHourish(v: string | null): number | null {
  if (!v) return null
  const m = /(\d{1,2})[:. ](\d{2})/.exec(v)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h > 23 || min > 59) return null
  const isPm = /p\.?\s?m/i.test(v)
  const isAm = /a\.?\s?m/i.test(v)
  if (isPm && h < 12) h += 12
  if (isAm && h === 12) h = 0
  return h * 60 + min
}

/** Pre-adivina los campos de una respuesta por sus encabezados (corregible en la UI). */
export function guess(row: Record<string, string>): FormGuess {
  const dateRaw = pick(row, ['fecha', 'dia', 'day', 'date'], ['nacimiento', 'birth', 'marca temporal', 'timestamp'])
  const birthRaw = pick(row, ['nacimiento', 'birth'])
  return {
    fullName: pick(row, ['nombre', 'name'], ['apodo', 'usuario', 'nickname']),
    email: pick(row, ['correo', 'email', 'e-mail', 'mail']),
    passport: pick(row, ['pasaporte', 'passport', 'documento', 'cedula', 'identificacion']),
    country: pick(row, ['pais', 'country', 'nacionalidad']),
    birthDate: birthRaw ? parseFlexibleDate(birthRaw).iso : null,
    date: dateRaw ? parseFlexibleDate(dateRaw).iso : null,
    startMin: parseHourish(pick(row, ['hora', 'hour', 'time'], ['marca temporal', 'timestamp'])),
    // Excluir fecha/día/hora: "Fecha de la clase" no es el servicio.
    service: pick(row, ['clase', 'servicio', 'curso', 'actividad', 'nivel', 'deporte'], ['fecha', 'dia', 'hora', 'date', 'day']),
    comment: pick(row, ['comentario', 'mensaje', 'observa', 'nota', 'adicional'])
  }
}
