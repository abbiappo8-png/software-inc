/**
 * Autenticación por PIN/contraseña.
 * Hash con scrypt (sin dependencias nativas), comparación en tiempo constante,
 * y backoff anti fuerza bruta. El PIN se guarda hasheado en settings.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database as DB } from 'better-sqlite3'

const KEYLEN = 64
// maxmem: scrypt con N=2^15, r=8 necesita justo 32 MiB — el tope por defecto del
// runtime (BoringSSL) lo rechaza con MEMORY_LIMIT_EXCEEDED; se amplía sin cambiar el hash.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return row ? row.value : null
}
function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).run(key, value)
}

export function hasPin(db: DB): boolean {
  return getSetting(db, 'pin_hash') != null
}

export function setPin(db: DB, pin: string): void {
  if (!pin || pin.length < 4) throw new Error('El PIN debe tener al menos 4 caracteres.')
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, KEYLEN, SCRYPT)
  setSetting(db, 'pin_salt', salt.toString('hex'))
  setSetting(db, 'pin_hash', hash.toString('hex'))
  setSetting(db, 'pin_fail_count', '0')
  setSetting(db, 'pin_lock_until', '0')
}

export interface VerifyResult {
  ok: boolean
  lockedForMs?: number
  remainingAttempts?: number
}

const MAX_ATTEMPTS = 5

export function verifyPin(db: DB, pin: string, nowMs = Date.now()): VerifyResult {
  const lockUntil = parseInt(getSetting(db, 'pin_lock_until') || '0', 10)
  if (lockUntil > nowMs) return { ok: false, lockedForMs: lockUntil - nowMs }

  const saltHex = getSetting(db, 'pin_salt')
  const hashHex = getSetting(db, 'pin_hash')
  if (!saltHex || !hashHex) return { ok: false }

  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pin, salt, KEYLEN, SCRYPT)
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected)

  if (ok) {
    setSetting(db, 'pin_fail_count', '0')
    setSetting(db, 'pin_lock_until', '0')
    return { ok: true }
  }

  const fails = parseInt(getSetting(db, 'pin_fail_count') || '0', 10) + 1
  setSetting(db, 'pin_fail_count', String(fails))
  if (fails >= MAX_ATTEMPTS) {
    // Backoff incremental: 30s * 2^(fails-MAX)
    const lockMs = 30000 * Math.pow(2, fails - MAX_ATTEMPTS)
    setSetting(db, 'pin_lock_until', String(nowMs + lockMs))
    return { ok: false, lockedForMs: lockMs }
  }
  return { ok: false, remainingAttempts: MAX_ATTEMPTS - fails }
}

export function changePin(db: DB, currentPin: string, newPin: string): VerifyResult {
  const v = verifyPin(db, currentPin)
  if (!v.ok) return v
  setPin(db, newPin)
  return { ok: true }
}
