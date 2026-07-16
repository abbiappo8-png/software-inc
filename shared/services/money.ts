/**
 * Utilidades de dinero en pesos colombianos (COP).
 * El COP no usa centavos: todo se maneja en enteros de pesos.
 */
import type { COP } from '@shared/types/domain'

/** Redondea a peso entero (half-up). Opcionalmente a un múltiplo (p.ej. 50). */
export function roundCOP(value: number, step = 1): COP {
  if (!isFinite(value)) return 0
  if (step <= 1) return Math.round(value)
  return Math.round(value / step) * step
}

/** Formatea un monto COP para mostrar: "$ 1.234.567". */
export function formatCOP(value: COP | null | undefined): string {
  if (value == null || !isFinite(value)) return '—'
  return (
    '$ ' +
    Math.round(value)
      .toLocaleString('es-CO', { maximumFractionDigits: 0 })
  )
}

/** Convierte un porcentaje 0..100 en factor multiplicador (100 -> 1, 90 -> 0.9). */
export function pctToFactor(pct: number): number {
  return (100 - pct) / 100
}
