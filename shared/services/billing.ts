/**
 * Facturación de cliente — porta la hoja Client_Bill.
 *
 *   B14 subtotal = (Σprecios + Σextras)=0 ? 0 : ((Σprecios+Σextras)·(100-desc)/100) - deducción
 *   B9  hospedaje = díasDATEDIF · tarifa_diaria
 *   O14 total_bar = Σ ventas de bar del cliente
 *   E1  total    = hospedaje + total_bar + subtotal
 *   E2  ya_pagado
 *   E3  neto     = total - ya_pagado
 *   E4  tarjeta  = neto · 1.05  (recargo 5%)
 */
import type { COP } from '@shared/types/domain'
import { roundCOP } from './money'
import { datedifDays } from './dates'

export interface ClientBillInput {
  servicePrices: COP[] // precios efectivos automáticos (Σ J)
  serviceExtras: COP[] // precios manuales / extras (Σ K)
  discountPct: number // descuento a nivel factura, 0..100 (B6)
  deduction: COP // deducción manual (B7)
  lodgingDays: number // o usar checkIn/checkOut abajo
  lodgingRate: COP // tarifa por día
  barTotal: COP // total de consumo de bar del cliente
  alreadyPaid: COP // Persons!K
  cardSurcharge: boolean // aplicar +5%
  cardSurchargePct?: number // por defecto 0.05
}

export interface ClientBillResult {
  sumServices: COP
  subtotal: COP
  lodging: COP
  barTotal: COP
  total: COP
  alreadyPaid: COP
  netToPay: COP
  cardTotal: COP
}

export function computeClientBill(input: ClientBillInput): ClientBillResult {
  const cardPct = input.cardSurchargePct ?? 0.05
  const sumServices =
    sum(input.servicePrices) + sum(input.serviceExtras)
  const subtotal =
    sumServices === 0
      ? 0
      : roundCOP((sumServices * (100 - (input.discountPct || 0))) / 100 - (input.deduction || 0))
  const lodging = roundCOP((input.lodgingDays || 0) * (input.lodgingRate || 0))
  const barTotal = input.barTotal || 0
  const total = subtotal + lodging + barTotal
  const netToPay = total - (input.alreadyPaid || 0)
  const cardTotal = input.cardSurcharge ? roundCOP(netToPay * (1 + cardPct)) : netToPay
  return {
    sumServices,
    subtotal,
    lodging,
    barTotal,
    total,
    alreadyPaid: input.alreadyPaid || 0,
    netToPay,
    cardTotal
  }
}

/** Días de hospedaje a partir de check-in / check-out (DATEDIF "D"). */
export function lodgingDaysFromStay(
  checkIn: string | null,
  checkOut: string | null
): number {
  if (!checkIn || !checkOut) return 0
  return datedifDays(checkIn, checkOut)
}

function sum(xs: (COP | null | undefined)[]): COP {
  let t = 0
  for (const x of xs) if (x != null && isFinite(x)) t += x
  return t
}
