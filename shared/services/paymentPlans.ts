/**
 * Planes de pago / amortización — generaliza la hoja "ozuna pago de cometa".
 *
 *   saldo_n = saldo_(n-1) - abono_n
 */
import type { COP, ISODate } from '@shared/types/domain'

export interface InstallmentLike {
  paidDate: ISODate
  amount: COP
}

export interface ScheduleRow {
  paidDate: ISODate
  amount: COP
  balanceAfter: COP
}

/** Calcula el saldo restante tras cada abono, en orden cronológico. */
export function schedule(principal: COP, installments: InstallmentLike[]): ScheduleRow[] {
  const sorted = [...installments].sort((a, b) => a.paidDate.localeCompare(b.paidDate))
  let balance = principal
  return sorted.map((i) => {
    balance = balance - i.amount
    return { paidDate: i.paidDate, amount: i.amount, balanceAfter: balance }
  })
}

/** Saldo pendiente actual del plan. */
export function outstanding(principal: COP, installments: InstallmentLike[]): COP {
  const rows = schedule(principal, installments)
  return rows.length ? rows[rows.length - 1].balanceAfter : principal
}
