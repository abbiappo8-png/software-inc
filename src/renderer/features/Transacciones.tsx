import React, { useEffect, useReducer, useState } from 'react'
import { api, useAsync, formatCOP, minutesToHHMM, hhmmToMinutes, todayISO } from '../lib/api'
import { googleCalendarInviteUrl } from '../lib/calendar'
import { Spinner, Empty, Avatar, Field, Modal } from '../components/ui'
import { SearchSelect } from '../components/SearchSelect'
import { PersonAvatar } from '../components/PersonAvatar'
import { EditableTable, GridColumn } from '../components/EditableTable'
import type { Transaction } from '@shared/types/domain'

const CLASS = '__class__'
// El tipo 'loan' se muestra SIEMPRE como "Alquiler" (nunca "préstamo").
const TYPE_OPTS = [
  { value: 'class', label: 'Clase' },
  { value: 'loan', label: 'Alquiler' },
  { value: 'service', label: 'Servicio' },
  { value: 'other', label: 'Otro' }
]

function nowMin(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v))

function fmtDur(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/** Alta de clase con contador: al pulsar "Empezar clase" queda abierta y el tiempo corre.
 *  Si el profesor tiene correo, al crearla se ofrece la invitación de Google Calendar
 *  (el profesor recibe la notificación por correo al guardar el evento). */
function NuevaClaseModal({ clients, professors, serviceOpts, services, onClose, onStarted }: {
  clients: { id: number; label: string }[]
  professors: { id: number; label: string; email: string | null }[]
  serviceOpts: { value: string; label: string }[]
  services: { id: number; name: string; hours: number | null }[]
  onClose: () => void
  onStarted: () => void
}) {
  const [form, setForm] = useState<any>({ clientId: '', serviceSel: CLASS, professorId: '', date: todayISO(), start: minutesToHHMM(nowMin()) })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [profEmail, setProfEmail] = useState<string | null>(null)

  async function empezar() {
    if (!form.clientId || !form.serviceSel) {
      setErr('Elige el cliente y el servicio/clase.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const isClass = form.serviceSel === CLASS
      const startMin = form.start ? hhmmToMinutes(form.start) ?? nowMin() : nowMin()
      await api.transactions.create({
        txDate: form.date || todayISO(), // hoy = contador en marcha; futuro = clase agendada
        startMin, // hora de inicio modificable
        endMin: null, // abierta: el contador corre hasta "Terminar"
        serviceId: isClass ? null : Number(form.serviceSel),
        isClass,
        txType: isClass ? 'class' : 'service',
        clientId: Number(form.clientId),
        professorId: form.professorId ? Number(form.professorId) : null,
        kiteId: null,
        boardId: null,
        priceOverride: null,
        comment: null
      })
      // Notificación al profesor: invitación de Google Calendar con él como invitado.
      const prof = professors.find((p) => p.id === Number(form.professorId))
      if (prof?.email) {
        const svc = services.find((s) => s.id === Number(form.serviceSel))
        const cliente = clients.find((c) => c.id === Number(form.clientId))?.label ?? 'Cliente'
        const durMin = svc?.hours ? Math.round(svc.hours * 60) : 60
        setProfEmail(prof.email)
        setInviteUrl(
          googleCalendarInviteUrl({
            title: `Clase ${svc?.name ?? 'de curso'} — ${cliente}`,
            dateISO: form.date || todayISO(),
            startMin,
            durationMin: durMin,
            details: `Clase en Kite Addict Colombia con ${cliente}. Profesor: ${prof.label}.`,
            guestEmail: prof.email
          })
        )
        return // muestra el paso de invitación (no cierra aún)
      }
      onStarted()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  // Paso 2: la clase ya está creada; enviar la invitación al correo del profesor.
  if (inviteUrl) {
    return (
      <Modal
        title="✅ Clase creada — notificar al profesor"
        onClose={onStarted}
        footer={<button className="btn" onClick={onStarted}>Listo</button>}
      >
        <p style={{ marginTop: 0 }}>
          El profesor tiene correo (<strong>{profEmail}</strong>). Abre la invitación y pulsa
          «Guardar» en Google Calendar: <strong>le llegará la notificación al correo</strong> con la
          clase para añadirla a su calendario.
        </p>
        <button className="btn primary" style={{ width: '100%' }} onClick={() => window.open(inviteUrl, '_blank')}>
          🗓 Abrir invitación de Google Calendar
        </button>
      </Modal>
    )
  }

  return (
    <Modal
      title="Añadir clase"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={empezar} disabled={busy || !form.clientId || !form.serviceSel}>
            {busy ? 'Empezando…' : form.date && form.date !== todayISO() ? '🗓 Agendar clase' : '▶ Empezar clase'}
          </button>
        </>
      }
    >
      <div className="row2">
        <Field label="Cliente *">
          <SearchSelect
            value={form.clientId}
            options={clients.map((c) => ({ value: String(c.id), label: c.label }))}
            onChange={(v) => setForm((f: any) => ({ ...f, clientId: v }))}
            placeholder="— Busca el cliente —"
          />
        </Field>
        <Field label="Servicio / Clase *">
          <SearchSelect
            value={form.serviceSel}
            options={serviceOpts.filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => setForm((f: any) => ({ ...f, serviceSel: v }))}
            placeholder="— Busca el servicio —"
          />
        </Field>
      </div>
      <div className="row2">
        <Field label="Profesor">
          <SearchSelect
            value={form.professorId}
            options={professors.map((p) => ({ value: String(p.id), label: p.label + (p.email ? ' ✉' : '') }))}
            onChange={(v) => setForm((f: any) => ({ ...f, professorId: v }))}
            placeholder="—"
          />
        </Field>
        <Field label="Fecha (hoy o futura para agendar)">
          <input type="date" value={form.date} onChange={(e) => setForm((f: any) => ({ ...f, date: e.target.value }))} />
        </Field>
      </div>
      <Field label="Hora de inicio (modificable)">
        <input type="time" value={form.start} onChange={(e) => setForm((f: any) => ({ ...f, start: e.target.value }))} />
      </Field>
      <p className="muted" style={{ fontSize: 12 }}>
        Con fecha de HOY el contador queda en marcha («⏹ Terminar» lo detiene y muestra el precio).
        Con fecha futura la clase queda agendada. Si el profesor tiene correo (✉), al crearla se
        abre la invitación de Google Calendar para notificarle.
      </p>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}

/** Tarjetas de clases EN CURSO: contador vivo, hora de inicio editable y botón Terminar. */
function ClasesEnCurso({ open, nameOf, svcName, onEditStart, onTerminar }: {
  open: Transaction[]
  nameOf: (id: number | null) => string
  svcName: (t: Transaction) => string
  onEditStart: (t: Transaction, startMin: number | null) => void
  onTerminar: (t: Transaction) => void
}) {
  // Tic cada 30 s para que el contador avance (el cómputo usa la hora real).
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const i = setInterval(tick, 30_000)
    return () => clearInterval(i)
  }, [])
  if (!open.length) return null
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: 16 }}>
      {open.map((t) => {
        const elapsed = t.startMin != null ? Math.max(0, nowMin() - t.startMin) : null
        return (
          <div className="panel panel-p" key={t.id} style={{ borderLeft: '4px solid var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
              <div>
                <strong>{nameOf(t.clientId)}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{svcName(t)}{t.professorId != null ? ` · ${nameOf(t.professorId)}` : ''}</div>
              </div>
              <span className="badge open">EN CURSO</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <label className="muted" style={{ fontSize: 12 }}>Inicio</label>
              <input
                type="time"
                style={{ width: 110 }}
                value={t.startMin != null ? minutesToHHMM(t.startMin) : ''}
                onChange={(e) => onEditStart(t, e.target.value ? hhmmToMinutes(e.target.value) : null)}
                title="Hora de inicio (modificable)"
              />
              <div style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ fontSize: 20, fontWeight: 800 }}>{elapsed != null ? fmtDur(elapsed) : '—'}</span>
              </div>
            </div>
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={() => onTerminar(t)}>
              ⏹ Terminar — calcular precio
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function Transacciones() {
  const { data, loading, reload } = useAsync(() => api.transactions.list({ limit: 500 }), [])
  const persons = useAsync(() => api.persons.list({ limit: 2000 }), [])
  const services = useAsync(() => api.catalog.listServices(true), [])
  const equipment = useAsync(() => api.catalog.listEquipment(true), [])
  const [grouped, setGrouped] = useState(false)
  const [addingClass, setAddingClass] = useState(false)
  const [finished, setFinished] = useState<Transaction | null>(null)

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
  /** Terminar una clase en curso: detiene el contador y muestra el precio a pagar. */
  async function terminar(t: Transaction) {
    try {
      const done = await api.transactions.checkout(t.id)
      setFinished(done)
      reload()
    } catch (e: any) {
      alert(e?.message ?? String(e))
    }
  }
  /** Cambiar la hora de inicio de una clase en curso (el contador se recalcula). */
  async function editarInicio(t: Transaction, startMin: number | null) {
    const base: any = { ...t, serviceSel: t.isClass ? CLASS : t.serviceId == null ? '' : String(t.serviceId) }
    await api.transactions.update(t.id, toInput({ ...base, startMin }))
    reload()
  }

  const nameOf = (id: number | null) => persons.data?.find((p) => p.id === id)?.fullName ?? '—'
  const svcName = (t: Transaction) =>
    (services.data ?? []).find((s) => s.id === (t.resolvedServiceId ?? t.serviceId))?.name ?? (t.isClass ? 'Clase de curso' : t.serviceRaw ?? 'Servicio')
  // Tarjetas con contador: solo las abiertas de HOY (las de fecha futura son agendadas)
  const openSessions = (data ?? []).filter((t) => t.isOpen && t.txDate === todayISO())

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
          <button className="btn primary" onClick={() => setAddingClass(true)}>＋ Añadir clase</button>
        </div>
      </div>
      <p className="muted" style={{ margin: '-6px 0 14px' }}>
        «＋ Añadir clase» pone el contador en marcha; «⏹ Terminar» lo detiene y muestra el precio a pagar.
        Las horas de inicio y fin se pueden modificar en cualquier momento (en la tarjeta o en la cuadrícula).
      </p>

      {!busy && (
        <ClasesEnCurso
          open={openSessions}
          nameOf={nameOf}
          svcName={svcName}
          onEditStart={editarInicio}
          onTerminar={terminar}
        />
      )}

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
              <button className="btn primary sm" onClick={() => terminar(r)} title="Terminar (hora actual) y calcular el precio">⏹ Terminar</button>
            ) : null
          }
        />
      )}

      {/* Alta de clase con contador — solo personas ACTIVAS (los inactivos no dan más clases) */}
      {addingClass && (
        <NuevaClaseModal
          clients={clients.filter((c) => c.stillHere !== false).map((c) => ({ id: c.id, label: c.fullName }))}
          professors={professors.filter((p) => p.stillHere !== false).map((p) => ({ id: p.id, label: p.nickname || p.fullName, email: p.email ?? null }))}
          serviceOpts={serviceOpts}
          services={(services.data ?? []).map((s) => ({ id: s.id, name: s.name, hours: s.hours ?? null }))}
          onClose={() => setAddingClass(false)}
          onStarted={() => { setAddingClass(false); reload() }}
        />
      )}

      {/* Resumen al terminar: contador detenido + precio a pagar */}
      {finished && (
        <Modal
          title="✅ Clase terminada"
          onClose={() => setFinished(null)}
          footer={<button className="btn primary" onClick={() => setFinished(null)}>Listo</button>}
        >
          <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{nameOf(finished.clientId)}</div>
            <div className="muted" style={{ marginTop: 2 }}>{svcName(finished)}</div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              <div className="panel stat">
                <div className="label">Duración</div>
                <div className="value">{finished.durationMin != null ? fmtDur(finished.durationMin) : '—'}</div>
              </div>
              <div className="panel stat">
                <div className="label">Precio a pagar</div>
                <div className="value" style={{ color: 'var(--brand-strong)' }}>{formatCOP(finished.priceEffective)}</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              {finished.startMin != null && finished.endMin != null
                ? `${minutesToHHMM(finished.startMin)} – ${minutesToHHMM(finished.endMin)} · `
                : ''}
              El importe quedó cargado a la cuenta del cliente. Puedes ajustar las horas en la cuadrícula si hace falta.
            </div>
          </div>
        </Modal>
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
                      <td>{t.txType === 'loan' ? <span className="badge loan">Alquiler</span> : t.isClass ? <span className="badge class">Clase</span> : ''} {svcOf(t.resolvedServiceId ?? t.serviceId) ?? t.serviceRaw ?? '—'}</td>
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
