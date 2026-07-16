/** Repositorio del catálogo de servicios y equipos. */
import { getDb } from '../db/connection'
import type { Equipment, ServiceCatalogItem } from '@shared/types/domain'
import { normalize } from '../services/text'
import type { CourseLevel } from '../services/courses'

function mapService(r: any): ServiceCatalogItem {
  return {
    id: r.id,
    name: r.name,
    discipline: r.discipline,
    seasonYear: r.season_year,
    hours: r.hours ?? 0,
    days: r.days ?? 0,
    price: r.price ?? 0,
    professorPct: r.professor_pct ?? 0,
    isClass: !!r.is_class,
    active: !!r.active
  }
}
function mapEquipment(r: any): Equipment {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    count: r.count ?? 1,
    price: r.price,
    active: !!r.active
  }
}

export function listServices(onlyActive = false): ServiceCatalogItem[] {
  const sql = 'SELECT * FROM service_catalog' + (onlyActive ? ' WHERE active=1' : '') + ' ORDER BY name COLLATE NOCASE'
  return getDb().prepare(sql).all().map(mapService)
}

export function getService(id: number): ServiceCatalogItem | null {
  const r = getDb().prepare('SELECT * FROM service_catalog WHERE id=?').get(id)
  return r ? mapService(r) : null
}

export function findServiceByName(name: string): ServiceCatalogItem | null {
  const r = getDb().prepare('SELECT * FROM service_catalog WHERE name_normalized=?').get(normalize(name))
  return r ? mapService(r) : null
}

/** Cursos (los 5 niveles is_class) ordenados por umbral de horas ascendente. */
export function courses(): CourseLevel[] {
  return getDb()
    .prepare('SELECT id, name, hours FROM service_catalog WHERE is_class=1 ORDER BY hours ASC')
    .all()
    .map((r: any) => ({ id: r.id, name: r.name, thresholdHours: r.hours ?? 0 }))
}

export function createService(s: Omit<ServiceCatalogItem, 'id'>): ServiceCatalogItem {
  const id = getDb()
    .prepare(
      `INSERT INTO service_catalog(name,name_normalized,discipline,season_year,hours,days,price,professor_pct,is_class,active)
       VALUES(@name,@norm,@disc,@year,@hours,@days,@price,@pct,@isClass,@active)`
    )
    .run({
      name: s.name, norm: normalize(s.name), disc: s.discipline, year: s.seasonYear,
      hours: s.hours, days: s.days, price: s.price, pct: s.professorPct,
      isClass: s.isClass ? 1 : 0, active: s.active === false ? 0 : 1
    }).lastInsertRowid as number
  return getService(id)!
}

export function updateService(id: number, s: Omit<ServiceCatalogItem, 'id'>): ServiceCatalogItem {
  getDb()
    .prepare(
      `UPDATE service_catalog SET name=@name, name_normalized=@norm, discipline=@disc, season_year=@year,
        hours=@hours, days=@days, price=@price, professor_pct=@pct, is_class=@isClass, active=@active WHERE id=@id`
    )
    .run({
      id, name: s.name, norm: normalize(s.name), disc: s.discipline, year: s.seasonYear,
      hours: s.hours, days: s.days, price: s.price, pct: s.professorPct,
      isClass: s.isClass ? 1 : 0, active: s.active === false ? 0 : 1
    })
  return getService(id)!
}

export function listEquipment(onlyActive = false): Equipment[] {
  const sql = 'SELECT * FROM equipment' + (onlyActive ? ' WHERE active=1' : '') + ' ORDER BY name COLLATE NOCASE'
  return getDb().prepare(sql).all().map(mapEquipment)
}

export function getEquipment(id: number): Equipment | null {
  const r = getDb().prepare('SELECT * FROM equipment WHERE id=?').get(id)
  return r ? mapEquipment(r) : null
}

export function createEquipment(e: Omit<Equipment, 'id'>): Equipment {
  const id = getDb()
    .prepare(
      `INSERT INTO equipment(name,name_normalized,category,count,price,active)
       VALUES(@name,@norm,@cat,@count,@price,@active)`
    )
    .run({
      name: e.name, norm: normalize(e.name), cat: e.category, count: e.count ?? 1,
      price: e.price ?? null, active: e.active === false ? 0 : 1
    }).lastInsertRowid as number
  return getEquipment(id)!
}

export function updateEquipment(id: number, e: Omit<Equipment, 'id'>): Equipment {
  getDb()
    .prepare(
      `UPDATE equipment SET name=@name, name_normalized=@norm, category=@cat,
        count=@count, price=@price, active=@active WHERE id=@id`
    )
    .run({
      id, name: e.name, norm: normalize(e.name), cat: e.category, count: e.count ?? 1,
      price: e.price ?? null, active: e.active === false ? 0 : 1
    })
  return getEquipment(id)!
}
