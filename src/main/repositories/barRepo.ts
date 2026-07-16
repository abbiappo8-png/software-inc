/** Repositorio del bar: productos (inventario) y ventas (POS). */
import { getDb } from '../db/connection'
import type { BarProduct, BarSale } from '@shared/types/domain'
import { normalize } from '../services/text'
import { unitCost, saleTotal, canSell } from '../services/bar'

function mapProduct(r: any): BarProduct {
  const cost = unitCost(r.box_price, r.units_per_box)
  return {
    id: r.id,
    name: r.name,
    boxPrice: r.box_price,
    unitsPerBox: r.units_per_box,
    sellPrice: r.sell_price,
    active: !!r.active,
    unitCost: cost,
    stock: r.stock ?? 0
  }
}

/** Productos con stock calculado = comprado (Outcome, por nombre) - vendido. */
export function listProducts(): BarProduct[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*,
         (SELECT IFNULL(SUM(e.count),0) FROM expenses e WHERE e.supply_name=p.name)
         - (SELECT IFNULL(SUM(s.qty),0) FROM bar_sales s WHERE s.product_id=p.id) AS stock
       FROM bar_products p ORDER BY p.name COLLATE NOCASE`
    )
    .all()
  return rows.map(mapProduct)
}

export function getProduct(id: number): BarProduct | null {
  const r = getDb()
    .prepare(
      `SELECT p.*,
         (SELECT IFNULL(SUM(e.count),0) FROM expenses e WHERE e.supply_name=p.name)
         - (SELECT IFNULL(SUM(s.qty),0) FROM bar_sales s WHERE s.product_id=p.id) AS stock
       FROM bar_products p WHERE p.id=?`
    )
    .get(id)
  return r ? mapProduct(r) : null
}

export interface BarProductInput {
  name: string
  boxPrice: number | null
  unitsPerBox: number | null
  sellPrice: number | null
  active?: boolean
}

export function createProduct(input: BarProductInput): BarProduct {
  const id = getDb()
    .prepare(
      `INSERT INTO bar_products(name,name_normalized,box_price,units_per_box,sell_price,active)
       VALUES(@name,@norm,@box,@units,@sell,@active)`
    )
    .run({
      name: input.name, norm: normalize(input.name), box: input.boxPrice ?? null,
      units: input.unitsPerBox ?? null, sell: input.sellPrice ?? null,
      active: input.active === false ? 0 : 1
    }).lastInsertRowid as number
  return getProduct(id)!
}

export function updateProduct(id: number, input: BarProductInput): BarProduct {
  const before = getProduct(id)
  getDb()
    .prepare(
      `UPDATE bar_products SET name=@name, name_normalized=@norm, box_price=@box,
        units_per_box=@units, sell_price=@sell, active=@active WHERE id=@id`
    )
    .run({
      id, name: input.name, norm: normalize(input.name), box: input.boxPrice ?? null,
      units: input.unitsPerBox ?? null, sell: input.sellPrice ?? null,
      active: input.active === false ? 0 : 1
    })
  // El stock se deriva de expenses.supply_name = nombre del producto. Si el nombre
  // cambió, migramos el historial de compras para no huérfanar el stock.
  if (before && before.name !== input.name) {
    getDb()
      .prepare('UPDATE expenses SET supply_name=@new WHERE supply_name=@old')
      .run({ new: input.name, old: before.name })
  }
  return getProduct(id)!
}

export interface RestockInput {
  productId: number
  date: string
  units: number
  amount: number // costo total de la compra (COP)
  comment?: string | null
}

/**
 * Registra una entrada de stock como una compra (gasto). El stock se deriva de
 * Σ compras (expenses.count por nombre de producto) − Σ ventas, así que ingresar
 * inventario = registrar la compra con supply_name = nombre del producto.
 */
export function restock(input: RestockInput): BarProduct {
  const product = getProduct(input.productId)
  if (!product) throw new Error('Producto no encontrado')
  if (!(input.units > 0)) throw new Error('Las unidades deben ser mayores que cero')
  getDb()
    .prepare(
      `INSERT INTO expenses(expense_date,supply_name,count,amount_out,comment)
       VALUES(@date,@name,@units,@amount,@comment)`
    )
    .run({
      date: input.date, name: product.name, units: input.units,
      amount: Math.round(input.amount || 0),
      comment: input.comment ?? `Compra de inventario: ${product.name}`
    })
  return getProduct(input.productId)!
}

function stockOf(productId: number): number {
  const r = getDb()
    .prepare(
      `SELECT (SELECT IFNULL(SUM(e.count),0) FROM expenses e JOIN bar_products p ON p.name=e.supply_name WHERE p.id=@id)
            - (SELECT IFNULL(SUM(s.qty),0) FROM bar_sales s WHERE s.product_id=@id) AS stock`
    )
    .get({ id: productId }) as { stock: number }
  return r.stock ?? 0
}

export interface BarSaleInput {
  saleDate: string
  clientId: number | null
  productId: number
  qty: number
  paidCash: boolean
  alreadyPaid: boolean
}

/** Registra una venta validando stock. Lanza si no hay stock suficiente. */
export function createSale(input: BarSaleInput): BarSale {
  const product = getProduct(input.productId)
  if (!product) throw new Error('Producto no encontrado')
  const available = stockOf(input.productId)
  const check = canSell(available, input.qty)
  if (!check.ok) {
    throw new Error(
      check.reason === 'stock_insuficiente'
        ? `Stock insuficiente de ${product.name} (disponible: ${available})`
        : 'Cantidad inválida'
    )
  }
  const total = saleTotal(input.qty, product.sellPrice)
  const id = getDb()
    .prepare(
      `INSERT INTO bar_sales(sale_date,client_id,product_id,product_raw,qty,total,paid_cash,already_paid)
       VALUES(@date,@client,@product,@raw,@qty,@total,@cash,@paid)`
    )
    .run({
      date: input.saleDate, client: input.clientId, product: input.productId, raw: product.name,
      qty: input.qty, total, cash: input.paidCash ? 1 : 0, paid: input.alreadyPaid ? 1 : 0
    }).lastInsertRowid as number
  const r = getDb().prepare('SELECT * FROM bar_sales WHERE id=?').get(id) as any
  return {
    id: r.id, saleDate: r.sale_date, clientId: r.client_id, clientRaw: r.client_raw,
    productId: r.product_id, productRaw: r.product_raw, qty: r.qty, total: r.total,
    paidCash: !!r.paid_cash, alreadyPaid: !!r.already_paid
  }
}

export function listSales(from?: string, to?: string): BarSale[] {
  const where: string[] = []
  const p: any = {}
  if (from) { where.push('sale_date>=@from'); p.from = from }
  if (to) { where.push('sale_date<=@to'); p.to = to }
  const sql =
    'SELECT * FROM bar_sales' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY sale_date DESC, id DESC'
  return getDb().prepare(sql).all(p).map((r: any) => ({
    id: r.id, saleDate: r.sale_date, clientId: r.client_id, clientRaw: r.client_raw,
    productId: r.product_id, productRaw: r.product_raw, qty: r.qty, total: r.total,
    paidCash: !!r.paid_cash, alreadyPaid: !!r.already_paid
  }))
}
