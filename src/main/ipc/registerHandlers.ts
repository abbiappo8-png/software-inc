/**
 * Registro de handlers IPC. Cada canal delega en un repositorio/servicio.
 * Entradas validadas con Zod en las mutaciones sensibles.
 */
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { z } from 'zod'
import { getDb } from '../db/connection'
import { getPaths } from '../paths'
import * as auth from '../services/auth'
import * as persons from '../repositories/personsRepo'
import * as catalog from '../repositories/catalogRepo'
import * as txRepo from '../repositories/transactionsRepo'
import * as bar from '../repositories/barRepo'
import * as expenses from '../repositories/expensesRepo'
import * as bills from '../repositories/billsRepo'
import * as settlements from '../repositories/settlementsRepo'
import * as finance from '../repositories/financeRepo'
import * as plans from '../repositories/paymentPlansRepo'
import * as settings from '../repositories/settingsRepo'
import * as backup from '../services/backup'
import * as excelExport from '../services/excelExport'
import { importWorkbook } from '../services/importer'
import { savePersonPhoto, absolutePhotoPath } from '../services/photos'
import { renderHtmlToPdf } from '../services/pdf'
import { clientBillHtml, settlementHtml } from '@shared/templates/documents'
import { sendInvoiceEmail, verifySmtp } from '../services/email'
import { encryptSecret } from '../services/crypto'
import * as forms from '../services/formsSync'
import * as filesLib from '../services/filesLib'

const personInput = z.object({
  fullName: z.string().min(1),
  nickname: z.string().nullable().optional(),
  isClient: z.boolean(),
  isProfessor: z.boolean(),
  isSupplier: z.boolean(),
  passport: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  country: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  birthDateRaw: z.string().nullable().optional(),
  checkIn: z.string().nullable().optional(),
  checkOut: z.string().nullable().optional(),
  takingCourse: z.boolean().optional(),
  discountPct: z.number().min(0).max(100).optional(),
  paid: z.number().optional(),
  stillHere: z.boolean().optional(),
  comment: z.string().nullable().optional(),
  photoPath: z.string().nullable().optional()
})

const txInput = z.object({
  txDate: z.string().min(1),
  startMin: z.number().nullable(),
  endMin: z.number().nullable(),
  serviceId: z.number().nullable(),
  isClass: z.boolean(),
  txType: z.enum(['class', 'loan', 'service', 'other']).optional(),
  clientId: z.number().nullable(),
  professorId: z.number().nullable(),
  kiteId: z.number().nullable(),
  boardId: z.number().nullable(),
  priceOverride: z.number().nullable(),
  comment: z.string().nullable().optional()
})

const equipmentInput = z.object({
  name: z.string().min(1),
  category: z.enum(['kite', 'board', 'efoil', 'sup', 'wing', 'wake', 'other']),
  count: z.number().int().min(0).optional(),
  price: z.number().nullable().optional(),
  active: z.boolean().optional()
})

const barProductInput = z.object({
  name: z.string().min(1),
  boxPrice: z.number().nullable().optional(),
  unitsPerBox: z.number().nullable().optional(),
  sellPrice: z.number().nullable().optional(),
  active: z.boolean().optional()
})

const restockInput = z.object({
  productId: z.number(),
  date: z.string().min(1),
  units: z.number().positive(),
  amount: z.number().min(0),
  comment: z.string().nullable().optional()
})

export function registerHandlers(getMainWindow: () => BrowserWindow | null): void {
  const db = getDb()

  // ---- auth ----
  ipcMain.handle('auth:status', () => ({
    hasPin: auth.hasPin(db),
    needsImport: (db.prepare('SELECT COUNT(*) c FROM persons').get() as { c: number }).c === 0,
    schemaVersion: parseInt(settings.get('schema_version') ?? '0', 10),
    userDataPath: getPaths().root
  }))
  ipcMain.handle('auth:hasPin', () => auth.hasPin(db))
  ipcMain.handle('auth:setPin', (_e, pin: string) => {
    auth.setPin(db, z.string().min(4).parse(pin))
    return { ok: true }
  })
  ipcMain.handle('auth:verify', (_e, pin: string) => auth.verifyPin(db, String(pin)))
  ipcMain.handle('auth:change', (_e, cur: string, next: string) => auth.changePin(db, String(cur), z.string().min(4).parse(next)))

  // ---- import ----
  ipcMain.handle('import:pickFile', async () => {
    const res = await dialog.showOpenDialog(getMainWindow() ?? undefined!, {
      title: 'Selecciona el Excel a importar',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile']
    })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  ipcMain.handle('import:run', async (_e, path: string) => {
    await backup.createBackup().catch(() => null)
    return importWorkbook(db, String(path), { force: false })
  })

  // ---- persons ----
  ipcMain.handle('persons:list', (_e, filter) => persons.list(filter ?? {}))
  ipcMain.handle('persons:count', (_e, filter) => persons.count(filter ?? {}))
  ipcMain.handle('persons:get', (_e, id: number) => persons.get(Number(id)))
  ipcMain.handle('persons:create', (_e, input) => persons.create(personInput.parse(input) as any))
  ipcMain.handle('persons:update', (_e, id: number, input) => persons.update(Number(id), personInput.parse(input) as any))
  ipcMain.handle('persons:remove', (_e, id: number) => persons.remove(Number(id)))
  ipcMain.handle('persons:setPhoto', async (_e, id: number, dataBase64: string) => {
    const b64 = String(dataBase64).replace(/^data:image\/\w+;base64,/, '')
    return savePersonPhoto(Number(id), Buffer.from(b64, 'base64'))
  })
  ipcMain.handle('persons:photoDataUrl', (_e, id: number) => {
    const p = persons.get(Number(id))
    const abs = absolutePhotoPath(p?.photoThumbPath ?? p?.photoPath ?? null)
    if (!abs || !existsSync(abs)) return null
    return 'data:image/jpeg;base64,' + readFileSync(abs).toString('base64')
  })

  // ---- catalog ----
  ipcMain.handle('catalog:listServices', (_e, onlyActive?: boolean) => catalog.listServices(!!onlyActive))
  ipcMain.handle('catalog:createService', (_e, s) => catalog.createService(s))
  ipcMain.handle('catalog:updateService', (_e, id: number, s) => catalog.updateService(Number(id), s))
  ipcMain.handle('catalog:listEquipment', (_e, onlyActive?: boolean) => catalog.listEquipment(!!onlyActive))
  ipcMain.handle('catalog:createEquipment', (_e, input) => catalog.createEquipment(equipmentInput.parse(input) as any))
  ipcMain.handle('catalog:updateEquipment', (_e, id: number, input) => catalog.updateEquipment(Number(id), equipmentInput.parse(input) as any))

  // ---- transactions ----
  ipcMain.handle('tx:list', (_e, filter) => txRepo.list(filter ?? {}))
  ipcMain.handle('tx:preview', (_e, input) => txRepo.preview(txInput.parse(input)))
  ipcMain.handle('tx:create', (_e, input) => txRepo.create(txInput.parse(input)))
  ipcMain.handle('tx:update', (_e, id: number, input) => txRepo.update(Number(id), txInput.parse(input)))
  ipcMain.handle('tx:checkout', (_e, id: number, endMin?: number | null) =>
    txRepo.checkout(Number(id), endMin == null ? null : Number(endMin))
  )
  ipcMain.handle('tx:remove', (_e, id: number) => txRepo.remove(Number(id)))

  // ---- bar ----
  ipcMain.handle('bar:listProducts', () => bar.listProducts())
  ipcMain.handle('bar:createProduct', (_e, input) => bar.createProduct(barProductInput.parse(input) as any))
  ipcMain.handle('bar:updateProduct', (_e, id: number, input) => bar.updateProduct(Number(id), barProductInput.parse(input) as any))
  ipcMain.handle('bar:restock', (_e, input) => bar.restock(restockInput.parse(input)))
  ipcMain.handle('bar:createSale', (_e, input) => bar.createSale(input))
  ipcMain.handle('bar:listSales', (_e, from?: string, to?: string) => bar.listSales(from, to))

  // ---- expenses ----
  ipcMain.handle('expenses:list', (_e, from?: string, to?: string) => expenses.list(from, to))
  ipcMain.handle('expenses:create', (_e, input) => expenses.create(input))
  ipcMain.handle('expenses:update', (_e, id: number, input) => expenses.update(Number(id), input))
  ipcMain.handle('expenses:remove', (_e, id: number) => expenses.remove(Number(id)))

  // ---- bills ----
  ipcMain.handle('bills:preview', (_e, clientId: number, opts) => bills.previewClientBill(Number(clientId), opts ?? {}))
  ipcMain.handle('bills:save', (_e, clientId: number, opts) => bills.saveBill(Number(clientId), opts ?? {}))
  ipcMain.handle('bills:markPaid', (_e, billId: number) => bills.markPaid(Number(billId)))
  ipcMain.handle('bills:pdf', async (_e, billId: number) => {
    const bill = bills.get(Number(billId))
    if (!bill) throw new Error('Factura no encontrada')
    const client = persons.get(bill.clientId)!
    const html = clientBillHtml(bill, client, settings.getCompanyConfig())
    const path = await renderHtmlToPdf(html, `factura-${bill.id}.pdf`)
    bills.setPdfPath(bill.id, path)
    return path
  })
  ipcMain.handle('bills:email', async (_e, billId: number) => {
    const bill = bills.get(Number(billId))
    if (!bill) throw new Error('Factura no encontrada')
    const client = persons.get(bill.clientId)!
    if (!client.email) return { ok: false, error: 'El cliente no tiene email.' }
    let path = bill.pdfPath
    if (!path || !existsSync(path)) {
      const html = clientBillHtml(bill, client, settings.getCompanyConfig())
      path = await renderHtmlToPdf(html, `factura-${bill.id}.pdf`)
      bills.setPdfPath(bill.id, path)
    }
    const res = await sendInvoiceEmail(
      client.email,
      `Factura N.º ${bill.id} — ${settings.getCompanyConfig().companyName}`,
      `Hola ${client.fullName},\n\nAdjuntamos tu factura N.º ${bill.id}.\n\nGracias.`,
      path
    )
    if (res.ok) bills.markEmailed(bill.id)
    return res
  })

  // ---- settlements ----
  ipcMain.handle('settlements:preview', (_e, professorId: number, year: number, month: number) =>
    settlements.previewSettlement(Number(professorId), Number(year), Number(month))
  )
  ipcMain.handle('settlements:save', (_e, professorId: number, year: number, month: number) =>
    settlements.saveSettlement(Number(professorId), Number(year), Number(month))
  )
  ipcMain.handle('settlements:markPaid', (_e, professorId: number, year: number, month: number) =>
    settlements.markPaid(Number(professorId), Number(year), Number(month))
  )
  ipcMain.handle('settlements:pdf', async (_e, professorId: number, year: number, month: number) => {
    const preview = settlements.previewSettlement(Number(professorId), Number(year), Number(month))
    const html = settlementHtml(preview, settings.getCompanyConfig())
    return renderHtmlToPdf(html, `liquidacion-${professorId}-${year}-${month}.pdf`)
  })

  // ---- finance ----
  ipcMain.handle('finance:dailyCashflow', (_e, from?: string, to?: string) => finance.dailyCashflow(from, to))
  ipcMain.handle('finance:monthSummary', (_e, year: number, month: number) => finance.monthSummary(Number(year), Number(month)))
  ipcMain.handle('finance:ageStats', () => finance.ageStatistics())
  ipcMain.handle('finance:yearBalance', () => finance.yearBalance())
  ipcMain.handle('finance:dashboard', () => finance.dashboardTotals())

  // ---- payment plans ----
  ipcMain.handle('plans:list', () => plans.list())
  ipcMain.handle('plans:get', (_e, id: number) => plans.get(Number(id)))
  ipcMain.handle('plans:create', (_e, title: string, personId: number | null, principal: number, startDate: string | null) =>
    plans.create(String(title), personId ?? null, Number(principal), startDate ?? null)
  )
  ipcMain.handle('plans:addInstallment', (_e, planId: number, paidDate: string, amount: number, comment: string | null) =>
    plans.addInstallment(Number(planId), String(paidDate), Number(amount), comment ?? null)
  )

  // ---- settings ----
  ipcMain.handle('settings:getCompany', () => settings.getCompanyConfig())
  ipcMain.handle('settings:setCompany', (_e, cfg) => {
    settings.set('company_name', String(cfg.companyName ?? ''))
    settings.set('company_nit', String(cfg.companyNit ?? ''))
    settings.set('card_surcharge_pct', String(cfg.cardSurchargePct ?? 0.05))
  })
  ipcMain.handle('settings:getSmtp', () => ({
    host: settings.get('smtp_host') ?? '',
    port: parseInt(settings.get('smtp_port') ?? '587', 10),
    user: settings.get('smtp_user') ?? '',
    from: settings.get('smtp_from') ?? '',
    hasPassword: !!settings.get('smtp_pass')
  }))
  ipcMain.handle('settings:setSmtp', (_e, cfg) => {
    settings.set('smtp_host', String(cfg.host ?? ''))
    settings.set('smtp_port', String(cfg.port ?? 587))
    settings.set('smtp_user', String(cfg.user ?? ''))
    settings.set('smtp_from', String(cfg.from ?? cfg.user ?? ''))
    if (cfg.password) settings.set('smtp_pass', encryptSecret(String(cfg.password)))
  })
  ipcMain.handle('settings:testSmtp', () => verifySmtp())
  ipcMain.handle('settings:setBarDiscount', (_e, pct: number) => settings.set('bar_discount_pct', String(pct)))
  ipcMain.handle('settings:getBarDiscount', () => parseFloat(settings.get('bar_discount_pct') ?? '0'))

  // ---- Google Forms (Reservas Web) ----
  const formConfig = z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      csvUrl: z.string(),
      formUrl: z.string()
    })
  )
  const formGuessEdit = z
    .object({
      fullName: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      passport: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      birthDate: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      startMin: z.number().nullable().optional(),
      service: z.string().nullable().optional(),
      comment: z.string().nullable().optional()
    })
    .optional()
  ipcMain.handle('forms:list', () => forms.listForms())
  ipcMain.handle('forms:saveConfig', (_e, cfg) => forms.saveForms(formConfig.parse(cfg)))
  ipcMain.handle('forms:sync', (_e, formKey: string) => forms.sync(String(formKey)))
  ipcMain.handle('forms:responses', (_e, formKey: string, status?: string) =>
    forms.listResponses(String(formKey), status)
  )
  ipcMain.handle('forms:convert', (_e, responseId: number, kind: string, edited) =>
    forms.convert(
      Number(responseId),
      kind === 'reservation' ? 'reservation' : 'client',
      formGuessEdit.parse(edited),
      { createTransaction: (input) => txRepo.create(input) }
    )
  )
  ipcMain.handle('forms:ignore', (_e, responseId: number) => forms.ignore(Number(responseId)))

  // ---- backup ----
  ipcMain.handle('backup:create', () => backup.createBackup())
  ipcMain.handle('backup:list', () => backup.listBackups())

  // ---- exports ----
  ipcMain.handle('exports:balance', (_e, from?: string, to?: string) => excelExport.exportBalance(from, to))
  ipcMain.handle('exports:monthSummary', (_e, year: number, month: number) => excelExport.exportMonthSummary(Number(year), Number(month)))
  ipcMain.handle('exports:openFolder', () => shell.openPath(getPaths().exportsDir).then(() => undefined))

  // ---- biblioteca de archivos (pestaña "Archivos") ----
  const fileName = z.string().min(1)
  ipcMain.handle('files:list', () => filesLib.listFiles())
  ipcMain.handle('files:add', () => filesLib.addFiles(getMainWindow()))
  ipcMain.handle('files:remove', (_e, name: string) => filesLib.removeFile(fileName.parse(name)))
  ipcMain.handle('files:open', (_e, name: string) => filesLib.openExternal(fileName.parse(name)))
  ipcMain.handle('files:read', (_e, name: string) => filesLib.readWorkbook(fileName.parse(name)))
}
