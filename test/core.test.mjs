import test from 'node:test';
import assert from 'node:assert/strict';
import { round2, parseAmount, parsePlan, paymentShare, monthSummary, savingsStats, goalTotals, defaultData,
  expensesCSV, validateBackup, daysInMonth } from '../core.js';

test('parseAmount: coma, punto y rechazos', () => {
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount(' 3.456 '), 3.46);
  for (const bad of ['', 'abc', '0', '-5', '1e9', '100001']) assert.equal(parseAmount(bad), null);
});

const rows = [
  ['Alquiler', 'Vivienda', 'Fijo', 200, 12, 1, 1, 1, 2400, 200, 0, 'OK', null, null],
  ['Agua (bimestral)', 'Suministros', 'Fijo', 50, 6, 1, 2, 2, 300, 25, 25, 'OK', null, null],
  ['Seguro coche', 'Seguros e impuestos', 'Fijo', 400, 1, 4, 12, 12, 400, 33.33, 33.33, 'OK', null, null],
  ['Ropa', 'Personal', 'Variable', 200, 2, 1, 6, 6, 400, 33.33, 33.33, 'OK', null, null],
  ['Viaje', 'Ocio', 'Variable', 856, 1, 10, 1, 12, 856, 0, 0, 'OK', null, 2026],
  [null, null],
  ['TOTAL', null, null, 999, 1],
  ['Despues del total', 'Otros', 'Fijo', 10, 12],
];

test('parsePlan: media, gran pago anual y gasto puntual', () => {
  const { categories, payments } = parsePlan(rows, 2026);
  const get = (n) => categories.find((c) => c.name === n)?.budget;
  assert.equal(get('Vivienda'), 200);
  assert.equal(get('Suministros'), 25);
  assert.equal(get('Personal'), 33.33);              // 2 pagos al anio -> media
  assert.equal(get('Seguros e impuestos'), 0);       // el seguro va como gran pago, no en la media
  assert.equal(categories.find((c) => c.name === 'Otros'), undefined);
  const seg = payments.find((p) => p.name === 'Seguro coche');
  assert.deepEqual([seg.amount, seg.month, seg.spread, seg.repeat, seg.year], [400, 4, 12, true, 2026]);
  const viaje = payments.find((p) => p.name === 'Viaje');
  assert.deepEqual([viaje.amount, viaje.month, viaje.year, viaje.spread, viaje.repeat], [856, 10, 2026, 1, false]);
});

test('paymentShare: 12 meses, 6 meses, solo ese mes y repeticion anual', () => {
  const base = { amount: 1200, month: 4, year: 2026, repeat: false };
  const p12 = { ...base, spread: 12 }, p6 = { ...base, spread: 6 }, p1 = { ...base, spread: 1 };
  assert.equal(paymentShare(p12, 2025, 5), 100);     // empieza 12 meses antes
  assert.equal(paymentShare(p12, 2026, 4), 100);     // mes de pago
  assert.equal(paymentShare(p12, 2026, 5), 0);       // despues del pago ya no (no se repite)
  assert.equal(paymentShare(p12, 2025, 4), 0);
  assert.equal(paymentShare(p6, 2025, 11), 200);     // nov-abr
  assert.equal(paymentShare(p6, 2025, 10), 0);
  assert.equal(paymentShare(p1, 2026, 4), 1200);
  assert.equal(paymentShare(p1, 2026, 3), 0);
  const rep = { ...p12, repeat: true };
  let total2027 = 0;
  for (let m = 1; m <= 12; m++) total2027 += paymentShare(rep, 2027, m);
  assert.ok(Math.abs(total2027 - 1200) < 1e-9);      // un anio completo reparte exactamente el pago
  assert.equal(paymentShare(rep, 2026, 12), 100);    // dic 2026 ya aparta para el pago de abril 2027
});

function sample() {
  const d = defaultData();
  const plan = parsePlan(rows, 2026);
  Object.assign(d, plan, { income: 2000, investment: 400 });
  d.expenses = [
    { id: 'a', date: '2026-10-02', amount: 60, category: 'Vivienda', concept: '' },
    { id: 'b', date: '2026-10-05', amount: 30, category: 'Sin plan', concept: 'raro' },
    { id: 'c', date: '2026-09-30', amount: 500, category: 'Vivienda', concept: 'otro mes' },
  ];
  d.incomes = [{ id: 'i1', date: '2026-10-15', amount: 550, concept: 'Salidas PeM' }];
  d.goals = [{ id: 'g1', name: 'Viaje', target: 1000 }];
  d.contributions = [{ id: 'c1', goalId: 'g1', date: '2026-10-20', amount: 150, concept: '' }];
  return d;
}

test('monthSummary: gran pago, fuera de plan, ingreso extra, ritmo y aportaciones', () => {
  const oct = monthSummary(sample(), 2026, 10, '2026-10-11');
  // presupuesto octubre = 200 + 25 + 33.33 (media) + seguro 400/12 + viaje 856
  assert.equal(oct.budget, round2(200 + 25 + 33.33 + 400 / 12 + 856));
  assert.equal(oct.spent, 90);
  assert.equal(oct.rows.find((r) => r.name === 'Sin plan').over, true);
  assert.equal(oct.daysLeft, 21);
  assert.equal(oct.income, 2550);                     // sueldo + extra
  assert.equal(oct.extra, 550);
  assert.equal(oct.saved, 2460);                      // 2550 - 90
  assert.equal(oct.contributed, 150);
  const nov = monthSummary(sample(), 2026, 11, '2026-10-11');
  assert.equal(nov.budget, round2(200 + 25 + 33.33 + 400 / 12));   // sin el viaje
  assert.equal(nov.income, 2000);
  assert.equal(nov.daysLeft, 30);
});

test('savingsStats: promedio de meses completos, sin el mes en curso', () => {
  const d = defaultData();
  d.income = 2000;
  d.expenses = [
    { id: '1', date: '2026-08-02', amount: 1500, category: 'x', concept: '' },
    { id: '2', date: '2026-09-03', amount: 1700, category: 'x', concept: '' },
    { id: '3', date: '2026-10-04', amount: 1000, category: 'x', concept: '' },
    { id: '4', date: '2026-11-02', amount: 100, category: 'x', concept: '' },     // mes en curso: no cuenta
  ];
  d.incomes = [{ id: 'i', date: '2026-09-10', amount: 1000, concept: '' }];
  const s = savingsStats(d, '2026-11-19');
  assert.deepEqual(s.months.map((x) => x.saved), [500, 1300, 1000]);
  assert.equal(s.count, 3);
  assert.equal(s.avg, round2((500 + 1300 + 1000) / 3));
  assert.equal(savingsStats({ ...d, income: 0 }, '2026-11-19').ready, false);
  // primer registro tarde (dia 19) -> ese mes es parcial y se salta
  const late = defaultData();
  late.income = 2000;
  late.expenses = [{ id: 'z', date: '2026-09-19', amount: 50, category: 'x', concept: '' }];
  assert.equal(savingsStats(late, '2026-11-19').months[0].m, 10);
  assert.equal(savingsStats({ ...late, savingsFrom: '2026-09' }, '2026-11-19').months[0].m, 9);
});

test('goalTotals y expensesCSV', () => {
  const d = sample();
  const g = goalTotals(d)[0];
  assert.equal(g.total, 150);
  assert.equal(g.pct, 0.15);
  const csv = expensesCSV({ ...defaultData(), expenses: [{ date: '2026-10-01', amount: 5, category: 'Ocio', concept: 'cena "buena"' }] });
  assert.equal(csv.split('\n')[1], '2026-10-01,gasto,-5.00,"Ocio","cena ""buena"""');
  assert.ok(expensesCSV(d).includes('ingreso extra,550.00'));
});

test('validateBackup: filtra basura, valida y migra datos v1', () => {
  assert.throws(() => validateBackup({}), /no valido/);
  const d = validateBackup({ income: '100', categories: [{ name: 'A', budget: 5 }, { x: 1 }],
    expenses: [{ date: '2026-10-01', amount: 3, category: 'A' }, { date: 'mal', amount: 3 }, { date: '2026-10-02', amount: -1 }] });
  assert.equal(d.categories.length, 1);
  assert.equal(d.expenses.length, 1);
  assert.equal(d.version, 2);
  const v1 = validateBackup({ categories: [], expenses: [],
    oneOffs: [{ name: 'Viaje', category: 'Ocio', year: 2026, month: 10, amount: 856 }] });
  assert.equal(v1.payments.length, 1);
  assert.deepEqual([v1.payments[0].spread, v1.payments[0].repeat], [1, false]);
  const badGoal = validateBackup({ categories: [], expenses: [], goals: [{ id: 'g', name: 'V' }],
    contributions: [{ goalId: 'zzz', date: '2026-10-01', amount: 5 }, { goalId: 'g', date: '2026-10-01', amount: 5 }] });
  assert.equal(badGoal.contributions.length, 1);
});

test('daysInMonth bisiesto', () => assert.equal(daysInMonth(2028, 2), 29));
