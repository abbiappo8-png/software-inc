import React, { useState } from 'react'
import { api } from '../lib/api'
import { Spinner } from '../components/ui'
import { Logo } from '../components/Logo'
import type { ImportReport } from '@shared/types/domain'

export function FirstRun({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function pickAndImport() {
    setErr(null)
    const path = await api.import.pickFile()
    if (!path) return
    setBusy(true)
    try {
      const r = await api.import.run(path)
      setReport(r)
    } catch (e: any) {
      setErr(e?.message ?? 'Error al importar')
    } finally {
      setBusy(false)
    }
  }

  if (report) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ width: 460 }}>
          <h2>Importación completada</h2>
          <p className="sub">Se importaron los datos del Excel.</p>
          <table className="data">
            <tbody>
              {Object.entries(report.counts).map(([k, v]) => (
                <tr key={k}>
                  <td>{k.replace(/_/g, ' ')}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
              <tr>
                <td className="muted">Filas con aviso</td>
                <td className="num">{report.rowsError}</td>
              </tr>
            </tbody>
          </table>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={onDone}>
            Ir a la aplicación
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 460 }}>
        <div className="logo-wrap"><Logo height={48} /></div>
        <h2>Bienvenido</h2>
        <p className="sub">
          Aún no hay datos. Importa tu Excel <strong>“software inc.xlsx”</strong> para cargar clientes, profesores,
          transacciones, gastos y el catálogo. Podrás seguir usándolo todo desde aquí.
        </p>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={pickAndImport} disabled={busy}>
          {busy ? (
            <>
              <Spinner /> Importando…
            </>
          ) : (
            'Seleccionar Excel e importar'
          )}
        </button>
        <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={onDone} disabled={busy}>
          Empezar de cero (sin importar)
        </button>
      </div>
    </div>
  )
}
