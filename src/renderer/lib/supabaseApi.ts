/**
 * Implementación del contrato AppApi para el MODO WEB: los datos viven en
 * Supabase (Postgres vía PostgREST + Storage) y toda la lógica de negocio se
 * calcula aquí reutilizando los servicios puros de shared/services — replicando
 * la semántica de los repositorios de la app de escritorio (src/main/repositories).
 *
 * Lo que requiere el sistema operativo (SMTP, abrir con Excel, respaldo local,
 * importación del Excel histórico) queda como "solo escritorio" con mensajes amables.
 */
import type { AppApi } from '@shared/types/api'
import type {
  Person,
  PersonInput,
  ServiceCatalogItem,
  Equipment,
  Transaction,
  TxType,
  TxPreview,
  BarProduct,
  BarSale,
  Expense,
  ClientBill,
  ClientBillItem,
  ProfessorSettlement,
  PaymentPlan,
  MonthSummary,
  CompanyConfig,
  FormConfig,
  FormGuess,
  FormResponse,
  FormSyncResult,
  StoredFile
} from '@shared/types/domain'
import * as sb from './supabaseRest'
import { normalize, cleanName, normalizeCountry } from '@shared/services/text'
import { autoPrice, professorSalary as calcProfessorSalary } from '@shared/services/pricing'
import { detectCourseForClient, type CourseLevel } from '@shared/services/courses'
import { unitCost, saleTotal, canSell } from '@shared/services/bar'
import { computeClientBill, lodgingDaysFromStay } from '@shared/services/billing'
import { minutesToHHMM } from '@shared/services/dates'
import { computeProfessorPayroll } from '@shared/services/payroll'
import { computeRunningBalance, totals as balanceTotals, type DayAggregate } from '@shared/services/balance'
import { ageAt, ageHistogram } from '@shared/services/statistics'
import { schedule, outstanding } from '@shared/services/paymentPlans'
import { csvToObjects } from '@shared/services/csv'
import { rowHash, findTimestamp, guess } from '@shared/services/formsGuess'
import { clientBillHtml, settlementHtml, type SettlementPreview } from '@shared/templates/documents'

const FILES_BUCKET = 'archivos'
const PHOTOS_BUCKET = 'fotos'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Minutos desde medianoche de la hora local actual (entrada/salida "ahora"). */
function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** Rango [primer día, último día] REAL del mes (apto para columnas date de PG). */
function monthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

/** Abre el documento en una ventana nueva y lanza el diálogo de impresión. */
function openPrintWindow(html: string): string {
  const w = window.open('', '_blank')
  if (!w) throw new Error('El navegador bloqueó la ventana emergente. Permite pop-ups para imprimir el documento.')
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400) // dar tiempo a que cargue el logo embebido
  return '(se abrió el diálogo de impresión)'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

// ---------------------------------------------------------------------------
// settings (tabla key/value con value jsonb)
// ---------------------------------------------------------------------------

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await sb.selectOne<{ value: any }>('settings', { select: 'value', filters: [sb.eq('key', key)] })
  return row == null || row.value == null ? fallback : (row.value as T)
}

async function getSettings(keys: string[]): Promise<Map<string, any>> {
  const rows = await sb.select<{ key: string; value: any }>('settings', {
    select: 'key,value',
    filters: [sb.inList('key', keys)]
  })
  return new Map(rows.map((r) => [r.key, r.value]))
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await sb.upsert('settings', [{ key, value }], 'key')
}

const asStr = (v: unknown): string => (v == null ? '' : String(v))
const asNum = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : fallback
}

async function getCompanyConfig(): Promise<CompanyConfig> {
  const m = await getSettings(['company_name', 'company_nit', 'card_surcharge_pct', 'currency'])
  return {
    companyName: asStr(m.get('company_name')) || 'Escuela de Deportes Acuáticos',
    companyNit: asStr(m.get('company_nit')),
    cardSurchargePct: asNum(m.get('card_surcharge_pct'), 0.05),
    currency: asStr(m.get('currency')) || 'COP'
  }
}

// ---------------------------------------------------------------------------
// Mapeos snake_case -> camelCase (idénticos a los repos de escritorio)
// ---------------------------------------------------------------------------

function mapPerson(r: any): Person {
  return {
    id: r.id,
    fullName: r.full_name,
    nickname: r.nickname,
    isClient: !!r.is_client,
    isProfessor: !!r.is_professor,
    isSupplier: !!r.is_supplier,
    passport: r.passport,
    email: r.email,
    country: r.country,
    birthDate: r.birth_date,
    birthDateRaw: r.birth_date_raw,
    checkIn: r.check_in,
    checkOut: r.check_out,
    takingCourse: !!r.taking_course,
    discountPct: r.discount_pct ?? 0,
    paid: r.paid ?? 0,
    stillHere: !!r.still_here,
    comment: r.comment,
    photoPath: r.photo_path,
    photoThumbPath: r.photo_thumb_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function mapService(r: any): ServiceCatalogItem {
  return {
    id: r.id,
    name: r.name,
    discipline: r.discipline,
    seasonYear: r.season_year,
    hours: r.hours ?? 0,
    days: r.days ?? 0,
    price: r.price ?? 0,
    professorPct: r.professor_pct ?? 0,
    isClass: !!r.is_class,
    active: !!r.active
  }
}

function mapEquipment(r: any): Equipment {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    count: r.count ?? 1,
    price: r.price,
    active: !!r.active
  }
}

function mapTx(r: any): Transaction {
  return {
    id: r.id,
    txDate: r.tx_date,
    startMin: r.start_min,
    endMin: r.end_min,
    serviceRaw: r.service_raw,
    serviceId: r.service_id,
    isClass: !!r.is_class,
    txType: (r.tx_type ?? 'service') as TxType,
    resolvedServiceId: r.resolved_service_id,
    professorId: r.professor_id,
    clientId: r.client_id,
    kiteId: r.kite_id,
    boardId: r.board_id,
    priceSnapshot: r.price_snapshot,
    professorPctSnapshot: r.professor_pct_snapshot,
    priceOverride: r.price_override,
    checkInAt: r.check_in_at ?? null,
    comment: r.comment,
    priceEffective: r.price_effective,
    durationMin: r.duration_min,
    professorSalary: r.professor_salary,
    isOpen: r.end_min == null
  }
}

function mapSale(r: any): BarSale {
  return {
    id: r.id,
    saleDate: r.sale_date,
    clientId: r.client_id,
    clientRaw: r.client_raw,
    productId: r.product_id,
    productRaw: r.product_raw,
    qty: r.qty,
    total: r.total,
    paidCash: !!r.paid_cash,
    alreadyPaid: !!r.already_paid
  }
}

function mapExpense(r: any): Expense {
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

function mapBillRow(r: any, items: any[]): ClientBill {
  return {
    id: r.id,
    clientId: r.client_id,
    billDate: r.bill_date,
    lodgingDays: r.lodging_days,
    lodgingRate: r.lodging_rate,
    discountPct: r.discount_pct,
    deductions: r.deductions,
    alreadyPaid: r.already_paid,
    cardSurcharge: !!r.card_surcharge,
    subtotal: r.subtotal,
    total: r.total,
    netToPay: r.net_to_pay,
    status: r.status,
    pdfPath: r.pdf_path,
    emailedAt: r.emailed_at,
    notes: r.notes,
    items: items.map((it) => ({
      id: it.id,
      billId: it.bill_id,
      kind: it.kind,
      transactionId: it.transaction_id,
      barSaleId: it.bar_sale_id,
      description: it.description,
      qty: it.qty,
      unitPrice: it.unit_price,
      lineTotal: it.line_total
    }))
  }
}

function mapSettlement(r: any): ProfessorSettlement {
  return {
    id: r.id,
    professorId: r.professor_id,
    periodYear: r.period_year,
    periodMonth: r.period_month,
    grossSalary: r.gross_salary,
    barDiscount: r.bar_discount,
    expensesAssigned: r.expenses_assigned,
    netAmount: r.net_amount,
    status: r.status,
    pdfPath: r.pdf_path,
    emailedAt: r.emailed_at
  }
}

// ---------------------------------------------------------------------------
// persons
// ---------------------------------------------------------------------------

function personFilters(filter?: { role?: string; search?: string; onlyActive?: boolean }, forCount = false): string[] {
  const f: string[] = []
  if (filter?.role === 'client') f.push(sb.eq('is_client', 1))
  if (filter?.role === 'professor') f.push(sb.eq('is_professor', 1))
  if (filter?.role === 'supplier') f.push(sb.eq('is_supplier', 1))
  if (filter?.onlyActive) f.push(sb.eq('still_here', 1))
  if (filter?.search) {
    // Mismos campos que el repo de escritorio (count busca solo nombre+email).
    const q = normalize(filter.search).replace(/\s+/g, ' ').trim()
    if (q) {
      // Comodines de LIKE escapados y valor entrecomillado: 'john_doe' o 'a,b' se buscan tal cual.
      const pattern = sb.quoteValue(`*${sb.escapeLike(q)}*`)
      const cols = forCount ? ['name_normalized', 'email'] : ['name_normalized', 'nickname_normalized', 'email', 'passport']
      f.push(sb.orFilter(cols.map((c) => `${c}.ilike.${pattern}`)))
    }
  }
  return f
}

function personRow(input: PersonInput): Record<string, unknown> {
  const full = cleanName(input.fullName)
  return {
    full_name: full,
    name_normalized: normalize(full),
    nickname: input.nickname ? cleanName(input.nickname) : null,
    nickname_normalized: input.nickname ? normalize(input.nickname) : null,
    is_client: input.isClient ? 1 : 0,
    is_professor: input.isProfessor ? 1 : 0,
    is_supplier: input.isSupplier ? 1 : 0,
    passport: input.passport ?? null,
    email: input.email ?? null,
    country: input.country ? normalizeCountry(input.country) : null,
    country_raw: input.country ?? null,
    birth_date: input.birthDate ?? null,
    birth_date_raw: input.birthDateRaw ?? null,
    check_in: input.checkIn ?? null,
    check_out: input.checkOut ?? null,
    taking_course: input.takingCourse ? 1 : 0,
    discount_pct: input.discountPct ?? 0,
    paid: input.paid ?? 0,
    still_here: input.stillHere !== false ? 1 : 0,
    comment: input.comment ?? null
  }
}

async function getPerson(id: number): Promise<Person | null> {
  const r = await sb.selectOne<any>('persons', { filters: [sb.eq('id', id)] })
  return r ? mapPerson(r) : null
}

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

async function getService(id: number): Promise<ServiceCatalogItem | null> {
  const r = await sb.selectOne<any>('service_catalog', { filters: [sb.eq('id', id)] })
  return r ? mapService(r) : null
}

/** Cursos (niveles is_class) ordenados por umbral de horas ascendente. */
async function courses(): Promise<CourseLevel[]> {
  const rows = await sb.select<any>('service_catalog', {
    select: 'id,name,hours',
    filters: [sb.eq('is_class', 1)],
    order: 'hours.asc'
  })
  return rows.map((r) => ({ id: r.id, name: r.name, thresholdHours: r.hours ?? 0 }))
}

/** Mapa id -> nombre del catálogo (para "joins" en cliente). */
async function serviceNames(): Promise<Map<number, string>> {
  const rows = await sb.select<any>('service_catalog', { select: 'id,name' })
  return new Map(rows.map((r) => [r.id, r.name]))
}

async function personNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const rows = await sb.select<any>('persons', { select: 'id,full_name', filters: [sb.inList('id', ids)] })
  return new Map(rows.map((r) => [r.id, r.full_name]))
}

// ---------------------------------------------------------------------------
// transactions (mismo motor que transactionsRepo)
// ---------------------------------------------------------------------------

interface TxInput {
  txDate: string
  startMin: number | null
  endMin: number | null
  serviceId: number | null
  isClass: boolean
  txType?: TxType
  clientId: number | null
  professorId: number | null
  kiteId: number | null
  boardId: number | null
  priceOverride: number | null
  comment?: string | null
}

function resolveTxType(input: TxInput): TxType {
  if (input.txType) return input.txType
  return input.isClass ? 'class' : 'service'
}

/** Resuelve el servicio (si es "Class", detecta el curso) y calcula snapshots. */
async function computeSnapshots(
  input: TxInput,
  excludeTxId?: number
): Promise<{
  resolvedServiceId: number | null
  priceSnapshot: number | null
  professorPct: number | null
  serviceRaw: string | null
}> {
  let resolvedServiceId = input.serviceId
  if (input.isClass && input.clientId != null) {
    const filters = [sb.eq('client_id', input.clientId)]
    if (excludeTxId != null) filters.push(sb.neq('id', excludeTxId))
    const clientTxs = await sb.selectAll<any>('transactions', { select: 'is_class,duration_min,tx_date', filters })
    const course = detectCourseForClient(
      clientTxs.map((r) => ({ chosenServiceIsClass: !!r.is_class, durationMin: r.duration_min, txDate: r.tx_date })),
      await courses(),
      input.txDate
    )
    resolvedServiceId = course?.id ?? null
  }
  const item = resolvedServiceId != null ? await getService(resolvedServiceId) : null
  const client =
    input.clientId != null
      ? await sb.selectOne<{ discount_pct: number | null }>('persons', {
          select: 'discount_pct',
          filters: [sb.eq('id', input.clientId)]
        })
      : null
  const durationMin = input.endMin != null && input.startMin != null ? input.endMin - input.startMin : null
  let priceSnapshot: number | null = null
  // Invariante entrada/salida: una sesión ABIERTA no tiene precio todavía.
  if (item && input.endMin != null) {
    priceSnapshot = autoPrice({
      item: { hours: item.hours, days: item.days, price: item.price },
      clientDiscountPct: client?.discount_pct ?? 0,
      durationMin
    })
  }
  return {
    resolvedServiceId,
    priceSnapshot,
    professorPct: input.professorId != null ? item?.professorPct ?? null : null,
    serviceRaw: item?.name ?? null
  }
}

async function previewTx(input: TxInput): Promise<TxPreview> {
  const snap = await computeSnapshots(input)
  const durationMin = input.endMin != null && input.startMin != null ? input.endMin - input.startMin : null
  const priceEffective = input.priceOverride != null ? input.priceOverride : snap.priceSnapshot
  const salary = calcProfessorSalary(priceEffective, snap.professorPct, input.professorId != null)
  return {
    resolvedServiceId: snap.resolvedServiceId,
    serviceName: snap.serviceRaw,
    isClass: input.isClass,
    courseDetected: input.isClass ? snap.serviceRaw : null,
    durationMin,
    priceEffective,
    professorSalary: salary
  }
}

/** Fila para insertar/actualizar. Los campos GENERADOS (price_effective, duration_min, professor_salary) NO se envían. */
function txRow(input: TxInput, snap: Awaited<ReturnType<typeof computeSnapshots>>): Record<string, unknown> {
  return {
    tx_date: input.txDate,
    start_min: input.startMin,
    end_min: input.endMin,
    service_raw: snap.serviceRaw,
    service_id: input.serviceId,
    is_class: input.isClass ? 1 : 0,
    tx_type: resolveTxType(input),
    resolved_service_id: snap.resolvedServiceId,
    professor_id: input.professorId,
    client_id: input.clientId,
    kite_id: input.kiteId,
    board_id: input.boardId,
    price_snapshot: snap.priceSnapshot,
    professor_pct_snapshot: snap.professorPct,
    price_override: input.priceOverride,
    comment: input.comment ?? null
  }
}

async function getTx(id: number): Promise<Transaction | null> {
  const r = await sb.selectOne<any>('transactions', { filters: [sb.eq('id', id)] })
  return r ? mapTx(r) : null
}

async function txCreate(input: TxInput): Promise<Transaction> {
  const snap = await computeSnapshots(input)
  const open = input.endMin == null
  const row = { ...txRow(input, snap), check_in_at: open ? new Date().toISOString() : null }
  const [r] = await sb.insert<any>('transactions', [row])
  return (await getTx(r.id))!
}

async function txUpdate(id: number, input: TxInput): Promise<Transaction> {
  const snap = await computeSnapshots(input, id)
  await sb.update('transactions', txRow(input, snap), [sb.eq('id', id)])
  return (await getTx(id))!
}

async function txCheckout(id: number, endMin?: number | null): Promise<Transaction> {
  const existing = await getTx(id)
  if (!existing) throw new Error('Transacción no encontrada')
  const end = endMin ?? nowMinutes()
  return txUpdate(id, {
    txDate: existing.txDate,
    startMin: existing.startMin,
    endMin: end,
    serviceId: existing.serviceId,
    isClass: existing.isClass,
    txType: existing.txType,
    clientId: existing.clientId,
    professorId: existing.professorId,
    kiteId: existing.kiteId,
    boardId: existing.boardId,
    priceOverride: existing.priceOverride,
    comment: existing.comment
  })
}

// ---------------------------------------------------------------------------
// bar (stock derivado como en barRepo)
// ---------------------------------------------------------------------------

async function purchasedByName(): Promise<Map<string, number>> {
  const rows = await sb.selectAll<any>('expenses', { select: 'supply_name,count', filters: [sb.notNull('supply_name')] })
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.supply_name, (m.get(r.supply_name) || 0) + (r.count || 0))
  return m
}

async function soldByProduct(): Promise<Map<number, number>> {
  const rows = await sb.selectAll<any>('bar_sales', { select: 'product_id,qty', filters: [sb.notNull('product_id')] })
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.product_id, (m.get(r.product_id) || 0) + (r.qty || 0))
  return m
}

function mapProduct(r: any, stock: number): BarProduct {
  return {
    id: r.id,
    name: r.name,
    boxPrice: r.box_price,
    unitsPerBox: r.units_per_box,
    sellPrice: r.sell_price,
    active: !!r.active,
    unitCost: unitCost(r.box_price, r.units_per_box),
    stock
  }
}

async function getProductWithStock(id: number): Promise<BarProduct | null> {
  const r = await sb.selectOne<any>('bar_products', { filters: [sb.eq('id', id)] })
  if (!r) return null
  const [purchased, sold] = await Promise.all([purchasedByName(), soldByProduct()])
  return mapProduct(r, (purchased.get(r.name) || 0) - (sold.get(r.id) || 0))
}

// ---------------------------------------------------------------------------
// bills (réplica de billsRepo)
// ---------------------------------------------------------------------------

interface BillOptions {
  billDate?: string
  discountPct?: number
  deduction?: number
  lodgingDays?: number
  lodgingRate?: number
  alreadyPaid?: number
  cardSurcharge?: boolean
}

async function previewClientBill(clientId: number, opts: BillOptions = {}) {
  const client = await sb.selectOne<any>('persons', { filters: [sb.eq('id', clientId)] })
  if (!client) throw new Error('Cliente no encontrado')

  // Se excluyen las sesiones ABIERTAS (end_min NULL): se facturan tras el check-out.
  const [txs, sales, svcNames, products] = await Promise.all([
    sb.selectAll<any>('transactions', {
      select: 'id,tx_date,start_min,end_min,price_effective,resolved_service_id,service_id',
      filters: [sb.eq('client_id', clientId), sb.notNull('end_min')],
      order: 'tx_date.asc,id.asc'
    }),
    sb.selectAll<any>('bar_sales', {
      select: 'id,sale_date,total,qty,product_id',
      filters: [sb.eq('client_id', clientId)],
      order: 'sale_date.asc,id.asc'
    }),
    serviceNames(),
    sb.select<any>('bar_products', { select: 'id,name' })
  ])
  const productNames = new Map<number, string>(products.map((p: any) => [p.id, p.name]))

  const items: ClientBillItem[] = []
  for (const t of txs) {
    const service = svcNames.get(t.resolved_service_id ?? t.service_id) ?? null
    // Horario de la sesión en el recibo: "(fecha, 09:30–11:00)"
    const horario = t.start_min != null ? `, ${minutesToHHMM(t.start_min)}–${minutesToHHMM(t.end_min)}` : ''
    items.push({
      kind: 'service',
      transactionId: t.id,
      description: `${service ?? 'Servicio'} (${t.tx_date}${horario})`,
      qty: 1,
      unitPrice: t.price_effective ?? 0,
      lineTotal: t.price_effective ?? 0
    })
  }
  for (const s of sales) {
    items.push({
      kind: 'bar',
      barSaleId: s.id,
      description: `Bar: ${productNames.get(s.product_id) ?? 'Consumo'} x${s.qty} (${s.sale_date})`,
      qty: s.qty,
      unitPrice: s.qty ? Math.round(s.total / s.qty) : s.total,
      lineTotal: s.total
    })
  }

  const lodgingDays = opts.lodgingDays != null ? opts.lodgingDays : lodgingDaysFromStay(client.check_in, client.check_out)
  const options: Required<BillOptions> = {
    billDate: opts.billDate ?? todayISO(),
    discountPct: opts.discountPct ?? 0,
    deduction: opts.deduction ?? 0,
    lodgingDays,
    lodgingRate: opts.lodgingRate ?? 0,
    alreadyPaid: opts.alreadyPaid ?? client.paid ?? 0,
    cardSurcharge: opts.cardSurcharge ?? false
  }

  const result = computeClientBill({
    servicePrices: txs.map((t: any) => t.price_effective ?? 0),
    serviceExtras: [],
    discountPct: options.discountPct,
    deduction: options.deduction,
    lodgingDays: options.lodgingDays,
    lodgingRate: options.lodgingRate,
    barTotal: sales.reduce((a: number, b: any) => a + (b.total ?? 0), 0),
    alreadyPaid: options.alreadyPaid,
    cardSurcharge: options.cardSurcharge,
    cardSurchargePct: (await getCompanyConfig()).cardSurchargePct
  })

  return { clientId, clientName: client.full_name as string, items, result, options }
}

async function getBill(id: number): Promise<ClientBill | null> {
  const r = await sb.selectOne<any>('client_bills', { filters: [sb.eq('id', id)] })
  if (!r) return null
  const items = await sb.select<any>('client_bill_items', { filters: [sb.eq('bill_id', id)], order: 'id.asc' })
  return mapBillRow(r, items)
}

// ---------------------------------------------------------------------------
// settlements (réplica de settlementsRepo)
// ---------------------------------------------------------------------------

async function previewSettlement(professorId: number, year: number, month: number): Promise<SettlementPreview> {
  const prof = await sb.selectOne<any>('persons', { select: 'full_name', filters: [sb.eq('id', professorId)] })
  if (!prof) throw new Error('Profesor no encontrado')
  const { from, to } = monthRange(year, month)

  const [txs, svcNames, barSalesRows, expenseRows, saved] = await Promise.all([
    sb.selectAll<any>('transactions', {
      select: 'tx_date,professor_salary,client_id,resolved_service_id,service_id',
      filters: [sb.eq('professor_id', professorId), sb.gte('tx_date', from), sb.lte('tx_date', to)],
      order: 'tx_date.asc,id.asc'
    }),
    serviceNames(),
    sb.selectAll<any>('bar_sales', {
      select: 'total',
      filters: [sb.eq('client_id', professorId), sb.gte('sale_date', from), sb.lte('sale_date', to)]
    }),
    sb.selectAll<any>('expenses', {
      select: 'expense_date,supply_name,amount_out,comment',
      filters: [sb.eq('area_person_id', professorId), sb.gte('expense_date', from), sb.lte('expense_date', to)]
    }),
    sb.selectOne<any>('professor_settlements', {
      select: 'status',
      filters: [sb.eq('professor_id', professorId), sb.eq('period_year', year), sb.eq('period_month', month)]
    })
  ])
  const clientNames = await personNames([...new Set(txs.map((t: any) => t.client_id).filter((x: any) => x != null))] as number[])

  const salaryRows = txs.map((t: any) => ({
    date: t.tx_date,
    service: svcNames.get(t.resolved_service_id ?? t.service_id) ?? null,
    client: t.client_id != null ? clientNames.get(t.client_id) ?? null : null,
    salary: t.professor_salary ?? 0
  }))
  const barConsumo = barSalesRows.reduce((a: number, b: any) => a + (b.total ?? 0), 0)
  // Gastos a nombre del profesor: informativos, NO se descuentan por defecto.
  const outcomeRows = expenseRows.map((r: any) => ({
    date: r.expense_date,
    supply: r.supply_name,
    amount: r.amount_out,
    comment: r.comment
  }))

  const result = computeProfessorPayroll({
    salaries: salaryRows.map((r) => r.salary),
    barConsumo,
    barDiscountPct: asNum(await getSetting('bar_discount_pct', 0), 0),
    assignedExpenses: []
  })

  return {
    professorId,
    professorName: prof.full_name,
    year,
    month,
    salaryRows,
    outcomeRows,
    result,
    savedStatus: saved?.status ?? null
  }
}

async function saveSettlement(professorId: number, year: number, month: number): Promise<ProfessorSettlement> {
  const preview = await previewSettlement(professorId, year, month)
  const r = preview.result
  const [row] = await sb.upsert<any>(
    'professor_settlements',
    [
      {
        professor_id: professorId,
        period_year: year,
        period_month: month,
        gross_salary: r.gross,
        bar_discount: r.barDiscount,
        expenses_assigned: r.expenses,
        net_amount: r.net,
        status: 'issued'
      }
    ],
    'professor_id,period_year,period_month'
  )
  return mapSettlement(row)
}

// ---------------------------------------------------------------------------
// finance (agregación en cliente, réplica de financeRepo)
// ---------------------------------------------------------------------------

async function dailyCashflow(from?: string, to?: string) {
  const [txs, sales, exps] = await Promise.all([
    sb.selectAll<any>('transactions', {
      select: 'tx_date,price_effective',
      filters: [sb.notNull('price_effective'), sb.notNull('end_min')]
    }),
    sb.selectAll<any>('bar_sales', { select: 'sale_date,total' }),
    sb.selectAll<any>('expenses', { select: 'expense_date,amount_out' })
  ])
  const days: Record<string, DayAggregate> = {}
  const touch = (d: string) => (days[d] ??= { date: d, inClients: 0, inBar: 0, out: 0 })
  for (const r of txs) if (r.tx_date) touch(r.tx_date).inClients += r.price_effective ?? 0
  for (const r of sales) if (r.sale_date) touch(r.sale_date).inBar += r.total ?? 0
  for (const r of exps) if (r.expense_date) touch(r.expense_date).out += r.amount_out ?? 0

  let list = Object.values(days)
  if (from) list = list.filter((d) => d.date >= from)
  if (to) list = list.filter((d) => d.date <= to)
  const rows = computeRunningBalance(list, todayISO())
  return { rows, totals: balanceTotals(rows) }
}

async function monthSummary(year: number, month: number): Promise<MonthSummary> {
  const { from, to } = monthRange(year, month)

  const [monthTxs, monthSales, monthExpenses] = await Promise.all([
    sb.selectAll<any>('transactions', {
      select: 'price_effective,professor_salary,professor_id',
      filters: [sb.gte('tx_date', from), sb.lte('tx_date', to), sb.notNull('end_min')]
    }),
    sb.selectAll<any>('bar_sales', {
      select: 'total',
      filters: [sb.gte('sale_date', from), sb.lte('sale_date', to)]
    }),
    sb.selectAll<any>('expenses', {
      select: 'amount_out,area_person_id',
      filters: [sb.gte('expense_date', from), sb.lte('expense_date', to)]
    })
  ])

  const incomeClients =
    monthTxs.reduce((a: number, b: any) => a + (b.price_effective ?? 0), 0) +
    monthSales.reduce((a: number, b: any) => a + (b.total ?? 0), 0)

  // Gastos que no son de profesores (área persona no profesor o sin persona).
  const areaIds = [...new Set(monthExpenses.map((e: any) => e.area_person_id).filter((x: any) => x != null))] as number[]
  const professorsById = new Map<number, boolean>()
  if (areaIds.length) {
    const rows = await sb.select<any>('persons', { select: 'id,is_professor', filters: [sb.inList('id', areaIds)] })
    for (const r of rows) professorsById.set(r.id, !!r.is_professor)
  }
  const expensesNonProfessor = monthExpenses
    .filter((e: any) => e.area_person_id == null || !professorsById.get(e.area_person_id))
    .reduce((a: number, b: any) => a + (b.amount_out ?? 0), 0)

  const salaryByProf = new Map<number, number>()
  for (const t of monthTxs) {
    if (t.professor_id == null) continue
    salaryByProf.set(t.professor_id, (salaryByProf.get(t.professor_id) || 0) + (t.professor_salary ?? 0))
  }
  const names = await personNames([...salaryByProf.keys()])
  const professorSalaries = [...salaryByProf.entries()]
    .map(([professorId, amount]) => ({ professorId, name: names.get(professorId) ?? '', amount }))
    .sort((a, b) => b.amount - a.amount)

  const salariesTotal = professorSalaries.reduce((a, b) => a + b.amount, 0)
  const totalCosts = expensesNonProfessor + salariesTotal
  return { year, month, incomeClients, expensesNonProfessor, professorSalaries, totalCosts, net: incomeClients - totalCosts }
}

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------

function mapPlan(p: any, installments: any[]): PaymentPlan & { outstanding: number } {
  const rows = schedule(
    p.principal,
    installments.map((i) => ({ paidDate: i.paid_date, amount: i.amount }))
  )
  return {
    id: p.id,
    title: p.title,
    personId: p.person_id,
    equipmentId: p.equipment_id,
    principal: p.principal,
    startDate: p.start_date,
    status: p.status,
    installments: installments.map((i, idx) => ({
      id: i.id,
      planId: p.id,
      paidDate: i.paid_date,
      amount: i.amount,
      comment: i.comment,
      balanceAfter: rows[idx]?.balanceAfter
    })),
    outstanding: rows.length ? rows[rows.length - 1].balanceAfter : p.principal
  }
}

async function getPlan(id: number): Promise<(PaymentPlan & { outstanding: number }) | null> {
  const p = await sb.selectOne<any>('payment_plans', { filters: [sb.eq('id', id)] })
  if (!p) return null
  const inst = await sb.select<any>('payment_plan_installments', {
    filters: [sb.eq('plan_id', id)],
    order: 'paid_date.asc'
  })
  return mapPlan(p, inst)
}

// ---------------------------------------------------------------------------
// forms (réplica de formsSync.ts)
// ---------------------------------------------------------------------------

const FORMS_KEY = 'google_forms'

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form'
}

/** values tolerante: raw_json puede venir como jsonb (objeto) o como texto JSON. */
function responseValues(r: any): Record<string, string> {
  const raw = r.raw_json
  if (raw == null) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return raw
}

function mapResponse(r: any): FormResponse {
  return {
    id: r.id,
    formKey: r.form_key,
    rowHash: r.row_hash,
    submittedAt: r.submitted_at,
    values: responseValues(r),
    status: r.status,
    importedPersonId: r.imported_person_id,
    importedTxId: r.imported_tx_id
  }
}

/** Busca una persona existente por pasaporte → email → nombre (como el importador). */
async function matchPerson(g: FormGuess): Promise<number | null> {
  if (g.passport) {
    const r = await sb.selectOne<{ id: number }>('persons', {
      select: 'id',
      filters: [sb.eq('passport', g.passport.trim())],
      order: 'id.asc'
    })
    if (r) return r.id
  }
  if (g.email) {
    // ilike sin comodines = igualdad sin distinguir mayúsculas (escapando % _ \ para
    // que 'jane_doe@x.com' no matchee 'janexdoe@x.com')
    const r = await sb.selectOne<{ id: number }>('persons', {
      select: 'id',
      filters: [sb.ilike('email', sb.escapeLike(g.email.trim()))],
      order: 'id.asc'
    })
    if (r) return r.id
  }
  if (g.fullName) {
    const r = await sb.selectOne<{ id: number }>('persons', {
      select: 'id',
      filters: [sb.eq('name_normalized', normalize(g.fullName))],
      order: 'id.asc'
    })
    if (r) return r.id
  }
  return null
}

/** Crea (o reutiliza) el cliente a partir de los campos adivinados/corregidos. */
async function ensureClient(g: FormGuess): Promise<number> {
  const existing = await matchPerson(g)
  if (existing != null) {
    await sb.update('persons', { is_client: 1 }, [sb.eq('id', existing)])
    return existing
  }
  if (!g.fullName?.trim()) throw new Error('La respuesta no tiene nombre: corrígelo antes de convertir.')
  const name = cleanName(g.fullName)
  const [row] = await sb.insert<{ id: number }>('persons', [
    {
      full_name: name,
      name_normalized: normalize(name),
      is_client: 1,
      passport: g.passport?.trim() || null,
      email: g.email?.trim() || null,
      country: normalizeCountry(g.country),
      country_raw: g.country ?? null,
      birth_date: g.birthDate,
      still_here: 1,
      comment: 'Registrado desde Google Forms'
    }
  ])
  return row.id
}

// ---------------------------------------------------------------------------
// files / fotos
// ---------------------------------------------------------------------------

async function filesList(): Promise<StoredFile[]> {
  const objs = await sb.storage.list(FILES_BUCKET)
  return objs
    .filter((o) => o.id && !o.name.startsWith('.'))
    .map((o) => ({
      name: o.name,
      size: o.metadata?.size ?? 0,
      mtime: o.updated_at ?? o.created_at ?? new Date().toISOString(),
      ext: o.name.includes('.') ? o.name.split('.').pop()!.toLowerCase() : ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Selector de archivos del navegador (equivalente web del diálogo de Electron). */
function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    const done = (files: File[]) => {
      if (settled) return
      settled = true
      if (focusTimer != null) clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    // Fallback para navegadores sin evento 'cancel' en <input type=file>: al volver
    // el foco a la ventana se espera un momento por si llega 'change'; si no llega,
    // se resuelve con lo que haya (cancelar => []) para no dejar la promesa colgada.
    const onFocus = () => {
      if (focusTimer != null) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => done(Array.from(input.files ?? [])), 1000)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => done([]))
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

// Caché de fotos como data URL, acotada (FIFO) para no crecer sin límite.
const photoCache = new Map<number, string | null>()
const PHOTO_CACHE_MAX = 200

function cachePhoto(id: number, url: string | null): void {
  photoCache.delete(id)
  photoCache.set(id, url)
  if (photoCache.size > PHOTO_CACHE_MAX) {
    const oldest = photoCache.keys().next().value
    if (oldest !== undefined) photoCache.delete(oldest)
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const supabaseApi: AppApi = {
  auth: {
    status: async () => ({ hasPin: true, needsImport: false, schemaVersion: 4, userDataPath: 'Supabase (nube)' }),
    hasPin: async () => true,
    setPin: async () => {
      throw new Error('En la versión web la contraseña se gestiona en Supabase. Usa "Cambiar PIN" con la contraseña actual.')
    },
    // El "PIN" de la web es la contraseña del usuario de Supabase (email fijo del build).
    verify: async (pin) => {
      if (!sb.SUPABASE_EMAIL) return { ok: false }
      const ok = await sb.signIn(sb.SUPABASE_EMAIL, pin)
      return { ok }
    },
    change: async (current, next) => {
      if (!sb.SUPABASE_EMAIL) return { ok: false }
      const ok = await sb.signIn(sb.SUPABASE_EMAIL, current)
      if (!ok) return { ok: false }
      await sb.updateUser({ password: next })
      return { ok: true }
    }
  },

  import: {
    pickFile: async () => {
      throw new Error('La carga inicial de datos se hace con el seed de Supabase o desde la app de escritorio.')
    },
    run: async () => {
      throw new Error('La carga inicial de datos se hace con el seed de Supabase o desde la app de escritorio.')
    }
  },

  persons: {
    list: async (filter) => {
      const rows = await sb.select<any>('persons', {
        filters: personFilters(filter),
        order: 'id.desc', // último registro primero (paridad con el escritorio)
        limit: filter?.limit,
        offset: filter?.limit ? filter?.offset || 0 : undefined
      })
      return rows.map(mapPerson)
    },
    count: async (filter) => sb.count('persons', personFilters(filter, true)),
    get: getPerson,
    create: async (input) => {
      const [r] = await sb.insert<any>('persons', [personRow(input)])
      return mapPerson(r)
    },
    update: async (id, input) => {
      const [r] = await sb.update<any>('persons', { ...personRow(input), updated_at: new Date().toISOString() }, [sb.eq('id', id)])
      return mapPerson(r)
    },
    remove: async (id) => {
      // Nunca borrar a alguien con historial: las FK de Postgres lo impedirían con un
      // error críptico; mejor un mensaje claro (paridad con el escritorio).
      const counts = await Promise.all([
        sb.count('transactions', [sb.eq('client_id', id)]),
        sb.count('transactions', [sb.eq('professor_id', id)]),
        sb.count('bar_sales', [sb.eq('client_id', id)]),
        sb.count('expenses', [sb.eq('supplier_id', id)]),
        sb.count('expenses', [sb.eq('area_person_id', id)]),
        sb.count('client_bills', [sb.eq('client_id', id)]),
        sb.count('professor_settlements', [sb.eq('professor_id', id)]),
        sb.count('payment_plans', [sb.eq('person_id', id)]),
        sb.count('form_responses', [sb.eq('imported_person_id', id)])
      ])
      const total = counts.reduce((a, b) => a + b, 0)
      if (total > 0) {
        throw new Error(
          `No se puede eliminar: tiene ${total} registro(s) asociados (clases, bar, gastos, facturas…). ` +
            'Desmarca "Activo" para ocultarla sin perder el historial.'
        )
      }
      await sb.remove('persons', [sb.eq('id', id)])
    },
    setPhoto: async (id, dataBase64) => {
      const b64 = String(dataBase64).replace(/^data:image\/\w+;base64,/, '')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const path = `persons/${id}.jpg`
      await sb.storage.upload(PHOTOS_BUCKET, path, new Blob([bytes], { type: 'image/jpeg' }), 'image/jpeg')
      await sb.update('persons', { photo_path: path, photo_thumb_path: path }, [sb.eq('id', id)])
      photoCache.delete(id)
      return { photoPath: path, photoThumbPath: path }
    },
    photoDataUrl: async (id) => {
      if (photoCache.has(id)) return photoCache.get(id)!
      const blob = await sb.storage.download(PHOTOS_BUCKET, `persons/${id}.jpg`)
      const url = blob ? await blobToDataUrl(blob) : null
      cachePhoto(id, url)
      return url
    }
  },

  catalog: {
    listServices: async (onlyActive) => {
      const rows = await sb.select<any>('service_catalog', {
        filters: onlyActive ? [sb.eq('active', 1)] : [],
        order: 'name.asc'
      })
      return rows.map(mapService)
    },
    createService: async (s) => {
      const [r] = await sb.insert<any>('service_catalog', [serviceRow(s)])
      return mapService(r)
    },
    updateService: async (id, s) => {
      const [r] = await sb.update<any>('service_catalog', serviceRow(s), [sb.eq('id', id)])
      return mapService(r)
    },
    listEquipment: async (onlyActive) => {
      const rows = await sb.select<any>('equipment', {
        filters: onlyActive ? [sb.eq('active', 1)] : [],
        order: 'name.asc'
      })
      return rows.map(mapEquipment)
    },
    createEquipment: async (e) => {
      const [r] = await sb.insert<any>('equipment', [equipmentRow(e)])
      return mapEquipment(r)
    },
    updateEquipment: async (id, e) => {
      const [r] = await sb.update<any>('equipment', equipmentRow(e), [sb.eq('id', id)])
      return mapEquipment(r)
    }
  },

  transactions: {
    list: async (filter) => {
      const base: string[] = []
      if (filter?.clientId) base.push(sb.eq('client_id', filter.clientId))
      if (filter?.professorId) base.push(sb.eq('professor_id', filter.professorId))
      if (filter?.from) base.push(sb.gte('tx_date', filter.from))
      if (filter?.to) base.push(sb.lte('tx_date', filter.to))
      const order = 'tx_date.desc,id.desc'
      // Abiertas primero (para el check-out), como el escritorio; el límite pagina las cerradas.
      const [open, closed] = await Promise.all([
        sb.selectAll<any>('transactions', { filters: [...base, sb.isNull('end_min')], order }),
        filter?.limit
          ? sb.select<any>('transactions', {
              filters: [...base, sb.notNull('end_min')],
              order,
              limit: filter.limit,
              offset: filter.offset || 0
            })
          : sb.selectAll<any>('transactions', { filters: [...base, sb.notNull('end_min')], order })
      ])
      return [...open, ...closed].map(mapTx)
    },
    preview: async (input: any) => previewTx(input),
    create: async (input: any) => txCreate(input),
    update: async (id, input: any) => txUpdate(id, input),
    checkout: async (id, endMin) => txCheckout(id, endMin),
    remove: async (id) => {
      await sb.remove('transactions', [sb.eq('id', id)])
    }
  },

  bar: {
    listProducts: async () => {
      const [rows, purchased, sold] = await Promise.all([
        sb.select<any>('bar_products', { order: 'name.asc' }),
        purchasedByName(),
        soldByProduct()
      ])
      return rows.map((r) => mapProduct(r, (purchased.get(r.name) || 0) - (sold.get(r.id) || 0)))
    },
    createProduct: async (input) => {
      const [r] = await sb.insert<any>('bar_products', [productRow(input)])
      return mapProduct(r, 0)
    },
    updateProduct: async (id, input) => {
      const before = await sb.selectOne<any>('bar_products', { select: 'name', filters: [sb.eq('id', id)] })
      await sb.update('bar_products', productRow(input), [sb.eq('id', id)])
      // El stock se deriva de expenses.supply_name: si el nombre cambió, migrar el historial.
      if (before && before.name !== input.name) {
        await sb.update('expenses', { supply_name: input.name }, [sb.eq('supply_name', before.name)])
      }
      return (await getProductWithStock(id))!
    },
    restock: async (input) => {
      const product = await getProductWithStock(input.productId)
      if (!product) throw new Error('Producto no encontrado')
      if (!(input.units > 0)) throw new Error('Las unidades deben ser mayores que cero')
      await sb.insert('expenses', [
        {
          expense_date: input.date,
          supply_name: product.name,
          count: input.units,
          amount_out: Math.round(input.amount || 0),
          comment: input.comment ?? `Compra de inventario: ${product.name}`
        }
      ])
      return (await getProductWithStock(input.productId))!
    },
    createSale: async (input: any) => {
      const product = await getProductWithStock(input.productId)
      if (!product) throw new Error('Producto no encontrado')
      const available = product.stock ?? 0
      const check = canSell(available, input.qty)
      if (!check.ok) {
        throw new Error(
          check.reason === 'stock_insuficiente'
            ? `Stock insuficiente de ${product.name} (disponible: ${available})`
            : 'Cantidad inválida'
        )
      }
      const [r] = await sb.insert<any>('bar_sales', [
        {
          sale_date: input.saleDate,
          client_id: input.clientId ?? null,
          product_id: input.productId,
          product_raw: product.name,
          qty: input.qty,
          total: saleTotal(input.qty, product.sellPrice),
          paid_cash: input.paidCash ? 1 : 0,
          already_paid: input.alreadyPaid ? 1 : 0
        }
      ])
      return mapSale(r)
    },
    listSales: async (from, to) => {
      const filters: string[] = []
      if (from) filters.push(sb.gte('sale_date', from))
      if (to) filters.push(sb.lte('sale_date', to))
      const rows = await sb.selectAll<any>('bar_sales', { filters, order: 'sale_date.desc,id.desc' })
      return rows.map(mapSale)
    }
  },

  expenses: {
    list: async (from, to) => {
      const filters: string[] = []
      if (from) filters.push(sb.gte('expense_date', from))
      if (to) filters.push(sb.lte('expense_date', to))
      const rows = await sb.selectAll<any>('expenses', { filters, order: 'expense_date.desc,id.desc' })
      return rows.map(mapExpense)
    },
    create: async (input: any) => {
      const [r] = await sb.insert<any>('expenses', [{ ...expenseRow(input), supplier_raw: null }])
      return mapExpense(r)
    },
    update: async (id, input: any) => {
      const [r] = await sb.update<any>('expenses', expenseRow(input), [sb.eq('id', id)])
      return mapExpense(r)
    },
    remove: async (id) => {
      await sb.remove('expenses', [sb.eq('id', id)])
    }
  },

  bills: {
    preview: async (clientId, opts) => previewClientBill(clientId, opts ?? {}),
    save: async (clientId, opts) => {
      const preview = await previewClientBill(clientId, opts ?? {})
      const o = preview.options
      const r = preview.result
      const [bill] = await sb.insert<any>('client_bills', [
        {
          client_id: clientId,
          bill_date: o.billDate,
          lodging_days: o.lodgingDays,
          lodging_rate: o.lodgingRate,
          discount_pct: o.discountPct,
          deductions: o.deduction,
          already_paid: o.alreadyPaid,
          card_surcharge: o.cardSurcharge ? 1 : 0,
          subtotal: r.subtotal,
          total: r.total,
          net_to_pay: r.netToPay,
          status: 'issued'
        }
      ])
      if (preview.items.length) {
        await sb.insert(
          'client_bill_items',
          preview.items.map((it) => ({
            bill_id: bill.id,
            kind: it.kind,
            transaction_id: it.transactionId ?? null,
            bar_sale_id: it.barSaleId ?? null,
            description: it.description,
            qty: it.qty,
            unit_price: it.unitPrice,
            line_total: it.lineTotal
          }))
        )
      }
      return (await getBill(bill.id))!
    },
    markPaid: async (billId) => {
      const bill = await getBill(billId)
      if (!bill) throw new Error('Factura no encontrada')
      if (bill.status === 'paid') return bill // idempotente: no duplica el abono
      // PATCH condicionado: solo la petición que gana el cambio 'issued'→'paid'
      // abona al cliente (dos clics/pestañas no duplican el abono).
      const changed = await sb.update('client_bills', { status: 'paid' }, [sb.eq('id', billId), sb.eq('status', 'issued')])
      if (changed.length) {
        // El pago cubre el neto pendiente: el saldo del cliente queda en 0.
        const p = await sb.selectOne<{ paid: number | null }>('persons', { select: 'paid', filters: [sb.eq('id', bill.clientId)] })
        await sb.update('persons', { paid: (p?.paid ?? 0) + bill.netToPay }, [sb.eq('id', bill.clientId)])
      }
      return (await getBill(billId))!
    },
    pdf: async (billId) => {
      const bill = await getBill(billId)
      if (!bill) throw new Error('Factura no encontrada')
      const client = await getPerson(bill.clientId)
      if (!client) throw new Error('Cliente no encontrado')
      return openPrintWindow(clientBillHtml(bill, client, await getCompanyConfig()))
    },
    email: async () => ({ ok: false, error: 'El envío por correo está disponible en la app de escritorio.' })
  },

  settlements: {
    preview: async (professorId, year, month) => previewSettlement(professorId, year, month),
    save: async (professorId, year, month) => saveSettlement(professorId, year, month),
    markPaid: async (professorId, year, month) => {
      await saveSettlement(professorId, year, month) // asegura que exista (upsert como 'issued')
      const [row] = await sb.update<any>('professor_settlements', { status: 'paid' }, [
        sb.eq('professor_id', professorId),
        sb.eq('period_year', year),
        sb.eq('period_month', month)
      ])
      return mapSettlement(row)
    },
    pdf: async (professorId, year, month) => {
      const preview = await previewSettlement(professorId, year, month)
      return openPrintWindow(settlementHtml(preview, await getCompanyConfig()))
    }
  },

  finance: {
    dailyCashflow: async (from, to) => dailyCashflow(from, to),
    monthSummary: async (year, month) => monthSummary(year, month),
    ageStats: async () => {
      const rows = await sb.selectAll<any>('persons', {
        select: 'birth_date,check_in',
        filters: [sb.notNull('birth_date')]
      })
      const today = todayISO()
      return ageHistogram(rows.map((r) => ageAt(r.birth_date, r.check_in || today)))
    },
    yearBalance: async () => {
      const [txs, sales, exps] = await Promise.all([
        sb.selectAll<any>('transactions', {
          select: 'tx_date,price_effective',
          filters: [sb.notNull('price_effective'), sb.notNull('end_min')]
        }),
        sb.selectAll<any>('bar_sales', { select: 'sale_date,total' }),
        sb.selectAll<any>('expenses', { select: 'expense_date,amount_out' })
      ])
      const map = new Map<number, { in: number; out: number }>()
      const touch = (y: number) => {
        if (!map.has(y)) map.set(y, { in: 0, out: 0 })
        return map.get(y)!
      }
      for (const r of txs) if (r.tx_date) touch(parseInt(r.tx_date.slice(0, 4), 10)).in += r.price_effective ?? 0
      for (const r of sales) if (r.sale_date) touch(parseInt(r.sale_date.slice(0, 4), 10)).in += r.total ?? 0
      for (const r of exps) if (r.expense_date) touch(parseInt(r.expense_date.slice(0, 4), 10)).out += r.amount_out ?? 0
      return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, in: v.in, out: v.out }))
    },
    dashboard: async () => {
      const [clients, professors, txCount, salesCount, txs, exps] = await Promise.all([
        sb.count('persons', [sb.eq('is_client', 1)]),
        sb.count('persons', [sb.eq('is_professor', 1)]),
        sb.count('transactions'),
        sb.count('bar_sales'),
        sb.selectAll<any>('transactions', { select: 'price_effective', filters: [sb.notNull('end_min')] }),
        sb.selectAll<any>('expenses', { select: 'amount_out' })
      ])
      return {
        clients,
        professors,
        transactions: txCount,
        incomeAll: txs.reduce((a: number, b: any) => a + (b.price_effective ?? 0), 0),
        expensesAll: exps.reduce((a: number, b: any) => a + (b.amount_out ?? 0), 0),
        barSales: salesCount
      }
    }
  },

  plans: {
    list: async () => {
      const [plans, installments] = await Promise.all([
        sb.selectAll<any>('payment_plans', { order: 'created_at.desc' }),
        sb.selectAll<any>('payment_plan_installments', { order: 'paid_date.asc' })
      ])
      const byPlan = new Map<number, any[]>()
      for (const i of installments) {
        if (!byPlan.has(i.plan_id)) byPlan.set(i.plan_id, [])
        byPlan.get(i.plan_id)!.push(i)
      }
      return plans.map((p) => {
        const inst = byPlan.get(p.id) ?? []
        const { installments: _omit, ...rest } = mapPlan(p, inst)
        return {
          ...rest,
          outstanding: outstanding(p.principal, inst.map((i) => ({ paidDate: i.paid_date, amount: i.amount })))
        }
      })
    },
    get: getPlan,
    create: async (title, personId, principal, startDate) => {
      const [p] = await sb.insert<any>('payment_plans', [
        { title, person_id: personId, principal: Math.round(principal), start_date: startDate, status: 'active' }
      ])
      return (await getPlan(p.id))!
    },
    addInstallment: async (planId, paidDate, amount, comment) => {
      await sb.insert('payment_plan_installments', [
        { plan_id: planId, paid_date: paidDate, amount: Math.round(amount), comment }
      ])
      const plan = (await getPlan(planId))!
      if (plan.outstanding <= 0) await sb.update('payment_plans', { status: 'settled' }, [sb.eq('id', planId)])
      return (await getPlan(planId))!
    }
  },

  settings: {
    getCompany: async () => getCompanyConfig(),
    setCompany: async (cfg) => {
      await setSetting('company_name', String(cfg.companyName ?? ''))
      await setSetting('company_nit', String(cfg.companyNit ?? ''))
      await setSetting('card_surcharge_pct', Number(cfg.cardSurchargePct ?? 0.05))
    },
    getSmtp: async () => {
      const m = await getSettings(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from'])
      return {
        host: asStr(m.get('smtp_host')),
        port: asNum(m.get('smtp_port'), 587),
        user: asStr(m.get('smtp_user')),
        from: asStr(m.get('smtp_from')),
        hasPassword: false // la contraseña SMTP solo se guarda (cifrada) en el escritorio
      }
    },
    setSmtp: async (cfg) => {
      await setSetting('smtp_host', String(cfg.host ?? ''))
      await setSetting('smtp_port', Number(cfg.port ?? 587))
      await setSetting('smtp_user', String(cfg.user ?? ''))
      await setSetting('smtp_from', String(cfg.from ?? cfg.user ?? ''))
      // La contraseña NO se guarda desde la web (aquí no hay cifrado local).
    },
    testSmtp: async () => ({ ok: false, error: 'El envío por correo está disponible en la app de escritorio.' }),
    setBarDiscount: async (pct) => setSetting('bar_discount_pct', Number(pct)),
    getBarDiscount: async () => asNum(await getSetting('bar_discount_pct', 0), 0)
  },

  forms: {
    list: async () => {
      const forms = await getSetting<FormConfig[]>(FORMS_KEY, [])
      return Array.isArray(forms) ? forms : []
    },
    saveConfig: async (forms) => {
      await setSetting(
        FORMS_KEY,
        forms
          .filter((f) => f.name?.trim() || f.csvUrl?.trim() || f.formUrl?.trim())
          .map((f) => ({
            key: f.key || slug(f.name || 'form'),
            name: (f.name || 'Formulario').trim(),
            csvUrl: (f.csvUrl || '').trim(),
            formUrl: (f.formUrl || '').trim()
          }))
      )
    },
    sync: async (formKey): Promise<FormSyncResult> => {
      const forms = await getSetting<FormConfig[]>(FORMS_KEY, [])
      const form = (Array.isArray(forms) ? forms : []).find((f) => f.key === formKey)
      if (!form) return { formKey, fetched: 0, added: 0, error: 'Formulario no configurado' }
      if (!form.csvUrl) return { formKey, fetched: 0, added: 0, error: 'Falta la URL del CSV publicado (Ajustes)' }

      // El navegador no puede bajar el CSV de Google por CORS: se usa el proxy del hosting.
      let text: string
      try {
        const res = await fetch('/api/fetch-csv?url=' + encodeURIComponent(form.csvUrl))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
      } catch (e: any) {
        return { formKey, fetched: 0, added: 0, error: 'No se pudo descargar la hoja: ' + (e?.message ?? e) }
      }
      if (/<html/i.test(text.slice(0, 300)))
        return {
          formKey,
          fetched: 0,
          added: 0,
          error: 'El enlace no es un CSV publicado. En Google Sheets: Archivo → Compartir → Publicar en la web → CSV.'
        }

      const rows = csvToObjects(text)
      if (!rows.length) return { formKey, fetched: 0, added: 0 }
      // Dedupe por row_hash: el upsert con ignore-duplicates devuelve solo lo insertado.
      const inserted = await sb.upsert<any>(
        'form_responses',
        rows.map((row) => ({
          form_key: formKey,
          row_hash: rowHash(formKey, row),
          submitted_at: findTimestamp(row),
          raw_json: row,
          status: 'new'
        })),
        'row_hash',
        true
      )
      return { formKey, fetched: rows.length, added: inserted.length }
    },
    responses: async (formKey, status) => {
      const filters = [sb.eq('form_key', formKey)]
      if (status) filters.push(sb.eq('status', status))
      const rows = await sb.selectAll<any>('form_responses', { filters, order: 'id.desc' })
      return rows.map((r) => {
        const resp = mapResponse(r)
        return { ...resp, guess: guess(resp.values) }
      })
    },
    convert: async (responseId, kind, edited) => {
      const r = await sb.selectOne<any>('form_responses', { filters: [sb.eq('id', responseId)] })
      if (!r) throw new Error('Respuesta no encontrada')
      // Solo se convierte lo que sigue 'new': ni reimportar, ni resucitar una ignorada.
      if (r.status !== 'new') return mapResponse(r)
      const g: FormGuess = { ...guess(responseValues(r)), ...(edited ?? {}) }

      // Una reserva sin fecha válida NO se crea en un día equivocado en silencio.
      if (kind === 'reservation' && !g.date)
        throw new Error('La fecha de la reserva no es válida: corrígela antes de crear la reserva.')

      // Se "reclama" la respuesta ANTES de crear nada (PATCH condicionado a status='new'):
      // un doble clic o dos pestañas no crean la persona/reserva dos veces.
      const [claimed] = await sb.update<any>('form_responses', { status: 'imported' }, [
        sb.eq('id', responseId),
        sb.eq('status', 'new')
      ])
      if (!claimed) {
        const cur = await sb.selectOne<any>('form_responses', { filters: [sb.eq('id', responseId)] })
        return mapResponse(cur ?? r)
      }
      try {
        const personId = await ensureClient(g)
        let txId: number | null = null
        if (kind === 'reservation') {
          // Reserva = sesión ABIERTA (entrada programada, sin salida): se cobra al check-out.
          const svc = g.service
            ? await sb.selectOne<{ id: number; is_class: boolean }>('service_catalog', {
                select: 'id,is_class',
                filters: [sb.eq('name_normalized', normalize(g.service))]
              })
            : null
          const isClass = svc ? !!svc.is_class : true // sin match de catálogo => clase de curso (nivel auto)
          const tx = await txCreate({
            txDate: g.date!,
            startMin: g.startMin,
            endMin: null,
            serviceId: svc && !svc.is_class ? svc.id : null,
            isClass,
            txType: 'class',
            clientId: personId,
            professorId: null,
            kiteId: null,
            boardId: null,
            priceOverride: null,
            comment: ['Reserva de Google Forms', g.service && !svc ? `(${g.service})` : null, g.comment]
              .filter(Boolean)
              .join(' · ')
          })
          txId = tx.id
        }
        const [updated] = await sb.update<any>(
          'form_responses',
          { imported_person_id: personId, imported_tx_id: txId },
          [sb.eq('id', responseId)]
        )
        return mapResponse(updated)
      } catch (e) {
        // Revertir la marca para que el reintento vuelva a encontrar la respuesta 'new'.
        await sb
          .update('form_responses', { status: 'new' }, [sb.eq('id', responseId)])
          .catch(() => undefined)
        throw e
      }
    },
    ignore: async (responseId) => {
      await sb.update('form_responses', { status: 'ignored' }, [sb.eq('id', responseId), sb.eq('status', 'new')])
      const r = await sb.selectOne<any>('form_responses', { filters: [sb.eq('id', responseId)] })
      if (!r) throw new Error('Respuesta no encontrada')
      return mapResponse(r)
    }
  },

  files: {
    list: filesList,
    add: async () => {
      const files = await pickFiles('.xlsx,.xls,.csv,.pdf')
      if (files.length) {
        // Evitar pisar: "x.xlsx" → "x (2).xlsx" si ya existe (como la biblioteca local).
        const existing = new Set((await filesList()).map((f) => f.name))
        for (const f of files) {
          const dot = f.name.lastIndexOf('.')
          const stem = dot > 0 ? f.name.slice(0, dot) : f.name
          const ext = dot > 0 ? f.name.slice(dot) : ''
          let name = f.name
          for (let i = 2; existing.has(name); i++) name = `${stem} (${i})${ext}`
          existing.add(name)
          await sb.storage.upload(FILES_BUCKET, name, f, f.type || 'application/octet-stream')
        }
      }
      return filesList()
    },
    remove: async (name) => {
      await sb.storage.remove(FILES_BUCKET, [name])
      return filesList()
    },
    open: async (name) => {
      // En la web "abrir" = descargar el archivo (el navegador no abre Excel).
      const url = await sb.storage.signedUrl(FILES_BUCKET, name)
      const a = document.createElement('a')
      a.href = url + '&download=' + encodeURIComponent(name)
      a.rel = 'noopener'
      a.click()
    },
    read: async (name) => {
      if (!name.toLowerCase().endsWith('.xlsx'))
        throw new Error('El visor solo soporta archivos .xlsx (usa "Abrir" para descargarlo).')
      const blob = await sb.storage.download(FILES_BUCKET, name)
      if (!blob) throw new Error('Archivo no encontrado')
      const { readWorkbookBlob } = await import('./excelWeb')
      return readWorkbookBlob(name, blob)
    }
  },

  backup: {
    create: async () => {
      throw new Error('En la web no hay copias locales: los respaldos los gestiona Supabase (copia automática del proyecto).')
    },
    list: async () => []
  },

  exports: {
    balance: async (from, to) => {
      const { rows, totals } = await dailyCashflow(from, to)
      const { exportBalanceXlsx } = await import('./excelWeb')
      return exportBalanceXlsx(rows, totals, from, to)
    },
    monthSummary: async (year, month) => {
      const s = await monthSummary(year, month)
      const { exportMonthSummaryXlsx } = await import('./excelWeb')
      return exportMonthSummaryXlsx(s)
    },
    openFolder: async () => undefined // en la web los .xlsx se descargan al navegador
  }
}

// ---- filas snake_case para insert/update (fuera del objeto para reutilizar) ----

function serviceRow(s: Omit<ServiceCatalogItem, 'id'>): Record<string, unknown> {
  return {
    name: s.name,
    name_normalized: normalize(s.name),
    discipline: s.discipline,
    season_year: s.seasonYear,
    hours: s.hours,
    days: s.days,
    price: s.price,
    professor_pct: s.professorPct,
    is_class: s.isClass ? 1 : 0,
    active: s.active !== false ? 1 : 0
  }
}

function equipmentRow(e: Omit<Equipment, 'id'>): Record<string, unknown> {
  return {
    name: e.name,
    name_normalized: normalize(e.name),
    category: e.category,
    count: e.count ?? 1,
    price: e.price ?? null,
    active: e.active !== false ? 1 : 0
  }
}

function productRow(input: { name: string; boxPrice?: number | null; unitsPerBox?: number | null; sellPrice?: number | null; active?: boolean }): Record<string, unknown> {
  return {
    name: input.name,
    name_normalized: normalize(input.name),
    box_price: input.boxPrice ?? null,
    units_per_box: input.unitsPerBox ?? null,
    sell_price: input.sellPrice ?? null,
    active: input.active !== false ? 1 : 0
  }
}

function expenseRow(input: any): Record<string, unknown> {
  return {
    expense_date: input.expenseDate,
    supply_name: input.supplyName ?? null,
    count: input.count ?? 1,
    area_name: input.areaName ?? null,
    area_person_id: input.areaPersonId ?? null,
    supplier_id: input.supplierId ?? null,
    amount_out: Math.round(input.amountOut || 0),
    comment: input.comment ?? null
  }
}
