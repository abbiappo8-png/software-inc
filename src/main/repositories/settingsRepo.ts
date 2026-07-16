/** Acceso genérico a la tabla settings (clave/valor). */
import { getDb } from '../db/connection'
import type { CompanyConfig } from '@shared/types/domain'
export type { CompanyConfig }

export function get(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function set(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
    .run(key, value)
}

export function getJSON<T>(key: string, fallback: T): T {
  const raw = get(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setJSON(key: string, value: unknown): void {
  set(key, JSON.stringify(value))
}

/** Config no sensible de la empresa/app (tipo compartido en @shared/types/domain). */

export function getCompanyConfig(): CompanyConfig {
  return {
    companyName: get('company_name') ?? 'Escuela de Deportes Acuáticos',
    companyNit: get('company_nit') ?? '',
    cardSurchargePct: parseFloat(get('card_surcharge_pct') ?? '0.05'),
    currency: get('currency') ?? 'COP'
  }
}
