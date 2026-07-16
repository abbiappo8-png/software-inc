/**
 * Invitación de Google Calendar para el profesor.
 *
 * Se abre una URL de "crear evento" con el profesor como invitado (`add=email`):
 * al guardar el evento, Google le envía automáticamente la notificación por
 * correo con el botón de añadir al calendario. Funciona igual en la web y en el
 * escritorio (el main abre el navegador), sin configurar SMTP.
 */
export function googleCalendarInviteUrl(opts: {
  title: string
  /** Fecha ISO YYYY-MM-DD. */
  dateISO: string
  /** Minutos desde medianoche (hora local de la escuela). */
  startMin: number
  durationMin: number
  details?: string
  guestEmail?: string | null
}): string {
  const d = opts.dateISO.replace(/-/g, '')
  const hhmmss = (min: number) => {
    const m = Math.max(0, Math.min(min, 24 * 60 - 1))
    return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`
  }
  // Hora "flotante" (sin zona): Google usa la zona del calendario de la escuela.
  const dates = `${d}T${hhmmss(opts.startMin)}/${d}T${hhmmss(opts.startMin + Math.max(15, opts.durationMin))}`
  const p = new URLSearchParams({ action: 'TEMPLATE', text: opts.title, dates })
  if (opts.details) p.set('details', opts.details)
  if (opts.guestEmail) p.set('add', opts.guestEmail)
  return 'https://calendar.google.com/calendar/render?' + p.toString()
}
