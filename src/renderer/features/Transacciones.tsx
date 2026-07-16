import React, { useState } from 'react'
import { api, useAsync, formatCOP, minutesToHHMM, todayISO } from '../lib/api'
import { Spinner, Empty, Avatar } from '../components/ui'
import { PersonAvatar } from '../components/PersonAvatar'
import { EditableTable, GridColumn } from '../components/EditableTable'
import type { Transaction } from '@shared/types/domain'

const CLASS = '__class__'
const TYPE_OPTS = [
  { value: 'class', label: 'Clase' },
  { value: 'loan', label: 'Préstamo' },
  { value: 'service', label: 'Servicio' },
  { value: 'other', label: 'Otro' }
]

function nowMin(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v))

export function Transacciones() {
  const { data, loading, reload } = useAsync(() => api.transactions.list({ limit: 500 }), [])
  const persons = useAsync(() => api.persons.list({ limit: 2000 }), [])
  const services = useAsync(() => api.catalog.listServices(true), [])
  const equipment = useAsync(() => api.catalog.listEquipment(true), [])
  const [grouped, setGrouped] = useState(false)

  const clients = (persons.data ?? []).filter((p) => p.isClient)
  const professors = (persons.data ?? []).filter((p) => p.isProfessor)
  const hasCourses = (services.data ?? []).some((s) => s.isClass)

  const opt = (arr: { id: number; label: string }[]) => [
    { value: '', label: '—' },
    ...arr.map((x) => ({ value: String(x.id), label: x.label }))
  ]
  const clientOpts = opt(clients.map((c) => ({ id: c.id, label: c.fullName })))
  const profOpts = opt(professors.map((p) => ({ id: p.id, label: p.nickname || p.fullName })))
  const equipOpts = opt((equipment.data ?? []).map((e) => ({ id: e.id, label: e.name })))
  const serviceOpts = [
    { value: '', label: '—' },
    ...(hasCourses ? [{ value: CLASS, label: '★ Clase de curso (nivel auto)' }] : []),
    ...(services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.name} · ${formatCOP(s.price)}` }))
  ]

  /** Construye el input completo para create/update a partir de una fila (con parche aplicado). */
  function toInput(r: any) {
    // serviceSel es la única fuente: '' / null = sin servicio (limpiar la celda LIMPIA el servicio).
    const isClass = r.serviceSel === CLASS
    const serviceId = isClass ? null : numOrNull(r.serviceSel)
    // Invariante: clase de curso => tipo 'class'; si deja de ser clase, 'class' vuelve a 'service'.
    const txType = isClass ? 'class' : r.txType && r.txType !== 'class' ? r.txType : 'service'
    return {
      txDate: r.txDate,
      startMin: r.startMin ?? null,
      endMin: r.endMin ?? null,
      serviceId,
      isClass,
      txType: txType as any,
      clientId: numOrNull(r.clientId),
      professorId: numOrNull(r.professorId),
      kiteId: numOrNull(r.kiteId),
      boardId: numOrNull(r.boardId),
      priceOverride: r.priceOverride ?? null,
      comment: r.comment ?? null
    }
  }

  async function onCreate(draft: any) {
    await api.transactions.create(toInput(draft))
    reload()
  }
  async function onUpdate(id: number, patch: any) {
    const row = data?.find((t) => t.id === id)
    if (!row) return
    // Fila base con serviceSel derivado, luego aplica el parche de la celda.
    const base: any = { ...row, serviceSel: row.isClass ? CLASS : row.serviceId == null ? '' : String(row.serviceId) }
    await api.transactions.update(id, toInput({ ...base, ...patch }))
    reload()
  }
  async function onDelete(id: number) {
    if (!confirm('¿Eliminar esta transacción? Se quitará de la cuenta del cliente.')) return
    await api.transactions.remove(id)
    reload()
  }
  async function salida(id: number) {
    await api.transactions.checkout(id)
    reload()
  }

  const nameOf = (id: number | null) => persons.data?.find((p) => p.id === id)?.fullName ?? '—'

  const columns: GridColumn[] = [
    { key: 'txDate', label: 'Fecha', type: 'date', width: 140 },
    { key: 'clientId', label: 'Cliente', type: 'select', options: clientOpts, width: 160, get: (r) => (r.clientId == null ? '' : String(r.clientId)) },
    { key: 'serviceSel', label: 'Servicio / Clase', type: 'select', options: serviceOpts, width: 210, get: (r) => (r.isClass ? CLASS : r.serviceId == null ? '' : String(r.serviceId)) },
    { key: 'txType', label: 'Tipo', type: 'select', options: TYPE_OPTS, width: 110, get: (r) => r.txType ?? 'service' },
    { key: 'professorId', label: 'Profesor', type: 'select', options: profOpts, width: 130, get: (r) => (r.professorId == null ? '' : String(r.professorId)) },
    { key: 'startMin', label: 'Entrada', type: 'time', width: 92 },
    { key: 'endMin', label: 'Salida', type: 'time', width: 92 },
    { key: 'kiteId', label: 'Kite', type: 'select', options: equipOpts, width: 120, get: (r) => (r.kiteId == null ? '' : String(r.kiteId)) },
    { key: 'boardId', label: 'Tabla', type: 'select', options: equipOpts, width: 120, get: (r) => (r.boardId == null ? '' : String(r.boardId)) },
    {
      key: 'priceEffective', label: 'Precio', type: 'computed', align: 'right', width: 120,
      render: (r) => (r.isOpen ? <span className="badge open">Abierta</span> : <strong>{formatCOP(r.priceEffective)}</strong>)
    },
    { key: 'professorSalary', label: 'Salario prof.', type: 'computed', align: 'right', width: 110, render: (r) => formatCOP(r.professorSalary) }
  ]

  const busy = loading || persons.loading || services.loading

  return (
    <div>
      <div className="header">
        <h1>Club</h1>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className={`btn ${grouped ? '' : 'primary'} sm`} onClick={() => setGrouped(false)}>Cuadrícula</button>
          <button className={`btn ${grouped ? 'primary' : ''} sm`} onClick={() => setGrouped(true)}>Agrupar por cliente</button>
        </div>
      </div>
      <p className="muted" style={{ margin: '-6px 0 14px' }}>
        Escribe la fila como en Excel. <strong>Entrada</strong> = hora de inicio (queda abierta, sin precio).
        <strong> Salida</strong> = escribe la hora de fin o pulsa “Salida ahora”: el precio se calcula por los
        minutos y se carga a la cuenta del cliente.
      </p>

      {busy ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : grouped ? (
        <GroupedView data={data ?? []} persons={persons.data ?? []} services={services.data ?? []} onSalida={salida} />
      ) : (
        <EditableTable
          columns={columns}
          rows={data ?? []}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          canCreate={(d) => !!(d.txDate && d.clientId && d.serviceSel)}
          newRowDefaults={{ txDate: todayISO(), txType: 'service', startMin: nowMin() }}
          rowClassName={(r) => (r.isOpen ? 'row-open' : undefined)}
          addLabel="Registrar"
          rowActions={(r) =>
            r.isOpen ? (
              <button className="btn primary sm" onClick={() => salida(r.id)} title="Registrar salida (hora actual)">Salida ahora</button>
            ) : null
          }
        />
      )}
    </div>
  )
}

function GroupedView({ data, persons, services, onSalida }: { data: Transaction[]; persons: any[]; services: any[]; onSalida: (id: number) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const svcOf = (id: number | null) => services.find((s) => s.id === id)?.name ?? null
  const groups = new Map<number, Transaction[]>()
  for (const t of data) {
    const k = t.clientId ?? -1
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  if (!groups.size) return <Empty>Sin transacciones.</Empty>

  return (
    <div className="grid" style={{ gap: 10 }}>
      {[...groups.entries()].map(([clientId, txs]) => {
        const client = persons.find((p) => p.id === clientId)
        // El total solo cuenta sesiones CERRADAS (las abiertas aún no tienen precio real).
        const total = txs.filter((t) => !t.isOpen).reduce((a, t) => a + (t.priceEffective ?? 0), 0)
        const openCount = txs.filter((t) => t.isOpen).length
        const isOpen = open.has(clientId)
        return (
          <div className="panel" key={clientId}>
            <div className="panel-p clickable" style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => toggle(clientId)}>
              {client ? <PersonAvatar person={client} /> : <Avatar name="Sin cliente" />}
              <div style={{ flex: 1 }}>
                <strong>{client?.fullName ?? 'Sin cliente'}</strong>{' '}
                {openCount > 0 && <span className="badge open">{openCount} abierta{openCount > 1 ? 's' : ''}</span>}
                <div className="muted" style={{ fontSize: 12 }}>{txs.length} registro{txs.length > 1 ? 's' : ''} · total {formatCOP(total)}</div>
              </div>
              <span className="muted">{isOpen ? '▾' : '▸'}</span>
            </div>
            {isOpen && (
              <table className="data">
                <thead><tr><th>Fecha</th><th>Servicio</th><th>Horario</th><th className="num">Precio</th><th /></tr></thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id} className={t.isOpen ? 'row-open' : undefined}>
                      <td>{t.txDate}</td>
                      <td>{t.txType === 'loan' ? <span className="badge loan">Préstamo</span> : t.isClass ? <span className="badge class">Clase</span> : ''} {svcOf(t.resolvedServiceId ?? t.serviceId) ?? t.serviceRaw ?? '—'}</td>
                      <td>{t.startMin != null ? minutesToHHMM(t.startMin) : '—'}{t.endMin != null ? `–${minutesToHHMM(t.endMin)}` : ''}</td>
                      <td className="num">{t.isOpen ? <span className="badge open">Abierta</span> : formatCOP(t.priceEffective)}</td>
                      <td>{t.isOpen && <button className="btn primary sm" onClick={() => onSalida(t.id)}>Salida ahora</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
