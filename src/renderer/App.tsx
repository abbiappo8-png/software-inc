import React, { useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import { api, IS_DEMO, IS_WEB } from './lib/api'
import { Spinner } from './components/ui'
import { Logo } from './components/Logo'
import { NavIcon, type NavIconName } from './components/NavIcon'
import { SetPinScreen, PinGate } from './features/Auth'
import { FirstRun } from './features/FirstRun'
import { Dashboard } from './features/Dashboard'
import { Personas } from './features/Personas'
import { Catalogo } from './features/Catalogo'
import { Transacciones } from './features/Transacciones'
import { Calendario } from './features/Calendario'
import { Bar } from './features/Bar'
import { Gastos } from './features/Gastos'
import { Facturacion } from './features/Facturacion'
import { Liquidaciones } from './features/Liquidaciones'
import { Finanzas } from './features/Finanzas'
import { PlanesPago } from './features/PlanesPago'
import { ReservasWeb } from './features/ReservasWeb'
import { Archivos } from './features/Archivos'
import { Ajustes } from './features/Ajustes'
import type { AppStatus } from '@shared/types/api'

type Phase = 'loading' | 'setPin' | 'locked' | 'firstRun' | 'ready'

const NAV: { to: string; label: string; icon: NavIconName; end?: boolean }[] = [
  { to: '/', label: 'Panel', icon: 'dashboard', end: true },
  { to: '/personas', label: 'Personas', icon: 'users' },
  { to: '/catalogo', label: 'Catálogo', icon: 'tag' },
  { to: '/transacciones', label: 'Club', icon: 'kite' },
  { to: '/calendario', label: 'Calendario', icon: 'calendar' },
  { to: '/bar', label: 'Bar', icon: 'cocktail' },
  { to: '/gastos', label: 'Gastos', icon: 'banknote' },
  { to: '/reservas-web', label: 'Reservas Web', icon: 'globe' },
  { to: '/facturacion', label: 'Facturación', icon: 'receipt' },
  { to: '/liquidaciones', label: 'Liquidaciones', icon: 'wallet' },
  { to: '/finanzas', label: 'Finanzas', icon: 'chart' },
  { to: '/planes', label: 'Planes de pago', icon: 'card' },
  { to: '/ajustes', label: 'Ajustes', icon: 'gear' }
]

export default function App() {
  const [phase, setPhase] = useState<Phase>(IS_DEMO ? 'ready' : 'loading')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [menuOpen, setMenuOpen] = useState(false) // cajón de navegación en móvil

  async function refresh() {
    const s = await api.auth.status()
    setStatus(s)
    if (!s.hasPin) setPhase('setPin')
    else setPhase('locked')
  }
  useEffect(() => {
    if (!IS_DEMO) refresh()
  }, [])

  // Web: si la sesión de Supabase expira (o se cierra sesión), vuelve al bloqueo por PIN.
  useEffect(() => {
    if (!IS_WEB) return
    const onSessionLost = () => setPhase('locked')
    window.addEventListener('sb:session-lost', onSessionLost)
    return () => window.removeEventListener('sb:session-lost', onSessionLost)
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
      {/* Barra superior SOLO móvil: hamburguesa + logo (el sidebar se vuelve cajón) */}
      <div className="topbar">
        <button className="hamburger" aria-label="Menú" onClick={() => setMenuOpen(true)}>☰</button>
        <div className="topbar-logo"><Logo height={30} onDark /></div>
        <span style={{ width: 40 }} />
      </div>
      {menuOpen && <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />}
      <nav className={'sidebar' + (menuOpen ? ' open' : '')}>
        {IS_DEMO && <div className="demo-banner">MODO DEMO · datos de ejemplo</div>}
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
            onClick={() => setMenuOpen(false)}
          >
            <span className="nav-ico"><NavIcon name={n.icon} /></span>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/archivos" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMenuOpen(false)}>
          <span className="nav-ico"><NavIcon name="folder" /></span>
          Archivos
        </NavLink>
        <div className="muted" style={{ fontSize: 11, padding: '8px 10px' }}>
          {IS_WEB ? 'Datos en la nube (Supabase)' : 'Datos locales en este equipo'}
        </div>
      </nav>
      <main className="main">
        {/* Logo centrado arriba del contenido (el sidebar sigue negro; en móvil va en la topbar) */}
        <div className="main-brand"><Logo height={46} /></div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/personas" element={<Personas />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/transacciones" element={<Transacciones />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/bar" element={<Bar />} />
          <Route path="/gastos" element={<Gastos />} />
          <Route path="/reservas-web" element={<ReservasWeb />} />
          <Route path="/facturacion" element={<Facturacion />} />
          <Route path="/liquidaciones" element={<Liquidaciones />} />
          <Route path="/finanzas" element={<Finanzas />} />
          <Route path="/planes" element={<PlanesPago />} />
          <Route path="/archivos" element={<Archivos />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
