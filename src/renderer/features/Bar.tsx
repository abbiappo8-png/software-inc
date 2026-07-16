import React, { useState } from 'react'
import { api, useAsync, formatCOP, todayISO } from '../lib/api'
import { Modal, Field, Spinner } from '../components/ui'
import { EditableTable, GridColumn } from '../components/EditableTable'
import type { BarProduct } from '@shared/types/domain'

const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v))

export function Bar() {
  const products = useAsync(() => api.bar.listProducts(), [])
  const sales = useAsync(() => api.bar.listSales(), [])
  const clients = useAsync(() => api.persons.list({ limit: 2000 }), [])
  const [restock, setRestock] = useState<BarProduct | null>(null)

  const prodList = products.data ?? []
  const clientList = (clients.data ?? []).filter((c) => c.isClient || c.isProfessor)

  function toProduct(r: any) {
    return {
      name: (r.name ?? '').trim(),
      boxPrice: numOrNull(r.boxPrice),
      unitsPerBox: numOrNull(r.unitsPerBox),
      sellPrice: numOrNull(r.sellPrice)
    }
  }
  async function createProduct(draft: any) {
    if (!draft.name?.trim()) return
    try { await api.bar.createProduct(toProduct(draft)); products.reload() } catch (e: any) { alert(e?.message ?? 'Error') }
  }
  async function updateProduct(id: number, patch: any) {
    const row = prodList.find((p) => p.id === id); if (!row) return
    try { await api.bar.updateProduct(id, toProduct({ ...row, ...patch })); products.reload() } catch (e: any) { alert(e?.message ?? 'Error'); products.reload() }
  }

  async function createSale(draft: any) {
    if (!draft.productId || !(Number(draft.qty) > 0)) return
    try {
      await api.bar.createSale({
        saleDate: draft.saleDate,
        productId: Number(draft.productId),
        qty: Number(draft.qty),
        clientId: numOrNull(draft.clientId),
        paidCash: draft.paidCash !== false,
        alreadyPaid: draft.paidCash !== false
      })
      sales.reload(); products.reload()
    } catch (e: any) {
      alert(e?.message ?? 'Error')
    }
  }

  const productCols: GridColumn[] = [
    { key: 'name', label: 'Producto', type: 'text', width: 180 },
    { key: 'boxPrice', label: 'Precio caja', type: 'money', width: 120, align: 'right' },
    { key: 'unitsPerBox', label: 'Unid./caja', type: 'number', width: 100, align: 'right' },
    { key: 'sellPrice', label: 'Venta unid.', type: 'money', width: 120, align: 'right' },
    { key: 'unitCost', label: 'Costo u.', type: 'computed', align: 'right', width: 100, render: (r) => formatCOP(r.unitCost) },
    { key: 'stock', label: 'Stock', type: 'computed', align: 'right', width: 90, render: (r) => <strong style={{ color: (r.stock ?? 0) <= 0 ? 'var(--danger)' : undefined }}>{r.stock}</strong> }
  ]

  const clientOpts = [{ value: '', label: 'Directa (efectivo)' }, ...clientList.map((c) => ({ value: String(c.id), label: c.fullName }))]
  const productOpts = [{ value: '', label: '—' }, ...prodList.map((p) => ({ value: String(p.id), label: `${p.name} · ${formatCOP(p.sellPrice)} · stock ${p.stock}` }))]
  const saleCols: GridColumn[] = [
    { key: 'saleDate', label: 'Fecha', type: 'date', width: 150 },
    { key: 'productId', label: 'Producto', type: 'select', options: productOpts, width: 240, get: (r) => (r.productId == null ? '' : String(r.productId)), render: (r) => r.productRaw ?? '—' },
    { key: 'clientId', label: 'Cliente', type: 'select', options: clientOpts, width: 170, get: (r) => (r.clientId == null ? '' : String(r.clientId)), render: (r) => r.clientRaw ?? (r.clientId ? clientList.find((c) => c.id === r.clientId)?.fullName : 'Directa') ?? '—' },
    { key: 'qty', label: 'Cant.', type: 'number', width: 80, align: 'right' },
    { key: 'total', label: 'Total', type: 'computed', align: 'right', width: 110, render: (r) => formatCOP(r.total) },
    { key: 'paidCash', label: 'Efectivo', type: 'toggle', width: 80, align: 'center' }
  ]

  return (
    <div>
      <div className="header"><h1>Bar</h1></div>

      <div style={{ marginBottom: 8 }}><strong>Inventario</strong> <span className="muted">· “+ Stock” registra una compra que suma al inventario</span></div>
      {products.loading ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : (
        <EditableTable
          columns={productCols}
          rows={prodList}
          onCreate={createProduct}
          onUpdate={updateProduct}
          canCreate={(d) => !!d.name?.trim()}
          addLabel="Agregar"
          rowActions={(r) => <button className="btn ghost sm" onClick={() => setRestock(r)}>+ Stock</button>}
        />
      )}

      <div style={{ margin: '20px 0 8px' }}><strong>Ventas</strong> <span className="muted">· agrega una fila para registrar una venta</span></div>
      {sales.loading ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : (
        <EditableTable
          columns={saleCols}
          rows={sales.data ?? []}
          onCreate={createSale}
          canCreate={(d) => !!d.productId && Number(d.qty) > 0}
          newRowDefaults={{ saleDate: todayISO(), qty: 1, paidCash: true }}
          addLabel="Vender"
        />
      )}

      {restock && <RestockForm product={restock} onClose={() => setRestock(null)} onSaved={() => { setRestock(null); products.reload() }} />}
    </div>
  )
}

function RestockForm({ product, onClose, onSaved }: { product: BarProduct; onClose: () => void; onSaved: () => void }) {
  const s = product.unitsPerBox && product.boxPrice ? { units: product.unitsPerBox, amount: product.boxPrice } : { units: 0, amount: 0 }
  const [form, setForm] = useState({ date: todayISO(), units: s.units, amount: s.amount, comment: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: any) => setForm((f) => ({ ...f, ...p }))
  async function save() {
    setErr(null)
    if (!(Number(form.units) > 0)) return setErr('Ingresa cuántas unidades entran.')
    setBusy(true)
    try {
      await api.bar.restock({ productId: product.id, date: form.date, units: Number(form.units), amount: Number(form.amount) || 0, comment: form.comment || null })
      onSaved()
    } catch (e: any) { setErr(e?.message ?? 'Error') } finally { setBusy(false) }
  }
  return (
    <Modal title={`Ingresar stock — ${product.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Ingresar stock'}</button></>}>
      <p className="muted">Stock actual: <strong>{product.stock}</strong>. Registrar una entrada crea una compra (gasto) y suma al inventario.</p>
      <div className="row3">
        <Field label="Fecha de compra"><input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Unidades que entran"><input type="number" min={1} value={form.units} onChange={(e) => set({ units: Number(e.target.value) })} /></Field>
        <Field label="Costo total"><input type="number" value={form.amount} onChange={(e) => set({ amount: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Comentario (opcional)"><input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Proveedor, factura…" /></Field>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
