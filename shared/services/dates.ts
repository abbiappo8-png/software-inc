/**
 * Conversión de fechas y horas provenientes del Excel y utilidades de fecha.
 *
 * Excel guarda:
 *   - Fechas como número serial con base 1899-12-30 (p.ej. 45839).
 *   - Horas como fracción de día (0.3333 = 08:00).
 * Google Sheets exporta igual. Algunas celdas vienen como texto "sucio".
 */
import type { ISODate } from '@shared/types/domain'

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30) // 1899-12-30
const MS_PER_DAY = 86400000

/** Serial de Excel -> fecha ISO 'YYYY-MM-DD' (o null si fuera de rango plausible). */
export function excelSerialToISO(serial: number): ISODate | null {
  if (!isFinite(serial) || serial < 1) return null
  const ms = EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  if (year < 1900 || year > 2100) return null
  return toISO(d)
}

/** Fracción de día (0..1) -> minutos desde medianoche (0..1439). */
export function dayFractionToMinutes(fraction: number): number | null {
  if (!isFinite(fraction)) return null
  let min = Math.round(fraction * 1440)
  if (min < 0) min = 0
  if (min > 1439) min = 1439
  return min
}

/** Minutos desde medianoche -> "HH:MM". */
export function minutesToHHMM(min: number | null | undefined): string {
  if (min == null || !isFinite(min)) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "HH:MM" -> minutos desde medianoche. */
export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  return min >= 0 && min <= 1439 ? min : null
}

function toISO(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
}

export interface DateParseResult {
  iso: ISODate | null
  raw: string | null
  reason?: string
}

/**
 * Parseo tolerante de una celda de fecha que puede ser:
 *  - número serial de Excel,
 *  - Date real,
 *  - texto "DD/MM/YYYY", "D/M/YYYY", con errores tipo "04/031977", "17/08/".
 * Nunca lanza: devuelve iso=null + raw cuando no se puede recuperar.
 */
export function parseFlexibleDate(value: unknown): DateParseResult {
  if (value == null || value === '') return { iso: null, raw: null }

  if (value instanceof Date) {
    const d = value
    if (isNaN(d.getTime())) return { iso: null, raw: String(value), reason: 'fecha_invalida' }
    return { iso: toISO(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))), raw: null }
  }

  if (typeof value === 'number') {
    const iso = excelSerialToISO(value)
    return iso ? { iso, raw: null } : { iso: null, raw: String(value), reason: 'serial_fuera_de_rango' }
  }

  const raw = String(value).trim()
  if (raw === '') return { iso: null, raw: null }

  // Número dentro de texto ("45839")
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const iso = excelSerialToISO(parseFloat(raw))
    if (iso) return { iso, raw: null }
  }

  // Corregir separador extra tipo "04/031977" -> "04/03/1977"
  const glued = /^(\d{1,2})\/(\d{2})(\d{4})$/.exec(raw)
  const candidate = glued ? `${glued[1]}/${glued[2]}/${glued[3]}` : raw

  // DD/MM/YYYY o D/M/YYYY (separadores / . -)
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(candidate)
  if (m) {
    let [_, dd, mm, yy] = m
    let day = parseInt(dd, 10)
    let month = parseInt(mm, 10)
    let year = parseInt(yy, 10)
    if (year < 100) year += year < 50 ? 2000 : 1900
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      const d = new Date(Date.UTC(year, month - 1, day))
      return { iso: toISO(d), raw: null }
    }
  }

  // Irrecuperable (p.ej. "17/08/", "27/06/ 1963" ambiguo): conservar crudo, no perder el dato
  return { iso: null, raw, reason: 'fecha_parcial' }
}

/** Diferencia en días calendario, estilo DATEDIF "D" (no incluye el día final). */
export function datedifDays(startISO: ISODate, endISO: ISODate): number {
  const a = Date.parse(startISO)
  const b = Date.parse(endISO)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / MS_PER_DAY))
}

export function monthOf(iso: ISODate): number {
  return parseInt(iso.slice(5, 7), 10)
}
export function yearOf(iso: ISODate): number {
  return parseInt(iso.slice(0, 4), 10)
}
