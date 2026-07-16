import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Empty, Spinner } from '../components/ui'
import type { StoredFile, WorkbookData } from '@shared/types/domain'

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Pestaña "Archivos": biblioteca de documentos del negocio con visor de Excel integrado. */
export function Archivos() {
  const [files, setFiles] = useState<StoredFile[] | null>(null)
  const [viewing, setViewing] = useState<WorkbookData | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    setFiles(await api.files.list())
  }
  useEffect(() => {
    reload().catch((e) => setMsg('Error: ' + (e?.message ?? e)))
  }, [])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const addFiles = () => run(async () => setFiles(await api.files.add()))
  const openFile = (name: string) => run(() => api.files.open(name))
  const removeFile = (name: string) =>
    run(async () => {
      if (!confirm(`¿Eliminar "${name}" de la biblioteca?`)) return
      setFiles(await api.files.remove(name))
      if (viewing?.fileName === name) setViewing(null)
    })
  const viewFile = (name: string) =>
    run(async () => {
      const wb = await api.files.read(name)
      setViewing(wb)
      setSheetIdx(0)
    })

  const sheet = viewing?.sheets[sheetIdx] ?? null

  return (
    <div>
      <div className="header">
        <h1>Archivos</h1>
        <button className="btn primary" onClick={addFiles} disabled={busy}>+ Añadir archivos</button>
      </div>

      {msg && <div className="err">{msg}</div>}

      <div className="panel">
        {!files ? (
          <div className="panel-p"><Spinner /></div>
        ) : !files.length ? (
          <Empty>La biblioteca está vacía. Usa «Añadir archivos» para guardar aquí los Excel del negocio.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Archivo</th><th>Tipo</th><th className="num">Tamaño</th><th>Modificado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>
                    {f.ext === 'xlsx' ? (
                      <span className="linklike" onClick={() => viewFile(f.name)}>{f.name}</span>
                    ) : (
                      f.name
                    )}
                  </td>
                  <td><span className="badge role">{f.ext.toUpperCase() || '—'}</span></td>
                  <td className="num">{formatSize(f.size)}</td>
                  <td className="muted">{formatDate(f.mtime)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {f.ext === 'xlsx' && (
                      <button className="btn sm" onClick={() => viewFile(f.name)} disabled={busy}>Ver</button>
                    )}{' '}
                    <button className="btn sm" onClick={() => openFile(f.name)} disabled={busy}>Abrir con Excel</button>{' '}
                    <button className="btn sm danger" onClick={() => removeFile(f.name)} disabled={busy}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {busy && !viewing && <div style={{ marginTop: 14 }}><Spinner /></div>}

      {viewing && (
        <div className="panel panel-p" style={{ marginTop: 16 }}>
          <div className="header" style={{ marginBottom: 12 }}>
            <h1 style={{ fontSize: 16 }}>{viewing.fileName}</h1>
            <button className="btn sm" onClick={() => setViewing(null)}>Cerrar visor</button>
          </div>
          <div className="filetabs">
            {viewing.sheets.map((s, i) => (
              <button key={s.name} className={'tab' + (i === sheetIdx ? ' active' : '')} onClick={() => setSheetIdx(i)}>
                {s.name}
              </button>
            ))}
          </div>
          {sheet && (
            <>
              {sheet.truncated && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Vista recortada (hoja grande): usa «Abrir con Excel» para verla completa.
                </div>
              )}
              {!sheet.rows.length ? (
                <Empty>Hoja vacía.</Empty>
              ) : (
                <div className="sheet-wrap viewer-wrap">
                  <table className="sheet">
                    <thead>
                      <tr>{sheet.rows[0].map((h, i) => <th key={i}>{h || '·'}</th>)}</tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(1).map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td key={c} className="sheet-cell">
                              {cell ? <span style={{ display: 'block', padding: '7px 10px' }}>{cell}</span> : <span className="cell-empty">·</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
