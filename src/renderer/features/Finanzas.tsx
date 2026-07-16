import React, { useState } from 'react'
import { api, useAsync, formatCOP } from '../lib/api'
import { Spinner, Empty } from '../components/ui'

const now = new Date()

export function Finanzas() {
  const [tab, setTab] = useState<'balance' | 'month' | 'ages'>('balance')
  return (
    <div>
      <div className="header"><h1>Finanzas</h1></div>
      <div className="toolbar">
        <button className={`btn ${tab === 'balance' ? 'primary' : ''}`} onClick={() => setTab('balance')}>Balance diario</button>
        <button className={`btn ${tab === 'month' ? 'primary' : ''}`} onClick={() => setTab('month')}>Resumen mensual</button>
        <button className={`btn ${tab === 'ages' ? 'primary' : ''}`} onClick={() => setTab('ages')}>Estadísticas</button>
      </div>
      {tab === 'balance' && <BalanceTab />}
      {tab === 'month' && <MonthTab />}
      {tab === 'ages' && <AgesTab />}
    </div>
  )
}

function BalanceTab() {
  const { data, loading } = useAsync(() => api.finance.dailyCashflow(), [])
  const [err, setErr] = useState<string | null>(null)
  async function exportXlsx() {
    setErr(null)
    try {
      const path = await api.exports.balance()
      alert('Excel generado en:\n' + path)
    } catch (e: any) {
      setErr('Error: ' + (e?.message ?? e))
    }
  }
  if (loading || !data) return <Spinner />
  const rows = data.rows.slice(-120).reverse()
  return (
    <div className="panel">
      <div className="panel-p" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <strong>Totales:</strong> IN {formatCOP(data.totals.in)} · OUT {formatCOP(data.totals.out)} ·{' '}
          <span style={{ color: data.totals.net >= 0 ? 'var(--ok)' : 'var(--danger)' }}>Neto {formatCOP(data.totals.net)}</span>
        </div>
        <button className="btn" onClick={exportXlsx}>Exportar a Excel</button>
      </div>
      {err && <div className="err" style={{ padding: '0 16px 12px' }}>{err}</div>}
      {!rows.length ? <Empty>Sin movimientos.</Empty> : (
        <table className="data">
          <thead><tr><th>Fecha</th><th className="num">Ing. clientes</th><th className="num">Ing. bar</th><th className="num">IN</th><th className="num">OUT</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{formatCOP(r.inClients)}</td>
                <td className="num">{formatCOP(r.inBar)}</td>
                <td className="num">{formatCOP(r.in)}</td>
                <td className="num">{formatCOP(r.out)}</td>
                <td className="num">{r.runningBalance == null ? '—' : formatCOP(r.runningBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function MonthTab() {
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const { data, loading, reload } = useAsync(() => api.finance.monthSummary(year, month), [year, month])
  const [err, setErr] = useState<string | null>(null)
  async function exportXlsx() {
    setErr(null)
    try {
      const path = await api.exports.monthSummary(year, month)
      alert('Excel generado en:\n' + path)
    } catch (e: any) {
      setErr('Error: ' + (e?.message ?? e))
    }
  }
  return (
    <div className="panel panel-p">
      <div className="toolbar">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ width: 120 }}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Mes {i + 1}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 120 }} />
        <button className="btn" onClick={reload}>Ver</button>
        <div className="grow" />
        <button className="btn" onClick={exportXlsx}>Exportar a Excel</button>
      </div>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      {loading || !data ? <Spinner /> : (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <table className="data">
            <tbody>
              <tr><td>Ingresos de clientes</td><td className="num">{formatCOP(data.incomeClients)}</td></tr>
              <tr><td>Gastos (no profesores)</td><td className="num">{formatCOP(data.expensesNonProfessor)}</td></tr>
              <tr><td>Salarios de profesores</td><td className="num">{formatCOP(data.totalCosts - data.expensesNonProfessor)}</td></tr>
              <tr><td><strong>Costo total</strong></td><td className="num"><strong>{formatCOP(data.totalCosts)}</strong></td></tr>
              <tr><td><strong>Neto</strong></td><td className="num" style={{ color: data.net >= 0 ? 'var(--ok)' : 'var(--danger)' }}><strong>{formatCOP(data.net)}</strong></td></tr>
            </tbody>
          </table>
          <table className="data">
            <thead><tr><th>Profesor</th><th className="num">Salario del mes</th></tr></thead>
            <tbody>
              {data.professorSalaries.map((p) => <tr key={p.professorId}><td>{p.name}</td><td className="num">{formatCOP(p.amount)}</td></tr>)}
              {!data.professorSalaries.length && <tr><td colSpan={2} className="muted">Sin salarios este mes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AgesTab() {
  const { data, loading } = useAsync(() => api.finance.ageStats(), [])
  if (loading || !data) return <Spinner />
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="panel panel-p">
      <h3 style={{ marginTop: 0 }}>Distribución de edades (por rangos de 5 años)</h3>
      {!data.length ? <Empty>Sin datos de edad.</Empty> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.map((d) => (
            <div key={d.bucket} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 70, textAlign: 'right' }} className="muted">{d.bucket}–{d.bucket + 4}</div>
              <div style={{ background: 'var(--brand)', height: 18, borderRadius: 4, width: `${(d.count / max) * 100}%`, minWidth: 2 }} />
              <div style={{ width: 40 }}>{d.count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
