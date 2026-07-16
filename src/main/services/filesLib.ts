/**
 * Biblioteca de archivos de la pestaña "Archivos".
 * Los archivos se COPIAN a userData/files (no se enlazan): sobreviven aunque el
 * original se mueva o borre, y entran en la carpeta de datos de la app.
 */
import { dialog, shell, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import ExcelJS from 'exceljs'
import { getPaths } from '../paths'
import type { StoredFile, WorkbookData, WorkbookSheet } from '@shared/types/domain'

/** Límites del visor: suficientes para las hojas del negocio sin colgar el renderer. */
export const VIEWER_MAX_ROWS = 300
export const VIEWER_MAX_COLS = 40

/**
 * Valida un nombre de archivo de la biblioteca y devuelve su ruta absoluta.
 * Rechaza separadores y ".." para que nadie escape de userData/files.
 */
export function safeFilePath(name: string): string {
  if (!name || name !== basename(name) || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('Nombre de archivo no válido.')
  }
  return join(getPaths().filesDir, name)
}

export function listFiles(): StoredFile[] {
  const dir = getPaths().filesDir
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      const st = statSync(join(dir, name))
      return {
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        ext: extname(name).slice(1).toLowerCase()
      }
    })
    .filter((f) => statSync(join(dir, f.name)).isFile())
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Copia a la biblioteca evitando pisar: "x.xlsx" → "x (2).xlsx" si ya existe. */
function copyIntoLibrary(srcPath: string): StoredFile {
  const dir = getPaths().filesDir
  const ext = extname(srcPath)
  const stem = basename(srcPath, ext)
  let candidate = basename(srcPath)
  for (let i = 2; existsSync(join(dir, candidate)); i++) candidate = `${stem} (${i})${ext}`
  copyFileSync(srcPath, join(dir, candidate))
  const st = statSync(join(dir, candidate))
  return { name: candidate, size: st.size, mtime: st.mtime.toISOString(), ext: ext.slice(1).toLowerCase() }
}

/** Diálogo de selección múltiple → copia todo a la biblioteca. Devuelve la lista actualizada. */
export async function addFiles(win: BrowserWindow | null): Promise<StoredFile[]> {
  const res = await dialog.showOpenDialog(win ?? (undefined as never), {
    title: 'Añadir archivos a la biblioteca',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documentos', extensions: ['xlsx', 'xls', 'csv', 'pdf'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  })
  if (!res.canceled) for (const p of res.filePaths) copyIntoLibrary(p)
  return listFiles()
}

export function removeFile(name: string): StoredFile[] {
  unlinkSync(safeFilePath(name))
  return listFiles()
}

/** Abre el archivo con la aplicación del sistema (Excel/Numbers…). */
export async function openExternal(name: string): Promise<void> {
  const err = await shell.openPath(safeFilePath(name))
  if (err) throw new Error(err)
}

/** Texto visible de una celda: fórmulas/richText via cell.text; fechas en formato legible. */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v instanceof Date) {
    const d = `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`
    const hasTime = v.getHours() || v.getMinutes()
    return hasTime ? `${d} ${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}` : d
  }
  // resultado de fórmula con fecha
  if (v && typeof v === 'object' && 'result' in v && (v as { result?: unknown }).result instanceof Date) {
    const r = (v as { result: Date }).result
    return `${String(r.getDate()).padStart(2, '0')}/${String(r.getMonth() + 1).padStart(2, '0')}/${r.getFullYear()}`
  }
  return cell.text ?? ''
}

/** Lee un Excel para el visor: cada hoja como texto visible, con recorte defensivo. */
export async function readWorkbook(name: string): Promise<WorkbookData> {
  const path = safeFilePath(name)
  const ext = extname(name).toLowerCase()
  if (ext !== '.xlsx') throw new Error('El visor solo soporta archivos .xlsx (usa "Abrir con Excel").')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const sheets: WorkbookSheet[] = []
  wb.eachSheet((ws) => {
    // actualRowCount ignora las filas/columnas vacías del final (hojas con formato "sobrante")
    const totalRows = ws.actualRowCount || ws.rowCount
    const totalCols = ws.actualColumnCount || ws.columnCount
    const truncated = totalRows > VIEWER_MAX_ROWS || totalCols > VIEWER_MAX_COLS
    const rows: string[][] = []
    const rowCount = Math.min(totalRows, VIEWER_MAX_ROWS)
    const colCount = Math.min(totalCols, VIEWER_MAX_COLS)
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c)))
      rows.push(cells)
    }
    sheets.push({ name: ws.name, rows, truncated })
  })
  return { fileName: name, sheets }
}
