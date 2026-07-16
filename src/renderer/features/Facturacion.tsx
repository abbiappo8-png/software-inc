import React, { useState } from 'react'
import { api, useAsync, formatCOP } from '../lib/api'
import { Field, Spinner } from '../components/ui'

type Done = { billId: number } | null

export function Facturacion() {
  const clients = useAsync(() => api.persons.list({ role: 'client', limit: 2000 }), [])
  const [clientId, setClientId] = useState<number | null>(null)
  const [opts, setOpts] = useState({ discountPct: 0, deduction: 0, lodgingRate: 0, cardSurcharge: false })
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function doPreview(id: number) {
    setClientId(id)
    setDone(null)
    setMsg(null)
    if (!id) return setPreview(null)
    setBusy(true)
    try {
      setPreview(await api.bills.preview(id, opts))
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  async function refresh() {
    if (!clientId) return
    try {
      setPreview(await api.bills.preview(clientId, opts))
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    }
  }

  /** Cobrar: crea la factura y registra el cobro → el saldo del cliente queda en $0. */
  async function cobrar() {
    if (!clientId) return
    setBusy(true)
    try {
      const bill = await api.bills.save(clientId, opts)
      await api.bills.markPaid(bill.id)
      setDone({ billId: bill.id })
      setMsg(`Factura N.º ${bill.id} cobrada ✔ — el saldo del cliente quedó en $ 0.`)
      await refresh() // refleja "Ya pagado" completo y neto $0
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function pdf() {
    if (!done) return
    try {
      const path = await api.bills.pdf(done.billId)
      if (path) setMsg('PDF generado: ' + path)
    } catch (e: any) {
      // p. ej. pop-up bloqueado en la web: "permite las ventanas emergentes…"
      setMsg('Error: ' + (e?.message ?? e))
    }
  }
  async function email() {
    if (!done) return
    setBusy(true)
    try {
      const res = await api.bills.email(done.billId)
      setMsg(res.ok ? 'Factura enviada por correo ✔' : 'No se pudo enviar: ' + res.error)
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  /** Guardar: la factura ya está guardada; cierra el flujo y deja listo para la siguiente. */
  function guardar() {
    setMsg(`Factura N.º ${done?.billId} guardada ✔`)
    setDone(null)
  }

  return (
    <div>
      <div className="header"><h1>Facturación de cliente</h1></div>
      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="panel panel-p">
          <Field label="Cliente">
            <select value={clientId ?? ''} onChange={(e) => doPreview(Number(e.target.value))}>
              <option value="">— Selecciona —</option>
              {clients.data?.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </Field>
          <div className="row2">
            <Field label="Descuento factura (%)"><input type="number" value={opts.discountPct} onChange={(e) => setOpts({ ...opts, discountPct: Number(e.target.value) })} onBlur={refresh} /></Field>
            <Field label="Deducción (COP)"><input type="number" value={opts.deduction} onChange={(e) => setOpts({ ...opts, deduction: Number(e.target.value) })} onBlur={refresh} /></Field>
          </div>
          <Field label="Tarifa hospedaje / día (COP)"><input type="number" value={opts.lodgingRate} onChange={(e) => setOpts({ ...opts, lodgingRate: Number(e.target.value) })} onBlur={refresh} /></Field>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={opts.cardSurcharge} onChange={(e) => { setOpts({ ...opts, cardSurcharge: e.target.checked }) }} onBlur={refresh} /> Pago con tarjeta (+5%)</label>

          {!done ? (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={refresh} disabled={!clientId || busy}>Recalcular</button>
              <button className="btn primary" onClick={cobrar} disabled={!clientId || busy} title="Crea la factura y registra el cobro: el saldo del cliente queda en $0">
                Cobrar
              </button>
            </div>
          ) : (
            <div className="panel" style={{ marginTop: 16, background: 'var(--panel-2)' }}>
              <div className="panel-p">
                <div style={{ fontWeight: 700, marginBottom: 10 }}>✅ Factura cobrada — saldo en $ 0</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <button className="btn primary" onClick={email} disabled={busy}>✉️ Enviar por correo</button>
                  <button className="btn" onClick={pdf} disabled={busy}>📄 PDF</button>
                  <button className="btn" onClick={guardar} disabled={busy}>💾 Guardar</button>
                </div>
              </div>
            </div>
          )}
          {msg && <div className="ok" style={{ marginTop: 10, fontSize: 13 }}>{msg}</div>}
        </div>

        <div className="panel panel-p">
          {busy && !preview ? <Spinner /> : !preview ? <p className="muted">Selecciona un cliente para ver su cuenta.</p> : (
            <div>
              <h3 style={{ marginTop: 0 }}>{preview.clientName}</h3>
              <table className="data">
                <thead><tr><th>Descripción</th><th className="num">Cant.</th><th className="num">V. Unit.</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {preview.items.map((it: any, i: number) => (
                    <tr key={i}><td>{it.description}</td><td className="num">{it.qty}</td><td className="num">{formatCOP(it.unitPrice)}</td><td className="num">{formatCOP(it.lineTotal)}</td></tr>
                  ))}
                  {!preview.items.length && <tr><td colSpan={4} className="muted">Sin ítems.</td></tr>}
                </tbody>
              </table>
              <table className="data" style={{ marginTop: 12, maxWidth: 380, marginLeft: 'auto' }}>
                <tbody>
                  <tr><td>Subtotal servicios</td><td className="num">{formatCOP(preview.result.subtotal)}</td></tr>
                  <tr><td>Bar</td><td className="num">{formatCOP(preview.result.barTotal)}</td></tr>
                  <tr><td>Hospedaje</td><td className="num">{formatCOP(preview.result.lodging)}</td></tr>
                  <tr><td>Total</td><td className="num">{formatCOP(preview.result.total)}</td></tr>
                  <tr><td>Ya pagado</td><td className="num">− {formatCOP(preview.result.alreadyPaid)}</td></tr>
                  <tr><td><strong>Saldo (neto a pagar)</strong></td><td className="num"><strong>{formatCOP(preview.result.netToPay)}</strong></td></tr>
                  {opts.cardSurcharge && <tr><td className="muted">Con tarjeta (+5%)</td><td className="num">{formatCOP(preview.result.cardTotal)}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
