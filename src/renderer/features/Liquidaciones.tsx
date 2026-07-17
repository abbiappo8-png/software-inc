import React, { useState } from 'react'
import { api, useAsync, formatCOP, todayISO } from '../lib/api'
import { Field, Spinner } from '../components/ui'
import { SearchSelect } from '../components/SearchSelect'
import type { SettlementPayment } from '@shared/types/domain'

const now = new Date()

/** Horas con hasta 2 decimales (ej. "1,5"); '—' si la clase sigue abierta. */
function fmtHoras(h: number | null | undefined): string {
  if (h == null) return '—'
  return (Math.round(h * 100) / 100).toLocaleString('es-CO')
}

export function Liquidaciones() {
  const professors = useAsync(() => api.persons.list({ role: 'professor', limit: 2000 }), [])
  const [professorId, setProfessorId] = useState<number | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [preview, setPreview] = useState<any>(null)
  const [abonos, setAbonos] = useState<SettlementPayment[]>([])
  const [ab, setAb] = useState({ date: todayISO(), amount: 0, comment: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function doPreview() {
    if (!professorId) return
    setBusy(true)
    setMsg(null)
    try {
      const [p, pays] = await Promise.all([
        api.settlements.preview(professorId, year, month),
        api.settlements.listPayments(professorId, year, month)
      ])
      setPreview(p)
      setAbonos(pays)
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  /** Refresca vista previa + abonos (tras registrar/eliminar un abono o pagar). */
  async function refreshAll() {
    if (!professorId) return
    const [p, pays] = await Promise.all([
      api.settlements.preview(professorId, year, month),
      api.settlements.listPayments(professorId, year, month)
    ])
    setPreview(p)
    setAbonos(pays)
  }
  async function registrarAbono() {
    if (!professorId || !(ab.amount > 0)) return
    setBusy(true)
    try {
      await api.settlements.addPayment({
        professorId, year, month,
        payDate: ab.date || todayISO(),
        amount: ab.amount,
        comment: ab.comment.trim() || null
      })
      setAb({ date: todayISO(), amount: 0, comment: '' })
      await refreshAll()
      setMsg('✔ Abono registrado (también quedó en Gastos).')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  async function quitarAbono(id: number) {
    if (!confirm('¿Eliminar este abono? También se elimina su gasto.')) return
    setBusy(true)
    try {
      await api.settlements.removePayment(id)
      await refreshAll()
      setMsg('Abono eliminado.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    if (!professorId) return
    setBusy(true)
    try {
      await api.settlements.save(professorId, year, month)
      setPreview(await api.settlements.preview(professorId, year, month))
      setMsg('Liquidación guardada.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
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
    try {
      const path = await api.settlements.pdf(professorId, year, month)
      setMsg('PDF generado: ' + path)
    } catch (e: any) {
      // p. ej. pop-up bloqueado en la web: "permite las ventanas emergentes…"
      setMsg('Error: ' + (e?.message ?? e))
    }
  }

  const abonado = abonos.reduce((a, p) => a + p.amount, 0)
  const saldo = Math.max(0, (preview?.result?.net ?? 0) - abonado)

  return (
    <div>
      <div className="header"><h1>Liquidación de profesores</h1></div>
      <div className="panel panel-p">
        <div className="row3" style={{ alignItems: 'end' }}>
          <Field label="Profesor">
            <SearchSelect
              value={professorId == null ? '' : String(professorId)}
              options={(professors.data ?? []).map((p) => ({ value: String(p.id), label: p.nickname || p.fullName }))}
              onChange={(v) => v && setProfessorId(Number(v))}
              placeholder="— Busca el profesor —"
            />
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
          <button className="btn" onClick={save} disabled={!preview || busy}>Guardar</button>
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
            <thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th className="num">Horas</th><th className="num">Salario</th></tr></thead>
            <tbody>
              {preview.salaryRows.map((r: any, i: number) => (
                <tr key={i}><td>{r.date}</td><td>{r.service}</td><td>{r.client}</td><td className="num">{fmtHoras(r.hours)}</td><td className="num">{formatCOP(r.salary)}</td></tr>
              ))}
              {!preview.salaryRows.length && <tr><td colSpan={5} className="muted">Sin clases en el periodo.</td></tr>}
            </tbody>
          </table>
          <table className="data" style={{ marginTop: 12, maxWidth: 360, marginLeft: 'auto' }}>
            <tbody>
              <tr><td>Horas dictadas</td><td className="num">{fmtHoras(preview.salaryRows.reduce((a: number, r: any) => a + (r.hours ?? 0), 0))}</td></tr>
              <tr><td>Bruto</td><td className="num">{formatCOP(preview.result.gross)}</td></tr>
              <tr><td>Descuento bar</td><td className="num">− {formatCOP(preview.result.barDiscount)}</td></tr>
              <tr><td><strong>Neto a pagar</strong></td><td className="num"><strong>{formatCOP(preview.result.net)}</strong></td></tr>
              {abonado > 0 && <tr><td>Abonado</td><td className="num">− {formatCOP(abonado)}</td></tr>}
              {abonado > 0 && (
                <tr>
                  <td><strong>Saldo pendiente</strong></td>
                  <td className="num"><strong>{saldo > 0 ? formatCOP(saldo) : '$ 0 ✔'}</strong></td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <strong>Abonos al profesor</strong>
            {abonos.length > 0 ? (
              <table className="data" style={{ marginTop: 8 }}>
                <thead><tr><th>Fecha</th><th>Comentario</th><th className="num">Monto</th><th /></tr></thead>
                <tbody>
                  {abonos.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payDate}</td>
                      <td className="muted">{p.comment ?? ''}</td>
                      <td className="num">{formatCOP(p.amount)}</td>
                      <td style={{ width: 40, textAlign: 'center' }}>
                        <button className="btn ghost sm" title="Eliminar abono" onClick={() => quitarAbono(p.id)} disabled={busy}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>Sin abonos registrados en este periodo.</div>
            )}
            {saldo > 0 && (
              <div className="row3" style={{ alignItems: 'end', marginTop: 10 }}>
                <Field label="Fecha del abono">
                  <input type="date" value={ab.date} onChange={(e) => setAb({ ...ab, date: e.target.value })} />
                </Field>
                <Field label="Monto (COP)">
                  <input type="number" min={0} value={ab.amount || ''} onChange={(e) => setAb({ ...ab, amount: Number(e.target.value) })} />
                </Field>
                <Field label="Comentario (opcional)">
                  <input value={ab.comment} onChange={(e) => setAb({ ...ab, comment: e.target.value })} placeholder="ej. efectivo, Nequi…" />
                </Field>
              </div>
            )}
            {saldo > 0 && (
              <button
                className="btn primary"
                style={{ marginTop: 8 }}
                onClick={registrarAbono}
                disabled={busy || !(ab.amount > 0)}
                title="Registra un pago parcial; también queda como gasto del día"
              >
                💵 Registrar abono
              </button>
            )}
            {saldo === 0 && abonado > 0 && (
              <div className="ok" style={{ marginTop: 8, fontSize: 13 }}>Los abonos cubren el neto: la liquidación quedó PAGADA.</div>
            )}
          </div>
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
