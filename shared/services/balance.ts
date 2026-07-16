/**
 * Balance diario (flujo de caja) — porta la hoja Balance.
 *
 *   IN    = ingresos_clientes + ingresos_bar
 *   OUT   = gastos del día
 *   saldo = (día > HOY) ? null : IN - OUT + saldo_previo
 */
import type { COP, DailyCashflowRow, ISODate } from '@shared/types/domain'

export interface DayAggregate {
  date: ISODate
  inClients: COP
  inBar: COP
  out: COP
}

/** Construye la serie con saldo acumulado, deteniéndose después de `today`. */
export function computeRunningBalance(days: DayAggregate[], today: ISODate): DailyCashflowRow[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const out: DailyCashflowRow[] = []
  let running = 0
  for (const d of sorted) {
    const inSum = (d.inClients || 0) + (d.inBar || 0)
    const isFuture = d.date > today
    let balance: COP | null
    if (isFuture) {
      balance = null
    } else {
      running = inSum - (d.out || 0) + running
      balance = running
    }
    out.push({
      date: d.date,
      inClients: d.inClients || 0,
      inBar: d.inBar || 0,
      in: inSum,
      out: d.out || 0,
      runningBalance: balance
    })
  }
  return out
}

export function totals(rows: DailyCashflowRow[]): { in: COP; out: COP; net: COP } {
  let inT = 0
  let outT = 0
  for (const r of rows) {
    inT += r.in
    outT += r.out
  }
  return { in: inT, out: outT, net: inT - outT }
}
