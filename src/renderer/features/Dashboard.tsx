import React from 'react'
import { api, formatCOP, useAsync } from '../lib/api'
import { Stat, Spinner } from '../components/ui'

export function Dashboard() {
  const { data, loading, error } = useAsync(() => api.finance.dashboard(), [])
  const yb = useAsync(() => api.finance.yearBalance(), [])

  if (error) return <div className="err">Error: {error}</div>
  if (loading || !data) return <Spinner />
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat label="Clientes" value={data.clients} />
        <Stat label="Profesores" value={data.professors} />
        <Stat label="Transacciones" value={data.transactions} />
        <Stat label="Ingresos (servicios)" value={formatCOP(data.incomeAll)} />
        <Stat label="Gastos" value={formatCOP(data.expensesAll)} />
        <Stat label="Ventas de bar" value={data.barSales} />
      </div>

      <div className="panel panel-p" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Balance por año</h3>
        {yb.data && yb.data.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Año</th>
                <th className="num">Ingresos</th>
                <th className="num">Egresos</th>
                <th className="num">Neto</th>
              </tr>
            </thead>
            <tbody>
              {yb.data.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td className="num">{formatCOP(r.in)}</td>
                  <td className="num">{formatCOP(r.out)}</td>
                  <td className="num" style={{ color: r.in - r.out >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    {formatCOP(r.in - r.out)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Sin datos aún.</p>
        )}
      </div>
    </div>
  )
}
