import React from 'react'
import logoUrl from '../assets/logo.png'

/**
 * Logo oficial "Kite Addict Colombia" (imagen real del cliente, fondo transparente).
 * `onDark` se mantiene por compatibilidad de la API; el PNG transparente se ve bien
 * sobre cualquier fondo.
 */
export function Logo({ height = 40 }: { height?: number; variant?: 'full' | 'mark'; onDark?: boolean }) {
  return (
    <img
      src={logoUrl}
      alt="Kite Addict Colombia"
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
    />
  )
}
