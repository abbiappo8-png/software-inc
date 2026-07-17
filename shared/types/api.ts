/** Contrato de la API expuesta por el preload al renderer (window.api). */
import type {
  Person,
  PersonInput,
  ServiceCatalogItem,
  Equipment,
  Transaction,
  BarProduct,
  BarSale,
  Expense,
  ClientBill,
  ProfessorSettlement,
  SettlementPayment,
  DailyCashflowRow,
  MonthSummary,
  AgeBucket,
  PaymentPlan,
  TxPreview,
  ImportReport,
  FormConfig,
  FormResponse,
  FormGuess,
  FormSyncResult,
  StoredFile,
  WorkbookData
} from './domain'

/** Datos para crear/editar un producto del bar (el stock y costo se calculan aparte). */
export type BarProductInput = Pick<BarProduct, 'name' | 'boxPrice' | 'unitsPerBox' | 'sellPrice'> & {
  active?: boolean
}

export interface AppStatus {
  hasPin: boolean
  needsImport: boolean
  schemaVersion: number
  userDataPath: string
}

export interface AppApi {
  auth: {
    status(): Promise<AppStatus>
    hasPin(): Promise<boolean>
    setPin(pin: string): Promise<{ ok: boolean }>
    verify(pin: string): Promise<{ ok: boolean; lockedForMs?: number; remainingAttempts?: number }>
    change(current: string, next: string): Promise<{ ok: boolean }>
  }
  import: {
    pickFile(): Promise<string | null>
    run(path: string): Promise<ImportReport>
  }
  persons: {
    list(filter?: {
      role?: 'client' | 'professor' | 'supplier'
      search?: string
      onlyActive?: boolean
      limit?: number
      offset?: number
    }): Promise<Person[]>
    count(filter?: { role?: 'client' | 'professor' | 'supplier'; search?: string; onlyActive?: boolean }): Promise<number>
    get(id: number): Promise<Person | null>
    create(input: PersonInput): Promise<Person>
    update(id: number, input: PersonInput): Promise<Person>
    remove(id: number): Promise<void>
    setPhoto(id: number, dataBase64: string): Promise<{ photoPath: string; photoThumbPath: string }>
    photoDataUrl(id: number): Promise<string | null>
  }
  catalog: {
    listServices(onlyActive?: boolean): Promise<ServiceCatalogItem[]>
    createService(s: Omit<ServiceCatalogItem, 'id'>): Promise<ServiceCatalogItem>
    updateService(id: number, s: Omit<ServiceCatalogItem, 'id'>): Promise<ServiceCatalogItem>
    listEquipment(onlyActive?: boolean): Promise<Equipment[]>
    createEquipment(e: Omit<Equipment, 'id'>): Promise<Equipment>
    updateEquipment(id: number, e: Omit<Equipment, 'id'>): Promise<Equipment>
  }
  transactions: {
    list(filter?: { clientId?: number; professorId?: number; from?: string; to?: string; limit?: number; offset?: number }): Promise<Transaction[]>
    /** Calcula precio/salario/nivel sin guardar (para mostrarlos en vivo en el formulario). */
    preview(input: any): Promise<TxPreview>
    create(input: any): Promise<Transaction>
    /** Edita una transacción existente recalculando precio/salario/nivel. */
    update(id: number, input: any): Promise<Transaction>
    /** Cierra una sesión abierta fijando la hora de fin (por defecto, la hora actual). */
    checkout(id: number, endMin?: number | null): Promise<Transaction>
    remove(id: number): Promise<void>
  }
  bar: {
    listProducts(): Promise<BarProduct[]>
    createProduct(input: BarProductInput): Promise<BarProduct>
    updateProduct(id: number, input: BarProductInput): Promise<BarProduct>
    /** Registra una compra/entrada de stock (crea un gasto ligado al producto). */
    restock(input: { productId: number; date: string; units: number; amount: number; comment?: string | null }): Promise<BarProduct>
    createSale(input: any): Promise<BarSale>
    listSales(from?: string, to?: string): Promise<BarSale[]>
  }
  expenses: {
    list(from?: string, to?: string): Promise<Expense[]>
    create(input: any): Promise<Expense>
    update(id: number, input: any): Promise<Expense>
    remove(id: number): Promise<void>
  }
  bills: {
    preview(clientId: number, opts?: any): Promise<any>
    save(clientId: number, opts?: any): Promise<ClientBill>
    /** Registra el pago de la factura: el saldo del cliente queda en 0. */
    markPaid(billId: number): Promise<ClientBill>
    pdf(billId: number): Promise<string>
    email(billId: number): Promise<{ ok: boolean; error?: string }>
  }
  settlements: {
    preview(professorId: number, year: number, month: number): Promise<any>
    save(professorId: number, year: number, month: number): Promise<ProfessorSettlement>
    /** Marca la liquidación del periodo como pagada (el saldo del profesor queda saldado). */
    markPaid(professorId: number, year: number, month: number): Promise<ProfessorSettlement>
    pdf(professorId: number, year: number, month: number): Promise<string>
    /** Abonos (pagos parciales) del periodo, ordenados por fecha. */
    listPayments(professorId: number, year: number, month: number): Promise<SettlementPayment[]>
    /**
     * Registra un abono: crea también el gasto correspondiente (dinero que sale de caja)
     * y, si los abonos completan el neto, la liquidación queda PAGADA automáticamente.
     */
    addPayment(input: {
      professorId: number
      year: number
      month: number
      payDate: string
      amount: number
      comment?: string | null
    }): Promise<SettlementPayment>
    /** Elimina un abono y su gasto enlazado, recalculando el estado de la liquidación. */
    removePayment(id: number): Promise<void>
  }
  finance: {
    dailyCashflow(from?: string, to?: string): Promise<{ rows: DailyCashflowRow[]; totals: { in: number; out: number; net: number } }>
    monthSummary(year: number, month: number): Promise<MonthSummary>
    ageStats(): Promise<AgeBucket[]>
    yearBalance(): Promise<{ year: number; in: number; out: number }[]>
    dashboard(): Promise<Record<string, number>>
  }
  plans: {
    list(): Promise<(PaymentPlan & { outstanding: number })[]>
    get(id: number): Promise<(PaymentPlan & { outstanding: number }) | null>
    create(title: string, personId: number | null, principal: number, startDate: string | null): Promise<PaymentPlan & { outstanding: number }>
    addInstallment(planId: number, paidDate: string, amount: number, comment: string | null): Promise<PaymentPlan & { outstanding: number }>
  }
  settings: {
    getCompany(): Promise<any>
    setCompany(cfg: any): Promise<void>
    getSmtp(): Promise<{ host: string; port: number; user: string; from: string; hasPassword: boolean }>
    setSmtp(cfg: { host: string; port: number; user: string; from: string; password?: string }): Promise<void>
    testSmtp(): Promise<{ ok: boolean; error?: string }>
    setBarDiscount(pct: number): Promise<void>
    getBarDiscount(): Promise<number>
  }
  forms: {
    /** Formularios de Google configurados (Ajustes). */
    list(): Promise<FormConfig[]>
    saveConfig(forms: FormConfig[]): Promise<void>
    /** Baja el CSV publicado y guarda las respuestas nuevas (dedupe por hash). */
    sync(formKey: string): Promise<FormSyncResult>
    /** Respuestas guardadas de un formulario (con campos pre-adivinados). */
    responses(formKey: string, status?: 'new' | 'imported' | 'ignored'): Promise<(FormResponse & { guess: FormGuess })[]>
    /** Convierte una respuesta en cliente o en reserva (transacción abierta). */
    convert(responseId: number, kind: 'client' | 'reservation', edited?: Partial<FormGuess>): Promise<FormResponse>
    ignore(responseId: number): Promise<FormResponse>
  }
  files: {
    /** Archivos guardados en la biblioteca de la app (pestaña "Archivos"). */
    list(): Promise<StoredFile[]>
    /** Abre el selector, copia los elegidos a la biblioteca y devuelve la lista. */
    add(): Promise<StoredFile[]>
    remove(name: string): Promise<StoredFile[]>
    /** Abre el archivo con la aplicación del sistema (Excel/Numbers…). */
    open(name: string): Promise<void>
    /** Lee un .xlsx para el visor interno (hojas como texto, recortadas al límite del visor). */
    read(name: string): Promise<WorkbookData>
  }
  backup: {
    create(): Promise<string>
    list(): Promise<{ file: string; size: number; mtime: string }[]>
  }
  exports: {
    balance(from?: string, to?: string): Promise<string>
    monthSummary(year: number, month: number): Promise<string>
    openFolder(): Promise<void>
  }
}
