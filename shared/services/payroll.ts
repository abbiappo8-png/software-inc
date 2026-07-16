/**
 * Liquidación mensual de profesores — porta la hoja Professor_Bill.
 *
 *   bruto   = Σ salario_profesor (Club!M) del profesor en el mes
 *   bar_ded = Σ consumo_bar_del_profesor · barDiscountPct
 *   gastos  = Σ gastos de Outcome asignados al profesor en el mes
 *   neto    = bruto - bar_ded - gastos
 */
import type { COP } from '@shared/types/domain'
import { roundCOP } from './money'

export interface ProfessorPayrollInput {
  salaries: COP[] // salarios de las clases del profesor en el mes (Club!M)
  barConsumo: COP // consumo del profesor en el bar en el mes
  barDiscountPct: number // fracción 0..1 (P5 del Excel, configurable)
  assignedExpenses: COP[] // gastos que asumió el profesor (Outcome)
  installmentDeductions?: COP[] // abonos de planes de pago a descontar (opcional)
}

export interface ProfessorPayrollResult {
  gross: COP
  barDiscount: COP
  expenses: COP
  installments: COP
  net: COP
}

export function computeProfessorPayroll(input: ProfessorPayrollInput): ProfessorPayrollResult {
  const gross = sum(input.salaries)
  const pct = clamp(input.barDiscountPct ?? 0, 0, 1)
  const barDiscount = roundCOP((input.barConsumo || 0) * pct)
  const expenses = sum(input.assignedExpenses)
  const installments = sum(input.installmentDeductions || [])
  const net = gross - barDiscount - expenses - installments
  return { gross, barDiscount, expenses, installments, net }
}

function sum(xs: (COP | null | undefined)[]): COP {
  let t = 0
  for (const x of xs) if (x != null && isFinite(x)) t += x
  return t
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
