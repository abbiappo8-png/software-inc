/** Normalización de texto para matching robusto de nombres/servicios. */

/** minúsculas, sin tildes, espacios colapsados y recortados. */
export function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar diacríticos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Limpia un nombre mostrado: recorta y colapsa espacios internos. */
export function cleanName(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\s+/g, ' ').trim()
}

/** Mapa de países comunes -> forma canónica. */
const COUNTRY_MAP: Record<string, string> = {
  colombia: 'Colombia',
  co: 'Colombia',
  francia: 'Francia',
  france: 'Francia',
  usa: 'Estados Unidos',
  eeuu: 'Estados Unidos',
  'estados unidos': 'Estados Unidos',
  argentina: 'Argentina',
  brasil: 'Brasil',
  brazil: 'Brasil',
  chile: 'Chile',
  espana: 'España',
  espania: 'España'
}

export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = normalize(raw)
  if (COUNTRY_MAP[key]) return COUNTRY_MAP[key]
  // Capitalizar la primera letra de cada palabra
  return cleanName(raw).replace(/\b\w/g, (c) => c.toUpperCase())
}
