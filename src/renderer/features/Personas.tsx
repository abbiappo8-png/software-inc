import React, { useState } from 'react'
import { api, useAsync } from '../lib/api'
import { Field, Modal, Spinner } from '../components/ui'
import { PersonAvatar } from '../components/PersonAvatar'
import { EditableTable, GridColumn } from '../components/EditableTable'
import { ClientProfile } from './ClientProfile'

type Role = 'client' | 'professor' | 'supplier'

const ROLE_LABEL: Record<Role, string> = { client: 'cliente', professor: 'profesor', supplier: 'proveedor' }

function toPersonInput(r: any) {
  return {
    fullName: (r.fullName ?? '').trim(),
    nickname: r.nickname ?? null,
    isClient: !!r.isClient,
    isProfessor: !!r.isProfessor,
    isSupplier: !!r.isSupplier,
    passport: r.passport ?? null,
    email: r.email ? String(r.email).trim() : null,
    country: r.country ?? null,
    birthDate: r.birthDate ?? null,
    birthDateRaw: r.birthDateRaw ?? null,
    checkIn: r.checkIn ?? null,
    checkOut: r.checkOut ?? null,
    takingCourse: !!r.takingCourse,
    discountPct: Number(r.discountPct ?? 0) || 0,
    paid: Number(r.paid ?? 0) || 0,
    stillHere: r.stillHere !== false,
    comment: r.comment ?? null,
    photoPath: r.photoPath ?? null
  }
}

/** Vista de alta de perfil: se abre desde el botón "Agregar" (arriba a la derecha). */
function NewPersonModal({ role, onClose, onCreated }: { role: Role; onClose: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState<any>({ fullName: '', stillHere: true, discountPct: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f: any) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!form.fullName?.trim()) {
      setErr('El nombre es obligatorio.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const input: any = toPersonInput({
        ...form,
        [role === 'client' ? 'isClient' : role === 'professor' ? 'isProfessor' : 'isSupplier']: true
      })
      const created = await api.persons.create(input)
      onCreated(created.id)
    } catch (e: any) {
      setErr(e?.message ?? 'Error al crear')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Nuevo ${ROLE_LABEL[role]}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={busy || !form.fullName?.trim()}>
            {busy ? 'Guardando…' : 'Guardar y abrir perfil'}
          </button>
        </>
      }
    >
      <div className="row2">
        <Field label="Nombre completo *"><input autoFocus value={form.fullName} onChange={set('fullName')} placeholder="Nombre y apellido" /></Field>
        <Field label="Apodo"><input value={form.nickname ?? ''} onChange={set('nickname')} /></Field>
      </div>
      <div className="row2">
        <Field label="Pasaporte / documento"><input value={form.passport ?? ''} onChange={set('passport')} /></Field>
        <Field label="Email"><input type="email" value={form.email ?? ''} onChange={set('email')} /></Field>
      </div>
      <div className="row2">
        <Field label="País"><input value={form.country ?? ''} onChange={set('country')} /></Field>
        <Field label="Fecha de nacimiento"><input type="date" value={form.birthDate ?? ''} onChange={set('birthDate')} /></Field>
      </div>
      {role === 'client' && (
        <div className="row3">
          <Field label="Check-in"><input type="date" value={form.checkIn ?? ''} onChange={set('checkIn')} /></Field>
          <Field label="Check-out"><input type="date" value={form.checkOut ?? ''} onChange={set('checkOut')} /></Field>
          <Field label="Descuento %"><input type="number" min={0} max={100} value={form.discountPct ?? 0} onChange={set('discountPct')} /></Field>
        </div>
      )}
      <Field label="Comentario"><textarea rows={2} value={form.comment ?? ''} onChange={set('comment')} /></Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={form.stillHere !== false}
          onChange={(e) => setForm((f: any) => ({ ...f, stillHere: e.target.checked }))}
        />
        Activo (está actualmente en la escuela)
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Al guardar se abre el perfil, donde puedes tomar la foto con la cámara.
      </p>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}

export function Personas() {
  const [role, setRole] = useState<Role>('client')
  const [search, setSearch] = useState('')
  const [profileId, setProfileId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const { data, loading, reload } = useAsync(() => api.persons.list({ role, search, limit: 1000 }), [role, search])

  async function onUpdate(id: number, patch: any) {
    const row = data?.find((p) => p.id === id)
    if (!row) return
    try {
      await api.persons.update(id, toPersonInput({ ...row, ...patch }) as any)
      reload()
    } catch (e: any) {
      alert(e?.message ?? 'Error al guardar')
      reload()
    }
  }
  async function onDelete(id: number) {
    if (!confirm('¿Eliminar esta persona?')) return
    await api.persons.remove(id)
    reload()
  }

  const columns: GridColumn[] = [
    {
      key: 'photo', label: 'Foto', type: 'computed', width: 52, editable: false,
      render: (r) => <PersonAvatar person={r} onClick={() => setProfileId(r.id)} />
    },
    { key: 'fullName', label: 'Nombre', type: 'text', width: 180 },
    { key: 'nickname', label: 'Apodo', type: 'text', width: 100 },
    { key: 'passport', label: 'Pasaporte', type: 'text', width: 110 },
    { key: 'email', label: 'Email', type: 'text', width: 180 },
    { key: 'country', label: 'País', type: 'text', width: 100 },
    { key: 'birthDate', label: 'Nacim.', type: 'date', width: 135 },
    { key: 'checkIn', label: 'Check-in', type: 'date', width: 135 },
    { key: 'checkOut', label: 'Check-out', type: 'date', width: 135 },
    { key: 'discountPct', label: 'Desc%', type: 'number', width: 70, align: 'right' },
    { key: 'paid', label: 'Pagado', type: 'money', width: 105, align: 'right' },
    { key: 'stillHere', label: 'Activo', type: 'toggle', width: 60, align: 'center' },
    { key: 'comment', label: 'Comentario', type: 'text', width: 160 }
  ]

  return (
    <div>
      <div className="header">
        <h1>Personas</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Agregar {ROLE_LABEL[role]}
        </button>
      </div>
      <div className="toolbar">
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button className={`btn sm ${role === 'client' ? 'primary' : ''}`} onClick={() => setRole('client')}>Clientes</button>
          <button className={`btn sm ${role === 'professor' ? 'primary' : ''}`} onClick={() => setRole('professor')}>Profesores</button>
          <button className={`btn sm ${role === 'supplier' ? 'primary' : ''}`} onClick={() => setRole('supplier')}>Proveedores</button>
        </div>
        <input className="grow" placeholder="Buscar por nombre o email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : (
        <EditableTable
          columns={columns}
          rows={data ?? []}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Haz clic en la foto de una persona para ver su perfil e historial. Edita cualquier celda directamente.
        Para añadir usa el botón «+ Agregar» de arriba a la derecha.
      </p>

      {/* Alta de perfil: al guardar se abre el perfil recién creado (para tomar la foto) */}
      {adding && (
        <NewPersonModal
          role={role}
          onClose={() => setAdding(false)}
          onCreated={(id) => { setAdding(false); reload(); setProfileId(id) }}
        />
      )}

      {/* Al cerrar el perfil se recarga la lista: una foto recién tomada aparece en la cuadrícula */}
      {profileId != null && <ClientProfile personId={profileId} onClose={() => { setProfileId(null); reload() }} />}
    </div>
  )
}
