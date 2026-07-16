/**
 * Repositorio de transacciones/reservas (hoja Club) con integración del motor de
 * precios: al crear/editar, se calculan y CONGELAN el precio y el % del profesor
 * (snapshots) usando el catálogo y el curso detectado del cliente.
 *
 * Modelo entrada/salida: una fila con end_min NULL es una sesión ABIERTA (entrada
 * sin salida); las columnas generadas dan precio/duración NULL hasta el check-out.
 */
import { getDb } from '../db/connection'
import type { Transaction, TxPreview, TxType } from '@shared/types/domain'
import { autoPrice, professorSalary as calcProfessorSalary } from '../services/pricing'
import { detectCourseForClient } from '../services/courses'
import * as catalog from './catalogRepo'

function mapRow(r: any): Transaction {
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

export interface TransactionInput {
  txDate: string
  startMin: number | null
  endMin: number | null // null => sesión abierta
  serviceId: number | null // servicio elegido; null si es "Class"
  isClass: boolean
  txType?: TxType
  clientId: number | null
  professorId: number | null
  kiteId: number | null
  boardId: number | null
  priceOverride: number | null
  comment?: string | null
}

/** Minutos desde medianoche de la hora local actual (para "entrada/salida ahora"). */
function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function resolveTxType(input: TransactionInput): TxType {
  if (input.txType) return input.txType
  return input.isClass ? 'class' : 'service'
}

/**
 * Resuelve el servicio (si es "Class", detecta el curso del cliente) y calcula snapshots.
 * `excludeTxId` excluye una fila de las horas acumuladas del cliente (para que una
 * transacción no se cuente a sí misma al recalcularse en un update/checkout).
 */
function computeSnapshots(
  input: TransactionInput,
  excludeTxId?: number
): {
  resolvedServiceId: number | null
  priceSnapshot: number | null
  professorPct: number | null
  serviceRaw: string | null
} {
  let resolvedServiceId = input.serviceId
  if (input.isClass && input.clientId != null) {
    const sql =
      'SELECT is_class AS c, duration_min AS d, tx_date FROM transactions WHERE client_id=@client' +
      (excludeTxId != null ? ' AND id<>@exclude' : '')
    const clientTxs = getDb()
      .prepare(sql)
      .all({ client: input.clientId, exclude: excludeTxId ?? -1 })
      .map((r: any) => ({ chosenServiceIsClass: !!r.c, durationMin: r.d, txDate: r.tx_date }))
    const course = detectCourseForClient(clientTxs, catalog.courses(), input.txDate)
    resolvedServiceId = course?.id ?? null
  }
  const item = resolvedServiceId != null ? catalog.getService(resolvedServiceId) : null
  const client = input.clientId != null ? getDb().prepare('SELECT discount_pct FROM persons WHERE id=?').get(input.clientId) as { discount_pct: number } | undefined : undefined
  const durationMin = input.endMin != null && input.startMin != null ? input.endMin - input.startMin : null
  let priceSnapshot: number | null = null
  // Invariante entrada/salida: una sesión ABIERTA (sin hora de fin) no tiene precio
  // todavía — ni siquiera para servicios "por día". Se calcula al hacer la salida.
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
    // Sin profesor asignado no hay salario: dejamos el % en null para que la columna
    // generada professor_salary dé 0, igual que el precio en vivo (preview).
    professorPct: input.professorId != null ? item?.professorPct ?? null : null,
    serviceRaw: item?.name ?? null
  }
}

/**
 * Calcula, SIN GUARDAR, el precio efectivo, el salario del profesor y el nivel de
 * curso detectado — para mostrarlos en vivo antes de registrar.
 */
export function preview(input: TransactionInput): TxPreview {
  const snap = computeSnapshots(input)
  const durationMin =
    input.endMin != null && input.startMin != null ? input.endMin - input.startMin : null
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

export function create(input: TransactionInput): Transaction {
  const snap = computeSnapshots(input)
  const open = input.endMin == null
  const id = getDb()
    .prepare(
      `INSERT INTO transactions(tx_date,start_min,end_min,service_raw,service_id,is_class,tx_type,resolved_service_id,
        professor_id,client_id,kite_id,board_id,price_snapshot,professor_pct_snapshot,price_override,check_in_at,comment)
       VALUES(@date,@start,@end,@raw,@serviceId,@isClass,@txType,@resolved,@prof,@client,@kite,@board,@price,@pct,@override,@checkIn,@comment)`
    )
    .run({
      date: input.txDate, start: input.startMin, end: input.endMin, raw: snap.serviceRaw,
      serviceId: input.serviceId, isClass: input.isClass ? 1 : 0, txType: resolveTxType(input),
      resolved: snap.resolvedServiceId,
      prof: input.professorId, client: input.clientId, kite: input.kiteId, board: input.boardId,
      price: snap.priceSnapshot, pct: snap.professorPct, override: input.priceOverride,
      checkIn: open ? new Date().toISOString() : null,
      comment: input.comment ?? null
    }).lastInsertRowid as number
  return get(id)!
}

/** Edita una transacción existente recalculando snapshots (excluyéndola a sí misma). */
export function update(id: number, input: TransactionInput): Transaction {
  const snap = computeSnapshots(input, id)
  getDb()
    .prepare(
      `UPDATE transactions SET tx_date=@date, start_min=@start, end_min=@end, service_raw=@raw,
        service_id=@serviceId, is_class=@isClass, tx_type=@txType, resolved_service_id=@resolved,
        professor_id=@prof, client_id=@client, kite_id=@kite, board_id=@board,
        price_snapshot=@price, professor_pct_snapshot=@pct, price_override=@override, comment=@comment
       WHERE id=@id`
    )
    .run({
      id, date: input.txDate, start: input.startMin, end: input.endMin, raw: snap.serviceRaw,
      serviceId: input.serviceId, isClass: input.isClass ? 1 : 0, txType: resolveTxType(input),
      resolved: snap.resolvedServiceId,
      prof: input.professorId, client: input.clientId, kite: input.kiteId, board: input.boardId,
      price: snap.priceSnapshot, pct: snap.professorPct, override: input.priceOverride,
      comment: input.comment ?? null
    })
  return get(id)!
}

/** Cierra una sesión abierta: fija end_min (por defecto la hora actual) y recalcula. */
export function checkout(id: number, endMin?: number | null): Transaction {
  const existing = get(id)
  if (!existing) throw new Error('Transacción no encontrada')
  const end = endMin ?? nowMinutes()
  const input: TransactionInput = {
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
  }
  return update(id, input)
}

export function get(id: number): Transaction | null {
  const r = getDb().prepare('SELECT * FROM transactions WHERE id=?').get(id)
  return r ? mapRow(r) : null
}

export interface TxFilter {
  clientId?: number
  professorId?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export function list(filter: TxFilter = {}): Transaction[] {
  const where: string[] = []
  const p: any = {}
  if (filter.clientId) { where.push('client_id=@clientId'); p.clientId = filter.clientId }
  if (filter.professorId) { where.push('professor_id=@professorId'); p.professorId = filter.professorId }
  if (filter.from) { where.push('tx_date>=@from'); p.from = filter.from }
  if (filter.to) { where.push('tx_date<=@to'); p.to = filter.to }
  const sql =
    'SELECT * FROM transactions' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    // Abiertas primero (para el check-out), luego por fecha desc
    ' ORDER BY (end_min IS NULL) DESC, tx_date DESC, id DESC' +
    (filter.limit ? ` LIMIT ${Number(filter.limit)} OFFSET ${Number(filter.offset || 0)}` : '')
  return getDb().prepare(sql).all(p).map(mapRow)
}

export function remove(id: number): void {
  getDb().prepare('DELETE FROM transactions WHERE id=?').run(id)
}
