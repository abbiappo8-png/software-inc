import React, { useState } from 'react'
import { api, useAsync, IS_WEB } from '../lib/api'
import { Field, Spinner } from '../components/ui'
import type { FormConfig } from '@shared/types/domain'

export function Ajustes() {
  return (
    <div>
      <div className="header"><h1>Ajustes</h1></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <CompanyPanel />
        {IS_WEB ? <SmtpWebNote /> : <SmtpPanel />}
        <FormsPanel />
        <PinPanel />
        {IS_WEB ? <CloudPanel /> : <BackupPanel />}
      </div>
    </div>
  )
}

function FormsPanel() {
  const { data } = useAsync(() => api.forms.list(), [])
  const [forms, setForms] = useState<FormConfig[] | null>(null)
  const [msg, setMsg] = useState('')
  React.useEffect(() => { if (data) setForms(data) }, [data])
  if (!forms) return <div className="panel panel-p"><Spinner /></div>

  const set = (i: number, patch: Partial<FormConfig>) =>
    setForms(forms.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const add = () => setForms([...forms, { key: '', name: '', csvUrl: '', formUrl: '' }])
  const remove = (i: number) => setForms(forms.filter((_, j) => j !== i))

  async function save() {
    if (!forms) return
    try {
      await api.forms.saveConfig(forms)
      setMsg('Guardado. Abre "Reservas Web" para sincronizar.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    }
  }

  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Formularios de Google (Reservas Web)</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        En Google Sheets (hoja de respuestas): <strong>Archivo → Compartir → Publicar en la web → CSV</strong> y pega aquí ese enlace.
      </p>
      {forms.map((f, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div className="row2">
            <Field label="Nombre"><input value={f.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Reservas de clases" /></Field>
            <div style={{ textAlign: 'right', paddingTop: 22 }}>
              <button className="btn ghost sm" onClick={() => remove(i)}>✕ Quitar</button>
            </div>
          </div>
          <Field label="Enlace del CSV publicado (hoja de respuestas)">
            <input value={f.csvUrl} onChange={(e) => set(i, { csvUrl: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" />
          </Field>
          <Field label="Enlace del formulario (para llenarlo desde el programa)">
            <input value={f.formUrl} onChange={(e) => set(i, { formUrl: e.target.value })} placeholder="https://docs.google.com/forms/d/e/…/viewform" />
          </Field>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}>+ Añadir formulario</button>
        <button className="btn primary" onClick={save}>Guardar</button>
      </div>
      <div className={msg.startsWith('Error') ? 'err' : 'ok'} style={{ marginTop: 8 }}>{msg}</div>
    </div>
  )
}

function CompanyPanel() {
  const { data } = useAsync(() => api.settings.getCompany(), [])
  const [form, setForm] = useState<any>(null)
  const [msg, setMsg] = useState('')
  React.useEffect(() => { if (data) setForm(data) }, [data])
  if (!form) return <div className="panel panel-p"><Spinner /></div>
  async function save() {
    try {
      await api.settings.setCompany(form)
      setMsg('Guardado.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    }
  }
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Empresa</h3>
      <Field label="Nombre"><input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
      <Field label="NIT"><input value={form.companyNit} onChange={(e) => setForm({ ...form, companyNit: e.target.value })} /></Field>
      <Field label="Recargo tarjeta (0.05 = 5%)"><input type="number" step="0.01" value={form.cardSurchargePct} onChange={(e) => setForm({ ...form, cardSurchargePct: Number(e.target.value) })} /></Field>
      <button className="btn primary" onClick={save}>Guardar</button> <span className={msg.startsWith('Error') ? 'err' : 'ok'}>{msg}</span>
    </div>
  )
}

function SmtpPanel() {
  const { data } = useAsync(() => api.settings.getSmtp(), [])
  const [form, setForm] = useState<any>(null)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  React.useEffect(() => { if (data) setForm(data) }, [data])
  if (!form) return <div className="panel panel-p"><Spinner /></div>
  async function save() {
    try {
      await api.settings.setSmtp({ ...form, password: password || undefined })
      setPassword('')
      setMsg('Guardado.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    }
  }
  async function test() {
    setBusy(true)
    setMsg('')
    try {
      const res = await api.settings.testSmtp()
      setMsg(res.ok ? 'Conexión SMTP correcta.' : 'Error: ' + res.error)
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Correo (SMTP) para enviar facturas</h3>
      <div className="row2">
        <Field label="Servidor (host)"><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
        <Field label="Puerto"><input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} placeholder="587" /></Field>
      </div>
      <Field label="Usuario"><input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="tu-correo@gmail.com" /></Field>
      <Field label={`Contraseña (app password)${form.hasPassword ? ' — ya configurada' : ''}`}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={form.hasPassword ? '••••••••' : ''} />
      </Field>
      <Field label="Remitente (From)"><input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={save}>Guardar</button>
        <button className="btn" onClick={test} disabled={busy}>{busy ? <Spinner /> : 'Probar conexión'}</button>
      </div>
      <div style={{ marginTop: 8 }} className={msg.startsWith('Error') ? 'err' : 'ok'}>{msg}</div>
      <p className="muted" style={{ fontSize: 12 }}>Con Gmail usa una “contraseña de aplicación” (requiere verificación en 2 pasos). Puerto 587 (STARTTLS) o 465 (TLS).</p>
    </div>
  )
}

/* En la web no hay servidor SMTP disponible: se muestra una nota en vez del formulario. */
function SmtpWebNote() {
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Correo (SMTP) para enviar facturas</h3>
      <p className="muted">El envío de correos solo funciona en la app de escritorio. Desde la web puedes generar el PDF de la factura y compartirlo manualmente.</p>
    </div>
  )
}

function PinPanel() {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  async function change() {
    setMsg('')
    try {
      const res = await api.auth.change(cur, next)
      setMsg(res.ok ? 'PIN actualizado.' : 'PIN actual incorrecto.')
      if (res.ok) { setCur(''); setNext('') }
    } catch (e: any) {
      setMsg(e?.message ?? 'Error')
    }
  }
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Cambiar PIN</h3>
      <Field label="PIN actual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="PIN nuevo"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <button className="btn primary" onClick={change}>Cambiar</button> <span className="ok">{msg}</span>
    </div>
  )
}

/** Panel de datos en la versión web: sin copias locales, con cierre de sesión. */
function CloudPanel() {
  const [busy, setBusy] = useState(false)
  async function lock() {
    setBusy(true)
    try {
      // signOut() lo aporta supabaseRest; import dinámico para no cargarlo en escritorio/demo.
      const rest: any = await import('../lib/supabaseRest')
      await rest.signOut()
    } finally {
      // Bloquea la app aunque el revoke remoto falle (la sesión local ya se descartó).
      window.dispatchEvent(new Event('sb:session-lost'))
    }
  }
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Respaldos y datos</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Los respaldos los gestiona Supabase automáticamente.</p>
      <button className="btn primary" onClick={lock} disabled={busy}>
        {busy ? <Spinner /> : 'Cerrar sesión / Bloquear'}
      </button>
    </div>
  )
}

function BackupPanel() {
  const { data, reload } = useAsync(() => api.backup.list(), [])
  const [msg, setMsg] = useState('')
  async function create() {
    try {
      const path = await api.backup.create()
      setMsg('Copia creada: ' + path)
      reload()
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    }
  }
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Respaldos y datos</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="btn primary" onClick={create}>Crear copia ahora</button>
        <button className="btn" onClick={() => api.exports.openFolder()}>Abrir carpeta de exportaciones</button>
      </div>
      {msg && <div className="ok" style={{ fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      <div className="muted" style={{ fontSize: 12 }}>Últimas copias:</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
        {data?.slice(0, 5).map((b) => <li key={b.file}>{b.file} — {(b.size / 1024 / 1024).toFixed(1)} MB</li>)}
        {!data?.length && <li className="muted">Sin copias aún.</li>}
      </ul>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Recomendación: copia la carpeta de respaldos a un USB o a OneDrive.</p>
    </div>
  )
}
