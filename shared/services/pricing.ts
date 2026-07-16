/**
 * Motor de precios — porta las fórmulas de la hoja Club del Excel.
 *
 *   Club!L (horas)   = hora_fin - hora_inicio           (fracción de día)
 *   Club!J (precio)  = (100 - descuento_cliente)/100 ×
 *                        [ por hora: 24·L/horas_cat · precio_cat
 *                          por día : (1/dias_cat)   · precio_cat ]
 *                      (vacío si hay precio manual K)
 *   Club!M (salario) = precio_efectivo × %_profesor_del_catálogo
 *   effective        = precio_manual ?? precio_auto
 *
 * Funciones puras y testables. Dinero en enteros COP.
 */
import type { COP, ProfessorPayModel, ServiceCatalogItem } from '@shared/types/domain'
import { roundCOP, pctToFactor } from './money'

export function isDaily(item: Pick<ServiceCatalogItem, 'days'>): boolean {
  return (item.days ?? 0) > 0
}

/** Horas reales a partir de la duración en minutos (Club: 24 × fracción de día). */
export function realHours(durationMin: number | null | undefined): number | null {
  if (durationMin == null || !isFinite(durationMin)) return null
  return durationMin / 60
}

export interface AutoPriceInput {
  item: Pick<ServiceCatalogItem, 'hours' | 'days' | 'price'>
  clientDiscountPct: number // 0..100 (Persons!J)
  durationMin: number | null // duración de la reserva
  manualPrice?: COP | null // Club!K; si existe, el auto no aplica
}

/** Precio automático (Club!J). Devuelve null si hay precio manual o no es calculable. */
export function autoPrice(input: AutoPriceInput): COP | null {
  const { item, clientDiscountPct, durationMin, manualPrice } = input
  if (manualPrice != null) return null
  if (!item || item.price == null) return null
  const factor = pctToFactor(clientDiscountPct || 0)
  let base: number
  if (isDaily(item)) {
    if (!item.days) return null
    base = (1 / item.days) * item.price
  } else {
    const hours = realHours(durationMin)
    if (hours == null || !item.hours) return null
    base = (hours / item.hours) * item.price
  }
  return roundCOP(factor * base)
}

/** Precio efectivo: el manual si existe, si no el automático. */
export function effectivePrice(input: AutoPriceInput): COP | null {
  if (input.manualPrice != null) return input.manualPrice
  return autoPrice(input)
}

/** Salario del profesor (Club!M) = precio efectivo × % del catálogo. */
export function professorSalary(
  price: COP | null,
  professorPct: number | null,
  hasProfessor = true
): COP {
  if (!hasProfessor || price == null || !professorPct) return 0
  return roundCOP(price * professorPct)
}

/**
 * Deriva el modelo de pago del profesor a partir del % y (si se conocen) del
 * precio y las horas del catálogo. Permite corregir el pago fijo/hora cuando el
 * precio del catálogo cambie, sin dejar de reproducir el Excel con PERCENT.
 */
export function derivePayModel(
  pct: number,
  price?: number | null,
  hours?: number | null
): ProfessorPayModel {
  if (price && hours && hours > 0) {
    const perHour = (pct * price) / hours // k en "k·P/R"
    if (isRoundish(perHour)) return { type: 'FIXED_PER_HOUR', rate: Math.round(perHour) }
  }
  if (price) {
    const amount = pct * price // k en "k/R"
    if (isRoundish(amount)) return { type: 'FIXED_AMOUNT', amount: Math.round(amount) }
  }
  return { type: 'PERCENT', pct }
}

/** ¿El número parece un valor "redondo" de pago fijo (múltiplo de 500)? */
function isRoundish(n: number): boolean {
  if (!isFinite(n) || n <= 0) return false
  return Math.abs(n - Math.round(n / 500) * 500) < 1
}
