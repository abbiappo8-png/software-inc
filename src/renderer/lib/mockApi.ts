/**
 * API simulado para el MODO DEMO (navegador, sin Electron).
 * Implementa el contrato AppApi calculando sobre datos de ejemplo en memoria,
 * con las mismas fórmulas de la app real (precios, factura, liquidación, balance).
 * Las mutaciones se pierden al recargar la página (es un demo).
 */
import type { AppApi } from '@shared/types/api'
import type { Person } from '@shared/types/domain'
import * as sample from './sampleData'

const persons: Person[] = sample.persons.map((p) => ({ ...p }))
const services = sample.services.map((s) => ({ ...s }))
const equipment = sample.equipment.map((e) => ({ ...e }))
const transactions = sample.transactions.map((t) => ({ ...t }))
const barProducts = sample.barProducts.map((p) => ({ ...p }))
const barSales = sample.barSales.map((s) => ({ ...s }))
const expenses = sample.expenses.map((e) => ({ ...e }))
const plans = sample.paymentPlans.map((p) => ({ ...p, installments: p.installments.map((i) => ({ ...i })) }))
const savedBills: any[] = [] // facturas guardadas en la sesión demo (para markPaid)
const photos = new Map<number, string>() // fotos de perfil (base64) de la sesión demo
const settlementStatus = new Map<string, 'issued' | 'paid'>() // estado de liquidaciones (profId-YYYY-MM)

// Google Forms simulado (la sincronización real es de la app instalada)
const demoForms = [
  { key: 'reservas', name: 'Reservas de clases (demo)', csvUrl: '(demo)', formUrl: '' }
]
const formResponses: any[] = [
  {
    id: 901, formKey: 'reservas', rowHash: 'demo1', submittedAt: '2026-07-13T09:12:00',
    values: { 'Marca temporal': '13/07/2026 9:12', 'Nombre completo': 'Lucía Fernández', 'Correo electrónico': 'lucia@example.com', 'Fecha de la clase': '16/07/2026', 'Hora': '8:00 a. m.', '¿Qué clase quieres?': 'Clase de kite (curso)', 'Comentario': 'Primera vez' },
    status: 'new', importedPersonId: null, importedTxId: null
  },
  {
    id: 902, formKey: 'reservas', rowHash: 'demo2', submittedAt: '2026-07-13T18:40:00',
    values: { 'Marca temporal': '13/07/2026 18:40', 'Nombre completo': 'Marco Rossi', 'Correo electrónico': 'marco@example.com', 'Fecha de la clase': '17/07/2026', 'Hora': '10:30 a. m.', '¿Qué clase quieres?': 'Wing foil', 'Comentario': '' },
    status: 'new', importedPersonId: null, importedTxId: null
  },
  {
    id: 903, formKey: 'reservas', rowHash: 'demo3', submittedAt: '2026-07-12T14:05:00',
    values: { 'Marca temporal': '12/07/2026 14:05', 'Nombre completo': 'Ana Restrepo', 'Correo electrónico': 'ana@example.com', 'Fecha de la clase': '14/07/2026', 'Hora': '9:00 a. m.', '¿Qué clase quieres?': 'Clase de kite (curso)', 'Comentario': 'Cliente frecuente' },
    status: 'imported', importedPersonId: 1, importedTxId: null
  }
]

/** Auto-detección de campos (versión ligera del main, para el demo). */
function guessLite(values: Record<string, string>) {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const pick = (keys: string[], exclude: string[] = []) => {
    for (const [k, v] of Object.entries(values)) {
      const nk = norm(k)
      if (exclude.some((e) => nk.includes(e))) continue
      if (keys.some((key) => nk.includes(key)) && v?.trim()) return v.trim()
    }
    return null
  }
  const parseDate = (v: string | null) => {
    if (!v) return null
    const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(v)
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
  }
  const parseHour = (v: string | null) => {
    if (!v) return null
    const m = /(\d{1,2})[:. ](\d{2})/.exec(v)
    if (!m) return null
    let h = parseInt(m[1], 10)
    if (/p\.?\s?m/i.test(v) && h < 12) h += 12
    return h * 60 + parseInt(m[2], 10)
  }
  return {
    fullName: pick(['nombre', 'name'], ['apodo']),
    email: pick(['correo', 'email', 'mail']),
    passport: pick(['pasaporte', 'documento', 'cedula']),
    country: pick(['pais', 'nacionalidad']),
    birthDate: parseDate(pick(['nacimiento', 'birth'])),
    date: parseDate(pick(['fecha', 'dia'], ['nacimiento', 'marca temporal'])),
    startMin: parseHour(pick(['hora'], ['marca temporal'])),
    service: pick(['clase', 'servicio', 'curso', 'actividad'], ['fecha', 'dia', 'hora']),
    comment: pick(['comentario', 'mensaje', 'nota'])
  }
}

let nextId = 1000
const roundCOP = (n: number) => Math.round(n)
const monthOf = (iso: string) => iso.slice(0, 7)
const notAvailable = async (): Promise<any> => {
  alert('Esta función (PDF / Excel / correo / respaldo) está disponible en la app instalada.')
  return ''
}

export const mockApi: AppApi = {
  auth: {
    status: async () => ({ hasPin: true, needsImport: false, schemaVersion: 1, userDataPath: '(demo)' }),
    hasPin: async () => true,
    setPin: async () => ({ ok: true }),
    verify: async () => ({ ok: true }),
    change: async () => ({ ok: true })
  },
  import: {
    pickFile: async () => null,
    run: async () => ({ batchId: 0, sourceFile: '(demo)', counts: {}, rowsOk: 0, rowsError: 0, errors: [], durationMs: 0 })
  },
  persons: {
    list: async (filter) => {
      let r = persons
      if (filter?.role === 'client') r = r.filter((p) => p.isClient)
      if (filter?.role === 'professor') r = r.filter((p) => p.isProfessor)
      if (filter?.role === 'supplier') r = r.filter((p) => p.isSupplier)
      if (filter?.onlyActive) r = r.filter((p) => p.stillHere)
      if (filter?.search) {
        const q = filter.search.toLowerCase()
        r = r.filter((p) => p.fullName.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
      }
      // último registro primero (paridad con escritorio y web)
      return r.map((p) => ({ ...p })).sort((a, b) => b.id - a.id)
    },
    count: async (filter) => (await mockApi.persons.list(filter)).length,
    get: async (id) => persons.find((p) => p.id === id) ?? null,
    create: async (input) => {
      const p: Person = { ...(input as any), id: ++nextId, photoThumbPath: null }
      persons.push(p)
      return p
    },
    update: async (id, input) => {
      const i = persons.findIndex((p) => p.id === id)
      if (i >= 0) persons[i] = { ...persons[i], ...(input as any), id }
      return persons[i]
    },
    remove: async (id) => {
      // Paridad con escritorio/web: con historial no se borra, se marca inactiva.
      const refs =
        transactions.filter((t) => t.clientId === id || t.professorId === id).length +
        barSales.filter((s) => s.clientId === id).length
      if (refs > 0) {
        throw new Error(
          `No se puede eliminar: tiene ${refs} registro(s) asociados (clases, bar…). ` +
            'Desmarca "Activo" para ocultarla sin perder el historial.'
        )
      }
      const i = persons.findIndex((p) => p.id === id)
      if (i >= 0) persons.splice(i, 1)
    },
    setPhoto: async (id, dataBase64) => {
      photos.set(id, String(dataBase64).replace(/^data:image\/\w+;base64,/, ''))
      const p = persons.find((x) => x.id === id)
      if (p) {
        p.photoPath = '(demo)'
        p.photoThumbPath = '(demo)'
      }
      return { photoPath: '(demo)', photoThumbPath: '(demo)' }
    },
    photoDataUrl: async (id) => (photos.has(id) ? 'data:image/jpeg;base64,' + photos.get(id) : null)
  },
  catalog: {
    listServices: async () => services.map((s) => ({ ...s })),
    createService: async (s) => {
      const item = { ...(s as any), id: ++nextId }
      services.push(item)
      return item
    },
    updateService: async (id, s) => {
      const i = services.findIndex((x) => x.id === id)
      if (i >= 0) services[i] = { ...(s as any), id }
      return services[i]
    },
    listEquipment: async () => equipment.map((e) => ({ ...e })),
    createEquipment: async (e) => {
      const item = { ...(e as any), id: ++nextId }
      equipment.push(item)
      return item
    },
    updateEquipment: async (id, e) => {
      const i = equipment.findIndex((x) => x.id === id)
      if (i >= 0) equipment[i] = { ...(e as any), id }
      return equipment[i]
    }
  },
  transactions: {
    list: async (filter) => {
      let r = transactions
      if (filter?.clientId) r = r.filter((t) => t.clientId === filter.clientId)
      if (filter?.professorId) r = r.filter((t) => t.professorId === filter.professorId)
      return r.map((t) => ({ ...t })).sort((a, b) => b.txDate.localeCompare(a.txDate))
    },
    preview: async (input: any) => computeTx(input),
    create: async (input: any) => {
      const t = mkTxRow(++nextId, input)
      transactions.push(t as any)
      return t as any
    },
    update: async (id: number, input: any) => {
      const i = transactions.findIndex((t) => t.id === id)
      if (i < 0) throw new Error('Transacción no encontrada')
      const t = mkTxRow(id, input, id, transactions[i].checkInAt)
      transactions[i] = t as any
      return t as any
    },
    checkout: async (id: number, endMin?: number | null) => {
      const i = transactions.findIndex((t) => t.id === id)
      if (i < 0) throw new Error('Transacción no encontrada')
      const cur = transactions[i]
      const input = {
        txDate: cur.txDate, startMin: cur.startMin, endMin: endMin ?? nowMinutes(),
        serviceId: cur.serviceId, isClass: cur.isClass, txType: cur.txType, clientId: cur.clientId,
        professorId: cur.professorId, kiteId: cur.kiteId, boardId: cur.boardId,
        priceOverride: cur.priceOverride, comment: cur.comment
      }
      const t = mkTxRow(id, input, id, cur.checkInAt)
      transactions[i] = t as any
      return t as any
    },
    remove: async (id) => {
      const i = transactions.findIndex((t) => t.id === id)
      if (i >= 0) transactions.splice(i, 1)
    }
  },
  bar: {
    listProducts: async () => barProducts.map((p) => ({ ...p, stock: stockOf(p) })),
    createProduct: async (input: any) => {
      const p = { id: ++nextId, name: input.name, boxPrice: input.boxPrice ?? null, unitsPerBox: input.unitsPerBox ?? null, sellPrice: input.sellPrice ?? null, active: input.active !== false, unitCost: mockUnitCost(input.boxPrice, input.unitsPerBox), stock: 0 }
      barProducts.push(p)
      return p
    },
    updateProduct: async (id: number, input: any) => {
      const i = barProducts.findIndex((x) => x.id === id)
      if (i >= 0) {
        const oldName = barProducts[i].name
        barProducts[i] = { ...barProducts[i], name: input.name, boxPrice: input.boxPrice ?? null, unitsPerBox: input.unitsPerBox ?? null, sellPrice: input.sellPrice ?? null, active: input.active !== false, unitCost: mockUnitCost(input.boxPrice, input.unitsPerBox) }
        // Igual que el repo real: al renombrar, migrar el historial de compras para no perder stock.
        if (oldName !== input.name) expenses.forEach((e) => { if (e.supplyName === oldName) e.supplyName = input.name })
      }
      return { ...barProducts[i], stock: stockOf(barProducts[i]) }
    },
    restock: async (input: any) => {
      const p = barProducts.find((x) => x.id === input.productId)
      if (!p) throw new Error('Producto no encontrado')
      if (!(input.units > 0)) throw new Error('Las unidades deben ser mayores que cero')
      expenses.push({ id: ++nextId, expenseDate: input.date, supplyName: p.name, count: input.units, areaName: null, areaPersonId: null, supplierId: null, supplierRaw: null, amountOut: roundCOP(input.amount || 0), comment: input.comment ?? `Compra de inventario: ${p.name}` })
      return { ...p, stock: stockOf(p) }
    },
    createSale: async (input: any) => {
      const p = barProducts.find((x) => x.id === input.productId)
      if (!p) throw new Error('Producto no encontrado')
      const available = stockOf(p)
      if (!(input.qty > 0)) throw new Error('Cantidad inválida')
      if (available < input.qty) throw new Error(`Stock insuficiente de ${p.name} (disponible: ${available})`)
      const total = roundCOP(input.qty * (p.sellPrice ?? 0))
      const s = { id: ++nextId, saleDate: input.saleDate, clientId: input.clientId ?? null, clientRaw: null, productId: input.productId, productRaw: p.name, qty: input.qty, total, paidCash: !!input.paidCash, alreadyPaid: !!input.alreadyPaid }
      barSales.push(s)
      return s
    },
    listSales: async () => barSales.map((s) => ({ ...s })).sort((a, b) => b.saleDate.localeCompare(a.saleDate))
  },
  expenses: {
    list: async () => expenses.map((e) => ({ ...e })).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    create: async (input: any) => {
      const e = { id: ++nextId, expenseDate: input.expenseDate, supplyName: input.supplyName ?? null, count: input.count ?? 1, areaName: input.areaName ?? null, areaPersonId: input.areaPersonId ?? null, supplierId: input.supplierId ?? null, supplierRaw: null, amountOut: roundCOP(input.amountOut || 0), comment: input.comment ?? null }
      expenses.push(e)
      return e
    },
    update: async (id: number, input: any) => {
      const i = expenses.findIndex((e) => e.id === id)
      if (i < 0) throw new Error('Gasto no encontrado')
      expenses[i] = { ...expenses[i], expenseDate: input.expenseDate, supplyName: input.supplyName ?? null, count: input.count ?? 1, areaName: input.areaName ?? null, areaPersonId: input.areaPersonId ?? null, supplierId: input.supplierId ?? null, amountOut: roundCOP(input.amountOut || 0), comment: input.comment ?? null }
      return expenses[i]
    },
    remove: async (id) => {
      const i = expenses.findIndex((e) => e.id === id)
      if (i >= 0) expenses.splice(i, 1)
    }
  },
  bills: {
    preview: async (clientId, opts = {}) => buildBill(clientId, opts),
    save: async (clientId, opts = {}) => {
      const b = buildBill(clientId, opts)
      const bill = { id: ++nextId, clientId, billDate: opts.billDate ?? new Date().toISOString().slice(0, 10), lodgingDays: 0, lodgingRate: 0, discountPct: opts.discountPct ?? 0, deductions: opts.deduction ?? 0, alreadyPaid: b.result.alreadyPaid, cardSurcharge: !!opts.cardSurcharge, subtotal: b.result.subtotal, total: b.result.total, netToPay: b.result.netToPay, status: 'issued' as const, pdfPath: null, emailedAt: null, notes: null, items: b.items }
      savedBills.push(bill as any)
      return bill as any
    },
    markPaid: async (billId) => {
      const bill = savedBills.find((b) => b.id === billId)
      if (!bill) throw new Error('Factura no encontrada')
      if (bill.status !== 'paid') {
        bill.status = 'paid'
        // El pago cubre el neto pendiente: el saldo del cliente queda en 0.
        const p = persons.find((x) => x.id === bill.clientId)
        if (p) p.paid = (p.paid ?? 0) + bill.netToPay
      }
      return { ...bill }
    },
    pdf: notAvailable,
    email: async () => ({ ok: false, error: 'Disponible en la app instalada.' })
  },
  settlements: {
    preview: async (professorId, year, month) => buildSettlement(professorId, year, month),
    save: async (professorId, year, month) => {
      const s = buildSettlement(professorId, year, month)
      const prefix = `${year}-${String(month).padStart(2, '0')}`
      if (!settlementStatus.has(`${professorId}-${prefix}`)) settlementStatus.set(`${professorId}-${prefix}`, 'issued')
      return { id: ++nextId, professorId, periodYear: year, periodMonth: month, grossSalary: s.result.gross, barDiscount: s.result.barDiscount, expensesAssigned: 0, netAmount: s.result.net, status: settlementStatus.get(`${professorId}-${prefix}`) ?? 'issued', pdfPath: null, emailedAt: null }
    },
    markPaid: async (professorId, year, month) => {
      const s = buildSettlement(professorId, year, month)
      const prefix = `${year}-${String(month).padStart(2, '0')}`
      settlementStatus.set(`${professorId}-${prefix}`, 'paid')
      return { id: ++nextId, professorId, periodYear: year, periodMonth: month, grossSalary: s.result.gross, barDiscount: s.result.barDiscount, expensesAssigned: 0, netAmount: s.result.net, status: 'paid', pdfPath: null, emailedAt: null }
    },
    pdf: notAvailable
  },
  finance: {
    dailyCashflow: async () => {
      const days: Record<string, { date: string; inClients: number; inBar: number; out: number }> = {}
      const touch = (d: string) => (days[d] ??= { date: d, inClients: 0, inBar: 0, out: 0 })
      // Las sesiones abiertas aún no son ingreso (se cobran al registrar la salida).
      transactions.filter((t) => t.endMin != null).forEach((t) => (touch(t.txDate).inClients += t.priceEffective ?? 0))
      barSales.forEach((s) => (touch(s.saleDate).inBar += s.total))
      expenses.forEach((e) => (touch(e.expenseDate).out += e.amountOut))
      const sorted = Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
      let running = 0
      const rows = sorted.map((d) => {
        const inSum = d.inClients + d.inBar
        running += inSum - d.out
        return { date: d.date, inClients: d.inClients, inBar: d.inBar, in: inSum, out: d.out, runningBalance: running }
      })
      const totals = rows.reduce((a, r) => ({ in: a.in + r.in, out: a.out + r.out, net: 0 }), { in: 0, out: 0, net: 0 })
      totals.net = totals.in - totals.out
      return { rows, totals }
    },
    monthSummary: async (year, month) => {
      const prefix = `${year}-${String(month).padStart(2, '0')}`
      const incomeClients =
        transactions.filter((t) => monthOf(t.txDate) === prefix && t.endMin != null).reduce((a, b) => a + (b.priceEffective ?? 0), 0) +
        barSales.filter((s) => monthOf(s.saleDate) === prefix).reduce((a, b) => a + b.total, 0)
      const professorSalaries = professorsWithSalary(prefix)
      const salariesTotal = professorSalaries.reduce((a, b) => a + b.amount, 0)
      const expensesNonProfessor = expenses
        .filter((e) => monthOf(e.expenseDate) === prefix && !isProfessor(e.areaPersonId))
        .reduce((a, b) => a + b.amountOut, 0)
      const totalCosts = expensesNonProfessor + salariesTotal
      return { year, month, incomeClients, expensesNonProfessor, professorSalaries, totalCosts, net: incomeClients - totalCosts }
    },
    ageStats: async () => {
      const counts = new Map<number, number>()
      const today = new Date().toISOString().slice(0, 10)
      persons.forEach((p) => {
        if (!p.birthDate) return
        const years = (Date.parse(p.checkIn || today) - Date.parse(p.birthDate)) / (365 * 86400000)
        if (years < 0 || years > 120) return
        const b = Math.floor(years) - (Math.floor(years) % 5)
        counts.set(b, (counts.get(b) || 0) + 1)
      })
      return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, count]) => ({ bucket, count }))
    },
    yearBalance: async () => {
      const map = new Map<number, { in: number; out: number }>()
      const touch = (y: number) => (map.get(y) ?? map.set(y, { in: 0, out: 0 }).get(y)!)
      transactions.filter((t) => t.endMin != null).forEach((t) => (touch(+t.txDate.slice(0, 4)).in += t.priceEffective ?? 0))
      barSales.forEach((s) => (touch(+s.saleDate.slice(0, 4)).in += s.total))
      expenses.forEach((e) => (touch(+e.expenseDate.slice(0, 4)).out += e.amountOut))
      return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, in: v.in, out: v.out }))
    },
    dashboard: async () => ({
      clients: persons.filter((p) => p.isClient).length,
      professors: persons.filter((p) => p.isProfessor).length,
      transactions: transactions.length,
      incomeAll: transactions.filter((t) => t.endMin != null).reduce((a, b) => a + (b.priceEffective ?? 0), 0),
      expensesAll: expenses.reduce((a, b) => a + b.amountOut, 0),
      barSales: barSales.length
    })
  },
  plans: {
    list: async () => plans.map((p) => ({ ...p, outstanding: outstanding(p) })),
    get: async (id) => {
      const p = plans.find((x) => x.id === id)
      if (!p) return null
      let bal = p.principal
      const installments = p.installments.map((i) => {
        bal -= i.amount
        return { ...i, balanceAfter: bal }
      })
      return { ...p, installments, outstanding: bal }
    },
    create: async (title, personId, principal, startDate) => {
      const p = { id: ++nextId, title, personId, equipmentId: null, principal, startDate: startDate ?? null, status: 'active' as const, installments: [] }
      plans.push(p)
      return { ...p, outstanding: principal }
    },
    addInstallment: async (planId, paidDate, amount, comment) => {
      const p = plans.find((x) => x.id === planId)!
      p.installments.push({ id: ++nextId, planId, paidDate, amount, comment: comment ?? null })
      return { ...p, outstanding: outstanding(p) }
    }
  },
  settings: {
    getCompany: async () => ({ companyName: 'Kite Addict Colombia (DEMO)', companyNit: '', cardSurchargePct: 0.05, currency: 'COP' }),
    setCompany: async () => undefined,
    getSmtp: async () => ({ host: '', port: 587, user: '', from: '', hasPassword: false }),
    setSmtp: async () => undefined,
    testSmtp: async () => ({ ok: false, error: 'Disponible en la app instalada.' }),
    setBarDiscount: async () => undefined,
    getBarDiscount: async () => 0
  },
  forms: {
    list: async () => demoForms.map((f) => ({ ...f })),
    saveConfig: async (cfg) => {
      // Igual que el backend real: descarta filas vacías y genera el slug con normalize.
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form'
      demoForms.length = 0
      demoForms.push(
        ...cfg
          .filter((f) => f.name?.trim() || f.csvUrl?.trim() || f.formUrl?.trim())
          .map((f) => ({ key: f.key || slug(f.name || 'form'), name: (f.name || 'Formulario').trim(), csvUrl: (f.csvUrl || '').trim(), formUrl: (f.formUrl || '').trim() }))
      )
    },
    sync: async (formKey) => ({ formKey, fetched: formResponses.filter((r) => r.formKey === formKey).length, added: 0 }),
    responses: async (formKey, status) =>
      formResponses
        .filter((r) => r.formKey === formKey && (!status || r.status === status))
        .map((r) => ({ ...r, guess: guessLite(r.values) })),
    convert: async (responseId, kind, edited) => {
      const r = formResponses.find((x) => x.id === responseId)
      if (!r) throw new Error('Respuesta no encontrada')
      if (r.status !== 'new') return { ...r } // ni reimportar ni resucitar una ignorada
      const g = { ...guessLite(r.values), ...(edited ?? {}) }
      if (!g.fullName) throw new Error('La respuesta no tiene nombre.')
      if (kind === 'reservation' && !g.date) throw new Error('La fecha de la reserva no es válida: corrígela antes de crear la reserva.')
      // Dedupe pasaporte → email → nombre (y marca is_client en la existente).
      const nm = (s?: string | null) => (s ?? '').trim().toLowerCase()
      let person = persons.find(
        (p) =>
          (g.passport && nm(p.passport) === nm(g.passport)) ||
          (g.email && nm(p.email) === nm(g.email)) ||
          nm(p.fullName) === nm(g.fullName)
      )
      if (person) person.isClient = true
      else {
        person = { id: ++nextId, fullName: g.fullName, nickname: null, isClient: true, isProfessor: false, isSupplier: false, passport: g.passport ?? null, email: g.email ?? null, country: g.country ?? null, birthDate: g.birthDate ?? null, birthDateRaw: null, checkIn: null, checkOut: null, takingCourse: false, discountPct: 0, paid: 0, stillHere: true, comment: 'Registrado desde Google Forms', photoPath: null, photoThumbPath: null }
        persons.push(person)
      }
      r.importedPersonId = person.id
      if (kind === 'reservation') {
        // Mapea al catálogo como el backend: servicio no-clase => serviceId; si no, clase de curso.
        const svc = g.service ? services.find((s) => s.name.toLowerCase() === g.service!.toLowerCase()) : null
        const t = mkTxRow(++nextId, {
          txDate: g.date, startMin: g.startMin, endMin: null,
          serviceId: svc && !svc.isClass ? svc.id : null, isClass: svc ? svc.isClass : true, txType: 'class',
          clientId: person.id, professorId: null, kiteId: null, boardId: null, priceOverride: null,
          comment: ['Reserva de Google Forms', g.service && !svc ? `(${g.service})` : null].filter(Boolean).join(' · ')
        })
        transactions.push(t as any)
        r.importedTxId = t.id
      }
      r.status = 'imported'
      return { ...r }
    },
    ignore: async (responseId) => {
      const r = formResponses.find((x) => x.id === responseId)
      if (!r) throw new Error('Respuesta no encontrada')
      if (r.status === 'new') r.status = 'ignored'
      return { ...r }
    }
  },
  files: {
    list: async () => demoFiles.map((f) => ({ ...f })),
    add: async () => {
      throw new Error('En el demo no se pueden añadir archivos. En la app real se abre el selector del equipo.')
    },
    remove: async (name) => {
      const i = demoFiles.findIndex((f) => f.name === name)
      if (i >= 0) demoFiles.splice(i, 1)
      return demoFiles.map((f) => ({ ...f }))
    },
    open: async () => {
      throw new Error('En el demo no hay Excel instalado. En la app real el archivo se abre con Excel/Numbers.')
    },
    read: async (name) => {
      const f = demoFiles.find((x) => x.name === name)
      if (!f) throw new Error('Archivo no encontrado')
      return { fileName: name, sheets: demoSheets[name].map((s) => ({ name: s, rows: demoSheetRows(s), truncated: false })) }
    }
  },
  backup: { create: notAvailable, list: async () => [] },
  exports: { balance: notAvailable, monthSummary: notAvailable, openFolder: async () => undefined }
}

// ---- pestaña "Archivos" (demo): nombres reales de archivos/hojas, celdas de EJEMPLO ----
const demoFiles = [
  { name: 'Archivos KITE ADDICT.xlsx', size: 237142, mtime: '2025-11-02T10:00:00.000Z', ext: 'xlsx' },
  { name: 'Precios_Kite Addict Colombia 2025.xlsx', size: 252608, mtime: '2025-11-02T10:00:00.000Z', ext: 'xlsx' }
]
const demoSheets: Record<string, string[]> = {
  'Archivos KITE ADDICT.xlsx': ['In & Out', 'Yoga', 'Oswaldo Prestamo', 'Pendiente Estudiante', 'To Does', 'UTRIPER Infos', 'Cosas que falten en la escuela', 'Precios & Inventario Shop'],
  'Precios_Kite Addict Colombia 2025.xlsx': ['Kite + Alquiler', 'Downwind & Kite Caddy', 'Wing Foil + Wing Skate + Alquil', 'Windsurf', 'Towing', 'SUP', 'Umrechnung', 'clases kite', 'ClasesKite2023 2024', 'Tabelle1', 'rental']
}
function demoSheetRows(sheet: string): string[][] {
  // Datos inventados para el demo (los reales solo viven en la app instalada)
  return [
    ['Concepto', 'Detalle', 'Valor'],
    [`${sheet} — ejemplo 1`, 'Dato de muestra', '$ 150.000'],
    [`${sheet} — ejemplo 2`, 'Dato de muestra', '$ 90.000'],
    ['(demo)', 'El contenido real se ve en la app instalada', '—']
  ]
}

// ---- helpers de cálculo ----
/** Costo unitario: null si no hay precio de caja (igual que services/bar.ts unitCost). */
function mockUnitCost(boxPrice: number | null | undefined, unitsPerBox: number | null | undefined): number | null {
  if (boxPrice == null || !unitsPerBox) return null
  return roundCOP(boxPrice / unitsPerBox)
}

function stockOf(p: { id: number; name: string }): number {
  const purchased = expenses.filter((e) => e.supplyName === p.name).reduce((a, b) => a + (b.count || 0), 0)
  const sold = barSales.filter((s) => s.productId === p.id).reduce((a, b) => a + (b.qty || 0), 0)
  return purchased - sold
}

/** Minutos desde medianoche de la hora local actual (entrada/salida "ahora"). */
function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** Detecta el nivel de curso del cliente por horas de clase acumuladas (como en la app real). */
function detectCourseId(clientId: number | null, asOf?: string, excludeId?: number): number | null {
  const ladder = services.filter((s) => s.isClass).sort((a, b) => a.hours - b.hours)
  if (!ladder.length) return null
  let hours = 0
  transactions
    .filter((t) => t.clientId === clientId && t.isClass && t.id !== excludeId && (!asOf || t.txDate <= asOf))
    .forEach((t) => (hours += (t.durationMin ?? 0) / 60))
  let reached = ladder[0]
  for (const c of ladder) if (c.hours <= hours) reached = c
  return reached.id
}

/** Cálculo del precio/salario/nivel de una clase o servicio, sin guardar. */
function computeTx(input: any, excludeId?: number) {
  const open = input.endMin == null
  const durationMin = !open && input.startMin != null ? input.endMin - input.startMin : null
  const resolvedServiceId = input.isClass ? detectCourseId(input.clientId, input.txDate, excludeId) : input.serviceId ?? null
  const svc = services.find((s) => s.id === resolvedServiceId)
  const client = persons.find((p) => p.id === input.clientId)
  let price = input.priceOverride ?? null
  // Invariante entrada/salida: sesión abierta => sin precio automático (ni "por día");
  // el precio se calcula al registrar la salida.
  if (price == null && svc && !open) {
    const factor = (100 - (client?.discountPct ?? 0)) / 100
    if (svc.days > 0) price = roundCOP((factor * svc.price) / svc.days)
    else if (durationMin != null && svc.hours) price = roundCOP(factor * (durationMin / 60 / svc.hours) * svc.price)
  }
  const salary = input.professorId != null && svc && price != null ? roundCOP(price * svc.professorPct) : 0
  return {
    resolvedServiceId,
    serviceName: svc?.name ?? null,
    isClass: !!input.isClass,
    courseDetected: input.isClass ? svc?.name ?? null : null,
    durationMin,
    priceEffective: price,
    professorSalary: salary
  }
}

/** Construye una fila Transaction completa (para create/update/checkout del demo). */
function mkTxRow(id: number, input: any, excludeId?: number, prevCheckInAt?: string | null) {
  const c = computeTx(input, excludeId)
  const open = input.endMin == null
  return {
    id, txDate: input.txDate, startMin: input.startMin, endMin: input.endMin ?? null,
    serviceRaw: c.serviceName, serviceId: input.serviceId ?? null, isClass: !!input.isClass,
    txType: input.txType ?? (input.isClass ? 'class' : 'service'),
    resolvedServiceId: c.resolvedServiceId, professorId: input.professorId ?? null, clientId: input.clientId ?? null,
    kiteId: input.kiteId ?? null, boardId: input.boardId ?? null, priceSnapshot: c.priceEffective,
    professorPctSnapshot: input.professorId != null ? services.find((s) => s.id === c.resolvedServiceId)?.professorPct ?? null : null,
    priceOverride: input.priceOverride ?? null,
    // check_in_at se fija al crear la entrada y se PRESERVA en updates/checkout (como el backend).
    checkInAt: excludeId != null ? prevCheckInAt ?? null : open ? new Date().toISOString() : null,
    comment: input.comment ?? null, priceEffective: c.priceEffective, durationMin: c.durationMin,
    professorSalary: c.professorSalary, isOpen: open
  }
}

function isProfessor(id: number | null): boolean {
  return !!persons.find((p) => p.id === id)?.isProfessor
}
function professorsWithSalary(prefix: string) {
  const map = new Map<number, number>()
  transactions.filter((t) => monthOf(t.txDate) === prefix && t.professorId).forEach((t) => {
    map.set(t.professorId!, (map.get(t.professorId!) || 0) + (t.professorSalary ?? 0))
  })
  return [...map.entries()].map(([professorId, amount]) => ({ professorId, name: persons.find((p) => p.id === professorId)?.fullName ?? '', amount })).sort((a, b) => b.amount - a.amount)
}
function outstanding(p: { principal: number; installments: { amount: number }[] }): number {
  return p.principal - p.installments.reduce((a, b) => a + b.amount, 0)
}
function buildBill(clientId: number, opts: any) {
  const client = persons.find((p) => p.id === clientId)!
  // Excluir sesiones abiertas (sin salida): aún no tienen precio.
  const txs = transactions.filter((t) => t.clientId === clientId && t.endMin != null)
  const sales = barSales.filter((s) => s.clientId === clientId)
  const items = [
    ...txs.map((t) => {
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const horario = t.startMin != null && t.endMin != null ? `, ${hhmm(t.startMin)}–${hhmm(t.endMin)}` : ''
      return { kind: 'service' as const, transactionId: t.id, description: `${t.serviceRaw ?? 'Servicio'} (${t.txDate}${horario})`, qty: 1, unitPrice: t.priceEffective ?? 0, lineTotal: t.priceEffective ?? 0 }
    }),
    ...sales.map((s) => ({ kind: 'bar' as const, barSaleId: s.id, description: `Bar: ${s.productRaw} x${s.qty} (${s.saleDate})`, qty: s.qty, unitPrice: s.qty ? Math.round(s.total / s.qty) : s.total, lineTotal: s.total }))
  ]
  const sumServices = txs.reduce((a, b) => a + (b.priceEffective ?? 0), 0)
  const subtotal = sumServices === 0 ? 0 : roundCOP((sumServices * (100 - (opts.discountPct || 0))) / 100 - (opts.deduction || 0))
  const barTotal = sales.reduce((a, b) => a + b.total, 0)
  const lodging = roundCOP((opts.lodgingDays || 0) * (opts.lodgingRate || 0))
  const total = subtotal + lodging + barTotal
  const alreadyPaid = opts.alreadyPaid ?? client.paid ?? 0
  const netToPay = total - alreadyPaid
  const cardTotal = opts.cardSurcharge ? roundCOP(netToPay * 1.05) : netToPay
  return { clientId, clientName: client.fullName, items, result: { sumServices, subtotal, lodging, barTotal, total, alreadyPaid, netToPay, cardTotal }, options: opts }
}
function buildSettlement(professorId: number, year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const prof = persons.find((p) => p.id === professorId)!
  const rows = transactions.filter((t) => t.professorId === professorId && monthOf(t.txDate) === prefix)
  const salaryRows = rows.map((t) => ({ date: t.txDate, service: t.serviceRaw, client: persons.find((p) => p.id === t.clientId)?.fullName ?? null, salary: t.professorSalary ?? 0 }))
  const gross = salaryRows.reduce((a, b) => a + b.salary, 0)
  return { professorId, professorName: prof.fullName, year, month, salaryRows, outcomeRows: [], result: { gross, barDiscount: 0, expenses: 0, installments: 0, net: gross }, savedStatus: settlementStatus.get(`${professorId}-${prefix}`) ?? null }
}
