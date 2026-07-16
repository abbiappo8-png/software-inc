/**
 * Conexión con Google Forms vía la hoja de respuestas PUBLICADA como CSV.
 *
 * - sync(): baja el CSV (fetch del main; el renderer no puede por CSP), parsea y
 *   guarda solo filas nuevas (row_hash UNIQUE).
 * - guess(): pre-adivina campos (nombre, email, fecha, hora, servicio…) por los
 *   encabezados del formulario, con normalize() — el usuario puede corregirlos.
 * - convertToClient()/convertToReservation(): crean el registro real SIN duplicar
 *   (match pasaporte→email→nombre contra la BD) y marcan la respuesta importada.
 */
import { getDb } from '../db/connection'
import type { FormConfig, FormGuess, FormResponse, FormSyncResult } from '@shared/types/domain'
import { csvToObjects } from './csv'
import { normalize, cleanName, normalizeCountry } from './text'
import { rowHash, findTimestamp, guess } from './formsGuess'
import * as settings from '../repositories/settingsRepo'

const FORMS_KEY = 'google_forms'

// ---------- configuración ----------

export function listForms(): FormConfig[] {
  return settings.getJSON<FormConfig[]>(FORMS_KEY, [])
}

export function saveForms(forms: FormConfig[]): void {
  settings.setJSON(
    FORMS_KEY,
    forms
      .filter((f) => f.name?.trim() || f.csvUrl?.trim() || f.formUrl?.trim())
      .map((f) => ({
        key: f.key || slug(f.name || 'form'),
        name: (f.name || 'Formulario').trim(),
        csvUrl: (f.csvUrl || '').trim(),
        formUrl: (f.formUrl || '').trim()
      }))
  )
}

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form'
}

// ---------- sincronización ----------

export async function sync(formKey: string): Promise<FormSyncResult> {
  const form = listForms().find((f) => f.key === formKey)
  if (!form) return { formKey, fetched: 0, added: 0, error: 'Formulario no configurado' }
  if (!form.csvUrl) return { formKey, fetched: 0, added: 0, error: 'Falta la URL del CSV publicado (Ajustes)' }

  let text: string
  try {
    const res = await fetch(form.csvUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    text = await res.text()
  } catch (e: any) {
    return { formKey, fetched: 0, added: 0, error: 'No se pudo descargar la hoja: ' + (e?.message ?? e) }
  }
  if (/<html/i.test(text.slice(0, 300)))
    return { formKey, fetched: 0, added: 0, error: 'El enlace no es un CSV publicado. En Google Sheets: Archivo → Compartir → Publicar en la web → CSV.' }

  const rows = csvToObjects(text)
  const db = getDb()
  const ins = db.prepare(
    `INSERT OR IGNORE INTO form_responses(form_key,row_hash,submitted_at,raw_json) VALUES(?,?,?,?)`
  )
  let added = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const hash = rowHash(formKey, row)
      const submitted = findTimestamp(row)
      const info = ins.run(formKey, hash, submitted, JSON.stringify(row))
      if (info.changes > 0) added++
    }
  })
  tx()
  return { formKey, fetched: rows.length, added }
}

// ---------- respuestas ----------

function mapResponse(r: any): FormResponse {
  return {
    id: r.id,
    formKey: r.form_key,
    rowHash: r.row_hash,
    submittedAt: r.submitted_at,
    values: safeParse(r.raw_json),
    status: r.status,
    importedPersonId: r.imported_person_id,
    importedTxId: r.imported_tx_id
  }
}
function safeParse(s: string): Record<string, string> {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

export function listResponses(formKey: string, status?: string): (FormResponse & { guess: FormGuess })[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM form_responses WHERE form_key=?' +
        (status ? ' AND status=?' : '') +
        ' ORDER BY id DESC'
    )
    .all(...(status ? [formKey, status] : [formKey])) as any[]
  return rows.map((r) => {
    const resp = mapResponse(r)
    return { ...resp, guess: guess(resp.values) }
  })
}

// ---------- conversión ----------

/** Busca una persona existente por pasaporte → email → nombre (como el importador). */
export function matchPerson(g: FormGuess): number | null {
  const db = getDb()
  if (g.passport) {
    const r = db.prepare('SELECT id FROM persons WHERE passport=?').get(g.passport.trim()) as any
    if (r) return r.id
  }
  if (g.email) {
    const r = db.prepare('SELECT id FROM persons WHERE lower(email)=lower(?)').get(g.email.trim()) as any
    if (r) return r.id
  }
  if (g.fullName) {
    const r = db.prepare('SELECT id FROM persons WHERE name_normalized=?').get(normalize(g.fullName)) as any
    if (r) return r.id
  }
  return null
}

/** Crea (o reutiliza) el cliente a partir de los campos adivinados/corregidos. */
function ensureClient(g: FormGuess): number {
  const db = getDb()
  const existing = matchPerson(g)
  if (existing != null) {
    db.prepare('UPDATE persons SET is_client=1 WHERE id=?').run(existing)
    return existing
  }
  if (!g.fullName?.trim()) throw new Error('La respuesta no tiene nombre: corrígelo antes de convertir.')
  const name = cleanName(g.fullName)
  const id = db
    .prepare(
      `INSERT INTO persons(full_name,name_normalized,is_client,passport,email,country,country_raw,birth_date,still_here,comment)
       VALUES(@full,@norm,1,@passport,@email,@country,@countryRaw,@birth,1,@comment)`
    )
    .run({
      full: name,
      norm: normalize(name),
      passport: g.passport?.trim() || null,
      email: g.email?.trim() || null,
      country: normalizeCountry(g.country),
      countryRaw: g.country ?? null,
      birth: g.birthDate,
      comment: 'Registrado desde Google Forms'
    }).lastInsertRowid as number
  return id
}

export interface ConvertDeps {
  createTransaction: (input: any) => { id: number }
}

/** Convierte la respuesta en cliente o reserva. `edited` corrige los campos adivinados. */
export function convert(
  responseId: number,
  kind: 'client' | 'reservation',
  edited: Partial<FormGuess> | undefined,
  deps: ConvertDeps
): FormResponse {
  const db = getDb()
  const r = db.prepare('SELECT * FROM form_responses WHERE id=?').get(responseId) as any
  if (!r) throw new Error('Respuesta no encontrada')
  // Solo se convierte lo que sigue 'new': ni reimportar, ni resucitar una ignorada.
  if (r.status !== 'new') return mapResponse(r)
  const g: FormGuess = { ...guess(safeParse(r.raw_json)), ...(edited ?? {}) }

  // Una reserva sin fecha válida NO se crea en un día equivocado en silencio.
  if (kind === 'reservation' && !g.date)
    throw new Error('La fecha de la reserva no es válida: corrígela antes de crear la reserva.')

  // Atómico: cliente + reserva + marca de estado se hacen todo-o-nada.
  const run = db.transaction(() => {
    const personId = ensureClient(g)
    let txId: number | null = null
    if (kind === 'reservation') {
      // Reserva = sesión ABIERTA (entrada programada, sin salida): se cobra al hacer check-out.
      const svc = g.service
        ? (db.prepare('SELECT id, is_class FROM service_catalog WHERE name_normalized=?').get(normalize(g.service)) as any)
        : null
      const isClass = svc ? !!svc.is_class : true // sin match de catálogo => clase de curso (nivel auto)
      const tx = deps.createTransaction({
        txDate: g.date,
        startMin: g.startMin,
        endMin: null,
        serviceId: svc && !svc.is_class ? svc.id : null,
        isClass,
        txType: 'class',
        clientId: personId,
        professorId: null,
        kiteId: null,
        boardId: null,
        priceOverride: null,
        comment: ['Reserva de Google Forms', g.service && !svc ? `(${g.service})` : null, g.comment].filter(Boolean).join(' · ')
      })
      txId = tx.id
    }
    db.prepare("UPDATE form_responses SET status='imported', imported_person_id=?, imported_tx_id=? WHERE id=?")
      .run(personId, txId, responseId)
  })
  run()
  return mapResponse(db.prepare('SELECT * FROM form_responses WHERE id=?').get(responseId))
}

export function ignore(responseId: number): FormResponse {
  const db = getDb()
  db.prepare("UPDATE form_responses SET status='ignored' WHERE id=? AND status='new'").run(responseId)
  const r = db.prepare('SELECT * FROM form_responses WHERE id=?').get(responseId) as any
  if (!r) throw new Error('Respuesta no encontrada')
  return mapResponse(r)
}
