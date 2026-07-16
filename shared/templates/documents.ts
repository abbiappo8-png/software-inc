/** Plantillas HTML (en español) para factura de cliente y liquidación de profesor. */
import type { ClientBill, Person, CompanyConfig } from '@shared/types/domain'
import type { ProfessorPayrollResult } from '../services/payroll'
import { LOGO_DATA_URI } from './logo'

/** Vista previa de la liquidación mensual de un profesor (calculada por el repo). */
export interface SettlementPreview {
  professorId: number
  professorName: string
  year: number
  month: number
  salaryRows: { date: string; service: string | null; client: string | null; salary: number }[]
  /** Gastos de Outcome a nombre del profesor (informativos; NO se descuentan por defecto). */
  outcomeRows: { date: string; supply: string | null; amount: number; comment: string | null }[]
  result: ProfessorPayrollResult
  /** Estado de la liquidación ya guardada de este periodo (null si aún no se ha guardado). */
  savedStatus: 'draft' | 'issued' | 'paid' | null
}

function money(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$ ' + Math.round(n).toLocaleString('es-CO', { maximumFractionDigits: 0 })
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #666; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; }
  th { background: #f5f7fa; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 16px; margin-left: auto; width: 320px; }
  .totals td { border: none; padding: 4px 10px; }
  .totals .grand { font-size: 16px; font-weight: 700; border-top: 2px solid #333; }
  .badge { display:inline-block; padding:2px 8px; border-radius:6px; background:#eef; font-size:11px; }
  .footer { margin-top: 40px; color:#888; font-size: 11px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { height:52px; width:auto; display:block; }
`

function header(company: CompanyConfig, docTitle: string, docMeta: string): string {
  return `
  <div class="row">
    <div class="brand">
      <img src="${LOGO_DATA_URI}" alt="Kite Addict">
      <div>
        <h1>${escape(company.companyName)}</h1>
        ${company.companyNit ? `<div class="muted">NIT ${escape(company.companyNit)}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right">
      <div class="badge">${escape(docTitle)}</div>
      <div class="muted" style="margin-top:6px">${escape(docMeta)}</div>
    </div>
  </div>`
}

export function clientBillHtml(bill: ClientBill, client: Person, company: CompanyConfig): string {
  const rows = (bill.items ?? [])
    .map(
      (it) =>
        `<tr><td>${escape(it.description)}</td><td class="num">${it.qty}</td><td class="num">${money(
          it.unitPrice
        )}</td><td class="num">${money(it.lineTotal)}</td></tr>`
    )
    .join('')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
    ${header(company, 'FACTURA', `N.º ${bill.id} · ${bill.billDate}`)}
    <div style="margin-top:16px"><strong>Cliente:</strong> ${escape(client.fullName)}${
    client.email ? ` · <span class="muted">${escape(client.email)}</span>` : ''
  }</div>
    <table><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">V. Unit.</th><th class="num">Total</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="muted">Sin ítems</td></tr>'}</tbody></table>
    <table class="totals">
      <tr><td>Subtotal servicios</td><td class="num">${money(bill.subtotal)}</td></tr>
      ${bill.lodgingDays ? `<tr><td>Hospedaje (${bill.lodgingDays} días)</td><td class="num">${money(bill.lodgingDays * bill.lodgingRate)}</td></tr>` : ''}
      <tr><td>Total</td><td class="num">${money(bill.total)}</td></tr>
      <tr><td>Ya pagado</td><td class="num">− ${money(bill.alreadyPaid)}</td></tr>
      <tr class="grand"><td>Neto a pagar</td><td class="num">${money(bill.netToPay)}</td></tr>
      ${bill.cardSurcharge ? `<tr><td class="muted">Con tarjeta (+5%)</td><td class="num">${money(Math.round(bill.netToPay * (1 + company.cardSurchargePct)))}</td></tr>` : ''}
    </table>
    <div class="footer">Documento generado por el sistema de gestión · ${company.currency}</div>
  </body></html>`
}

export function settlementHtml(p: SettlementPreview, company: CompanyConfig): string {
  const rows = p.salaryRows
    .map(
      (r) =>
        `<tr><td>${r.date}</td><td>${escape(r.service ?? '')}</td><td>${escape(r.client ?? '')}</td><td class="num">${money(
          r.salary
        )}</td></tr>`
    )
    .join('')
  const months = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
    ${header(company, 'LIQUIDACIÓN', `${months[p.month]} ${p.year}`)}
    <div style="margin-top:16px"><strong>Profesor:</strong> ${escape(p.professorName)}</div>
    <table><thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th class="num">Salario</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="muted">Sin clases en el periodo</td></tr>'}</tbody></table>
    <table class="totals">
      <tr><td>Bruto (salarios)</td><td class="num">${money(p.result.gross)}</td></tr>
      <tr><td>Descuento bar</td><td class="num">− ${money(p.result.barDiscount)}</td></tr>
      <tr class="grand"><td>Neto a pagar</td><td class="num">${money(p.result.net)}</td></tr>
    </table>
    <div class="footer">Documento generado por el sistema de gestión · ${company.currency}</div>
  </body></html>`
}

function escape(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
