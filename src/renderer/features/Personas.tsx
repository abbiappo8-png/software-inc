import React, { useState } from 'react'
import { api, useAsync } from '../lib/api'
import { Spinner } from '../components/ui'
import { PersonAvatar } from '../components/PersonAvatar'
import { EditableTable, GridColumn } from '../components/EditableTable'
import { ClientProfile } from './ClientProfile'

type Role = 'client' | 'professor' | 'supplier'

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

export function Personas() {
  const [role, setRole] = useState<Role>('client')
  const [search, setSearch] = useState('')
  const [profileId, setProfileId] = useState<number | null>(null)
  const { data, loading, reload } = useAsync(() => api.persons.list({ role, search, limit: 1000 }), [role, search])

  async function onCreate(draft: any) {
    if (!draft.fullName?.trim()) return
    try {
      const input: any = toPersonInput({
        ...draft,
        [role === 'client' ? 'isClient' : role === 'professor' ? 'isProfessor' : 'isSupplier']: true
      })
      await api.persons.create(input)
      reload()
    } catch (e: any) {
      alert(e?.message ?? 'Error al crear')
    }
  }
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
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          canCreate={(d) => !!d.fullName?.trim()}
          newRowDefaults={{ isClient: role === 'client', isProfessor: role === 'professor', isSupplier: role === 'supplier', stillHere: true }}
          addLabel="Agregar"
        />
      )}
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Haz clic en la foto de una persona para ver su perfil e historial. Edita cualquier celda directamente.
      </p>

      {/* Al cerrar el perfil se recarga la lista: una foto recién tomada aparece en la cuadrícula */}
      {profileId != null && <ClientProfile personId={profileId} onClose={() => { setProfileId(null); reload() }} />}
    </div>
  )
}
