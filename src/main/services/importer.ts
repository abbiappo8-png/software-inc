/**
 * Importador del Excel histórico (software inc.xlsx) a la base SQLite.
 *
 * - Lee con exceljs (distingue número/texto/fórmula y celdas error como #N/A/#REF!).
 * - Convierte seriales de fecha, fracciones de hora y notación científica.
 * - Deduplica personas por pasaporte -> email -> nombre normalizado.
 * - Todo en UNA transacción; idempotente por hash del archivo; filas problemáticas
 *   van a import_errors sin romper el import.
 *
 * Diseñado para correr con Node plano (no importa Electron) => testable/CLI.
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Database as DB } from 'better-sqlite3'
import type { ImportError, ImportReport } from '@shared/types/domain'
import { parseFlexibleDate, excelSerialToISO, dayFractionToMinutes } from '@shared/services/dates'
import { normalize, cleanName, normalizeCountry } from '@shared/services/text'
import { derivePayModel } from '@shared/services/pricing'

// ---------- helpers de lectura de celdas ----------

/** Valor efectivo de una celda exceljs: resultado de fórmula, o el valor plano. */
function cellVal(cell: ExcelJS.Cell | undefined): unknown {
  if (!cell) return null
  const v = cell.value as any
  if (v == null) return null
  if (typeof v === 'object') {
    if ('error' in v) return null // #N/A, #REF!, #VALUE! -> null
    if ('result' in v) return (v as any).result // fórmula: valor cacheado
    if ('formula' in v) return null
    if (v instanceof Date) return v
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('')
    if ('text' in v) return (v as any).text // hyperlink
  }
  return v
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  const n = Number(String(value).replace(/[^\d.\-eE]/g, '')) // tolera "1.0E7", "$", comas
  return isFinite(n) ? n : null
}

function asMoney(value: unknown): number | null {
  const n = asNumber(value)
  return n == null ? null : Math.round(n)
}

function asText(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function asISODate(value: unknown): { iso: string | null; raw: string | null } {
  const r = parseFlexibleDate(value)
  return { iso: r.iso, raw: r.raw }
}

function asMinutes(value: unknown): number | null {
  const n = asNumber(value)
  if (n == null) return null
  if (n >= 0 && n <= 1) return dayFractionToMinutes(n)
  return null
}

function truthy(value: unknown): boolean {
  const s = normalize(String(value ?? ''))
  return ['1', 'si', 'sí', 'yes', 'x', 'true', 'still here', 'pagado'].includes(s)
}

// ---------- importador ----------

export interface ImportOptions {
  /** Si el archivo ya se importó (mismo hash) con éxito, no reejecuta salvo force. */
  force?: boolean
}

export async function importWorkbook(
  db: DB,
  filePath: string,
  opts: ImportOptions = {}
): Promise<ImportReport> {
  const started = Date.now()
  const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex')

  const prev = db
    .prepare("SELECT id, status FROM import_batches WHERE source_sha256=? AND status='completed'")
    .get(sha256) as { id: number } | undefined
  if (prev && !opts.force) {
    return {
      batchId: prev.id,
      sourceFile: filePath,
      counts: {},
      rowsOk: 0,
      rowsError: 0,
      errors: [{ sheet: '-', sourceRow: null, reason: 'ya_importado' }],
      durationMs: Date.now() - started
    }
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)

  const errors: ImportError[] = []
  const counts: Record<string, number> = {}
  const addErr = (sheet: string, row: number | null, reason: string, raw?: unknown) =>
    errors.push({ sheet, sourceRow: row, reason, raw })

  const batchId = db
    .prepare('INSERT INTO import_batches(source_file, source_sha256) VALUES(?,?)')
    .run(filePath.split(/[\\/]/).pop() || filePath, sha256).lastInsertRowid as number

  // Índices en memoria para matching
  const personByName = new Map<string, number>()
  const personByNick = new Map<string, number>()
  const personByPassport = new Map<string, number>()
  const personByEmail = new Map<string, number>()
  const catalogByName = new Map<string, { id: number; pct: number; hours: number; days: number; price: number }>()
  const equipmentByName = new Map<string, number>()
  const barProductByName = new Map<string, number>()

  const tx = db.transaction(() => {
    importCatalog(wb, db, batchId, catalogByName, counts, addErr)
    importEquipment(wb, db, batchId, equipmentByName, counts, addErr)
    importBarProducts(wb, db, batchId, barProductByName, counts, addErr)
    importPersons(wb, db, batchId, { personByName, personByNick, personByPassport, personByEmail }, counts, addErr)
    importTransactions(wb, db, batchId, { personByName, personByNick, catalogByName, equipmentByName }, counts, addErr)
    importExpenses(wb, db, batchId, { personByName, personByNick }, counts, addErr)
    importBarSales(wb, db, batchId, { personByName, barProductByName }, counts, addErr)
    importPaymentPlan(wb, db, batchId, { personByNick, personByName }, counts, addErr)

    // Persistir errores
    const insErr = db.prepare(
      'INSERT INTO import_errors(batch_id, sheet, source_row, raw_json, reason) VALUES(?,?,?,?,?)'
    )
    for (const e of errors) insErr.run(batchId, e.sheet, e.sourceRow, JSON.stringify(e.raw ?? null), e.reason)

    const rowsOk = Object.values(counts).reduce((a, b) => a + b, 0)
    db.prepare(
      "UPDATE import_batches SET status='completed', rows_ok=?, rows_error=?, finished_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"
    ).run(rowsOk, errors.length, batchId)
  })

  try {
    tx()
  } catch (err) {
    db.prepare("UPDATE import_batches SET status='failed' WHERE id=?").run(batchId)
    throw err
  }

  const rowsOk = Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    batchId,
    sourceFile: filePath,
    counts,
    rowsOk,
    rowsError: errors.length,
    errors,
    durationMs: Date.now() - started
  }
}

// ---------- sub-importadores por hoja ----------

function importCatalog(
  wb: ExcelJS.Workbook,
  db: DB,
  batchId: number,
  index: Map<string, { id: number; pct: number; hours: number; days: number; price: number }>,
  counts: Record<string, number>,
  addErr: (s: string, r: number | null, reason: string, raw?: unknown) => void
) {
  const ws = wb.getWorksheet('Club')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO service_catalog(name,name_normalized,discipline,season_year,hours,days,price,professor_pct,pay_model_json,is_class,active,import_batch_id)
     VALUES(@name,@norm,@disc,@year,@hours,@days,@price,@pct,@pay,@isClass,1,@batch)`
  )
  let n = 0
  // Catálogo en O..S; cursos = O4:O8 (isClass); servicios = O9+
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return
    const name = asText(cellVal(row.getCell('O')))
    if (!name) return
    const hours = asNumber(cellVal(row.getCell('P'))) ?? 0
    const days = asNumber(cellVal(row.getCell('Q'))) ?? 0
    const price = asMoney(cellVal(row.getCell('R'))) ?? 0
    const pct = asNumber(cellVal(row.getCell('S'))) ?? 0
    const norm = normalize(name)
    if (index.has(norm)) return // evitar duplicados de catálogo
    const isClass = rowNumber >= 4 && rowNumber <= 8 ? 1 : 0
    const year = /\b(20\d{2})\b/.exec(name)?.[1]
    const disc = detectDiscipline(name)
    const pay = JSON.stringify(derivePayModel(pct, price, hours))
    const id = ins.run({
      name, norm, disc, year: year ? parseInt(year, 10) : null,
      hours, days, price, pct, pay, isClass, batch: batchId
    }).lastInsertRowid as number
    index.set(norm, { id, pct, hours, days, price })
    n++
  })
  counts.service_catalog = n
}

function importEquipment(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  index: Map<string, number>, counts: Record<string, number>,
  _addErr: any
) {
  const ws = wb.getWorksheet('Club')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO equipment(name,name_normalized,category,count,price,active,import_batch_id)
     VALUES(@name,@norm,@cat,@count,@price,1,@batch)`
  )
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return
    const name = asText(cellVal(row.getCell('U')))
    if (!name) return
    const norm = normalize(name)
    if (index.has(norm)) return
    const count = asNumber(cellVal(row.getCell('V'))) ?? 1
    const price = asMoney(cellVal(row.getCell('W')))
    const id = ins.run({ name, norm, cat: detectEquipCategory(name), count, price, batch: batchId })
      .lastInsertRowid as number
    index.set(norm, id)
    n++
  })
  counts.equipment = n
}

function importBarProducts(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  index: Map<string, number>, counts: Record<string, number>, _addErr: any
) {
  const ws = wb.getWorksheet('Bar')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO bar_products(name,name_normalized,box_price,units_per_box,sell_price,active,import_batch_id)
     VALUES(@name,@norm,@box,@units,@sell,1,@batch)`
  )
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return
    const name = asText(cellVal(row.getCell('J')))
    if (!name) return
    const norm = normalize(name)
    if (index.has(norm)) return
    const box = asMoney(cellVal(row.getCell('K')))
    const units = asNumber(cellVal(row.getCell('L')))
    const sell = asMoney(cellVal(row.getCell('N')))
    const id = ins.run({ name, norm, box, units, sell, batch: batchId }).lastInsertRowid as number
    index.set(norm, id)
    n++
  })
  counts.bar_products = n
}

interface PersonIndexes {
  personByName: Map<string, number>
  personByNick: Map<string, number>
  personByPassport: Map<string, number>
  personByEmail: Map<string, number>
}

function importPersons(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  idx: PersonIndexes, counts: Record<string, number>,
  addErr: (s: string, r: number | null, reason: string, raw?: unknown) => void
) {
  const ws = wb.getWorksheet('Persons')
  if (!ws) return
  const insPerson = db.prepare(
    `INSERT INTO persons(full_name,name_normalized,nickname,nickname_normalized,is_client,is_professor,is_supplier,
       passport,email,country,country_raw,birth_date,birth_date_raw,check_in,check_out,garos,taking_course,
       discount_pct,paid,still_here,comment,import_batch_id,source_sheet,source_row)
     VALUES(@full,@norm,@nick,@nickNorm,@isClient,@isProf,@isSup,@passport,@email,@country,@countryRaw,
       @birth,@birthRaw,@checkIn,@checkOut,@garos,@course,@discount,@paid,@still,@comment,@batch,'Persons',@row)`
  )

  const ensurePerson = (fullName: string, row: number | null): number => {
    const norm = normalize(fullName)
    const existing = idx.personByName.get(norm)
    if (existing) return existing
    const id = insPerson.run({
      full: cleanName(fullName), norm, nick: null, nickNorm: null,
      isClient: 0, isProf: 0, isSup: 0, passport: null, email: null, country: null, countryRaw: null,
      birth: null, birthRaw: null, checkIn: null, checkOut: null, garos: null, course: 0,
      discount: 0, paid: 0, still: 1, comment: null, batch: batchId, row
    }).lastInsertRowid as number
    idx.personByName.set(norm, id)
    return id
  }

  let nClients = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return
    const name = asText(cellVal(row.getCell('A')))
    if (!name) return
    const norm = normalize(name)
    const passport = asText(cellVal(row.getCell('B')))
    const email = asText(cellVal(row.getCell('C')))

    // Dedupe: pasaporte -> email -> nombre
    let existingId: number | undefined
    if (passport && idx.personByPassport.has(normalize(passport))) existingId = idx.personByPassport.get(normalize(passport))
    else if (email && idx.personByEmail.has(normalize(email))) existingId = idx.personByEmail.get(normalize(email))
    else if (idx.personByName.has(norm)) existingId = idx.personByName.get(norm)

    const birth = asISODate(cellVal(row.getCell('E')))
    if (birth.iso == null && birth.raw) addErr('Persons', rowNumber, 'fecha_nacimiento_invalida', birth.raw)
    const checkIn = asISODate(cellVal(row.getCell('F')))
    const checkOut = asISODate(cellVal(row.getCell('H')))
    const countryRaw = asText(cellVal(row.getCell('D')))
    const discount = asNumber(cellVal(row.getCell('J'))) ?? 0
    const paidVal = asMoney(cellVal(row.getCell('K'))) ?? 0
    const still = truthy(cellVal(row.getCell('M'))) || normalize(String(cellVal(row.getCell('M')) ?? '')) === 'still here'
    const comment = asText(cellVal(row.getCell('L')))
    const garos = asText(cellVal(row.getCell('G')))

    if (existingId) {
      db.prepare(`UPDATE persons SET is_client=1 WHERE id=?`).run(existingId)
      counts.persons_clients = (counts.persons_clients ?? 0) + 1
      nClients++
      return
    }

    const id = insPerson.run({
      full: cleanName(name), norm, nick: null, nickNorm: null,
      isClient: 1, isProf: 0, isSup: 0,
      passport, email, country: normalizeCountry(countryRaw), countryRaw,
      birth: birth.iso, birthRaw: birth.raw, checkIn: checkIn.iso, checkOut: checkOut.iso, garos,
      course: 0, discount, paid: paidVal, still: still ? 1 : 0, comment, batch: batchId, row: rowNumber
    }).lastInsertRowid as number
    idx.personByName.set(norm, id)
    if (passport) idx.personByPassport.set(normalize(passport), id)
    if (email) idx.personByEmail.set(normalize(email), id)
    nClients++
  })
  counts.persons_clients = nClients

  // Staff (col O) -> is_professor, nickname
  let nStaff = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return
    const nick = asText(cellVal(row.getCell('O')))
    if (!nick) return
    const norm = normalize(nick)
    let id = idx.personByNick.get(norm) ?? idx.personByName.get(norm)
    if (id) {
      db.prepare(`UPDATE persons SET is_professor=1, nickname=COALESCE(nickname,?), nickname_normalized=COALESCE(nickname_normalized,?) WHERE id=?`)
        .run(cleanName(nick), norm, id)
    } else {
      id = insPerson.run({
        full: cleanName(nick), norm, nick: cleanName(nick), nickNorm: norm,
        isClient: 0, isProf: 1, isSup: 0, passport: null, email: null, country: null, countryRaw: null,
        birth: null, birthRaw: null, checkIn: null, checkOut: null, garos: null, course: 0,
        discount: 0, paid: 0, still: 1, comment: null, batch: batchId, row: rowNumber
      }).lastInsertRowid as number
      idx.personByName.set(norm, id)
    }
    idx.personByNick.set(norm, id)
    nStaff++
  })
  counts.persons_staff = nStaff

  // Suppliers (col P) -> is_supplier
  let nSup = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return
    const name = asText(cellVal(row.getCell('P')))
    if (!name) return
    const norm = normalize(name)
    let id = idx.personByName.get(norm)
    if (id) {
      db.prepare(`UPDATE persons SET is_supplier=1 WHERE id=?`).run(id)
    } else {
      id = insPerson.run({
        full: cleanName(name), norm, nick: null, nickNorm: null,
        isClient: 0, isProf: 0, isSup: 1, passport: null, email: null, country: null, countryRaw: null,
        birth: null, birthRaw: null, checkIn: null, checkOut: null, garos: null, course: 0,
        discount: 0, paid: 0, still: 1, comment: null, batch: batchId, row: rowNumber
      }).lastInsertRowid as number
      idx.personByName.set(norm, id)
    }
    nSup++
  })
  counts.persons_suppliers = nSup
}

function importTransactions(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  ctx: {
    personByName: Map<string, number>
    personByNick: Map<string, number>
    catalogByName: Map<string, { id: number; pct: number; hours: number; days: number; price: number }>
    equipmentByName: Map<string, number>
  },
  counts: Record<string, number>,
  addErr: (s: string, r: number | null, reason: string, raw?: unknown) => void
) {
  const ws = wb.getWorksheet('Club')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO transactions(tx_date,start_min,end_min,service_raw,service_id,is_class,tx_type,resolved_service_id,
       professor_id,client_id,kite_id,board_id,price_snapshot,professor_pct_snapshot,price_override,comment,
       import_batch_id,source_sheet,source_row)
     VALUES(@date,@start,@end,@serviceRaw,@serviceId,@isClass,@txType,@resolvedId,@prof,@client,@kite,@board,
       @price,@pct,@override,@comment,@batch,'Club',@row)`
  )
  const findPerson = (raw: string | null, nick = false): number | null => {
    if (!raw) return null
    const norm = normalize(raw)
    return (nick ? ctx.personByNick.get(norm) : ctx.personByName.get(norm)) ??
      ctx.personByName.get(norm) ?? ctx.personByNick.get(norm) ?? null
  }
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return
    const date = asISODate(cellVal(row.getCell('A')))
    if (!date.iso) return // sin fecha no es una transacción real
    const dRaw = asText(cellVal(row.getCell('D')))
    const eRaw = asText(cellVal(row.getCell('E')))
    const isClass = normalize(dRaw ?? '') === 'class' ? 1 : 0
    const serviceItem = dRaw && !isClass ? ctx.catalogByName.get(normalize(dRaw)) : undefined
    const resolvedItem = eRaw ? ctx.catalogByName.get(normalize(eRaw)) : undefined
    const price = asMoney(cellVal(row.getCell('J')))
    const override = asMoney(cellVal(row.getCell('K')))
    const salary = asMoney(cellVal(row.getCell('M')))
    const effective = override ?? price
    let pct = resolvedItem?.pct ?? null
    if (pct == null && salary != null && effective && effective > 0) pct = salary / effective

    ins.run({
      date: date.iso,
      start: asMinutes(cellVal(row.getCell('B'))),
      end: asMinutes(cellVal(row.getCell('C'))),
      serviceRaw: dRaw,
      serviceId: serviceItem?.id ?? null,
      isClass,
      txType: isClass ? 'class' : 'service',
      resolvedId: resolvedItem?.id ?? null,
      prof: findPerson(asText(cellVal(row.getCell('F'))), true),
      client: findPerson(asText(cellVal(row.getCell('G')))),
      kite: raw2equip(ctx.equipmentByName, asText(cellVal(row.getCell('H')))),
      board: raw2equip(ctx.equipmentByName, asText(cellVal(row.getCell('I')))),
      price,
      pct,
      override,
      comment: null,
      batch: batchId,
      row: rowNumber
    })
    n++
  })
  counts.transactions = n
}

function importExpenses(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  ctx: { personByName: Map<string, number>; personByNick: Map<string, number> },
  counts: Record<string, number>,
  addErr: (s: string, r: number | null, reason: string, raw?: unknown) => void
) {
  const ws = wb.getWorksheet('Outcome')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO expenses(expense_date,supply_name,count,area_name,area_person_id,supplier_id,supplier_raw,amount_out,comment,
       import_batch_id,source_sheet,source_row)
     VALUES(@date,@supply,@count,@area,@areaId,@supId,@supRaw,@amount,@comment,@batch,'Outcome',@row)`
  )
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return
    const date = asISODate(cellVal(row.getCell('C')))
    const amount = asMoney(cellVal(row.getCell('H')))
    if (!date.iso || amount == null) {
      if (rowNumber >= 4 && (date.raw || amount != null)) addErr('Outcome', rowNumber, 'gasto_incompleto')
      return
    }
    const areaName = asText(cellVal(row.getCell('F')))
    const supplierRaw = asText(cellVal(row.getCell('G')))
    ins.run({
      date: date.iso,
      supply: asText(cellVal(row.getCell('D'))),
      count: asNumber(cellVal(row.getCell('E'))) ?? 1,
      area: areaName,
      areaId: areaName ? ctx.personByNick.get(normalize(areaName)) ?? ctx.personByName.get(normalize(areaName)) ?? null : null,
      supId: supplierRaw ? ctx.personByName.get(normalize(supplierRaw)) ?? null : null,
      supRaw: supplierRaw,
      amount,
      comment: asText(cellVal(row.getCell('I'))),
      batch: batchId,
      row: rowNumber
    })
    n++
  })
  counts.expenses = n
}

function importBarSales(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  ctx: { personByName: Map<string, number>; barProductByName: Map<string, number> },
  counts: Record<string, number>,
  _addErr: any
) {
  const ws = wb.getWorksheet('Bar')
  if (!ws) return
  const ins = db.prepare(
    `INSERT INTO bar_sales(sale_date,client_id,client_raw,product_id,product_raw,qty,total,paid_cash,already_paid,
       import_batch_id,source_sheet,source_row)
     VALUES(@date,@client,@clientRaw,@product,@productRaw,@qty,@total,@cash,@paid,@batch,'Bar',@row)`
  )
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return
    const date = asISODate(cellVal(row.getCell('A')))
    const productRaw = asText(cellVal(row.getCell('C')))
    if (!date.iso && !productRaw) return
    if (!date.iso) return
    const clientRaw = asText(cellVal(row.getCell('B')))
    ins.run({
      date: date.iso,
      client: clientRaw ? ctx.personByName.get(normalize(clientRaw)) ?? null : null,
      clientRaw,
      product: productRaw ? ctx.barProductByName.get(normalize(productRaw)) ?? null : null,
      productRaw,
      qty: asNumber(cellVal(row.getCell('D'))) ?? 1,
      total: asMoney(cellVal(row.getCell('E'))) ?? 0,
      cash: truthy(cellVal(row.getCell('F'))) ? 1 : 0,
      paid: truthy(cellVal(row.getCell('G'))) ? 1 : 0,
      batch: batchId,
      row: rowNumber
    })
    n++
  })
  counts.bar_sales = n
}

function importPaymentPlan(
  wb: ExcelJS.Workbook, db: DB, batchId: number,
  ctx: { personByNick: Map<string, number>; personByName: Map<string, number> },
  counts: Record<string, number>,
  _addErr: any
) {
  const ws = wb.getWorksheet('ozuna pago de cometa ') || wb.getWorksheet('ozuna pago de cometa')
  if (!ws) return
  // A1 = concepto ; A2 = saldo inicial ; filas: C=fecha, D=abono, E=saldo
  const title = asText(cellVal(ws.getRow(1).getCell('A'))) ?? 'Plan de pago'
  const principal = asMoney(cellVal(ws.getRow(2).getCell('A'))) ?? 0
  const personId = ctx.personByNick.get('ozuna') ?? ctx.personByName.get('ozuna') ?? null
  const planId = db.prepare(
    `INSERT INTO payment_plans(title,person_id,principal,status,import_batch_id) VALUES(?,?,?,'active',?)`
  ).run(title, personId, principal, batchId).lastInsertRowid as number

  const insAb = db.prepare(
    'INSERT INTO payment_plan_installments(plan_id,paid_date,amount,comment) VALUES(?,?,?,?)'
  )
  let n = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 2) return
    const date = asISODate(cellVal(row.getCell('C')))
    const amount = asMoney(cellVal(row.getCell('D')))
    if (!date.iso || amount == null) return
    insAb.run(planId, date.iso, amount, null)
    n++
  })
  counts.payment_plans = 1
  counts.payment_installments = n
}

// ---------- utilidades de clasificación ----------

function raw2equip(map: Map<string, number>, raw: string | null): number | null {
  if (!raw) return null
  return map.get(normalize(raw)) ?? null
}

function detectDiscipline(name: string): string | null {
  const n = normalize(name)
  if (n.includes('kite') || n.includes('cometa')) return 'kite'
  if (n.includes('wing')) return 'wing'
  if (n.includes('wake')) return 'wake'
  if (n.includes('sup')) return 'sup'
  if (n.includes('foil') || n.includes('efoil') || n.includes('e-foil')) return 'efoil'
  return null
}

function detectEquipCategory(name: string): string {
  const n = normalize(name)
  if (n.includes('tabla') || n.includes('board') || n.includes('bord')) return 'board'
  if (n.includes('foil')) return 'efoil'
  if (n.includes('sup')) return 'sup'
  if (n.includes('wing')) return 'wing'
  return 'kite'
}
