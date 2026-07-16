import React, { useState } from 'react'
import { api } from '../lib/api'
import { Spinner } from '../components/ui'
import { Logo } from '../components/Logo'

export function SetPinScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (pin.length < 4) return setErr('El PIN debe tener al menos 4 dígitos.')
    if (pin !== confirm) return setErr('Los PIN no coinciden.')
    setBusy(true)
    try {
      await api.auth.setPin(pin)
      onDone()
    } catch (e: any) {
      setErr(e?.message ?? 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo-wrap"><Logo height={48} /></div>
        <h2>Crear PIN de acceso</h2>
        <p className="sub">Protege la información de tus clientes. Podrás cambiarlo luego en Ajustes.</p>
        <div className="field">
          <label>PIN nuevo</label>
          <input className="pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Confirmar PIN</label>
          <input className="pin-input" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={busy}>
          {busy ? <Spinner /> : 'Crear PIN y continuar'}
        </button>
      </form>
    </div>
  )
}

export function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const res = await api.auth.verify(pin)
      if (res.ok) return onUnlock()
      if (res.lockedForMs) setErr(`Demasiados intentos. Espera ${Math.ceil(res.lockedForMs / 1000)} s.`)
      else setErr(`PIN incorrecto.${res.remainingAttempts != null ? ` Te quedan ${res.remainingAttempts} intentos.` : ''}`)
      setPin('')
    } catch (e: any) {
      setErr(e?.message ?? 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo-wrap"><Logo height={48} /></div>
        <p className="sub">Ingresa tu PIN para continuar.</p>
        <div className="field">
          <input className="pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={busy}>
          {busy ? <Spinner /> : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
