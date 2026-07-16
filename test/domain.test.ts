/**
 * Tests del núcleo de dominio, validados contra celdas conocidas del Excel real
 * (software inc.xlsx). Ejecutar con: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { roundCOP, formatCOP, pctToFactor } from '../shared/services/money'
import {
  excelSerialToISO,
  dayFractionToMinutes,
  minutesToHHMM,
  parseFlexibleDate,
  datedifDays
} from '../shared/services/dates'
import { normalize, normalizeCountry } from '../shared/services/text'
import { autoPrice, professorSalary, derivePayModel, realHours } from '../shared/services/pricing'
import { detectCourse, accumulatedClassHours } from '../shared/services/courses'
import { computeClientBill } from '../shared/services/billing'
import { computeProfessorPayroll } from '../shared/services/payroll'
import { computeRunningBalance } from '../shared/services/balance'
import { ageAt, ageBucket, ageHistogram } from '../shared/services/statistics'
import { unitCost, saleTotal, canSell } from '../shared/services/bar'
import { schedule, outstanding } from '../shared/services/paymentPlans'

// --------------------------------------------------------------------------
test('money: roundCOP y factor de descuento', () => {
  assert.equal(roundCOP(300000.0000000001), 300000)
  assert.equal(roundCOP(1234.6), 1235)
  assert.equal(roundCOP(1240, 50), 1250)
  assert.equal(pctToFactor(10), 0.9)
  assert.equal(pctToFactor(0), 1)
  assert.ok(formatCOP(1234567).includes('1.234.567'))
})

// --------------------------------------------------------------------------
test('dates: seriales y fracciones de hora del Excel', () => {
  // F3=45839 (check-in) -> 2025-07-01 ; horas Club B4=0.3333=08:00, C4=0.375=09:00
  assert.equal(excelSerialToISO(45839), '2025-07-01')
  assert.equal(dayFractionToMinutes(1 / 3), 480)
  assert.equal(minutesToHHMM(480), '08:00')
  assert.equal(dayFractionToMinutes(0.375), 540)
  assert.equal(minutesToHHMM(540), '09:00')
})

test('dates: parseo tolerante de fechas de nacimiento "sucias"', () => {
  assert.equal(parseFlexibleDate(35671).iso !== null, true) // serial válido
  assert.equal(parseFlexibleDate('29/8/1992').iso, '1992-08-29')
  assert.equal(parseFlexibleDate('04/031977').iso, '1977-03-04') // separador extra corregido
  const partial = parseFlexibleDate('17/08/')
  assert.equal(partial.iso, null) // irrecuperable
  assert.equal(partial.raw, '17/08/') // pero no se pierde el dato
  assert.equal(parseFlexibleDate('45839').iso, '2025-07-01')
})

test('dates: datedif en días', () => {
  assert.equal(datedifDays('2025-07-01', '2025-07-08'), 7)
})

// --------------------------------------------------------------------------
test('text: normalización de nombres y países', () => {
  assert.equal(normalize('  Diana   Benavides  '), 'diana benavides')
  assert.equal(normalize('Ozuña'), 'ozuna')
  assert.equal(normalizeCountry('colombia'), 'Colombia')
  assert.equal(normalizeCountry('Francia'), 'Francia')
})

// --------------------------------------------------------------------------
test('pricing: precio automático (Club!J) con prorrateo por horas', () => {
  // Catálogo O9: "1h clases grupales" price=390000, hours=1, days=0
  const item = { hours: 1, days: 0, price: 390000 }
  // 1 hora, sin descuento -> 390000
  assert.equal(autoPrice({ item, clientDiscountPct: 0, durationMin: 60 }), 390000)
  // 10% de descuento -> 351000
  assert.equal(autoPrice({ item, clientDiscountPct: 10, durationMin: 60 }), 351000)
  // Catálogo O5: "4h curso" price=1052000, hours=4 -> 2 horas = mitad
  const curso = { hours: 4, days: 0, price: 1052000 }
  assert.equal(autoPrice({ item: curso, clientDiscountPct: 0, durationMin: 120 }), 526000)
  // Precio manual -> auto no aplica
  assert.equal(autoPrice({ item, clientDiscountPct: 0, durationMin: 60, manualPrice: 250000 }), null)
})

test('pricing: precio por día (servicio "Daily")', () => {
  // Un servicio por día: days=1 -> (1/1)*price
  const daily = { hours: 0, days: 1, price: 15000 }
  assert.equal(autoPrice({ item: daily, clientDiscountPct: 0, durationMin: null }), 15000)
})

test('pricing: salario del profesor (Club!M) reproduce el % del catálogo', () => {
  // S9 = 80000*1/390000 -> a precio pleno el profesor recibe 80000
  assert.equal(professorSalary(390000, 80000 / 390000), 80000)
  // S5 = 60000*4/1052000 -> 4h a precio pleno -> 240000 (60000/hora)
  assert.equal(professorSalary(1052000, (60000 * 4) / 1052000), 240000)
  // Sin profesor -> 0
  assert.equal(professorSalary(390000, 0.2, false), 0)
})

test('pricing: derivación del modelo de pago', () => {
  assert.deepEqual(derivePayModel((60000 * 4) / 1052000, 1052000, 4), {
    type: 'FIXED_PER_HOUR',
    rate: 60000
  })
  assert.equal(realHours(90), 1.5)
})

// --------------------------------------------------------------------------
test('courses: detección de nivel por horas acumuladas (reemplazo del #REF!)', () => {
  const courses = [
    { id: 1, name: 'Nivel 1', thresholdHours: 0 },
    { id: 2, name: 'Nivel 2', thresholdHours: 4 },
    { id: 3, name: 'Nivel 3', thresholdHours: 8 },
    { id: 4, name: 'Nivel 4', thresholdHours: 10 },
    { id: 5, name: 'Nivel 5', thresholdHours: 12 }
  ]
  assert.equal(detectCourse(0, courses)?.id, 1)
  assert.equal(detectCourse(5, courses)?.id, 2) // umbral 4 alcanzado
  assert.equal(detectCourse(8, courses)?.id, 3) // empate exacto en el umbral
  assert.equal(detectCourse(100, courses)?.id, 5)
  const txs = [
    { chosenServiceIsClass: true, durationMin: 60 },
    { chosenServiceIsClass: true, durationMin: 120 },
    { chosenServiceIsClass: false, durationMin: 300 }
  ]
  assert.equal(accumulatedClassHours(txs), 3) // 1h + 2h, ignora lo no-clase
})

// --------------------------------------------------------------------------
test('billing: factura de cliente con recargo de tarjeta +5%', () => {
  const r = computeClientBill({
    servicePrices: [390000],
    serviceExtras: [],
    discountPct: 0,
    deduction: 0,
    lodgingDays: 0,
    lodgingRate: 0,
    barTotal: 0,
    alreadyPaid: 0,
    cardSurcharge: true
  })
  assert.equal(r.total, 390000)
  assert.equal(r.netToPay, 390000)
  assert.equal(r.cardTotal, 409500) // 390000 * 1.05
})

test('billing: descuento a nivel factura, deducción, hospedaje y ya pagado', () => {
  const r = computeClientBill({
    servicePrices: [1000000],
    serviceExtras: [200000],
    discountPct: 10, // (1.200.000)*0.9 = 1.080.000
    deduction: 80000, // -80.000 = 1.000.000
    lodgingDays: 3,
    lodgingRate: 50000, // +150.000
    barTotal: 30000, // +30.000 = 1.180.000
    alreadyPaid: 180000, // neto 1.000.000
    cardSurcharge: false
  })
  assert.equal(r.subtotal, 1000000)
  assert.equal(r.lodging, 150000)
  assert.equal(r.total, 1180000)
  assert.equal(r.netToPay, 1000000)
})

// --------------------------------------------------------------------------
test('payroll: liquidación mensual del profesor', () => {
  const r = computeProfessorPayroll({
    salaries: [60000, 80000, 240000], // bruto 380.000
    barConsumo: 100000,
    barDiscountPct: 0.1, // -10.000
    assignedExpenses: [50000] // -50.000
  })
  assert.equal(r.gross, 380000)
  assert.equal(r.barDiscount, 10000)
  assert.equal(r.expenses, 50000)
  assert.equal(r.net, 320000)
})

// --------------------------------------------------------------------------
test('balance: saldo acumulado que se detiene después de HOY', () => {
  const rows = computeRunningBalance(
    [
      { date: '2025-07-01', inClients: 100000, inBar: 20000, out: 50000 },
      { date: '2025-07-02', inClients: 0, inBar: 10000, out: 0 },
      { date: '2999-01-01', inClients: 999, inBar: 0, out: 0 } // futuro
    ],
    '2025-07-15'
  )
  assert.equal(rows[0].runningBalance, 70000) // 120000-50000
  assert.equal(rows[1].runningBalance, 80000) // +10000
  assert.equal(rows[2].runningBalance, null) // futuro -> null
})

// --------------------------------------------------------------------------
test('statistics: edad y bucket', () => {
  assert.equal(ageBucket(27), 25)
  assert.equal(ageBucket(35), 35)
  const age = ageAt('1990-01-01', '2020-01-01') // ~30 años (divisor 365)
  assert.ok(age !== null && age > 29.9 && age < 30.2)
  assert.equal(ageAt('2030-01-01', '2020-01-01'), null) // fecha implausible -> null
})

test('statistics: histograma ignora edades negativas/invalidas', () => {
  const hist = ageHistogram([27, 35, 8, 39, null, -5, 130])
  const buckets = Object.fromEntries(hist.map((h) => [h.bucket, h.count]))
  assert.equal(buckets[25], 1) // 27
  assert.equal(buckets[35], 2) // 35 y 39
  assert.equal(buckets[5], 1) // 8
  assert.equal(hist.find((h) => h.bucket < 0), undefined) // sin negativos
})

// --------------------------------------------------------------------------
test('bar: costo unitario, total de venta y control de stock', () => {
  // Bar!K=18000, L=15 -> M=1200
  assert.equal(unitCost(18000, 15), 1200)
  assert.equal(saleTotal(2, 5000), 10000)
  assert.equal(canSell(5, 3).ok, true)
  assert.equal(canSell(2, 3).ok, false)
})

// --------------------------------------------------------------------------
test('paymentPlans: amortización reproduce "ozuna pago de cometa"', () => {
  // Saldo inicial 4.028.000; abonos 412.667 y 585.833 -> 3.615.333 y 3.029.500
  const rows = schedule(4028000, [
    { paidDate: '2025-07-01', amount: 412667 },
    { paidDate: '2025-07-15', amount: 585833 }
  ])
  assert.equal(rows[0].balanceAfter, 3615333)
  assert.equal(rows[1].balanceAfter, 3029500)
  assert.equal(outstanding(4028000, []), 4028000)
})

// --------------------------------------------------------------------------
import { parseCsv, csvToObjects } from '../shared/services/csv'
import { rowHash, guess, parseHourish } from '../shared/services/formsGuess'

test('csv: comillas, comas y saltos dentro de celdas', () => {
  const text = 'Nombre,Comentario\n"Pérez, Ana","Dijo ""hola""\ny se fue"\nBeto,simple'
  const rows = parseCsv(text)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[1], ['Pérez, Ana', 'Dijo "hola"\ny se fue'])
  const objs = csvToObjects(text)
  assert.equal(objs[0]['Nombre'], 'Pérez, Ana')
  assert.equal(objs[1]['Comentario'], 'simple')
})

test('csv: BOM y filas vacías', () => {
  const text = '﻿A,B\n1,2\n,\n'
  const objs = csvToObjects(text)
  assert.equal(objs.length, 1)
  assert.equal(objs[0]['A'], '1')
})

test('forms: hash estable e independiente del orden de columnas', () => {
  const a = rowHash('f1', { Nombre: 'Ana', Hora: '8:00' })
  const b = rowHash('f1', { Hora: '8:00', Nombre: 'Ana' })
  const c = rowHash('f2', { Nombre: 'Ana', Hora: '8:00' })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, rowHash('f1', { Nombre: 'Ana', Hora: '9:00' }))
})

test('forms: auto-detección de campos por encabezados del form', () => {
  const g = guess({
    'Marca temporal': '13/07/2026 9:12',
    'Nombre completo': 'Lucía Fernández',
    'Correo electrónico': 'lucia@example.com',
    'Fecha de la clase': '16/07/2026',
    'Hora': '8:00 a. m.',
    '¿Qué clase quieres?': 'Kite curso',
    'Fecha de nacimiento': '05/12/1994'
  })
  assert.equal(g.fullName, 'Lucía Fernández')
  assert.equal(g.email, 'lucia@example.com')
  assert.equal(g.date, '2026-07-16')       // fecha de la clase, no la marca temporal ni nacimiento
  assert.equal(g.birthDate, '1994-12-05')
  assert.equal(g.startMin, 480)
  assert.equal(g.service, 'Kite curso')
})

test('forms: parseHourish con am/pm y formatos sueltos', () => {
  assert.equal(parseHourish('8:30'), 510)
  assert.equal(parseHourish('08:30'), 510)
  assert.equal(parseHourish('8:30 p. m.'), 1230)
  assert.equal(parseHourish('12:15 a. m.'), 15)
  assert.equal(parseHourish('sin hora'), null)
})

// ── sha256 puro (shared/services/hash) ─────────────────────────────────────
import { sha256Hex } from '../shared/services/hash'

test('hash: sha256Hex coincide con digests conocidos (shasum -a 256)', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('kite addict'), '3ba9a2e2a3201839ab4e5c9a6417252141f414e843c1cbc05917e5fb0f656e49')
  // UTF-8 multibyte (tildes y emoji) para cubrir la codificación manual
  assert.equal(sha256Hex('ñandú 🪁'), 'cb6a29e4c2d781a21e994d2471ed1719919700d221a4569d6850a49ddd16957e')
  // Entrada > 64 bytes para cubrir múltiples bloques
  assert.equal(sha256Hex('a'.repeat(100)), '2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e')
})
