/**
 * Prueba de integración end-to-end sobre datos reales:
 * importa el Excel y ejercita los repositorios (finanzas, facturación, liquidación).
 *   tsx test/integration.ts "../software inc.xlsx"
 */
import { initDatabase, getDb } from '../src/main/db/connection'
import { runMigrations } from '../src/main/db/migrate'
import { importWorkbook } from '../src/main/services/importer'
import * as finance from '../src/main/repositories/financeRepo'
import * as bills from '../src/main/repositories/billsRepo'
import * as settlements from '../src/main/repositories/settlementsRepo'
import { formatCOP } from '../shared/services/money'

async function main() {
  const xlsx = process.argv[2] || '../software inc.xlsx'
  initDatabase(':memory:')
  runMigrations(getDb())
  const report = await importWorkbook(getDb(), xlsx, { force: true })
  console.log('Import OK:', report.rowsOk, 'filas |', report.rowsError, 'avisos')

  const db = getDb()

  console.log('\n== Dashboard ==')
  console.log(finance.dashboardTotals())

  // Elegir un profesor con más transacciones
  const prof = db
    .prepare(
      `SELECT p.id, p.full_name, COUNT(*) n, substr(t.tx_date,1,7) ym
       FROM transactions t JOIN persons p ON p.id=t.professor_id
       GROUP BY t.professor_id ORDER BY n DESC LIMIT 1`
    )
    .get() as any
  console.log('\n== Profesor con más clases ==', prof.full_name, `(${prof.n})`)
  const [yy, mm] = (prof.ym as string).split('-').map(Number)
  const settle = settlements.previewSettlement(prof.id, yy, mm)
  console.log(`Liquidación ${mm}/${yy}: bruto=${formatCOP(settle.result.gross)}  neto=${formatCOP(settle.result.net)}  (${settle.salaryRows.length} clases)`)

  // Resumen mensual de ese periodo
  const ms = finance.monthSummary(yy, mm)
  console.log(`\n== Resumen ${mm}/${yy} ==`)
  console.log('  ingresos clientes:', formatCOP(ms.incomeClients))
  console.log('  gastos no-profesor:', formatCOP(ms.expensesNonProfessor))
  console.log('  profesores con salario:', ms.professorSalaries.length)
  console.log('  costo total:', formatCOP(ms.totalCosts))

  // Elegir un cliente con más transacciones y facturarlo
  const client = db
    .prepare(
      `SELECT p.id, p.full_name, COUNT(*) n FROM transactions t JOIN persons p ON p.id=t.client_id
       GROUP BY t.client_id ORDER BY n DESC LIMIT 1`
    )
    .get() as any
  console.log('\n== Cliente con más reservas ==', client.full_name, `(${client.n})`)
  const bill = bills.previewClientBill(client.id, { cardSurcharge: true })
  console.log('  ítems:', bill.items.length)
  console.log('  subtotal servicios:', formatCOP(bill.result.subtotal))
  console.log('  total:', formatCOP(bill.result.total))
  console.log('  neto a pagar:', formatCOP(bill.result.netToPay))
  console.log('  con tarjeta (+5%):', formatCOP(bill.result.cardTotal))

  // Balance diario
  const cf = finance.dailyCashflow()
  console.log('\n== Balance diario ==')
  console.log('  días con movimiento:', cf.rows.length)
  console.log('  IN total:', formatCOP(cf.totals.in), '| OUT total:', formatCOP(cf.totals.out), '| neto:', formatCOP(cf.totals.net))

  console.log('\n✅ Integración end-to-end OK: import + finanzas + facturación + liquidación funcionan sobre datos reales.')
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
