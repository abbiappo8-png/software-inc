import { useCallback, useEffect, useState } from 'react'
import type { AppApi } from '@shared/types/api'
import { mockApi } from './mockApi'
import { supabaseApi } from './supabaseApi'

/** En MODO DEMO (build de navegador) se usa el API simulado; si no, el IPC real de Electron. */
export const IS_DEMO: boolean = !!(import.meta as any).env?.VITE_DEMO
/**
 * MODO WEB: build de navegador con los datos en Supabase (sin Electron).
 * Requiere la bandera VITE_TARGET=web (definida SOLO en vite.web.config.ts): la mera
 * presencia de VITE_SUPABASE_URL en un .env no debe desviar el escritorio ni el demo.
 */
export const IS_WEB: boolean =
  (import.meta as any).env?.VITE_TARGET === 'web' && !!(import.meta as any).env?.VITE_SUPABASE_URL
export const api: AppApi = IS_DEMO ? mockApi : IS_WEB ? supabaseApi : window.api

export function formatCOP(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—'
  return '$ ' + Math.round(value).toLocaleString('es-CO', { maximumFractionDigits: 0 })
}

export function minutesToHHMM(min: number | null | undefined): string {
  if (min == null) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/** Hook simple para cargar datos asíncronos con recarga. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const memo = useCallback(fn, deps)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    memo()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo, tick])

  return { data, loading, error, reload: () => setTick((t) => t + 1) }
}

// Fecha de hoy en hora LOCAL (toISOString daba la fecha UTC: un día adelantada desde las 7 p. m.).
export { todayISO } from '@shared/services/dates'
