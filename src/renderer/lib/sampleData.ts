/**
 * Datos de ejemplo para el MODO DEMO (navegador, sin Electron/SQLite).
 * Representativos pero ficticios: ninguna relación con datos reales de clientes.
 */
import type {
  Person,
  ServiceCatalogItem,
  Equipment,
  Transaction,
  BarProduct,
  BarSale,
  Expense,
  PaymentPlan
} from '@shared/types/domain'

export const persons: Person[] = [
  mkPerson(1, 'Ana Restrepo', { isClient: true, country: 'Colombia', email: 'ana@example.com', birthDate: '1994-05-12', checkIn: '2026-06-01', checkOut: '2026-06-10', discountPct: 10 }),
  mkPerson(2, 'Boris Heger', { isClient: true, country: 'Francia', email: 'boris@example.com', birthDate: '1988-11-03', checkIn: '2026-06-15', checkOut: '2026-06-25' }),
  mkPerson(3, 'Carla Núñez', { isClient: true, country: 'Argentina', email: 'carla@example.com', birthDate: '2000-02-20', checkIn: '2026-07-01', checkOut: '2026-07-05', discountPct: 5 }),
  mkPerson(4, 'Diego Salazar', { isClient: true, country: 'Colombia', birthDate: '1979-09-09' }),
  mkPerson(5, 'Ozuna', { isProfessor: true, nickname: 'Ozuna' }),
  mkPerson(6, 'Pato Gómez', { isProfessor: true, nickname: 'Pato' }),
  mkPerson(7, 'Distribuidora del Mar', { isSupplier: true }),
  mkPerson(8, 'Elena Ríos', { isClient: true, country: 'Chile', email: 'elena@example.com', birthDate: '1996-12-01', checkIn: '2026-07-10', checkOut: '2026-07-14' })
]

export const services: ServiceCatalogItem[] = [
  svc(1, '1h clase privada Kite 2026', 1, 0, 280000, 0.2143, true, 'kite'),
  svc(2, '4h curso privado Kite 2026', 4, 0, 1052000, 0.2281, true, 'kite'),
  svc(3, '8h curso privado Kite 2026', 8, 0, 2060000, 0.233, true, 'kite'),
  svc(4, '1h clase grupal Kite 2026', 1, 0, 390000, 0.2051, false, 'kite'),
  svc(5, '1h clase Wing Foil 2026', 1, 0, 300000, 0.22, false, 'wing'),
  svc(6, '1 día Alquiler Equipo Completo', 0, 1, 180000, 0.1, false, 'kite')
]

export const equipment: Equipment[] = [
  { id: 1, name: 'Bandit 9 - 2026', category: 'kite', count: 2, price: 4000000, active: true },
  { id: 2, name: 'Dice 6', category: 'kite', count: 1, price: 3800000, active: true },
  { id: 3, name: 'Tabla North 138', category: 'board', count: 3, price: 1800000, active: true }
]

// Transacciones: minutos desde medianoche (480 = 08:00)
export const transactions: Transaction[] = [
  tx(1, '2026-07-01', 480, 540, 4, 5, 1, false),
  tx(2, '2026-07-01', 600, 660, 1, 5, 2, false),
  tx(3, '2026-07-02', 480, 720, 2, 6, 1, false),
  tx(4, '2026-07-02', 540, 600, 5, 6, 3, false),
  tx(5, '2026-07-03', 480, 540, 4, 5, 8, false),
  tx(6, '2026-07-03', 900, 960, 1, 6, 2, false),
  tx(7, '2026-07-04', 480, 600, 5, 5, 1, false),
  tx(8, '2026-07-05', 480, 720, 2, 6, 8, false),
  tx(9, '2026-07-06', 600, 660, 4, 5, 3, false),
  tx(10, '2026-07-06', 660, 720, 1, 6, 2, false),
  tx(11, '2026-07-08', 480, 540, 4, 5, 1, false),
  tx(12, '2026-07-08', 540, 660, 5, 6, 4, false),
  // Préstamo de equipo (alquiler por día)
  tx(13, '2026-07-09', 540, 900, 6, null, 3, false, 'loan'),
  // Sesión ABIERTA (entrada sin salida) — pendiente de check-out
  tx(14, '2026-07-14', 600, null, 1, 5, 8, false)
]

export const barProducts: BarProduct[] = [
  bp(1, 'Agua', 18000, 15, 5000),
  bp(2, 'Gatorade', 50000, 24, 9000),
  bp(3, 'Cerveza', 60000, 30, 8000),
  bp(4, 'Snack', 24000, 12, 4000)
]

export const barSales: BarSale[] = [
  { id: 1, saleDate: '2026-07-01', clientId: 1, clientRaw: null, productId: 1, productRaw: 'Agua', qty: 2, total: 10000, paidCash: true, alreadyPaid: true },
  { id: 2, saleDate: '2026-07-02', clientId: 2, clientRaw: null, productId: 3, productRaw: 'Cerveza', qty: 3, total: 24000, paidCash: false, alreadyPaid: false },
  { id: 3, saleDate: '2026-07-03', clientId: 8, clientRaw: null, productId: 2, productRaw: 'Gatorade', qty: 1, total: 9000, paidCash: true, alreadyPaid: true }
]

export const expenses: Expense[] = [
  exp(1, '2026-07-01', 'Agua', 5, null, 7, 60000, 'Compra de agua para el bar'),
  exp(2, '2026-07-02', 'Gasolina lancha', 1, 5, null, 120000, 'Combustible'),
  exp(3, '2026-07-03', 'Cerveza', 3, null, 7, 180000, 'Reposición bar'),
  exp(4, '2026-07-05', 'Mantenimiento', 1, null, null, 300000, 'Reparación equipo')
]

export const paymentPlans: (PaymentPlan & { installments: any[] })[] = [
  {
    id: 1,
    title: 'Cometa Switch Blade 10',
    personId: 5,
    equipmentId: null,
    principal: 4028000,
    startDate: '2026-05-01',
    status: 'active',
    installments: [
      { id: 1, planId: 1, paidDate: '2026-05-15', amount: 412667, comment: null },
      { id: 2, planId: 1, paidDate: '2026-06-15', amount: 585833, comment: null },
      { id: 3, planId: 1, paidDate: '2026-07-01', amount: 555000, comment: null }
    ]
  }
]

// ---- helpers ----
function mkPerson(id: number, fullName: string, extra: Partial<Person>): Person {
  return {
    id, fullName, nickname: null, isClient: false, isProfessor: false, isSupplier: false,
    passport: null, email: null, country: null, birthDate: null, birthDateRaw: null,
    checkIn: null, checkOut: null, takingCourse: false, discountPct: 0, paid: 0,
    stillHere: true, comment: null, photoPath: null, photoThumbPath: null, ...extra
  }
}
function svc(id: number, name: string, hours: number, days: number, price: number, professorPct: number, isClass: boolean, discipline: string): ServiceCatalogItem {
  return { id, name, discipline, seasonYear: 2026, hours, days, price, professorPct, isClass, active: true }
}
function tx(id: number, txDate: string, startMin: number, endMin: number | null, serviceId: number, professorId: number | null, clientId: number, isClass: boolean, txType: 'class' | 'loan' | 'service' | 'other' = isClass ? 'class' : 'service'): Transaction {
  const svcItem = services.find((s) => s.id === serviceId)!
  const client = persons.find((p) => p.id === clientId)!
  const open = endMin == null
  const durationMin = open ? null : endMin - startMin
  const factor = (100 - (client.discountPct || 0)) / 100
  const price = open
    ? null
    : svcItem.days > 0
      ? Math.round(factor * svcItem.price / svcItem.days)
      : Math.round(factor * ((durationMin as number) / 60 / svcItem.hours) * svcItem.price)
  const salary = professorId != null && price != null ? Math.round(price * svcItem.professorPct) : 0
  return {
    id, txDate, startMin, endMin, serviceRaw: svcItem.name, serviceId, isClass, txType,
    resolvedServiceId: serviceId, professorId, clientId, kiteId: null, boardId: null,
    priceSnapshot: price, professorPctSnapshot: professorId != null ? svcItem.professorPct : null,
    priceOverride: null, checkInAt: open ? `${txDate}T10:00:00.000Z` : null, comment: null,
    priceEffective: price, durationMin, professorSalary: salary, isOpen: open
  }
}
function bp(id: number, name: string, boxPrice: number, unitsPerBox: number, sellPrice: number): BarProduct {
  return { id, name, boxPrice, unitsPerBox, sellPrice, active: true, unitCost: Math.round(boxPrice / unitsPerBox), stock: 0 }
}
function exp(id: number, expenseDate: string, supplyName: string, count: number, areaPersonId: number | null, supplierId: number | null, amountOut: number, comment: string): Expense {
  return { id, expenseDate, supplyName, count, areaName: null, areaPersonId, supplierId, supplierRaw: supplierId ? 'Distribuidora del Mar' : null, amountOut, comment }
}
