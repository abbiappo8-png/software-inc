import React, { useEffect, useRef, useState } from 'react'
import { api, useAsync, formatCOP, minutesToHHMM, todayISO } from '../lib/api'
import { Modal, Spinner, Avatar, Empty } from '../components/ui'
import { CameraCapture } from '../components/CameraCapture'

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

/** Ficha de persona: foto, datos, cuenta de cliente y/o clases dadas como profesor. */
export function ClientProfile({ personId, onClose }: { personId: number; onClose: () => void }) {
  const { data: person, loading } = useAsync(() => api.persons.get(personId), [personId])
  const txs = useAsync(() => api.transactions.list({ clientId: personId, limit: 500 }), [personId])
  // Clases DADAS (como profesor): otra consulta, por professor_id.
  const profTxs = useAsync(
    () => (person?.isProfessor ? api.transactions.list({ professorId: personId, limit: 500 }) : Promise.resolve([])),
    [personId, person?.isProfessor]
  )
  const services = useAsync(() => api.catalog.listServices(), [])
  // Nombres de los clientes de las clases dadas (solo hace falta si es profesor).
  const people = useAsync(
    () => (person?.isProfessor ? api.persons.list({ limit: 2000 }) : Promise.resolve([])),
    [person?.isProfessor]
  )
  const [photo, setPhoto] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const svcName = (t: any) =>
    services.data?.find((s) => s.id === (t.resolvedServiceId ?? t.serviceId))?.name ?? t.serviceRaw ?? (t.isClass ? 'Clase de curso' : '—')
  const clientName = (id: number | null) => people.data?.find((p) => p.id === id)?.fullName ?? '—'

  useEffect(() => {
    if (person?.photoThumbPath || person?.photoPath) api.persons.photoDataUrl(personId).then(setPhoto)
  }, [person, personId])

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const b64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()))
    setPhoto(`data:${f.type || 'image/jpeg'};base64,` + b64)
    await api.persons.setPhoto(personId, b64)
  }

  /** Foto tomada con la cámara del dispositivo. */
  async function onCameraShot(dataUrl: string) {
    setCamera(false)
    setPhoto(dataUrl)
    await api.persons.setPhoto(personId, dataUrl.replace(/^data:image\/\w+;base64,/, ''))
  }

  const rows = txs.data ?? []
  const totalCharged = rows.filter((t) => !t.isOpen).reduce((a, t) => a + (t.priceEffective ?? 0), 0)
  const openCount = rows.filter((t) => t.isOpen).length
  // Como profesor
  const given = profTxs.data ?? []
  const salaryTotal = given.filter((t) => !t.isOpen).reduce((a, t) => a + (t.professorSalary ?? 0), 0)

  const roles = person
    ? [person.isClient && 'Cliente', person.isProfessor && 'Profesor', person.isSupplier && 'Proveedor'].filter(Boolean).join(' · ')
    : ''

  return (
    <Modal title={person?.fullName ?? 'Perfil'} onClose={onClose} footer={<button className="btn" onClick={onClose}>Cerrar</button>}>
      {loading || !person ? (
        <Spinner />
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
            <div style={{ textAlign: 'center' }}>
              <Avatar dataUrl={photo} name={person.fullName} size="lg" />
              <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                <button className="btn primary sm" onClick={() => setCamera(true)}>📷 Tomar foto</button>
                <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>Subir archivo…</button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{person.fullName}</div>
              {person.nickname && <div className="muted">“{person.nickname}”</div>}
              <div className="muted" style={{ marginTop: 2 }}>{roles || '—'}</div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <Info label="Email" value={person.email} />
                <Info label="País" value={person.country} />
                <Info label="Pasaporte" value={person.passport} />
                <Info label="Nacimiento" value={person.birthDate} />
                <Info label="Check-in" value={person.checkIn} />
                <Info label="Check-out" value={person.checkOut} />
              </div>
            </div>
          </div>

          {person.isClient && (
            <>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div className="panel stat"><div className="label">Total cargado</div><div className="value">{formatCOP(totalCharged)}</div></div>
                <div className="panel stat"><div className="label">Registros</div><div className="value">{rows.length}</div></div>
                <div className="panel stat"><div className="label">Abiertas</div><div className="value">{openCount}</div></div>
              </div>

              <strong>Historial de clases y servicios</strong>
              {txs.loading ? (
                <Spinner />
              ) : !rows.length ? (
                <Empty>Sin registros.</Empty>
              ) : (
                <table className="data" style={{ marginTop: 8, marginBottom: 18 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Horario</th><th className="num">Precio</th></tr></thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className={t.isOpen ? 'row-open' : undefined}>
                        <td>{t.txDate}</td>
                        <td>{t.txType === 'loan' ? <span className="badge loan">Alquiler</span> : t.isClass ? <span className="badge class">Clase</span> : ''} {svcName(t)}</td>
                        <td>{t.startMin != null ? minutesToHHMM(t.startMin) : '—'}{t.endMin != null ? `–${minutesToHHMM(t.endMin)}` : ''}</td>
                        <td className="num">{t.isOpen ? <span className="badge open">Abierta</span> : formatCOP(t.priceEffective)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {person.isProfessor && (
            <>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '16px 0' }}>
                <div className="panel stat"><div className="label">Clases dadas</div><div className="value">{given.filter((t) => !t.isOpen).length}</div></div>
                <div className="panel stat"><div className="label">Salario generado</div><div className="value">{formatCOP(salaryTotal)}</div></div>
                <div className="panel stat"><div className="label">En curso / agendadas</div><div className="value">{given.filter((t) => t.isOpen).length}</div></div>
              </div>

              <strong>Clases dadas (como profesor)</strong>
              {profTxs.loading ? (
                <Spinner />
              ) : !given.length ? (
                <Empty>Sin clases registradas como profesor.</Empty>
              ) : (
                <table className="data" style={{ marginTop: 8 }}>
                  <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicio</th><th>Horario</th><th className="num">Salario</th></tr></thead>
                  <tbody>
                    {given.map((t) => (
                      <tr key={t.id} className={t.isOpen ? 'row-open' : undefined}>
                        <td>{t.txDate}</td>
                        <td>{clientName(t.clientId)}</td>
                        <td>{t.isClass ? <span className="badge class">Clase</span> : ''} {svcName(t)}</td>
                        <td>{t.startMin != null ? minutesToHHMM(t.startMin) : '—'}{t.endMin != null ? `–${minutesToHHMM(t.endMin)}` : ''}</td>
                        <td className="num">{t.isOpen ? <span className="badge open">{t.txDate === todayISO() ? 'En curso' : 'Agendada'}</span> : formatCOP(t.professorSalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {camera && (
            <CameraCapture
              title={`Tomar foto — ${person.fullName}`}
              onCapture={onCameraShot}
              onClose={() => setCamera(false)}
            />
          )}
        </div>
      )}
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div>{value || '—'}</div>
    </div>
  )
}
