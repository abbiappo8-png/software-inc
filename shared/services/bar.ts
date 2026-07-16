/**
 * Bar — POS + inventario. Cierra el ciclo que en el Excel estaba a medias.
 *
 *   costo_unitario = precio_compra_caja / unidades_por_caja
 *   stock          = Σ comprado - Σ vendido
 *   total_venta    = cantidad · precio_venta_unidad
 */
import type { COP } from '@shared/types/domain'
import { roundCOP } from './money'

export function unitCost(boxPrice: COP | null, unitsPerBox: number | null): COP | null {
  if (boxPrice == null || !unitsPerBox) return null
  return roundCOP(boxPrice / unitsPerBox)
}

export function saleTotal(qty: number, sellPrice: COP | null): COP {
  if (sellPrice == null || !isFinite(qty)) return 0
  return roundCOP(qty * sellPrice)
}

export function stock(purchasedUnits: number, soldUnits: number): number {
  return (purchasedUnits || 0) - (soldUnits || 0)
}

export interface StockCheck {
  ok: boolean
  available: number
  reason?: string
}

/** Valida que haya stock suficiente antes de vender. */
export function canSell(available: number, qty: number): StockCheck {
  if (qty <= 0) return { ok: false, available, reason: 'cantidad_invalida' }
  if (available < qty) return { ok: false, available, reason: 'stock_insuficiente' }
  return { ok: true, available }
}
