import React, { useState } from 'react'
import { api, useAsync, formatCOP } from '../lib/api'
import { Field, Spinner } from '../components/ui'

const now = new Date()

export function Liquidaciones() {
  const professors = useAsync(() => api.persons.list({ role: 'professor', limit: 2000 }), [])
  const [professorId, setProfessorId] = useState<number | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function doPreview() {
    if (!professorId) return
    setBusy(true)
    setMsg(null)
    try {
      setPreview(await api.settlements.preview(professorId, year, month))
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    if (!professorId) return
    await api.settlements.save(professorId, year, month)
    setPreview(await api.settlements.preview(professorId, year, month))
    setMsg('Liquidación guardada.')
  }
  async function marcarPagado() {
    if (!professorId) return
    setBusy(true)
    try {
      await api.settlements.markPaid(professorId, year, month)
      setPreview(await api.settlements.preview(professorId, year, month)) // refresca el badge
      setMsg('✔ Liquidación marcada como PAGADA.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  async function pdf() {
    if (!professorId) return
    const path = await api.settlements.pdf(professorId, year, month)
    setMsg('PDF generado: ' + path)
  }

  return (
    <div>
      <div className="header"><h1>Liquidación de profesores</h1></div>
      <div className="panel panel-p">
        <div className="row3" style={{ alignItems: 'end' }}>
          <Field label="Profesor">
            <select value={professorId ?? ''} onChange={(e) => setProfessorId(Number(e.target.value))}>
              <option value="">— Selecciona —</option>
              {professors.data?.map((p) => <option key={p.id} value={p.id}>{p.nickname || p.fullName}</option>)}
            </select>
          </Field>
          <Field label="Mes">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </Field>
          <Field label="Año">
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={doPreview} disabled={!professorId || busy}>Calcular</button>
          <button className="btn" onClick={save} disabled={!preview}>Guardar</button>
          <button
            className="btn primary"
            onClick={marcarPagado}
            disabled={!preview || busy || preview?.savedStatus === 'paid'}
            title="Marca la liquidación de este profesor y mes como pagada"
          >
            {preview?.savedStatus === 'paid' ? '✔ Pagado' : 'Marcar como pagado'}
          </button>
          <button className="btn" onClick={pdf} disabled={!preview}>PDF</button>
          {preview?.savedStatus === 'paid' && <span className="badge ok">PAGADO</span>}
          {preview?.savedStatus === 'issued' && <span className="badge open">Por pagar</span>}
        </div>
        {msg && <div className="ok" style={{ marginTop: 10, fontSize: 13 }}>{msg}</div>}
      </div>

      {busy ? <Spinner /> : preview && (
        <div className="panel panel-p" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            {preview.professorName} — {month}/{year}{' '}
            {preview.savedStatus === 'paid' && <span className="badge ok">PAGADO</span>}
          </h3>
          <table className="data">
            <thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th className="num">Salario</th></tr></thead>
            <tbody>
              {preview.salaryRows.map((r: any, i: number) => (
                <tr key={i}><td>{r.date}</td><td>{r.service}</td><td>{r.client}</td><td className="num">{formatCOP(r.salary)}</td></tr>
              ))}
              {!preview.salaryRows.length && <tr><td colSpan={4} className="muted">Sin clases en el periodo.</td></tr>}
            </tbody>
          </table>
          <table className="data" style={{ marginTop: 12, maxWidth: 360, marginLeft: 'auto' }}>
            <tbody>
              <tr><td>Bruto</td><td className="num">{formatCOP(preview.result.gross)}</td></tr>
              <tr><td>Descuento bar</td><td className="num">− {formatCOP(preview.result.barDiscount)}</td></tr>
              <tr><td><strong>Neto a pagar</strong></td><td className="num"><strong>{formatCOP(preview.result.net)}</strong></td></tr>
            </tbody>
          </table>
          {preview.outcomeRows?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Gastos registrados a nombre del profesor en el periodo (informativos, no descontados automáticamente):
              </div>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Comentario</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {preview.outcomeRows.map((r: any, i: number) => (
                    <tr key={i}><td>{r.date}</td><td>{r.supply ?? '—'}</td><td className="muted">{r.comment ?? ''}</td><td className="num">{formatCOP(r.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
