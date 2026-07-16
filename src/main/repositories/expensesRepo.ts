/** Repositorio de gastos (hoja Outcome). */
import { getDb } from '../db/connection'
import type { Expense } from '@shared/types/domain'

function mapRow(r: any): Expense {
  return {
    id: r.id,
    expenseDate: r.expense_date,
    supplyName: r.supply_name,
    count: r.count ?? 1,
    areaName: r.area_name,
    areaPersonId: r.area_person_id,
    supplierId: r.supplier_id,
    supplierRaw: r.supplier_raw,
    amountOut: r.amount_out,
    comment: r.comment,
    importBatchId: r.import_batch_id ?? null
  }
}

export interface ExpenseInput {
  expenseDate: string
  supplyName: string | null
  count: number
  areaName: string | null
  areaPersonId: number | null
  supplierId: number | null
  amountOut: number
  comment: string | null
}

export function create(input: ExpenseInput): Expense {
  const id = getDb()
    .prepare(
      `INSERT INTO expenses(expense_date,supply_name,count,area_name,area_person_id,supplier_id,supplier_raw,amount_out,comment)
       VALUES(@date,@supply,@count,@area,@areaId,@supId,@supRaw,@amount,@comment)`
    )
    .run({
      date: input.expenseDate, supply: input.supplyName, count: input.count ?? 1,
      area: input.areaName, areaId: input.areaPersonId, supId: input.supplierId,
      supRaw: null, amount: Math.round(input.amountOut), comment: input.comment
    }).lastInsertRowid as number
  return getDb().prepare('SELECT * FROM expenses WHERE id=?').get(id) ? mapRow(getDb().prepare('SELECT * FROM expenses WHERE id=?').get(id)) : (null as any)
}

export function update(id: number, input: ExpenseInput): Expense {
  getDb()
    .prepare(
      `UPDATE expenses SET expense_date=@date, supply_name=@supply, count=@count, area_name=@area,
        area_person_id=@areaId, supplier_id=@supId, amount_out=@amount, comment=@comment WHERE id=@id`
    )
    .run({
      id, date: input.expenseDate, supply: input.supplyName, count: input.count ?? 1,
      area: input.areaName, areaId: input.areaPersonId, supId: input.supplierId,
      amount: Math.round(input.amountOut), comment: input.comment
    })
  return mapRow(getDb().prepare('SELECT * FROM expenses WHERE id=?').get(id))
}

export function list(from?: string, to?: string): Expense[] {
  const where: string[] = []
  const p: any = {}
  if (from) { where.push('expense_date>=@from'); p.from = from }
  if (to) { where.push('expense_date<=@to'); p.to = to }
  const sql = 'SELECT * FROM expenses' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY expense_date DESC, id DESC'
  return getDb().prepare(sql).all(p).map(mapRow)
}

export function remove(id: number): void {
  getDb().prepare('DELETE FROM expenses WHERE id=?').run(id)
}
