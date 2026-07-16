import React, { useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import { api, IS_DEMO } from './lib/api'
import { Spinner } from './components/ui'
import { Logo } from './components/Logo'
import { SetPinScreen, PinGate } from './features/Auth'
import { FirstRun } from './features/FirstRun'
import { Dashboard } from './features/Dashboard'
import { Personas } from './features/Personas'
import { Catalogo } from './features/Catalogo'
import { Transacciones } from './features/Transacciones'
import { Bar } from './features/Bar'
import { Gastos } from './features/Gastos'
import { Facturacion } from './features/Facturacion'
import { Liquidaciones } from './features/Liquidaciones'
import { Finanzas } from './features/Finanzas'
import { PlanesPago } from './features/PlanesPago'
import { ReservasWeb } from './features/ReservasWeb'
import { Ajustes } from './features/Ajustes'
import type { AppStatus } from '@shared/types/api'

type Phase = 'loading' | 'setPin' | 'locked' | 'firstRun' | 'ready'

const NAV = [
  { to: '/', label: 'Panel', end: true },
  { to: '/personas', label: 'Personas' },
  { to: '/catalogo', label: 'Catálogo' },
  { to: '/transacciones', label: 'Club' },
  { to: '/bar', label: 'Bar' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/reservas-web', label: 'Reservas Web' },
  { to: '/facturacion', label: 'Facturación' },
  { to: '/liquidaciones', label: 'Liquidaciones' },
  { to: '/finanzas', label: 'Finanzas' },
  { to: '/planes', label: 'Planes de pago' },
  { to: '/ajustes', label: 'Ajustes' }
]

export default function App() {
  const [phase, setPhase] = useState<Phase>(IS_DEMO ? 'ready' : 'loading')
  const [status, setStatus] = useState<AppStatus | null>(null)

  async function refresh() {
    const s = await api.auth.status()
    setStatus(s)
    if (!s.hasPin) setPhase('setPin')
    else setPhase('locked')
  }
  useEffect(() => {
    if (!IS_DEMO) refresh()
  }, [])

  async function afterUnlock() {
    const s = await api.auth.status()
    setStatus(s)
    setPhase(s.needsImport ? 'firstRun' : 'ready')
  }

  if (phase === 'loading')
    return <div className="auth-wrap"><Spinner /></div>
  if (phase === 'setPin')
    return <SetPinScreen onDone={() => setPhase('locked')} />
  if (phase === 'locked')
    return <PinGate onUnlock={afterUnlock} />
  if (phase === 'firstRun')
    return <FirstRun onDone={() => setPhase('ready')} />

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><Logo height={34} onDark /></div>
        {IS_DEMO && <div className="demo-banner">MODO DEMO · datos de ejemplo</div>}
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="muted" style={{ fontSize: 11, padding: '8px 10px' }}>
          Datos locales en este equipo
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/personas" element={<Personas />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/transacciones" element={<Transacciones />} />
          <Route path="/bar" element={<Bar />} />
          <Route path="/gastos" element={<Gastos />} />
          <Route path="/reservas-web" element={<ReservasWeb />} />
          <Route path="/facturacion" element={<Facturacion />} />
          <Route path="/liquidaciones" element={<Liquidaciones />} />
          <Route path="/finanzas" element={<Finanzas />} />
          <Route path="/planes" element={<PlanesPago />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
