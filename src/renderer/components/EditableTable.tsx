import React, { useState } from 'react'
import { formatCOP, minutesToHHMM, hhmmToMinutes } from '../lib/api'
import { SearchSelect } from './SearchSelect'

/** A partir de cuántas opciones el select de una celda usa buscador. */
const SEARCH_THRESHOLD = 12

/**
 * Cuadrícula editable en línea, estilo hoja de cálculo (como el Excel base):
 * cada celda editable es un input; se guarda al salir de la celda / Enter; hay una
 * fila vacía al final para agregar. Sin ventanas modales para las operaciones.
 */
export type ColType = 'text' | 'number' | 'money' | 'date' | 'time' | 'select' | 'toggle' | 'computed'

export interface GridColumn {
  key: string
  label: string
  type?: ColType
  options?: { value: any; label: string }[]
  width?: number | string
  editable?: boolean
  placeholder?: string
  align?: 'left' | 'right' | 'center'
  /** Render de solo lectura (columnas computed o presentación especial). */
  render?: (row: any) => React.ReactNode
  /** Getter del valor (por defecto row[key]). */
  get?: (row: any) => any
}

export interface EditableTableProps {
  columns: GridColumn[]
  rows: any[]
  getRowId?: (row: any) => number | string
  onCreate?: (draft: any) => Promise<void> | void
  onUpdate?: (id: any, patch: any) => Promise<void> | void
  onDelete?: (id: any) => Promise<void> | void
  /** ¿El borrador tiene lo mínimo para crear la fila? */
  canCreate?: (draft: any) => boolean
  newRowDefaults?: Record<string, any>
  emptyText?: string
  rowClassName?: (row: any) => string | undefined
  /** Acciones extra por fila (antes del botón de eliminar). */
  rowActions?: (row: any) => React.ReactNode
  addLabel?: string
}

const isEditable = (c: GridColumn) => c.type !== 'computed' && c.editable !== false

function displayValue(col: GridColumn, row: any): React.ReactNode {
  if (col.render) return col.render(row)
  const v = col.get ? col.get(row) : row[col.key]
  if (v == null || v === '') return <span className="cell-empty">—</span>
  if (col.type === 'money') return formatCOP(v)
  if (col.type === 'time') return minutesToHHMM(v)
  if (col.type === 'toggle') return v ? 'Sí' : 'No'
  if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v)
  return String(v)
}

/**
 * Celda editable: input plano. En filas existentes confirma al salir/Enter (evita
 * un guardado por tecla). En la fila NUEVA (`live`) confirma en cada cambio, para que
 * el borrador esté siempre completo al pulsar "Agregar" (sin carreras blur/click).
 */
function EditCell({ col, value, onCommit, live, autoFocus, onDone }: {
  col: GridColumn
  value: any
  onCommit: (v: any) => void
  live?: boolean
  /** Celda activada con clic (modo perezoso): enfoca el input al montarse. */
  autoFocus?: boolean
  /** Avisar que la edición terminó (la celda vuelve a modo lectura). */
  onDone?: () => void
}) {
  const [local, setLocal] = useState<string>(value == null ? '' : String(col.type === 'time' ? minutesToHHMM(value) : value))
  React.useEffect(() => {
    setLocal(value == null ? '' : String(col.type === 'time' ? minutesToHHMM(value) : value))
  }, [value, col.type])

  const align = col.align ?? (col.type === 'money' || col.type === 'number' ? 'right' : 'left')

  if (col.type === 'select') {
    // Listas largas (clientes, servicios…): desplegable CON BUSCADOR.
    if ((col.options?.length ?? 0) > SEARCH_THRESHOLD) {
      return (
        <SearchSelect
          value={value == null ? '' : String(value)}
          options={(col.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))}
          openOnMount={autoFocus}
          onChange={(v) => { onCommit(v === '' ? null : coerce(col, v)); onDone?.() }}
          onClose={onDone}
        />
      )
    }
    return (
      <select
        className="cell-input" autoFocus={autoFocus} value={value ?? ''}
        onChange={(e) => { onCommit(e.target.value === '' ? null : coerce(col, e.target.value)); onDone?.() }}
        onBlur={() => onDone?.()}
      >
        {col.options?.map((o) => (
          <option key={String(o.value)} value={o.value as any}>{o.label}</option>
        ))}
      </select>
    )
  }
  if (col.type === 'toggle') {
    return <input className="cell-check" type="checkbox" checked={!!value} onChange={(e) => onCommit(e.target.checked)} />
  }
  if (col.type === 'date') {
    return (
      <input
        className="cell-input" type="date" autoFocus={autoFocus} value={value ?? ''}
        onChange={(e) => onCommit(e.target.value || null)}
        onBlur={() => onDone?.()}
      />
    )
  }
  if (col.type === 'time') {
    return (
      <input
        className="cell-input" type="time" autoFocus={autoFocus} value={local}
        onChange={(e) => { setLocal(e.target.value); if (live) onCommit(e.target.value ? hhmmToMinutes(e.target.value) : null) }}
        onBlur={() => {
          if (!live) {
            const m = local ? hhmmToMinutes(local) : null
            setLocal(m == null ? '' : minutesToHHMM(m)) // re-normaliza lo mostrado
            onCommit(m)
          }
          onDone?.()
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    )
  }
  const numeric = col.type === 'number' || col.type === 'money'
  return (
    <input
      className="cell-input" type={numeric ? 'number' : 'text'} autoFocus={autoFocus} value={local}
      placeholder={col.placeholder} style={{ textAlign: align }}
      onChange={(e) => { setLocal(e.target.value); if (live) onCommit(coerce(col, e.target.value)) }}
      onBlur={() => {
        if (!live) {
          const v = coerce(col, local)
          setLocal(v == null ? '' : String(v)) // re-normaliza aunque el commit sea no-op
          onCommit(v)
        }
        onDone?.()
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

function coerce(col: GridColumn, raw: any): any {
  if (col.type === 'number' || col.type === 'money') {
    if (raw === '' || raw == null) return null
    const n = Number(raw)
    if (!isFinite(n)) return null
    // Solo el dinero se redondea a peso entero (COP); los números permiten decimales
    // (descuento 12.5%, horas 1.5, etc.).
    return col.type === 'money' ? Math.round(n) : n
  }
  if (col.type === 'time') return raw ? hhmmToMinutes(raw) : null
  return raw === '' ? null : raw
}

export function EditableTable(props: EditableTableProps) {
  const { columns, rows, onCreate, onUpdate, onDelete, canCreate, rowActions } = props
  const getId = props.getRowId ?? ((r: any) => r.id)
  const [draft, setDraft] = useState<Record<string, any>>({ ...(props.newRowDefaults ?? {}) })
  const [busy, setBusy] = useState(false)
  // Celda activa (rendimiento): el input/select solo se monta en la celda que se está
  // editando. Con cientos de filas × selects de cientos de opciones, montar todos los
  // inputs a la vez creaba ~500k nodos DOM y la cuadrícula tardaba en cargar.
  const [active, setActive] = useState<{ id: any; key: string } | null>(null)
  const hasActions = !!(onDelete || rowActions || onCreate)

  const setDraftVal = (k: string, v: any) => setDraft((d) => ({ ...d, [k]: v }))

  async function commitCell(row: any, col: GridColumn, v: any) {
    const cur = col.get ? col.get(row) : row[col.key]
    // '' y null son equivalentes (celda vacía): no dispara guardados espurios.
    const norm = (x: any) => (x === '' ? null : x)
    if (norm(v) === norm(cur)) return
    await onUpdate?.(getId(row), { [col.key]: v })
  }

  async function addRow() {
    if (!onCreate) return
    if (canCreate && !canCreate(draft)) return
    setBusy(true)
    try {
      await onCreate(draft)
      setDraft({ ...(props.newRowDefaults ?? {}) })
    } finally {
      setBusy(false)
    }
  }

  const createReady = !canCreate || canCreate(draft)

  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.label}</th>
            ))}
            {hasActions && <th className="sheet-actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getId(row)} className={props.rowClassName?.(row)}>
              {columns.map((c) => {
                const editable = isEditable(c) && !!onUpdate
                // Los toggles son baratos (1 checkbox) y deben responder al primer clic.
                if (editable && c.type === 'toggle') {
                  return (
                    <td key={c.key} className="sheet-cell type-toggle" style={{ textAlign: c.align }}>
                      <EditCell col={c} value={c.get ? c.get(row) : row[c.key]} onCommit={(v) => commitCell(row, c, v)} />
                    </td>
                  )
                }
                const isActive = editable && active?.id === getId(row) && active?.key === c.key
                return (
                  <td key={c.key} className={`sheet-cell type-${c.type ?? 'text'}`} style={{ textAlign: c.align }}>
                    {isActive ? (
                      <EditCell
                        col={c}
                        value={c.get ? c.get(row) : row[c.key]}
                        autoFocus
                        onDone={() => setActive(null)}
                        onCommit={(v) => commitCell(row, c, v)}
                      />
                    ) : (
                      <div
                        className={editable ? 'cell-view clickable' : 'cell-view'}
                        tabIndex={editable ? 0 : undefined}
                        onClick={editable ? () => setActive({ id: getId(row), key: c.key }) : undefined}
                        onFocus={editable ? () => setActive({ id: getId(row), key: c.key }) : undefined}
                        title={editable ? 'Clic para editar' : undefined}
                      >
                        {displayValue(c, row)}
                      </div>
                    )}
                  </td>
                )
              })}
              {hasActions && (
                <td className="sheet-actions">
                  {rowActions?.(row)}
                  {onDelete && (
                    <button className="btn ghost icon" title="Eliminar" onClick={() => onDelete(getId(row))}>✕</button>
                  )}
                </td>
              )}
            </tr>
          ))}

          {onCreate && (
            <tr className="sheet-newrow">
              {columns.map((c) => (
                <td key={c.key} className={`sheet-cell type-${c.type ?? 'text'}`}>
                  {isEditable(c) ? (
                    <EditCell
                      col={c}
                      live
                      value={draft[c.key] ?? (c.type === 'toggle' ? false : null)}
                      onCommit={(v) => setDraftVal(c.key, v)}
                    />
                  ) : (
                    <span className="cell-empty" />
                  )}
                </td>
              ))}
              {hasActions && (
                <td className="sheet-actions">
                  <button className="btn primary sm" disabled={busy || !createReady} onClick={addRow} title="Agregar fila">
                    ＋ {props.addLabel ?? 'Agregar'}
                  </button>
                </td>
              )}
            </tr>
          )}
        </tbody>
      </table>
      {!rows.length && !onCreate && <div className="empty">{props.emptyText ?? 'Sin datos.'}</div>}
    </div>
  )
}
