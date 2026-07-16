#!/usr/bin/env node
/**
 * Carga inicial del Excel histórico ("software inc.xlsx") a Supabase (Postgres + Storage).
 *
 * LO EJECUTA EL DUEÑO CON SUS PROPIAS CLAVES. Este script NO contiene claves.
 * La SERVICE_ROLE es secreta: NUNCA se comparte, NUNCA se sube al repo.
 *
 * Modos:
 *   DRY-RUN (sin red, solo parseo local y conteos):
 *     cd software-inc-app && DRY_RUN=1 EXCEL="/ruta/software inc.xlsx" \
 *       ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *       scripts/seed-supabase-run.cjs
 *
 *   REAL (sube filas por REST y archivos al bucket 'archivos'):
 *     cd software-inc-app && SUPABASE_URL="https://xxxx.supabase.co" \
 *       SUPABASE_SERVICE_ROLE="eyJ..." EXCEL="/ruta/software inc.xlsx" \
 *       ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *       scripts/seed-supabase-run.cjs
 *
 * Variables de entorno:
 *   EXCEL       ruta al Excel (default: "/Users/samuelcifuentesgutierrez/Desktop/software inc/software inc.xlsx")
 *   DRY_RUN=1   solo parsea y muestra conteos; CERO llamadas de red
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE  (solo modo real)
 *   FILES_DIR   carpeta con los archivos del negocio (default: "/Users/samuelcifuentesgutierrez/Desktop/software inc")
 *   BUSINESS_FILES  nombres separados por coma (default: "Archivos KITE ADDICT.xlsx,Precios_Kite Addict Colombia 2025.xlsx")
 *
 * Réplica fiel de src/main/services/importer.ts (mismo mapeo hoja -> tabla), pero
 * todo en memoria (sin SQLite) y con ids explícitos para conservarlos en Postgres.
 *
 * HOJAS CUBIERTAS:
 *   - "Club"                  -> service_catalog (cols O..S, filas 4+; cursos O4:O8),
 *                                equipment (cols U..W, filas 4+),
 *                                transactions (cols A..M, filas 4+)
 *   - "Persons"               -> persons: clientes (cols A..M, filas 3+),
 *                                staff/profesores (col O), proveedores (col P)
 *   - "Bar"                   -> bar_products (cols J..N, filas 3+),
 *                                bar_sales (cols A..G, filas 3+)
 *   - "Outcome"               -> expenses (cols C..I, filas 4+)
 *   - "ozuna pago de cometa " -> payment_plans + payment_plan_installments
 *
 * HOJAS NO CUBIERTAS (igual que el importador de la app): cualquier otra hoja del
 * libro (dashboards, estadísticas y celdas calculadas) no se importa; las columnas
 * derivadas (edad, totales, salario) se recalculan en la app, no se copian.
 *
 * Orden de subida (respeta FKs): import_batches -> persons -> service_catalog ->
 * equipment -> bar_products -> transactions -> expenses -> bar_sales ->
 * payment_plans -> payment_plan_installments. Lotes de 500; errores por lote se
 * reportan y se continúa. Al final imprime los setval(...) para el SQL Editor.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const ExcelJS = require('exceljs')

// ---------- config ----------

const DRY_RUN = !!process.env.DRY_RUN
const EXCEL_PATH =
  process.env.EXCEL || '/Users/samuelcifuentesgutierrez/Desktop/software inc/software inc.xlsx'
const FILES_DIR = process.env.FILES_DIR || '/Users/samuelcifuentesgutierrez/Desktop/software inc'
const BUSINESS_FILES = (
  process.env.BUSINESS_FILES || 'Archivos KITE ADDICT.xlsx,Precios_Kite Addict Colombia 2025.xlsx'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const BATCH_SIZE = 500
const BUCKET = 'archivos'
// ONLY_TABLES="service_catalog,transactions" -> re-sube SOLO esas tablas (y omite
// los archivos de negocio). Útil para reparar una carga parcial sin re-insertar
// las tablas que ya entraron (que darían conflicto de PK).
const ONLY_TABLES = (process.env.ONLY_TABLES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// ---------- helpers portados de shared/services/text.ts ----------

/** minúsculas, sin tildes, espacios colapsados y recortados. */
function normalize(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanName(s) {
  if (!s) return ''
  return String(s).replace(/\s+/g, ' ').trim()
}

const COUNTRY_MAP = {
  colombia: 'Colombia',
  co: 'Colombia',
  francia: 'Francia',
  france: 'Francia',
  usa: 'Estados Unidos',
  eeuu: 'Estados Unidos',
  'estados unidos': 'Estados Unidos',
  argentina: 'Argentina',
  brasil: 'Brasil',
  brazil: 'Brasil',
  chile: 'Chile',
  espana: 'España',
  espania: 'España'
}

function normalizeCountry(raw) {
  if (!raw) return null
  const key = normalize(raw)
  if (COUNTRY_MAP[key]) return COUNTRY_MAP[key]
  return cleanName(raw).replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------- helpers portados de shared/services/dates.ts ----------

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30) // 1899-12-30
const MS_PER_DAY = 86400000

function toISO(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
}

function excelSerialToISO(serial) {
  if (!isFinite(serial) || serial < 1) return null
  const ms = EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  if (year < 1900 || year > 2100) return null
  return toISO(d)
}

function dayFractionToMinutes(fraction) {
  if (!isFinite(fraction)) return null
  let min = Math.round(fraction * 1440)
  if (min < 0) min = 0
  if (min > 1439) min = 1439
  return min
}

/** Parseo tolerante de fecha: serial, Date real, texto DD/MM/YYYY con errores. */
function parseFlexibleDate(value) {
  if (value == null || value === '') return { iso: null, raw: null }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { iso: null, raw: String(value), reason: 'fecha_invalida' }
    return {
      iso: toISO(new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))),
      raw: null
    }
  }

  if (typeof value === 'number') {
    const iso = excelSerialToISO(value)
    return iso ? { iso, raw: null } : { iso: null, raw: String(value), reason: 'serial_fuera_de_rango' }
  }

  const raw = String(value).trim()
  if (raw === '') return { iso: null, raw: null }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const iso = excelSerialToISO(parseFloat(raw))
    if (iso) return { iso, raw: null }
  }

  // "04/031977" -> "04/03/1977"
  const glued = /^(\d{1,2})\/(\d{2})(\d{4})$/.exec(raw)
  const candidate = glued ? `${glued[1]}/${glued[2]}/${glued[3]}` : raw

  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(candidate)
  if (m) {
    const day = parseInt(m[1], 10)
    const month = parseInt(m[2], 10)
    let year = parseInt(m[3], 10)
    if (year < 100) year += year < 50 ? 2000 : 1900
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return { iso: toISO(new Date(Date.UTC(year, month - 1, day))), raw: null }
    }
  }

  return { iso: null, raw, reason: 'fecha_parcial' }
}

// ---------- helpers portados de shared/services/pricing.ts ----------

/** ¿Valor "redondo" de pago fijo (múltiplo de 500)? */
function isRoundish(n) {
  if (!isFinite(n) || n <= 0) return false
  return Math.abs(n - Math.round(n / 500) * 500) < 1
}

function derivePayModel(pct, price, hours) {
  if (price && hours && hours > 0) {
    const perHour = (pct * price) / hours
    if (isRoundish(perHour)) return { type: 'FIXED_PER_HOUR', rate: Math.round(perHour) }
  }
  if (price) {
    const amount = pct * price
    if (isRoundish(amount)) return { type: 'FIXED_AMOUNT', amount: Math.round(amount) }
  }
  return { type: 'PERCENT', pct }
}

// ---------- helpers de lectura de celdas (importer.ts) ----------

function cellVal(cell) {
  if (!cell) return null
  const v = cell.value
  if (v == null) return null
  if (typeof v === 'object') {
    if ('error' in v) return null // #N/A, #REF!, #VALUE! -> null
    if ('result' in v) return v.result // fórmula: valor cacheado
    if ('formula' in v) return null
    if (v instanceof Date) return v
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return v.text // hyperlink
  }
  return v
}

function asNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  const n = Number(String(value).replace(/[^\d.\-eE]/g, '')) // tolera "1.0E7", "$", comas
  return isFinite(n) ? n : null
}

function asMoney(value) {
  const n = asNumber(value)
  return n == null ? null : Math.round(n)
}

function asText(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function asISODate(value) {
  const r = parseFlexibleDate(value)
  return { iso: r.iso, raw: r.raw }
}

function asMinutes(value) {
  const n = asNumber(value)
  if (n == null) return null
  if (n >= 0 && n <= 1) return dayFractionToMinutes(n)
  return null
}

function truthy(value) {
  const s = normalize(String(value ?? ''))
  return ['1', 'si', 'sí', 'yes', 'x', 'true', 'still here', 'pagado'].includes(s)
}

function detectDiscipline(name) {
  const n = normalize(name)
  if (n.includes('kite') || n.includes('cometa')) return 'kite'
  if (n.includes('wing')) return 'wing'
  if (n.includes('wake')) return 'wake'
  if (n.includes('sup')) return 'sup'
  if (n.includes('foil') || n.includes('efoil') || n.includes('e-foil')) return 'efoil'
  return null
}

function detectEquipCategory(name) {
  const n = normalize(name)
  if (n.includes('tabla') || n.includes('board') || n.includes('bord')) return 'board'
  if (n.includes('foil')) return 'efoil'
  if (n.includes('sup')) return 'sup'
  if (n.includes('wing')) return 'wing'
  return 'kite'
}

// ---------- construcción en memoria (réplica de importer.ts) ----------

function buildRows(wb, sourceFileName) {
  const BATCH_ID = 1
  const t = {
    import_batches: [],
    persons: [],
    service_catalog: [],
    equipment: [],
    bar_products: [],
    transactions: [],
    expenses: [],
    bar_sales: [],
    payment_plans: [],
    payment_plan_installments: []
  }
  const errors = []
  const addErr = (sheet, row, reason, raw) => errors.push({ sheet, sourceRow: row, reason, raw })
  const nextId = { persons: 1, service_catalog: 1, equipment: 1, bar_products: 1, transactions: 1, expenses: 1, bar_sales: 1, payment_plans: 1, payment_plan_installments: 1 }

  t.import_batches.push({
    id: BATCH_ID,
    source_file: sourceFileName,
    source_sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(EXCEL_PATH)).digest('hex'),
    status: 'completed',
    rows_ok: 0, // se ajusta al final
    rows_error: 0
  })

  // Índices en memoria (mismos que el importador)
  const personByName = new Map()
  const personByNick = new Map()
  const personByPassport = new Map()
  const personByEmail = new Map()
  const catalogByName = new Map() // norm -> {id,pct,hours,days,price}
  const equipmentByName = new Map()
  const barProductByName = new Map()
  const personById = new Map()

  const counts = {}

  // ----- Club: catálogo de servicios (O..S; cursos O4:O8) -----
  const club = wb.getWorksheet('Club')
  if (club) {
    let n = 0
    club.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return
      const name = asText(cellVal(row.getCell('O')))
      if (!name) return
      const hours = asNumber(cellVal(row.getCell('P'))) ?? 0
      const days = asNumber(cellVal(row.getCell('Q'))) ?? 0
      const price = asMoney(cellVal(row.getCell('R'))) ?? 0
      const pct = asNumber(cellVal(row.getCell('S'))) ?? 0
      const norm = normalize(name)
      if (catalogByName.has(norm)) return // evitar duplicados de catálogo
      const isClass = rowNumber >= 4 && rowNumber <= 8 ? 1 : 0
      const year = /\b(20\d{2})\b/.exec(name)?.[1]
      const id = nextId.service_catalog++
      t.service_catalog.push({
        id,
        name,
        name_normalized: norm,
        discipline: detectDiscipline(name),
        season_year: year ? parseInt(year, 10) : null,
        hours,
        days,
        price,
        professor_pct: pct,
        pay_model_json: JSON.stringify(derivePayModel(pct, price, hours)),
        is_class: isClass,
        active: 1,
        import_batch_id: BATCH_ID
      })
      catalogByName.set(norm, { id, pct, hours, days, price })
      n++
    })
    counts.service_catalog = n
  }

  // ----- Club: equipos (U..W) -----
  if (club) {
    let n = 0
    club.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return
      const name = asText(cellVal(row.getCell('U')))
      if (!name) return
      const norm = normalize(name)
      if (equipmentByName.has(norm)) return
      const id = nextId.equipment++
      t.equipment.push({
        id,
        name,
        name_normalized: norm,
        category: detectEquipCategory(name),
        count: asNumber(cellVal(row.getCell('V'))) ?? 1,
        price: asMoney(cellVal(row.getCell('W'))),
        active: 1,
        import_batch_id: BATCH_ID
      })
      equipmentByName.set(norm, id)
      n++
    })
    counts.equipment = n
  }

  // ----- Bar: productos (J..N) -----
  const bar = wb.getWorksheet('Bar')
  if (bar) {
    let n = 0
    bar.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return
      const name = asText(cellVal(row.getCell('J')))
      if (!name) return
      const norm = normalize(name)
      if (barProductByName.has(norm)) return
      const id = nextId.bar_products++
      t.bar_products.push({
        id,
        name,
        name_normalized: norm,
        box_price: asMoney(cellVal(row.getCell('K'))),
        units_per_box: asNumber(cellVal(row.getCell('L'))),
        sell_price: asMoney(cellVal(row.getCell('N'))),
        active: 1,
        import_batch_id: BATCH_ID
      })
      barProductByName.set(norm, id)
      n++
    })
    counts.bar_products = n
  }

  // ----- Persons: clientes (A..M) -----
  const persons = wb.getWorksheet('Persons')
  const insPerson = (p) => {
    const id = nextId.persons++
    const row = { id, ...p, import_batch_id: BATCH_ID, source_sheet: 'Persons' }
    t.persons.push(row)
    personById.set(id, row)
    return id
  }
  if (persons) {
    let nClients = 0
    persons.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return
      const name = asText(cellVal(row.getCell('A')))
      if (!name) return
      const norm = normalize(name)
      const passport = asText(cellVal(row.getCell('B')))
      const email = asText(cellVal(row.getCell('C')))

      // Dedupe: pasaporte -> email -> nombre
      let existingId
      if (passport && personByPassport.has(normalize(passport))) existingId = personByPassport.get(normalize(passport))
      else if (email && personByEmail.has(normalize(email))) existingId = personByEmail.get(normalize(email))
      else if (personByName.has(norm)) existingId = personByName.get(norm)

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
        personById.get(existingId).is_client = 1
        nClients++
        return
      }

      const id = insPerson({
        full_name: cleanName(name),
        name_normalized: norm,
        nickname: null,
        nickname_normalized: null,
        is_client: 1,
        is_professor: 0,
        is_supplier: 0,
        passport,
        email,
        country: normalizeCountry(countryRaw),
        country_raw: countryRaw,
        birth_date: birth.iso,
        birth_date_raw: birth.raw,
        check_in: checkIn.iso,
        check_out: checkOut.iso,
        garos,
        taking_course: 0,
        discount_pct: discount,
        paid: paidVal,
        still_here: still ? 1 : 0,
        comment,
        source_row: rowNumber
      })
      personByName.set(norm, id)
      if (passport) personByPassport.set(normalize(passport), id)
      if (email) personByEmail.set(normalize(email), id)
      nClients++
    })
    counts.persons_clients = nClients

    // Staff (col O) -> is_professor, nickname
    let nStaff = 0
    persons.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return
      const nick = asText(cellVal(row.getCell('O')))
      if (!nick) return
      const norm = normalize(nick)
      let id = personByNick.get(norm) ?? personByName.get(norm)
      if (id) {
        const p = personById.get(id)
        p.is_professor = 1
        p.nickname = p.nickname ?? cleanName(nick)
        p.nickname_normalized = p.nickname_normalized ?? norm
      } else {
        id = insPerson({
          full_name: cleanName(nick),
          name_normalized: norm,
          nickname: cleanName(nick),
          nickname_normalized: norm,
          is_client: 0,
          is_professor: 1,
          is_supplier: 0,
          passport: null,
          email: null,
          country: null,
          country_raw: null,
          birth_date: null,
          birth_date_raw: null,
          check_in: null,
          check_out: null,
          garos: null,
          taking_course: 0,
          discount_pct: 0,
          paid: 0,
          still_here: 1,
          comment: null,
          source_row: rowNumber
        })
        personByName.set(norm, id)
      }
      personByNick.set(norm, id)
      nStaff++
    })
    counts.persons_staff = nStaff

    // Suppliers (col P) -> is_supplier
    let nSup = 0
    persons.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return
      const name = asText(cellVal(row.getCell('P')))
      if (!name) return
      const norm = normalize(name)
      let id = personByName.get(norm)
      if (id) {
        personById.get(id).is_supplier = 1
      } else {
        id = insPerson({
          full_name: cleanName(name),
          name_normalized: norm,
          nickname: null,
          nickname_normalized: null,
          is_client: 0,
          is_professor: 0,
          is_supplier: 1,
          passport: null,
          email: null,
          country: null,
          country_raw: null,
          birth_date: null,
          birth_date_raw: null,
          check_in: null,
          check_out: null,
          garos: null,
          taking_course: 0,
          discount_pct: 0,
          paid: 0,
          still_here: 1,
          comment: null,
          source_row: rowNumber
        })
        personByName.set(norm, id)
      }
      nSup++
    })
    counts.persons_suppliers = nSup
  }

  // ----- Club: transacciones (A..M) -----
  const findPerson = (raw, nick = false) => {
    if (!raw) return null
    const norm = normalize(raw)
    return (nick ? personByNick.get(norm) : personByName.get(norm)) ??
      personByName.get(norm) ?? personByNick.get(norm) ?? null
  }
  const raw2equip = (raw) => (raw ? equipmentByName.get(normalize(raw)) ?? null : null)
  if (club) {
    let n = 0
    club.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return
      const date = asISODate(cellVal(row.getCell('A')))
      if (!date.iso) return // sin fecha no es una transacción real
      const dRaw = asText(cellVal(row.getCell('D')))
      const eRaw = asText(cellVal(row.getCell('E')))
      const isClass = normalize(dRaw ?? '') === 'class' ? 1 : 0
      const serviceItem = dRaw && !isClass ? catalogByName.get(normalize(dRaw)) : undefined
      const resolvedItem = eRaw ? catalogByName.get(normalize(eRaw)) : undefined
      const price = asMoney(cellVal(row.getCell('J')))
      const override = asMoney(cellVal(row.getCell('K')))
      const salary = asMoney(cellVal(row.getCell('M')))
      const effective = override ?? price
      let pct = resolvedItem?.pct ?? null
      if (pct == null && salary != null && effective && effective > 0) pct = salary / effective

      t.transactions.push({
        id: nextId.transactions++,
        tx_date: date.iso,
        start_min: asMinutes(cellVal(row.getCell('B'))),
        end_min: asMinutes(cellVal(row.getCell('C'))),
        service_raw: dRaw,
        service_id: serviceItem?.id ?? null,
        is_class: isClass,
        tx_type: isClass ? 'class' : 'service',
        resolved_service_id: resolvedItem?.id ?? null,
        professor_id: findPerson(asText(cellVal(row.getCell('F'))), true),
        client_id: findPerson(asText(cellVal(row.getCell('G')))),
        kite_id: raw2equip(asText(cellVal(row.getCell('H')))),
        board_id: raw2equip(asText(cellVal(row.getCell('I')))),
        price_snapshot: price,
        professor_pct_snapshot: pct,
        price_override: override,
        comment: null,
        import_batch_id: BATCH_ID,
        source_sheet: 'Club',
        source_row: rowNumber
      })
      n++
    })
    counts.transactions = n
  }

  // ----- Outcome: gastos (C..I) -----
  const outcome = wb.getWorksheet('Outcome')
  if (outcome) {
    let n = 0
    outcome.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return
      const date = asISODate(cellVal(row.getCell('C')))
      const amount = asMoney(cellVal(row.getCell('H')))
      if (!date.iso || amount == null) {
        if (rowNumber >= 4 && (date.raw || amount != null)) addErr('Outcome', rowNumber, 'gasto_incompleto')
        return
      }
      const areaName = asText(cellVal(row.getCell('F')))
      const supplierRaw = asText(cellVal(row.getCell('G')))
      t.expenses.push({
        id: nextId.expenses++,
        expense_date: date.iso,
        supply_name: asText(cellVal(row.getCell('D'))),
        count: asNumber(cellVal(row.getCell('E'))) ?? 1,
        area_name: areaName,
        area_person_id: areaName ? personByNick.get(normalize(areaName)) ?? personByName.get(normalize(areaName)) ?? null : null,
        supplier_id: supplierRaw ? personByName.get(normalize(supplierRaw)) ?? null : null,
        supplier_raw: supplierRaw,
        amount_out: amount,
        comment: asText(cellVal(row.getCell('I'))),
        import_batch_id: BATCH_ID,
        source_sheet: 'Outcome',
        source_row: rowNumber
      })
      n++
    })
    counts.expenses = n
  }

  // ----- Bar: ventas (A..G) -----
  if (bar) {
    let n = 0
    bar.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return
      const date = asISODate(cellVal(row.getCell('A')))
      const productRaw = asText(cellVal(row.getCell('C')))
      if (!date.iso && !productRaw) return
      if (!date.iso) return
      const clientRaw = asText(cellVal(row.getCell('B')))
      t.bar_sales.push({
        id: nextId.bar_sales++,
        sale_date: date.iso,
        client_id: clientRaw ? personByName.get(normalize(clientRaw)) ?? null : null,
        client_raw: clientRaw,
        product_id: productRaw ? barProductByName.get(normalize(productRaw)) ?? null : null,
        product_raw: productRaw,
        qty: asNumber(cellVal(row.getCell('D'))) ?? 1,
        total: asMoney(cellVal(row.getCell('E'))) ?? 0,
        paid_cash: truthy(cellVal(row.getCell('F'))) ? 1 : 0,
        already_paid: truthy(cellVal(row.getCell('G'))) ? 1 : 0,
        import_batch_id: BATCH_ID,
        source_sheet: 'Bar',
        source_row: rowNumber
      })
      n++
    })
    counts.bar_sales = n
  }

  // ----- ozuna pago de cometa: plan de pago + cuotas -----
  const ozuna = wb.getWorksheet('ozuna pago de cometa ') || wb.getWorksheet('ozuna pago de cometa')
  if (ozuna) {
    // A1 = concepto ; A2 = saldo inicial ; filas: C=fecha, D=abono
    const title = asText(cellVal(ozuna.getRow(1).getCell('A'))) ?? 'Plan de pago'
    const principal = asMoney(cellVal(ozuna.getRow(2).getCell('A'))) ?? 0
    const personId = personByNick.get('ozuna') ?? personByName.get('ozuna') ?? null
    const planId = nextId.payment_plans++
    t.payment_plans.push({
      id: planId,
      title,
      person_id: personId,
      equipment_id: null,
      principal,
      start_date: null,
      status: 'active',
      import_batch_id: BATCH_ID
    })
    let n = 0
    ozuna.eachRow((row, rowNumber) => {
      if (rowNumber < 2) return
      const date = asISODate(cellVal(row.getCell('C')))
      const amount = asMoney(cellVal(row.getCell('D')))
      if (!date.iso || amount == null) return
      t.payment_plan_installments.push({
        id: nextId.payment_plan_installments++,
        plan_id: planId,
        paid_date: date.iso,
        amount,
        comment: null
      })
      n++
    })
    counts.payment_plans = 1
    counts.payment_installments = n
  }

  const rowsOk = Object.values(counts).reduce((a, b) => a + b, 0)
  t.import_batches[0].rows_ok = rowsOk
  t.import_batches[0].rows_error = errors.length
  t.import_batches[0].finished_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  // Los avisos de parseo también se suben (trazabilidad, como el importador real)
  t.import_errors = errors.map((e) => ({
    batch_id: BATCH_ID,
    sheet: e.sheet,
    source_row: e.sourceRow ?? null,
    raw_json: e.raw != null ? JSON.stringify(e.raw) : null,
    reason: e.reason
  }))
  return { tables: t, counts, errors, rowsOk }
}

// ---------- subida a Supabase (solo modo real) ----------

/** Orden de inserción que respeta las FKs. */
const UPLOAD_ORDER = [
  'import_batches',
  'import_errors',
  'persons',
  'service_catalog',
  'equipment',
  'bar_products',
  'transactions',
  'expenses',
  'bar_sales',
  'payment_plans',
  'payment_plan_installments'
]

async function uploadTables(baseUrl, serviceRole, tables) {
  let okRows = 0
  let failedBatches = 0
  for (const table of UPLOAD_ORDER) {
    const rows = tables[table] || []
    if (!rows.length) continue
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE)
      try {
        const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
          method: 'POST',
          headers: {
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify(chunk)
        })
        if (!res.ok) {
          failedBatches++
          const body = (await res.text()).slice(0, 500)
          console.error(`[ERROR] ${table} lote ${i}-${i + chunk.length - 1}: HTTP ${res.status} ${body}`)
        } else {
          okRows += chunk.length
          console.log(`[OK] ${table}: filas ${i + 1}..${i + chunk.length} de ${rows.length}`)
        }
      } catch (err) {
        failedBatches++
        console.error(`[ERROR] ${table} lote ${i}: ${err.message}`)
      }
    }
  }
  return { okRows, failedBatches }
}

async function uploadFiles(baseUrl, serviceRole) {
  for (const name of BUSINESS_FILES) {
    const filePath = path.join(FILES_DIR, name)
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] archivo no encontrado, se omite: ${filePath}`)
      continue
    }
    const buf = fs.readFileSync(filePath)
    const objectPath = encodeURIComponent(name)
    try {
      const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
        method: 'POST',
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: buf
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300)
        console.error(`[ERROR] Storage ${name}: HTTP ${res.status} ${body}`)
      } else {
        console.log(`[OK] Storage: ${BUCKET}/${name} (${buf.length} bytes)`)
      }
    } catch (err) {
      console.error(`[ERROR] Storage ${name}: ${err.message}`)
    }
  }
}

/** setval para cada tabla con identity: pegar en el SQL Editor tras la carga. */
function printSetvals(tables) {
  console.log('\n-- Pegar en el SQL Editor de Supabase para alinear las secuencias:')
  for (const table of UPLOAD_ORDER) {
    if (!(tables[table] || []).length) continue
    console.log(
      `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false);`
    )
  }
}

// ---------- main ----------

async function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`Excel no encontrado: ${EXCEL_PATH} (ajusta la variable EXCEL)`)
    process.exit(1)
  }

  console.log(`Leyendo ${EXCEL_PATH} ...`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)

  const { tables, counts, errors, rowsOk } = buildRows(wb, path.basename(EXCEL_PATH))

  if (ONLY_TABLES.length) {
    for (const table of UPLOAD_ORDER) {
      if (!ONLY_TABLES.includes(table)) tables[table] = []
    }
    console.log(`\nONLY_TABLES activo: solo se subirán -> ${ONLY_TABLES.join(', ')}`)
  }

  console.log('\nConteos por hoja (filas procesadas):')
  console.log(JSON.stringify(counts, null, 2))
  console.log('\nFilas por tabla destino:')
  for (const table of UPLOAD_ORDER) console.log(`  ${table}: ${(tables[table] || []).length}`)
  console.log(`\nTotal filas OK: ${rowsOk}; filas con aviso/error de parseo: ${errors.length}`)
  if (errors.length) {
    console.log('Primeros avisos:')
    for (const e of errors.slice(0, 10)) console.log(`  [${e.sheet} fila ${e.sourceRow}] ${e.reason}`)
  }

  if (DRY_RUN) {
    printSetvals(tables)
    console.log('\nDRY_RUN=1: no se hizo NINGUNA llamada de red. Nada se subió.')
    return
  }

  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE || ''
  if (!baseUrl || !serviceRole) {
    console.error('\nFaltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE. Aborto sin subir nada.')
    console.error('Ejemplo: SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_ROLE="eyJ..." ...')
    process.exit(1)
  }

  console.log(`\nSubiendo a ${baseUrl} en lotes de ${BATCH_SIZE} ...`)
  const { okRows, failedBatches } = await uploadTables(baseUrl, serviceRole, tables)
  console.log(`\nSubida de datos: ${okRows} filas OK, ${failedBatches} lotes con error.`)

  if (ONLY_TABLES.length) {
    console.log(`\nONLY_TABLES activo: se omite la subida de archivos del negocio.`)
  } else {
    console.log(`\nSubiendo archivos del negocio al bucket '${BUCKET}' ...`)
    await uploadFiles(baseUrl, serviceRole)
  }

  printSetvals(tables)
  console.log('\nRECORDATORIO: la clave service_role es SECRETA. No la compartas, no la')
  console.log('subas al repo ni la dejes en historiales de shell (usa un espacio inicial o unset).')
}

main().catch((err) => {
  console.error('Fallo fatal:', err)
  process.exit(1)
})
