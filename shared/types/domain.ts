/**
 * Tipos de dominio compartidos entre el proceso main (Node) y el renderer (React).
 *
 * Convenciones (ver el plan de arquitectura):
 *  - Dinero: enteros de pesos colombianos (COP). Nunca decimales.
 *  - Fechas: string ISO `YYYY-MM-DD`.
 *  - Horas del día: enteros de minutos desde medianoche (0..1439).
 *  - Booleanos: se exponen como boolean en TS; en SQLite se guardan como 0/1.
 */

export type ISODate = string // 'YYYY-MM-DD'
export type COP = number // entero de pesos

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export interface Person {
  id: number
  fullName: string
  nickname: string | null
  isClient: boolean
  isProfessor: boolean
  isSupplier: boolean
  passport: string | null
  email: string | null
  country: string | null
  birthDate: ISODate | null
  birthDateRaw: string | null
  checkIn: ISODate | null
  checkOut: ISODate | null
  takingCourse: boolean
  discountPct: number // 0..100 (porcentaje, tal como en el Excel: Persons!J)
  paid: COP // monto ya pagado registrado (Persons!K)
  stillHere: boolean
  comment: string | null
  photoPath: string | null
  photoThumbPath: string | null
  createdAt?: string
  updatedAt?: string
}

export type PersonInput = Omit<
  Person,
  'id' | 'photoThumbPath' | 'createdAt' | 'updatedAt'
> & { id?: number }

// ---------------------------------------------------------------------------
// Catálogo de servicios y equipos
// ---------------------------------------------------------------------------

/** Modelo de pago del profesor, derivado del % del catálogo del Excel. */
export type ProfessorPayModel =
  | { type: 'PERCENT'; pct: number } // fracción 0..1 del precio
  | { type: 'FIXED_PER_HOUR'; rate: COP } // p.ej. 60000 por hora del catálogo
  | { type: 'FIXED_AMOUNT'; amount: COP } // p.ej. 15000 fijos

export interface ServiceCatalogItem {
  id: number
  name: string
  discipline: string | null // 'kite' | 'wing' | 'wake' | 'sup' | 'efoil' | null
  seasonYear: number | null
  hours: number // horas de referencia del catálogo (Club!P)
  days: number // días de referencia (Club!Q); >0 => servicio "por día"
  price: COP // precio de catálogo (Club!R)
  professorPct: number // fracción 0..1 (Club!S)
  isClass: boolean
  active: boolean
}

export interface Equipment {
  id: number
  name: string
  category: 'kite' | 'board' | 'efoil' | 'sup' | 'wing' | 'wake' | 'other'
  count: number
  price: COP | null
  active: boolean
}

// ---------------------------------------------------------------------------
// Transacciones / reservas (hoja Club)
// ---------------------------------------------------------------------------

/** Tipo de transacción (etiqueta visible). 'loan' = préstamo/alquiler de equipo. */
export type TxType = 'class' | 'loan' | 'service' | 'other'

export interface Transaction {
  id: number
  txDate: ISODate
  startMin: number | null
  endMin: number | null // NULL = sesión abierta (entrada sin salida)
  serviceRaw: string | null
  serviceId: number | null
  isClass: boolean
  txType: TxType
  resolvedServiceId: number | null
  professorId: number | null
  clientId: number | null
  kiteId: number | null
  boardId: number | null
  priceSnapshot: COP | null
  professorPctSnapshot: number | null
  priceOverride: COP | null
  checkInAt: string | null // timestamp ISO de la entrada
  comment: string | null
  // Campos calculados (columnas generadas en SQLite; solo lectura)
  priceEffective?: COP | null
  durationMin?: number | null
  professorSalary?: COP | null
  isOpen?: boolean // derivado: end_min IS NULL
}

/** Cálculo en vivo del precio de una clase/servicio antes de guardarla. */
export interface TxPreview {
  resolvedServiceId: number | null
  serviceName: string | null // nombre del servicio/nivel que se aplicará
  isClass: boolean
  courseDetected: string | null // si es clase de curso: el nivel detectado por horas del alumno
  durationMin: number | null
  priceEffective: COP | null // lo que se cargará a la cuenta del cliente
  professorSalary: COP | null
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export interface BarProduct {
  id: number
  name: string
  boxPrice: COP | null
  unitsPerBox: number | null
  sellPrice: COP | null
  active: boolean
  // calculado
  unitCost?: COP | null
  stock?: number
}

export interface BarSale {
  id: number
  saleDate: ISODate
  clientId: number | null
  clientRaw: string | null
  productId: number | null
  productRaw: string | null
  qty: number
  total: COP
  paidCash: boolean
  alreadyPaid: boolean
}

// ---------------------------------------------------------------------------
// Gastos (hoja Outcome)
// ---------------------------------------------------------------------------

export interface Expense {
  id: number
  expenseDate: ISODate
  supplyName: string | null
  count: number
  areaName: string | null
  areaPersonId: number | null
  supplierId: number | null
  supplierRaw: string | null
  amountOut: COP
  comment: string | null
  /** Batch de importación: si no es null, el gasto vino del Excel (sistema viejo). */
  importBatchId?: number | null
}

// ---------------------------------------------------------------------------
// Facturación de cliente
// ---------------------------------------------------------------------------

export interface ClientBillItem {
  id?: number
  billId?: number
  kind: 'service' | 'bar' | 'lodging' | 'deduction' | 'other'
  transactionId?: number | null
  barSaleId?: number | null
  description: string
  qty: number
  unitPrice: COP
  lineTotal: COP
}

export interface ClientBill {
  id: number
  clientId: number
  billDate: ISODate
  lodgingDays: number
  lodgingRate: COP
  discountPct: number // descuento a nivel factura (0..100)
  deductions: COP
  alreadyPaid: COP
  cardSurcharge: boolean
  subtotal: COP
  total: COP
  netToPay: COP
  status: 'draft' | 'issued' | 'paid' | 'void'
  pdfPath: string | null
  emailedAt: string | null
  notes: string | null
  items?: ClientBillItem[]
}

// ---------------------------------------------------------------------------
// Liquidación de profesor
// ---------------------------------------------------------------------------

export interface ProfessorSettlement {
  id: number
  professorId: number
  periodYear: number
  periodMonth: number // 1..12
  grossSalary: COP
  barDiscount: COP
  expensesAssigned: COP
  netAmount: COP
  status: 'draft' | 'issued' | 'paid'
  pdfPath: string | null
  emailedAt: string | null
}

/** Abono (pago parcial) de la liquidación mensual de un profesor. */
export interface SettlementPayment {
  id: number
  professorId: number
  periodYear: number
  periodMonth: number // 1..12
  payDate: ISODate
  amount: COP
  comment: string | null
  /** Gasto generado por el abono (dinero que sale de caja), para poder borrarlo junto. */
  expenseId: number | null
}

// ---------------------------------------------------------------------------
// Balance / Resumen / Estadísticas
// ---------------------------------------------------------------------------

export interface DailyCashflowRow {
  date: ISODate
  inClients: COP
  inBar: COP
  in: COP
  out: COP
  runningBalance: COP | null
}

export interface MonthSummary {
  year: number
  month: number
  incomeClients: COP
  expensesNonProfessor: COP
  professorSalaries: { professorId: number; name: string; amount: COP }[]
  totalCosts: COP
  net: COP
}

export interface AgeBucket {
  bucket: number // múltiplo de 5
  count: number
}

// ---------------------------------------------------------------------------
// Planes de pago / amortización
// ---------------------------------------------------------------------------

export interface PaymentPlan {
  id: number
  title: string
  personId: number | null
  equipmentId: number | null
  principal: COP
  startDate: ISODate | null
  status: 'active' | 'settled' | 'cancelled'
  installments?: PaymentPlanInstallment[]
}

export interface PaymentPlanInstallment {
  id: number
  planId: number
  paidDate: ISODate
  amount: COP
  comment: string | null
  balanceAfter?: COP // calculado
}

// ---------------------------------------------------------------------------
// Google Forms (página "Reservas Web")
// ---------------------------------------------------------------------------

/** Un formulario de Google conectado (config guardada en settings). */
export interface FormConfig {
  key: string // identificador estable (slug)
  name: string // nombre visible ("Reservas de clases")
  csvUrl: string // URL del CSV publicado de la hoja de respuestas
  formUrl: string // URL del formulario (para llenarlo embebido)
}

export type FormResponseStatus = 'new' | 'imported' | 'ignored'

/** Una respuesta del formulario sincronizada a la BD local. */
export interface FormResponse {
  id: number
  formKey: string
  rowHash: string
  submittedAt: string | null
  values: Record<string, string> // encabezado -> valor
  status: FormResponseStatus
  importedPersonId: number | null
  importedTxId: number | null
}

/** Campos pre-adivinados de una respuesta (por encabezados), editables antes de convertir. */
export interface FormGuess {
  fullName: string | null
  email: string | null
  passport: string | null
  country: string | null
  birthDate: string | null
  date: string | null // fecha de la reserva (ISO)
  startMin: number | null
  service: string | null
  comment: string | null
}

export interface FormSyncResult {
  formKey: string
  fetched: number // filas en la hoja
  added: number // respuestas nuevas guardadas
  error?: string
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

export interface ImportError {
  sheet: string
  sourceRow: number | null
  reason: string
  raw?: unknown
}

export interface ImportReport {
  batchId: number
  sourceFile: string
  counts: Record<string, number>
  rowsOk: number
  rowsError: number
  errors: ImportError[]
  durationMs: number
}

// ---------------------------------------------------------------------------
// Biblioteca de archivos (pestaña "Archivos")
// ---------------------------------------------------------------------------

/** Un archivo guardado en la biblioteca de la app (userData/files). */
export interface StoredFile {
  name: string
  /** Tamaño en bytes. */
  size: number
  /** Última modificación (ISO). */
  mtime: string
  /** Extensión en minúsculas, sin punto (xlsx, pdf, …). */
  ext: string
}

/** Una hoja de un Excel leída para el visor (solo lectura). */
export interface WorkbookSheet {
  name: string
  /** Celdas como texto visible, fila por fila. */
  rows: string[][]
  /** true si la hoja se recortó al límite de filas/columnas del visor. */
  truncated: boolean
}

/** Contenido de un Excel de la biblioteca para el visor. */
export interface WorkbookData {
  fileName: string
  sheets: WorkbookSheet[]
}

/** Config no sensible de la empresa/app (para la UI de Ajustes). */
export interface CompanyConfig {
  companyName: string
  companyNit: string
  cardSurchargePct: number
  currency: string
}
