/**
 * Parser CSV mínimo y robusto (RFC 4180) para las hojas publicadas de Google:
 * maneja comillas dobles, comas/saltos de línea dentro de celdas y CRLF.
 * Puro (sin Node), testeable en test/domain.test.ts.
 */

/** Parsea el texto CSV completo a filas de celdas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  // BOM de Google Sheets
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"' // comilla escapada
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  // última celda/fila (sin salto final)
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  // descarta filas totalmente vacías
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Convierte las filas en objetos { encabezado: valor } usando la primera fila. */
export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((h, i) => (h.trim() === '' ? `Columna ${i + 1}` : h.trim()))
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}
