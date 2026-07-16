/**
 * Consultas financieras y analíticas: balance diario, resumen mensual y
 * estadísticas. Agrega sobre las bitácoras (transacciones/bar/gastos) y usa las
 * funciones puras de dominio para la lógica.
 */
import { getDb } from '../db/connection'
import type { DailyCashflowRow, MonthSummary, AgeBucket } from '@shared/types/domain'
import { computeRunningBalance, totals, type DayAggregate } from '../services/balance'
import { ageAt, ageHistogram } from '../services/statistics'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Balance diario (flujo de caja) con saldo acumulado. */
export function dailyCashflow(from?: string, to?: string): { rows: DailyCashflowRow[]; totals: { in: number; out: number; net: number } } {
  const db = getDb()
  // Ingresos de clientes: valor real de los servicios (precio efectivo) por fecha de la
  // transacción. (Mejora sobre el Excel, que usaba Persons!K — columna casi vacía en la práctica.)
  const days: Record<string, DayAggregate> = {}
  const touch = (d: string) => (days[d] ??= { date: d, inClients: 0, inBar: 0, out: 0 })

  // end_min IS NOT NULL: las sesiones abiertas aún no son ingreso (se cobran al salir).
  for (const r of db.prepare("SELECT tx_date d, SUM(price_effective) v FROM transactions WHERE price_effective IS NOT NULL AND end_min IS NOT NULL GROUP BY tx_date").all() as any[])
    if (r.d) touch(r.d).inClients += r.v
  for (const r of db.prepare('SELECT sale_date d, SUM(total) v FROM bar_sales GROUP BY sale_date').all() as any[])
    if (r.d) touch(r.d).inBar += r.v
  for (const r of db.prepare('SELECT expense_date d, SUM(amount_out) v FROM expenses GROUP BY expense_date').all() as any[])
    if (r.d) touch(r.d).out += r.v

  let list = Object.values(days)
  if (from) list = list.filter((d) => d.date >= from)
  if (to) list = list.filter((d) => d.date <= to)
  const rows = computeRunningBalance(list, todayISO())
  return { rows, totals: totals(rows) }
}

/** Resumen mensual (P&L). */
export function monthSummary(year: number, month: number): MonthSummary {
  const db = getDb()
  const mm = String(month).padStart(2, '0')
  const prefix = `${year}-${mm}`

  // Ingreso real de clientes = valor de los servicios prestados en el mes (transacciones).
  const incomeClients =
    (db.prepare("SELECT IFNULL(SUM(price_effective),0) v FROM transactions WHERE substr(tx_date,1,7)=? AND end_min IS NOT NULL").get(prefix) as { v: number }).v +
    (db.prepare("SELECT IFNULL(SUM(total),0) v FROM bar_sales WHERE substr(sale_date,1,7)=?").get(prefix) as { v: number }).v

  const expensesNonProfessor =
    (db
      .prepare(
        `SELECT IFNULL(SUM(e.amount_out),0) v FROM expenses e
         LEFT JOIN persons p ON p.id=e.area_person_id
         WHERE substr(e.expense_date,1,7)=? AND (e.area_person_id IS NULL OR IFNULL(p.is_professor,0)=0)`
      )
      .get(prefix) as { v: number }).v

  const professorSalaries = (
    db
      .prepare(
        `SELECT t.professor_id id, pr.full_name name, IFNULL(SUM(t.professor_salary),0) amount
         FROM transactions t JOIN persons pr ON pr.id=t.professor_id
         WHERE substr(t.tx_date,1,7)=? AND t.professor_id IS NOT NULL AND t.end_min IS NOT NULL
         GROUP BY t.professor_id ORDER BY amount DESC`
      )
      .all(prefix) as any[]
  ).map((r) => ({ professorId: r.id, name: r.name, amount: r.amount }))

  const salariesTotal = professorSalaries.reduce((a, b) => a + b.amount, 0)
  const totalCosts = expensesNonProfessor + salariesTotal
  return {
    year,
    month,
    incomeClients,
    expensesNonProfessor,
    professorSalaries,
    totalCosts,
    net: incomeClients - totalCosts
  }
}

/** Histograma de edades (por múltiplos de 5), ignorando fechas inválidas. */
export function ageStatistics(): AgeBucket[] {
  const rows = getDb()
    .prepare('SELECT birth_date, check_in FROM persons WHERE birth_date IS NOT NULL')
    .all() as any[]
  const today = todayISO()
  const ages = rows.map((r) => ageAt(r.birth_date, r.check_in || today))
  return ageHistogram(ages)
}

/** Ingresos vs egresos por año (para el gráfico "Year Balance"). */
export function yearBalance(): { year: number; in: number; out: number }[] {
  const db = getDb()
  const map = new Map<number, { in: number; out: number }>()
  const touch = (y: number) => {
    if (!map.has(y)) map.set(y, { in: 0, out: 0 })
    return map.get(y)!
  }
  for (const r of db.prepare("SELECT substr(tx_date,1,4) y, SUM(price_effective) v FROM transactions WHERE price_effective IS NOT NULL AND end_min IS NOT NULL GROUP BY y").all() as any[])
    if (r.y) touch(parseInt(r.y, 10)).in += r.v
  for (const r of db.prepare("SELECT substr(sale_date,1,4) y, SUM(total) v FROM bar_sales GROUP BY y").all() as any[])
    if (r.y) touch(parseInt(r.y, 10)).in += r.v
  for (const r of db.prepare("SELECT substr(expense_date,1,4) y, SUM(amount_out) v FROM expenses GROUP BY y").all() as any[])
    if (r.y) touch(parseInt(r.y, 10)).out += r.v
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, in: v.in, out: v.out }))
}

/** Totales rápidos para el panel principal. */
export function dashboardTotals() {
  const db = getDb()
  const one = (sql: string) => (db.prepare(sql).get() as { v: number }).v
  return {
    clients: one('SELECT COUNT(*) v FROM persons WHERE is_client=1'),
    professors: one('SELECT COUNT(*) v FROM persons WHERE is_professor=1'),
    transactions: one('SELECT COUNT(*) v FROM transactions'),
    incomeAll: one('SELECT IFNULL(SUM(price_effective),0) v FROM transactions WHERE end_min IS NOT NULL'),
    expensesAll: one('SELECT IFNULL(SUM(amount_out),0) v FROM expenses'),
    barSales: one('SELECT COUNT(*) v FROM bar_sales')
  }
}
