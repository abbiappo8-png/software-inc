import React, { useEffect, useMemo, useRef, useState } from 'react'

export interface SSOption {
  value: string
  label: string
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Desplegable con BUSCADOR: para listas largas (clientes, servicios, profesores…).
 * Al abrirlo aparece un campo de búsqueda; se filtra por texto (sin tildes) y se
 * elige con clic o Enter (primer resultado). Escape o clic fuera cierran.
 */
export function SearchSelect({ value, options, onChange, placeholder, openOnMount, onClose, className }: {
  value: string
  options: SSOption[]
  onChange: (v: string) => void
  placeholder?: string
  /** Abrir ya desplegado (celdas de cuadrícula activadas con clic). */
  openOnMount?: boolean
  /** Avisar al cerrarse sin elegir (para que la celda vuelva a modo lectura). */
  onClose?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(!!openOnMount)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!q.trim()) return options
    const nq = norm(q)
    return options.filter((o) => norm(o.label).includes(nq))
  }, [q, options])

  const currentLabel = options.find((o) => String(o.value) === String(value))?.label ?? ''

  useEffect(() => {
    if (open) {
      setQ('')
      // enfoca el buscador al abrir
      setTimeout(() => inputRef.current?.focus(), 0)
      const h = (e: MouseEvent) => {
        if (!wrapRef.current?.contains(e.target as Node)) close()
      }
      document.addEventListener('mousedown', h)
      return () => document.removeEventListener('mousedown', h)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false)
    onClose?.()
  }
  function pick(v: string) {
    setOpen(false)
    onChange(v)
    onClose?.()
  }

  return (
    <div ref={wrapRef} className={'sselect ' + (className ?? '')}>
      <div
        className={'sselect-display' + (currentLabel ? '' : ' placeholder')}
        tabIndex={0}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) }
        }}
      >
        <span className="sselect-label">{currentLabel || placeholder || '— Selecciona —'}</span>
        <span className="sselect-caret">▾</span>
      </div>
      {open && (
        <div className="sselect-panel">
          <input
            ref={inputRef}
            className="sselect-search"
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length) pick(String(filtered[0].value))
              if (e.key === 'Escape') close()
            }}
          />
          <div className="sselect-list">
            {filtered.slice(0, 200).map((o) => (
              <div
                key={String(o.value)}
                className={'sselect-opt' + (String(o.value) === String(value) ? ' sel' : '')}
                onClick={() => pick(String(o.value))}
              >
                {o.label}
              </div>
            ))}
            {filtered.length > 200 && <div className="sselect-more">… {filtered.length - 200} más — sigue escribiendo</div>}
            {!filtered.length && <div className="sselect-more">Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  )
}
