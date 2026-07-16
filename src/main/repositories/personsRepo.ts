/** Repositorio de personas (clientes / profesores / proveedores). */
import { getDb } from '../db/connection'
import type { Person, PersonInput } from '@shared/types/domain'
import { normalize, cleanName, normalizeCountry } from '@shared/services/text'

function mapRow(r: any): Person {
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

export interface PersonFilter {
  role?: 'client' | 'professor' | 'supplier'
  search?: string
  onlyActive?: boolean
  limit?: number
  offset?: number
}

export function list(filter: PersonFilter = {}): Person[] {
  const where: string[] = []
  const params: any = {}
  if (filter.role === 'client') where.push('is_client=1')
  if (filter.role === 'professor') where.push('is_professor=1')
  if (filter.role === 'supplier') where.push('is_supplier=1')
  if (filter.onlyActive) where.push('still_here=1')
  if (filter.search) {
    where.push('(name_normalized LIKE @q OR IFNULL(nickname_normalized,\'\') LIKE @q OR IFNULL(email,\'\') LIKE @q OR IFNULL(passport,\'\') LIKE @q)')
    params.q = '%' + normalize(filter.search) + '%'
  }
  const sql =
    'SELECT * FROM persons' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC' + // último registro primero (los recién creados salen arriba)
    (filter.limit ? ` LIMIT ${Number(filter.limit)} OFFSET ${Number(filter.offset || 0)}` : '')
  return getDb().prepare(sql).all(params).map(mapRow)
}

export function count(filter: PersonFilter = {}): number {
  const where: string[] = []
  const params: any = {}
  if (filter.role === 'client') where.push('is_client=1')
  if (filter.role === 'professor') where.push('is_professor=1')
  if (filter.role === 'supplier') where.push('is_supplier=1')
  if (filter.onlyActive) where.push('still_here=1')
  if (filter.search) {
    where.push('(name_normalized LIKE @q OR IFNULL(email,\'\') LIKE @q)')
    params.q = '%' + normalize(filter.search) + '%'
  }
  const sql = 'SELECT COUNT(*) c FROM persons' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
  return (getDb().prepare(sql).get(params) as { c: number }).c
}

export function get(id: number): Person | null {
  const r = getDb().prepare('SELECT * FROM persons WHERE id=?').get(id)
  return r ? mapRow(r) : null
}

export function create(input: PersonInput): Person {
  const full = cleanName(input.fullName)
  const id = getDb()
    .prepare(
      `INSERT INTO persons(full_name,name_normalized,nickname,nickname_normalized,is_client,is_professor,is_supplier,
        passport,email,country,country_raw,birth_date,birth_date_raw,check_in,check_out,taking_course,
        discount_pct,paid,still_here,comment,photo_path,photo_thumb_path)
       VALUES(@full,@norm,@nick,@nickNorm,@isClient,@isProf,@isSup,@passport,@email,@country,@countryRaw,
        @birth,@birthRaw,@checkIn,@checkOut,@course,@discount,@paid,@still,@comment,@photo,@thumb)`
    )
    .run({
      full,
      norm: normalize(full),
      nick: input.nickname ? cleanName(input.nickname) : null,
      nickNorm: input.nickname ? normalize(input.nickname) : null,
      isClient: input.isClient ? 1 : 0,
      isProf: input.isProfessor ? 1 : 0,
      isSup: input.isSupplier ? 1 : 0,
      passport: input.passport ?? null,
      email: input.email ?? null,
      country: input.country ? normalizeCountry(input.country) : null,
      countryRaw: input.country ?? null,
      birth: input.birthDate ?? null,
      birthRaw: input.birthDateRaw ?? null,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
      course: input.takingCourse ? 1 : 0,
      discount: input.discountPct ?? 0,
      paid: input.paid ?? 0,
      still: input.stillHere === false ? 0 : 1,
      comment: input.comment ?? null,
      photo: input.photoPath ?? null,
      thumb: null
    }).lastInsertRowid as number
  return get(id)!
}

export function update(id: number, input: PersonInput): Person {
  const full = cleanName(input.fullName)
  getDb()
    .prepare(
      `UPDATE persons SET full_name=@full, name_normalized=@norm, nickname=@nick, nickname_normalized=@nickNorm,
        is_client=@isClient, is_professor=@isProf, is_supplier=@isSup, passport=@passport, email=@email,
        country=@country, country_raw=@countryRaw, birth_date=@birth, birth_date_raw=@birthRaw,
        check_in=@checkIn, check_out=@checkOut, taking_course=@course, discount_pct=@discount, paid=@paid,
        still_here=@still, comment=@comment, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id=@id`
    )
    .run({
      id,
      full,
      norm: normalize(full),
      nick: input.nickname ? cleanName(input.nickname) : null,
      nickNorm: input.nickname ? normalize(input.nickname) : null,
      isClient: input.isClient ? 1 : 0,
      isProf: input.isProfessor ? 1 : 0,
      isSup: input.isSupplier ? 1 : 0,
      passport: input.passport ?? null,
      email: input.email ?? null,
      country: input.country ? normalizeCountry(input.country) : null,
      countryRaw: input.country ?? null,
      birth: input.birthDate ?? null,
      birthRaw: input.birthDateRaw ?? null,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
      course: input.takingCourse ? 1 : 0,
      discount: input.discountPct ?? 0,
      paid: input.paid ?? 0,
      still: input.stillHere === false ? 0 : 1,
      comment: input.comment ?? null
    })
  return get(id)!
}

export function remove(id: number): void {
  const db = getDb()
  // Nunca borrar a alguien con historial: dejaría clases/ventas/facturas huérfanas.
  // En su lugar se marca inactiva (still_here=0) desde la cuadrícula.
  const refs = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM transactions WHERE client_id=@id OR professor_id=@id) +
        (SELECT COUNT(*) FROM bar_sales WHERE client_id=@id) +
        (SELECT COUNT(*) FROM expenses WHERE supplier_id=@id OR area_person_id=@id) +
        (SELECT COUNT(*) FROM client_bills WHERE client_id=@id) +
        (SELECT COUNT(*) FROM professor_settlements WHERE professor_id=@id) +
        (SELECT COUNT(*) FROM payment_plans WHERE person_id=@id) +
        (SELECT COUNT(*) FROM form_responses WHERE imported_person_id=@id) AS n`
    )
    .get({ id }) as { n: number }
  if (refs.n > 0) {
    throw new Error(
      `No se puede eliminar: tiene ${refs.n} registro(s) asociados (clases, bar, gastos, facturas…). ` +
        'Desmarca "Activo" para ocultarla sin perder el historial.'
    )
  }
  getDb().prepare('DELETE FROM persons WHERE id=?').run(id)
}
