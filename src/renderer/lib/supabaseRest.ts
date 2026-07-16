/**
 * Cliente REST minimalista para Supabase (MODO WEB), sin dependencias:
 *  - GoTrue  ({url}/auth/v1)    : login con email+contraseña, refresh y updateUser.
 *  - PostgREST ({url}/rest/v1)  : select/insert/update/delete/upsert con filtros.
 *  - Storage ({url}/storage/v1) : upload/download/list/remove + URL firmada.
 *
 * Los tokens viven en memoria y en localStorage ('sb-session'). Ante un 401 se
 * intenta refrescar la sesión UNA vez y se reintenta la petición.
 */

export const SUPABASE_URL: string = (import.meta as any).env?.VITE_SUPABASE_URL ?? ''
const ANON_KEY: string = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? ''
export const SUPABASE_EMAIL: string = (import.meta as any).env?.VITE_SUPABASE_EMAIL ?? ''

const SESSION_KEY = 'sb-session'

interface Session {
  access_token: string
  refresh_token: string
}

let session: Session | null = loadSession()

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    return s?.access_token && s?.refresh_token
      ? { access_token: s.access_token, refresh_token: s.refresh_token }
      : null
  } catch {
    return null
  }
}

function storeSession(s: Session | null): void {
  session = s
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* localStorage no disponible: la sesión queda solo en memoria */
  }
}

export function hasSession(): boolean {
  return session != null
}

/** Avisa a la UI de que la sesión se perdió (App vuelve al PinGate). */
function sessionLost(): void {
  try {
    window.dispatchEvent(new CustomEvent('sb:session-lost'))
  } catch {
    /* sin window (tests): nada que avisar */
  }
}

// ---------------------------------------------------------------------------
// Auth (GoTrue)
// ---------------------------------------------------------------------------

/** Error de GoTrue con el código HTTP (para distinguirlo de fallos de red). */
class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const AUTH_TIMEOUT_MS = 10_000

async function tokenRequest(grant: string, body: unknown): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AUTH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
  } catch {
    // fetch solo lanza por red/timeout/CORS: NO es un problema de credenciales.
    throw new Error('No hay conexión con el servidor')
  } finally {
    clearTimeout(timer)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new AuthError(data?.error_description || data?.msg || data?.message || `Auth HTTP ${res.status}`, res.status)
  return data
}

/**
 * Login con email+contraseña. Devuelve true si la sesión quedó iniciada y false
 * si las credenciales son inválidas; un fallo de red LANZA (no es "PIN incorrecto").
 */
export async function signIn(email: string, password: string): Promise<boolean> {
  try {
    const data = await tokenRequest('password', { email, password })
    if (data?.access_token) {
      storeSession({ access_token: data.access_token, refresh_token: data.refresh_token })
      return true
    }
    return false
  } catch (e) {
    if (e instanceof AuthError && (e.status === 400 || e.status === 401)) return false
    throw e
  }
}

/** Cierra la sesión: revoca el refresh token (best-effort) y limpia el almacenamiento. */
export async function signOut(): Promise<void> {
  if (session) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` }
      })
    } catch {
      /* best-effort: aunque falle la revocación, la sesión local se borra */
    }
  }
  storeSession(null)
  sessionLost()
}

// Single-flight: varias peticiones con 401 simultáneas comparten UN solo refresh
// (con la rotación de tokens de GoTrue, refrescos paralelos se invalidan entre sí).
let refreshInFlight: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(): Promise<boolean> {
  if (!session?.refresh_token) return false
  try {
    const data = await tokenRequest('refresh_token', { refresh_token: session.refresh_token })
    if (data?.access_token) {
      storeSession({ access_token: data.access_token, refresh_token: data.refresh_token })
      return true
    }
    return false
  } catch (e) {
    // Solo un rechazo explícito de GoTrue invalida la sesión; un fallo de red
    // transitorio NO debe borrar el refresh token guardado.
    if (e instanceof AuthError && (e.status === 400 || e.status === 401)) {
      storeSession(null)
      sessionLost()
    }
    return false
  }
}

/**
 * fetch autenticado contra Supabase: agrega apikey + Bearer y, si responde 401,
 * refresca la sesión UNA vez y reintenta. Sin sesión (o si el refresh la
 * invalidó) NO consulta con la anon key: RLS devolvería [] en silencio.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const needsSession = path.startsWith('/rest/v1') || path.startsWith('/storage/v1')
  const expired = (): Error => {
    sessionLost()
    return new Error('Sesión expirada — vuelve a entrar con el PIN')
  }
  if (needsSession && !session) throw expired()
  const doFetch = () => {
    const headers = new Headers(init.headers)
    headers.set('apikey', ANON_KEY)
    if (session) headers.set('Authorization', `Bearer ${session.access_token}`)
    return fetch(`${SUPABASE_URL}${path}`, { ...init, headers })
  }
  let res = await doFetch()
  if (res.status === 401) {
    if (await refreshSession()) res = await doFetch()
    else if (needsSession && !session) throw expired() // el refresh fue rechazado por GoTrue
  }
  return res
}

/** Actualiza atributos del usuario logueado (p. ej. la contraseña). */
export async function updateUser(attrs: { password?: string; email?: string }): Promise<void> {
  const res = await apiFetch('/auth/v1/user', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attrs)
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d?.msg || d?.message || `Auth HTTP ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// PostgREST
// ---------------------------------------------------------------------------

/** Filtros ya codificados para la query string (usar los helpers eq/gte/…). */
export interface QueryOpts {
  select?: string
  filters?: string[]
  order?: string // p. ej. 'tx_date.desc,id.desc'
  limit?: number
  offset?: number
}

export function eq(col: string, v: unknown): string {
  return `${col}=${encodeURIComponent('eq.' + String(v))}`
}
export function neq(col: string, v: unknown): string {
  return `${col}=${encodeURIComponent('neq.' + String(v))}`
}
export function gte(col: string, v: unknown): string {
  return `${col}=${encodeURIComponent('gte.' + String(v))}`
}
export function lte(col: string, v: unknown): string {
  return `${col}=${encodeURIComponent('lte.' + String(v))}`
}
export function isNull(col: string): string {
  return `${col}=is.null`
}
export function notNull(col: string): string {
  return `${col}=not.is.null`
}
export function ilike(col: string, pattern: string): string {
  return `${col}=${encodeURIComponent('ilike.' + pattern)}`
}
/** Escapa los comodines de LIKE/ILIKE (% y _) y el propio backslash en un literal. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}
/** Valor entrecomillado para usar DENTRO de or= (tolera comas, paréntesis, puntos...). */
export function quoteValue(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}
export function inList(col: string, values: (string | number)[]): string {
  return `${col}=${encodeURIComponent('in.(' + values.join(',') + ')')}`
}
/** OR de condiciones SIN codificar (p. ej. 'email.ilike.*ana*'). */
export function orFilter(conds: string[]): string {
  return `or=${encodeURIComponent('(' + conds.join(',') + ')')}`
}

function qs(table: string, opts: QueryOpts = {}): string {
  const parts: string[] = ['select=' + encodeURIComponent(opts.select ?? '*')]
  for (const f of opts.filters ?? []) parts.push(f)
  if (opts.order) parts.push('order=' + encodeURIComponent(opts.order))
  if (opts.limit != null) parts.push('limit=' + Number(opts.limit))
  if (opts.offset) parts.push('offset=' + Number(opts.offset))
  return `/rest/v1/${table}?` + parts.join('&')
}

async function parseOrThrow(res: Response): Promise<any> {
  if (res.ok) return res.status === 204 ? null : res.json()
  const d = await res.json().catch(() => null)
  throw new Error(d?.message || d?.hint || d?.details || `Supabase HTTP ${res.status}`)
}

export async function select<T>(table: string, opts: QueryOpts = {}): Promise<T[]> {
  return (await parseOrThrow(await apiFetch(qs(table, opts)))) ?? []
}

/** select paginado hasta traer TODAS las filas (PostgREST limita por defecto). */
export async function selectAll<T>(table: string, opts: QueryOpts = {}): Promise<T[]> {
  const page = 1000
  // Sin ORDER BY el orden entre páginas no es estable (filas duplicadas/omitidas):
  // por defecto se ordena por la clave primaria.
  const order = opts.order ?? (table === 'settings' ? 'key.asc' : 'id.asc')
  const out: T[] = []
  for (let offset = opts.offset ?? 0; ; offset += page) {
    const batch = await select<T>(table, { ...opts, order, limit: page, offset })
    out.push(...batch)
    if (batch.length < page) return out
  }
}

export async function selectOne<T>(table: string, opts: QueryOpts = {}): Promise<T | null> {
  const rows = await select<T>(table, { ...opts, limit: 1 })
  return rows[0] ?? null
}

export async function insert<T>(table: string, rows: unknown): Promise<T[]> {
  const res = await apiFetch(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(rows)
  })
  return parseOrThrow(res)
}

/**
 * Upsert por columna(s) de conflicto. Con ignoreDuplicates=true (dedupe) la
 * respuesta trae SOLO las filas realmente insertadas.
 */
export async function upsert<T>(
  table: string,
  rows: unknown,
  onConflict: string,
  ignoreDuplicates = false
): Promise<T[]> {
  const res = await apiFetch(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: `resolution=${ignoreDuplicates ? 'ignore' : 'merge'}-duplicates,return=representation`
    },
    body: JSON.stringify(rows)
  })
  return (await parseOrThrow(res)) ?? []
}

export async function update<T>(table: string, patch: unknown, filters: string[]): Promise<T[]> {
  if (!filters.length) throw new Error('update sin filtros')
  const res = await apiFetch(`/rest/v1/${table}?` + filters.join('&'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  })
  return (await parseOrThrow(res)) ?? []
}

export async function remove(table: string, filters: string[]): Promise<void> {
  if (!filters.length) throw new Error('delete sin filtros')
  const res = await apiFetch(`/rest/v1/${table}?` + filters.join('&'), { method: 'DELETE' })
  await parseOrThrow(res)
}

/** COUNT exacto sin traer filas (HEAD + Content-Range). */
export async function count(table: string, filters: string[] = []): Promise<number> {
  const res = await apiFetch(`/rest/v1/${table}?select=id` + (filters.length ? '&' + filters.join('&') : ''), {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' }
  })
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`)
  const range = res.headers.get('content-range') // '0-24/357' o '*/0'
  const total = range?.split('/')[1]
  return total && total !== '*' ? parseInt(total, 10) : 0
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageObject {
  name: string
  id: string | null // null => "carpeta" virtual
  updated_at?: string
  created_at?: string
  metadata?: { size?: number; mimetype?: string } | null
}

export const storage = {
  async upload(bucket: string, path: string, body: Blob, contentType?: string): Promise<void> {
    const res = await apiFetch(`/storage/v1/object/${bucket}/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType || body.type || 'application/octet-stream', 'x-upsert': 'true' },
      body
    })
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      throw new Error(d?.message || d?.error || `Storage HTTP ${res.status}`)
    }
  },

  /** Descarga el objeto (o null si no existe). */
  async download(bucket: string, path: string): Promise<Blob | null> {
    const res = await apiFetch(`/storage/v1/object/${bucket}/${encodeURIComponent(path).replace(/%2F/g, '/')}`)
    if (!res.ok) return null
    return res.blob()
  },

  async list(bucket: string, prefix = ''): Promise<StorageObject[]> {
    const res = await apiFetch(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } })
    })
    return (await parseOrThrow(res)) ?? []
  },

  async remove(bucket: string, paths: string[]): Promise<void> {
    const res = await apiFetch(`/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths })
    })
    await parseOrThrow(res)
  },

  /** URL firmada temporal para descargar desde el navegador. */
  async signedUrl(bucket: string, path: string, expiresInSec = 300): Promise<string> {
    const res = await apiFetch(`/storage/v1/object/sign/${bucket}/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSec })
    })
    const d = await parseOrThrow(res)
    if (!d?.signedURL) throw new Error('No se pudo firmar la URL del archivo')
    return `${SUPABASE_URL}/storage/v1${d.signedURL}`
  }
}
