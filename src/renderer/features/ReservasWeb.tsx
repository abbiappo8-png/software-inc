import React, { useEffect, useState } from 'react'
import { api, useAsync, minutesToHHMM, hhmmToMinutes } from '../lib/api'
import { Modal, Field, Spinner, Empty } from '../components/ui'
import type { FormConfig, FormGuess, FormResponse, FormSyncResult } from '@shared/types/domain'
import { NavLink } from 'react-router-dom'

type Resp = FormResponse & { guess: FormGuess }

/** Convierte la URL del formulario en su versión embebible. */
function embedUrl(formUrl: string): string {
  if (!formUrl) return ''
  if (formUrl.includes('embedded=true')) return formUrl
  const sep = formUrl.includes('?') ? '&' : '?'
  return formUrl + sep + 'embedded=true'
}

export function ReservasWeb() {
  const formsCfg = useAsync(() => api.forms.list(), [])
  const [formKey, setFormKey] = useState<string | null>(null)
  const [tab, setTab] = useState<'respuestas' | 'llenar'>('respuestas')
  const [responses, setResponses] = useState<Resp[] | null>(null)
  const [syncInfo, setSyncInfo] = useState<FormSyncResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [converting, setConverting] = useState<{ resp: Resp; kind: 'client' | 'reservation' } | null>(null)

  const forms = formsCfg.data ?? []
  const current: FormConfig | undefined = forms.find((f) => f.key === formKey) ?? forms[0]

  useEffect(() => {
    if (!formKey && forms.length) setFormKey(forms[0].key)
  }, [forms, formKey])

  async function syncAndLoad(key: string) {
    setBusy(true)
    setResponses(null)   // limpia la tabla del formulario anterior (muestra el Spinner)
    setSyncInfo(null)    // y su resumen/badge de "nuevas"
    try {
      const info = await api.forms.sync(key)
      setSyncInfo(info)
      setResponses(await api.forms.responses(key))
    } catch (e: any) {
      setSyncInfo({ formKey: key, fetched: 0, added: 0, error: e?.message ?? 'Error al sincronizar' })
      setResponses([]) // evita el Spinner infinito
    } finally {
      setBusy(false)
    }
  }
  // Sincroniza automáticamente al abrir la página / cambiar de formulario.
  useEffect(() => {
    if (current?.key) syncAndLoad(current.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key])

  async function reloadResponses() {
    if (!current?.key) return
    try {
      setResponses(await api.forms.responses(current.key))
    } catch (e: any) {
      setErr('Error: ' + (e?.message ?? e))
    }
  }
  async function ignorar(id: number) {
    setErr(null)
    try {
      await api.forms.ignore(id)
      await reloadResponses()
    } catch (e: any) {
      setErr('Error: ' + (e?.message ?? e))
    }
  }

  if (formsCfg.loading) return <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>

  if (!forms.length) {
    return (
      <div>
        <div className="header"><h1>Reservas Web</h1></div>
        <div className="panel panel-p" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Conecta tu Google Forms</h3>
          <ol style={{ lineHeight: 1.9, paddingLeft: 20 }}>
            <li>Abre la <strong>hoja de respuestas</strong> de tu formulario en Google Sheets.</li>
            <li>Menú <strong>Archivo → Compartir → Publicar en la web</strong> → elige la hoja y formato <strong>CSV</strong> → Publicar.</li>
            <li>Copia ese enlace y pégalo en <NavLink to="/ajustes">Ajustes → Formularios de Google</NavLink>, junto con el enlace del formulario.</li>
          </ol>
          <p className="muted">Después, esta página traerá las respuestas automáticamente y podrás convertirlas en reservas o clientes con un clic.</p>
        </div>
      </div>
    )
  }

  const nuevas = (responses ?? []).filter((r) => r.status === 'new').length

  return (
    <div>
      <div className="header">
        <h1>Reservas Web</h1>
        <div className="toolbar" style={{ margin: 0 }}>
          {forms.length > 1 && (
            <select value={current?.key ?? ''} onChange={(e) => setFormKey(e.target.value)} style={{ width: 220 }}>
              {forms.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
            </select>
          )}
          <button className={`btn sm ${tab === 'respuestas' ? 'primary' : ''}`} onClick={() => setTab('respuestas')}>
            Respuestas {nuevas > 0 && <span className="badge open">{nuevas} nuevas</span>}
          </button>
          <button className={`btn sm ${tab === 'llenar' ? 'primary' : ''}`} onClick={() => setTab('llenar')}>Llenar formulario</button>
          <button className="btn primary sm" onClick={() => current && syncAndLoad(current.key)} disabled={busy}>
            {busy ? <Spinner /> : '⟳ Sincronizar'}
          </button>
        </div>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      {syncInfo?.error && <div className="err" style={{ marginBottom: 12 }}>{syncInfo.error}</div>}
      {syncInfo && !syncInfo.error && (
        <p className="muted" style={{ margin: '-6px 0 12px' }}>
          Última sincronización: {syncInfo.fetched} respuestas en la hoja · {syncInfo.added} nuevas guardadas.
        </p>
      )}

      {tab === 'llenar' ? (
        current?.formUrl ? (
          <div className="panel" style={{ height: 'calc(100vh - 160px)' }}>
            <iframe
              src={embedUrl(current.formUrl)}
              title={current.name}
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          </div>
        ) : (
          <Empty>Este formulario no tiene URL configurada (Ajustes → Formularios de Google).</Empty>
        )
      ) : responses == null ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : !responses.length ? (
        <Empty>Aún no hay respuestas sincronizadas.</Empty>
      ) : (
        <div className="panel">
          <table className="data">
            <thead>
              <tr>
                <th>Recibida</th>
                <th>Nombre</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Clase / Servicio</th>
                <th>Email</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr key={r.id}>
                  <td title={JSON.stringify(r.values, null, 1)}>{(r.submittedAt ?? '').slice(0, 16) || '—'}</td>
                  <td>{r.guess.fullName ?? '—'}</td>
                  <td>{r.guess.date ?? '—'}</td>
                  <td>{r.guess.startMin != null ? minutesToHHMM(r.guess.startMin) : '—'}</td>
                  <td>{r.guess.service ?? '—'}</td>
                  <td className="muted">{r.guess.email ?? '—'}</td>
                  <td>
                    {r.status === 'new' && <span className="badge open">Nueva</span>}
                    {r.status === 'imported' && <span className="badge ok">Importada</span>}
                    {r.status === 'ignored' && <span className="badge off">Ignorada</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'new' && (
                      <>
                        <button className="btn primary sm" onClick={() => setConverting({ resp: r, kind: 'reservation' })}>Crear reserva</button>{' '}
                        <button className="btn sm" onClick={() => setConverting({ resp: r, kind: 'client' })}>Crear cliente</button>{' '}
                        <button className="btn ghost sm" onClick={() => ignorar(r.id)}>Ignorar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {converting && (
        <ConvertModal
          resp={converting.resp}
          kind={converting.kind}
          onClose={() => setConverting(null)}
          onDone={() => {
            setConverting(null)
            reloadResponses()
          }}
        />
      )}
    </div>
  )
}

function ConvertModal({ resp, kind, onClose, onDone }: { resp: Resp; kind: 'client' | 'reservation'; onClose: () => void; onDone: () => void }) {
  const [g, setG] = useState<FormGuess>({ ...resp.guess })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<FormGuess>) => setG((x) => ({ ...x, ...p }))

  async function confirm() {
    setErr(null)
    if (!g.fullName?.trim()) return setErr('El nombre es obligatorio.')
    setBusy(true)
    try {
      await api.forms.convert(resp.id, kind, g)
      onDone()
    } catch (e: any) {
      setErr(e?.message ?? 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={kind === 'reservation' ? 'Crear reserva desde la respuesta' : 'Crear cliente desde la respuesta'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : kind === 'reservation' ? 'Crear reserva' : 'Crear cliente'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Campos detectados automáticamente en la respuesta — corrígelos si hace falta.
        {kind === 'reservation' && ' La reserva queda como sesión ABIERTA (se cobra al registrar la salida).'}
      </p>
      <div className="row2">
        <Field label="Nombre del cliente"><input value={g.fullName ?? ''} onChange={(e) => set({ fullName: e.target.value || null })} /></Field>
        <Field label="Email"><input value={g.email ?? ''} onChange={(e) => set({ email: e.target.value || null })} /></Field>
      </div>
      <div className="row3">
        <Field label="Pasaporte / documento"><input value={g.passport ?? ''} onChange={(e) => set({ passport: e.target.value || null })} /></Field>
        <Field label="País"><input value={g.country ?? ''} onChange={(e) => set({ country: e.target.value || null })} /></Field>
        <Field label="Nacimiento"><input type="date" value={g.birthDate ?? ''} onChange={(e) => set({ birthDate: e.target.value || null })} /></Field>
      </div>
      {kind === 'reservation' && (
        <div className="row3">
          <Field label="Fecha de la clase"><input type="date" value={g.date ?? ''} onChange={(e) => set({ date: e.target.value || null })} /></Field>
          <Field label="Hora"><input type="time" value={g.startMin != null ? minutesToHHMM(g.startMin) : ''} onChange={(e) => set({ startMin: e.target.value ? hhmmToMinutes(e.target.value) : null })} /></Field>
          <Field label="Clase / servicio (texto del form)"><input value={g.service ?? ''} onChange={(e) => set({ service: e.target.value || null })} /></Field>
        </div>
      )}
      <Field label="Comentario"><input value={g.comment ?? ''} onChange={(e) => set({ comment: e.target.value || null })} /></Field>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
