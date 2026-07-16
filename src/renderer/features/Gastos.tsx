import React from 'react'
import { api, useAsync, todayISO } from '../lib/api'
import { Spinner } from '../components/ui'
import { EditableTable, GridColumn } from '../components/EditableTable'

const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v))

export function Gastos() {
  const { data, loading, reload } = useAsync(() => api.expenses.list(), [])
  const persons = useAsync(() => api.persons.list({ limit: 2000 }), [])
  const staff = (persons.data ?? []).filter((p) => p.isProfessor || p.isSupplier)
  const areaOpts = [
    { value: '', label: '— general' },
    ...staff.map((p) => ({ value: String(p.id), label: p.nickname || p.fullName }))
  ]
  const nameOf = (id: number | null) => persons.data?.find((p) => p.id === id)?.fullName ?? null

  function toInput(r: any) {
    const areaPersonId = numOrNull(r.areaPersonId)
    return {
      expenseDate: r.expenseDate,
      supplyName: r.supplyName ?? null,
      count: Number(r.count ?? 1) || 1,
      areaName: areaPersonId != null ? nameOf(areaPersonId) : r.areaName ?? null,
      areaPersonId,
      // Conserva el proveedor ya vinculado (p.ej. del import del Excel).
      supplierId: numOrNull(r.supplierId),
      amountOut: Number(r.amountOut ?? 0) || 0,
      comment: r.comment ?? null
    }
  }

  async function onCreate(draft: any) {
    if (!draft.expenseDate || !(Number(draft.amountOut) > 0)) return
    try {
      await api.expenses.create(toInput(draft))
      reload()
    } catch (e: any) {
      alert(e?.message ?? 'Error')
    }
  }
  async function onUpdate(id: number, patch: any) {
    const row = data?.find((x) => x.id === id)
    if (!row) return
    const merged: any = { ...row, ...patch }
    // Si el usuario cambió "Asignado a", el nombre de área anterior deja de aplicar
    // (nameOf lo rellena si asignó a alguien; si eligió "general", queda null).
    if ('areaPersonId' in patch) merged.areaName = null
    try {
      await api.expenses.update(id, toInput(merged))
      reload()
    } catch (e: any) {
      alert(e?.message ?? 'Error'); reload()
    }
  }
  async function onDelete(id: number) {
    if (!confirm('¿Eliminar este gasto?')) return
    await api.expenses.remove(id)
    reload()
  }

  const columns: GridColumn[] = [
    { key: 'expenseDate', label: 'Fecha', type: 'date', width: 150 },
    { key: 'supplyName', label: 'Insumo / concepto', type: 'text', width: 220 },
    { key: 'count', label: 'Cant.', type: 'number', width: 80, align: 'right' },
    { key: 'areaPersonId', label: 'Asignado a', type: 'select', options: areaOpts, width: 150, get: (r) => (r.areaPersonId == null ? '' : String(r.areaPersonId)) },
    { key: 'amountOut', label: 'Monto', type: 'money', width: 130, align: 'right' },
    { key: 'comment', label: 'Comentario', type: 'text', width: 220 }
  ]

  return (
    <div>
      <div className="header"><h1>Gastos</h1></div>
      {loading ? (
        <div className="panel"><div style={{ padding: 24 }}><Spinner /></div></div>
      ) : (
        <EditableTable
          columns={columns}
          rows={data ?? []}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          canCreate={(d) => !!d.expenseDate && Number(d.amountOut) > 0}
          newRowDefaults={{ expenseDate: todayISO(), count: 1 }}
          addLabel="Agregar"
          rowClassName={(r) => (r.importBatchId != null ? 'row-imported' : undefined)}
        />
      )}
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Los gastos <span style={{ textDecoration: 'line-through' }}>tachados</span> vienen del Excel
        (pasados al nuevo sistema); los nuevos se registran sin tachar.
      </p>
    </div>
  )
}
