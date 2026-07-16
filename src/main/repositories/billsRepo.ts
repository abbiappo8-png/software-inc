/** Facturación de cliente: preview (cálculo) y persistencia. */
import { getDb } from '../db/connection'
import type { ClientBill, ClientBillItem } from '@shared/types/domain'
import { computeClientBill, lodgingDaysFromStay } from '@shared/services/billing'
import { getCompanyConfig } from './settingsRepo'

export interface BillOptions {
  billDate?: string
  discountPct?: number
  deduction?: number
  lodgingDays?: number
  lodgingRate?: number
  alreadyPaid?: number
  cardSurcharge?: boolean
}

export interface BillPreview {
  clientId: number
  clientName: string
  items: ClientBillItem[]
  result: ReturnType<typeof computeClientBill>
  options: Required<BillOptions>
}

export function previewClientBill(clientId: number, opts: BillOptions = {}): BillPreview {
  const db = getDb()
  const client = db.prepare('SELECT * FROM persons WHERE id=?').get(clientId) as any
  if (!client) throw new Error('Cliente no encontrado')

  const txs = db
    .prepare(
      // Se excluyen las sesiones ABIERTAS (end_min NULL): aún no tienen precio y no
      // deben entrar en la factura como líneas de $0. Se facturan tras el check-out.
      `SELECT t.id, t.tx_date, t.price_effective, s.name AS service
       FROM transactions t LEFT JOIN service_catalog s ON s.id=COALESCE(t.resolved_service_id, t.service_id)
       WHERE t.client_id=? AND t.end_min IS NOT NULL ORDER BY t.tx_date`
    )
    .all(clientId) as any[]

  const sales = db
    .prepare(
      `SELECT s.id, s.sale_date, s.total, s.qty, p.name AS product
       FROM bar_sales s LEFT JOIN bar_products p ON p.id=s.product_id
       WHERE s.client_id=? ORDER BY s.sale_date`
    )
    .all(clientId) as any[]

  const items: ClientBillItem[] = []
  for (const t of txs) {
    items.push({
      kind: 'service',
      transactionId: t.id,
      description: `${t.service ?? 'Servicio'} (${t.tx_date})`,
      qty: 1,
      unitPrice: t.price_effective ?? 0,
      lineTotal: t.price_effective ?? 0
    })
  }
  for (const s of sales) {
    items.push({
      kind: 'bar',
      barSaleId: s.id,
      description: `Bar: ${s.product ?? 'Consumo'} x${s.qty} (${s.sale_date})`,
      qty: s.qty,
      unitPrice: s.qty ? Math.round(s.total / s.qty) : s.total,
      lineTotal: s.total
    })
  }

  const lodgingDays =
    opts.lodgingDays != null ? opts.lodgingDays : lodgingDaysFromStay(client.check_in, client.check_out)

  const options: Required<BillOptions> = {
    billDate: opts.billDate ?? new Date().toISOString().slice(0, 10),
    discountPct: opts.discountPct ?? 0,
    deduction: opts.deduction ?? 0,
    lodgingDays,
    lodgingRate: opts.lodgingRate ?? 0,
    alreadyPaid: opts.alreadyPaid ?? client.paid ?? 0,
    cardSurcharge: opts.cardSurcharge ?? false
  }

  const result = computeClientBill({
    servicePrices: txs.map((t) => t.price_effective ?? 0),
    serviceExtras: [],
    discountPct: options.discountPct,
    deduction: options.deduction,
    lodgingDays: options.lodgingDays,
    lodgingRate: options.lodgingRate,
    barTotal: sales.reduce((a, b) => a + (b.total ?? 0), 0),
    alreadyPaid: options.alreadyPaid,
    cardSurcharge: options.cardSurcharge,
    cardSurchargePct: getCompanyConfig().cardSurchargePct
  })

  return { clientId, clientName: client.full_name, items, result, options }
}

export function saveBill(clientId: number, opts: BillOptions = {}): ClientBill {
  const preview = previewClientBill(clientId, opts)
  const db = getDb()
  const o = preview.options
  const r = preview.result
  const billId = db
    .prepare(
      `INSERT INTO client_bills(client_id,bill_date,lodging_days,lodging_rate,discount_pct,deductions,already_paid,
        card_surcharge,subtotal,total,net_to_pay,status)
       VALUES(@client,@date,@lodgingDays,@lodgingRate,@discount,@deduction,@paid,@card,@subtotal,@total,@net,'issued')`
    )
    .run({
      client: clientId, date: o.billDate, lodgingDays: o.lodgingDays, lodgingRate: o.lodgingRate,
      discount: o.discountPct, deduction: o.deduction, paid: o.alreadyPaid, card: o.cardSurcharge ? 1 : 0,
      subtotal: r.subtotal, total: r.total, net: r.netToPay
    }).lastInsertRowid as number

  const insItem = db.prepare(
    `INSERT INTO client_bill_items(bill_id,kind,transaction_id,bar_sale_id,description,qty,unit_price,line_total)
     VALUES(?,?,?,?,?,?,?,?)`
  )
  for (const it of preview.items)
    insItem.run(billId, it.kind, it.transactionId ?? null, it.barSaleId ?? null, it.description, it.qty, it.unitPrice, it.lineTotal)

  return get(billId)!
}

export function get(id: number): ClientBill | null {
  const db = getDb()
  const r = db.prepare('SELECT * FROM client_bills WHERE id=?').get(id) as any
  if (!r) return null
  const items = db.prepare('SELECT * FROM client_bill_items WHERE bill_id=?').all(id) as any[]
  return {
    id: r.id, clientId: r.client_id, billDate: r.bill_date, lodgingDays: r.lodging_days,
    lodgingRate: r.lodging_rate, discountPct: r.discount_pct, deductions: r.deductions,
    alreadyPaid: r.already_paid, cardSurcharge: !!r.card_surcharge, subtotal: r.subtotal,
    total: r.total, netToPay: r.net_to_pay, status: r.status, pdfPath: r.pdf_path,
    emailedAt: r.emailed_at, notes: r.notes,
    items: items.map((it) => ({
      id: it.id, billId: it.bill_id, kind: it.kind, transactionId: it.transaction_id,
      barSaleId: it.bar_sale_id, description: it.description, qty: it.qty,
      unitPrice: it.unit_price, lineTotal: it.line_total
    }))
  }
}

/**
 * Registra el pago de la factura: marca la factura como pagada y abona al cliente el
 * neto pendiente, de modo que su saldo (cargos − pagado) queda en 0.
 */
export function markPaid(id: number): ClientBill {
  const db = getDb()
  const bill = get(id)
  if (!bill) throw new Error('Factura no encontrada')
  if (bill.status === 'paid') return bill // idempotente: no duplica el abono
  db.prepare("UPDATE client_bills SET status='paid' WHERE id=?").run(id)
  db.prepare('UPDATE persons SET paid = IFNULL(paid,0) + ? WHERE id=?').run(bill.netToPay, bill.clientId)
  return get(id)!
}

export function markEmailed(id: number): void {
  getDb().prepare("UPDATE client_bills SET emailed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").run(id)
}
export function setPdfPath(id: number, path: string): void {
  getDb().prepare('UPDATE client_bills SET pdf_path=? WHERE id=?').run(path, id)
}
