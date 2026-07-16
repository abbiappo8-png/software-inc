/** Liquidación mensual de profesores (hoja Professor_Bill). */
import { getDb } from '../db/connection'
import type { ProfessorSettlement } from '@shared/types/domain'
import { computeProfessorPayroll } from '../services/payroll'
import { get as getSetting } from './settingsRepo'

export interface SettlementPreview {
  professorId: number
  professorName: string
  year: number
  month: number
  salaryRows: { date: string; service: string | null; client: string | null; salary: number }[]
  /** Gastos de Outcome a nombre del profesor (informativos; NO se descuentan por defecto). */
  outcomeRows: { date: string; supply: string | null; amount: number; comment: string | null }[]
  result: ReturnType<typeof computeProfessorPayroll>
  /** Estado de la liquidación ya guardada de este periodo (null si aún no se ha guardado). */
  savedStatus: 'draft' | 'issued' | 'paid' | null
}

function barDiscountPct(): number {
  return parseFloat(getSetting('bar_discount_pct') ?? '0')
}

export function previewSettlement(professorId: number, year: number, month: number): SettlementPreview {
  const db = getDb()
  const prof = db.prepare('SELECT full_name FROM persons WHERE id=?').get(professorId) as { full_name: string } | undefined
  if (!prof) throw new Error('Profesor no encontrado')
  const prefix = `${year}-${String(month).padStart(2, '0')}`

  const salaryRows = (
    db
      .prepare(
        `SELECT t.tx_date date, s.name service, c.full_name client, t.professor_salary salary
         FROM transactions t
         LEFT JOIN service_catalog s ON s.id=COALESCE(t.resolved_service_id, t.service_id)
         LEFT JOIN persons c ON c.id=t.client_id
         WHERE t.professor_id=? AND substr(t.tx_date,1,7)=?
         ORDER BY t.tx_date`
      )
      .all(professorId, prefix) as any[]
  ).map((r) => ({ date: r.date, service: r.service, client: r.client, salary: r.salary ?? 0 }))

  const barConsumo =
    (db.prepare("SELECT IFNULL(SUM(total),0) v FROM bar_sales WHERE client_id=? AND substr(sale_date,1,7)=?").get(professorId, prefix) as { v: number }).v

  // Gastos de Outcome a nombre del profesor: se muestran como referencia, pero NO se
  // descuentan automáticamente (en el Excel esos registros suelen ser el propio PAGO del
  // salario al profesor; restarlos invertía el neto). El usuario decide caso por caso.
  const outcomeRows = (
    db.prepare("SELECT expense_date date, supply_name supply, amount_out amount, comment FROM expenses WHERE area_person_id=? AND substr(expense_date,1,7)=?").all(professorId, prefix) as any[]
  ).map((r) => ({ date: r.date, supply: r.supply, amount: r.amount, comment: r.comment }))

  const result = computeProfessorPayroll({
    salaries: salaryRows.map((r) => r.salary),
    barConsumo,
    barDiscountPct: barDiscountPct(),
    assignedExpenses: [] // no se descuentan por defecto (ver nota arriba)
  })

  const saved = db
    .prepare('SELECT status FROM professor_settlements WHERE professor_id=? AND period_year=? AND period_month=?')
    .get(professorId, year, month) as { status: 'draft' | 'issued' | 'paid' } | undefined

  return { professorId, professorName: prof.full_name, year, month, salaryRows, outcomeRows, result, savedStatus: saved?.status ?? null }
}

function mapRow(row: any): ProfessorSettlement {
  return {
    id: row.id, professorId: row.professor_id, periodYear: row.period_year, periodMonth: row.period_month,
    grossSalary: row.gross_salary, barDiscount: row.bar_discount, expensesAssigned: row.expenses_assigned,
    netAmount: row.net_amount, status: row.status, pdfPath: row.pdf_path, emailedAt: row.emailed_at
  }
}

/** Marca la liquidación del periodo como PAGADA (la guarda antes si aún no existe). */
export function markPaid(professorId: number, year: number, month: number): ProfessorSettlement {
  const db = getDb()
  saveSettlement(professorId, year, month) // asegura que exista (upsert como 'issued')
  db.prepare(
    "UPDATE professor_settlements SET status='paid' WHERE professor_id=? AND period_year=? AND period_month=?"
  ).run(professorId, year, month)
  return mapRow(
    db.prepare('SELECT * FROM professor_settlements WHERE professor_id=? AND period_year=? AND period_month=?').get(professorId, year, month)
  )
}

export function saveSettlement(professorId: number, year: number, month: number): ProfessorSettlement {
  const preview = previewSettlement(professorId, year, month)
  const r = preview.result
  const db = getDb()
  db.prepare(
    `INSERT INTO professor_settlements(professor_id,period_year,period_month,gross_salary,bar_discount,expenses_assigned,net_amount,status)
     VALUES(@prof,@year,@month,@gross,@bar,@exp,@net,'issued')
     ON CONFLICT(professor_id,period_year,period_month) DO UPDATE SET
       gross_salary=@gross, bar_discount=@bar, expenses_assigned=@exp, net_amount=@net, status='issued'`
  ).run({ prof: professorId, year, month, gross: r.gross, bar: r.barDiscount, exp: r.expenses, net: r.net })
  const row = db.prepare('SELECT * FROM professor_settlements WHERE professor_id=? AND period_year=? AND period_month=?').get(professorId, year, month) as any
  return {
    id: row.id, professorId: row.professor_id, periodYear: row.period_year, periodMonth: row.period_month,
    grossSalary: row.gross_salary, barDiscount: row.bar_discount, expensesAssigned: row.expenses_assigned,
    netAmount: row.net_amount, status: row.status, pdfPath: row.pdf_path, emailedAt: row.emailed_at
  }
}
