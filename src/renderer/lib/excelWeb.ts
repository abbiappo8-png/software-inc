/**
 * Excel EN EL NAVEGADOR (MODO WEB) con exceljs: visor de .xlsx de la biblioteca
 * y exportación de reportes. Se importa DINÁMICAMENTE desde supabaseApi para no
 * cargar exceljs hasta que haga falta.
 */
import ExcelJS from 'exceljs'
import type { DailyCashflowRow, MonthSummary, WorkbookData, WorkbookSheet } from '@shared/types/domain'

/** Límites del visor (mismos que src/main/services/filesLib.ts). */
export const VIEWER_MAX_ROWS = 300
export const VIEWER_MAX_COLS = 40

/** Texto visible de una celda: fórmulas/richText via cell.text; fechas legibles. */
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

/** Lee un .xlsx (blob descargado de Storage) para el visor, con recorte defensivo. */
export async function readWorkbookBlob(name: string, blob: Blob): Promise<WorkbookData> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  const sheets: WorkbookSheet[] = []
  wb.eachSheet((ws) => {
    // actualRowCount ignora las filas/columnas vacías del final
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

/** Dispara la descarga del workbook como .xlsx y devuelve el nombre del archivo. */
async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string): Promise<string> {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return fileName
}

/** Exporta el balance diario (mismo formato que src/main/services/excelExport.ts). */
export async function exportBalanceXlsx(
  rows: DailyCashflowRow[],
  totals: { in: number; out: number; net: number },
  from?: string,
  to?: string
): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Balance')
  ws.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'Ingresos clientes', key: 'inClients', width: 18, style: { numFmt: '#,##0' } },
    { header: 'Ingresos bar', key: 'inBar', width: 16, style: { numFmt: '#,##0' } },
    { header: 'IN', key: 'in', width: 16, style: { numFmt: '#,##0' } },
    { header: 'OUT', key: 'out', width: 16, style: { numFmt: '#,##0' } },
    { header: 'Saldo acumulado', key: 'runningBalance', width: 18, style: { numFmt: '#,##0' } }
  ]
  ws.getRow(1).font = { bold: true }
  rows.forEach((r) => ws.addRow(r))
  ws.addRow({})
  ws.addRow({ date: 'TOTAL', in: totals.in, out: totals.out, runningBalance: totals.net }).font = { bold: true }
  return downloadWorkbook(wb, `balance-${from ?? 'inicio'}_${to ?? 'hoy'}.xlsx`)
}

/** Exporta el resumen mensual (P&L), como en la app de escritorio. */
export async function exportMonthSummaryXlsx(s: MonthSummary): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Resumen ${s.year}-${String(s.month).padStart(2, '0')}`)
  ws.addRow(['Resumen mensual', `${s.year}-${String(s.month).padStart(2, '0')}`]).font = { bold: true }
  ws.addRow([])
  ws.addRow(['Ingresos de clientes', s.incomeClients])
  ws.addRow(['Gastos (no profesores)', s.expensesNonProfessor])
  ws.addRow([])
  ws.addRow(['Salarios por profesor']).font = { bold: true }
  s.professorSalaries.forEach((p) => ws.addRow([p.name, p.amount]))
  ws.addRow([])
  ws.addRow(['Costo total', s.totalCosts]).font = { bold: true }
  ws.addRow(['Neto', s.net]).font = { bold: true }
  ws.getColumn(2).numFmt = '#,##0'
  ws.getColumn(1).width = 32
  ws.getColumn(2).width = 18
  return downloadWorkbook(wb, `resumen-${s.year}-${String(s.month).padStart(2, '0')}.xlsx`)
}
