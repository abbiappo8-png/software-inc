/** Planes de pago / amortización (generaliza "ozuna pago de cometa"). */
import { getDb } from '../db/connection'
import type { PaymentPlan } from '@shared/types/domain'
import { schedule, outstanding } from '@shared/services/paymentPlans'

function loadInstallments(planId: number) {
  return getDb()
    .prepare('SELECT id, paid_date, amount, comment FROM payment_plan_installments WHERE plan_id=? ORDER BY paid_date')
    .all(planId) as any[]
}

export function list(): (PaymentPlan & { outstanding: number })[] {
  const plans = getDb().prepare('SELECT * FROM payment_plans ORDER BY created_at DESC').all() as any[]
  return plans.map((p) => {
    const inst = loadInstallments(p.id)
    return {
      id: p.id, title: p.title, personId: p.person_id, equipmentId: p.equipment_id,
      principal: p.principal, startDate: p.start_date, status: p.status,
      outstanding: outstanding(p.principal, inst.map((i) => ({ paidDate: i.paid_date, amount: i.amount })))
    }
  })
}

export function get(id: number): (PaymentPlan & { outstanding: number }) | null {
  const p = getDb().prepare('SELECT * FROM payment_plans WHERE id=?').get(id) as any
  if (!p) return null
  const inst = loadInstallments(id)
  const rows = schedule(p.principal, inst.map((i) => ({ paidDate: i.paid_date, amount: i.amount })))
  return {
    id: p.id, title: p.title, personId: p.person_id, equipmentId: p.equipment_id,
    principal: p.principal, startDate: p.start_date, status: p.status,
    installments: inst.map((i, idx) => ({
      id: i.id, planId: id, paidDate: i.paid_date, amount: i.amount, comment: i.comment,
      balanceAfter: rows[idx]?.balanceAfter
    })),
    outstanding: rows.length ? rows[rows.length - 1].balanceAfter : p.principal
  }
}

export function create(title: string, personId: number | null, principal: number, startDate: string | null): PaymentPlan & { outstanding: number } {
  const id = getDb()
    .prepare("INSERT INTO payment_plans(title,person_id,principal,start_date,status) VALUES(?,?,?,?,'active')")
    .run(title, personId, Math.round(principal), startDate).lastInsertRowid as number
  return get(id)!
}

export function addInstallment(planId: number, paidDate: string, amount: number, comment: string | null): PaymentPlan & { outstanding: number } {
  getDb()
    .prepare('INSERT INTO payment_plan_installments(plan_id,paid_date,amount,comment) VALUES(?,?,?,?)')
    .run(planId, paidDate, Math.round(amount), comment)
  const plan = get(planId)!
  if (plan.outstanding <= 0) getDb().prepare("UPDATE payment_plans SET status='settled' WHERE id=?").run(planId)
  return get(planId)!
}
