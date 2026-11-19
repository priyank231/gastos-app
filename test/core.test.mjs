import test from 'node:test';
import assert from 'node:assert/strict';
import { round2, parseAmount, parsePlan, monthSummary, defaultData, expensesCSV, validateBackup, daysInMonth } from '../core.js';

test('parseAmount: coma, punto y rechazos', () => {
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount(' 3.456 '), 3.46);
  for (const bad of ['', 'abc', '0', '-5', '1e9', '100001']) assert.equal(parseAmount(bad), null);
});

const rows = [
  ['Alquiler', 'Vivienda', 'Fijo', 200, 12, 1, 1, 1, 2400, 200, 0, 'OK', null, null],
  ['Agua (bimestral)', 'Suministros', 'Fijo', 50, 6, 1, 2, 2, 300, 25, 25, 'OK', null, null],
  ['Seguro coche', 'Seguros e impuestos', 'Fijo', 400, 1, 4, 12, 12, 400, 33.33, 33.33, 'OK', null, null],
  ['Viaje', 'Ocio', 'Variable', 856, 1, 10, 1, 12, 856, 0, 0, 'OK', null, 2026],
  [null, null],                                  // fila vacia: se ignora
  ['TOTAL', null, null, 999, 1],                 // corta el recorrido
  ['Despues del total', 'Otros', 'Fijo', 10, 12],
];

test('parsePlan: media mensual y gastos puntuales', () => {
  const { categories, oneOffs } = parsePlan(rows);
  const get = (n) => categories.find((c) => c.name === n)?.budget;
  assert.equal(get('Vivienda'), 200);
  assert.equal(get('Suministros'), 25);
  assert.equal(get('Seguros e impuestos'), 33.33);
  assert.equal(get('Ocio'), 0);                  // el viaje no entra en la media
  assert.equal(categories.find((c) => c.name === 'Otros'), undefined);
  assert.deepEqual(oneOffs, [{ name: 'Viaje', category: 'Ocio', year: 2026, month: 10, amount: 856 }]);
});

function sample() {
  const d = defaultData();
  Object.assign(d, parsePlan(rows), { income: 2465, investment: 400 });
  d.expenses = [
    { id: 'a', date: '2026-10-02', amount: 60, category: 'Vivienda', concept: '' },
    { id: 'b', date: '2026-10-05', amount: 30, category: 'Sin plan', concept: 'raro' },
    { id: 'c', date: '2026-09-30', amount: 500, category: 'Vivienda', concept: 'otro mes' },
  ];
  return d;
}

test('monthSummary: gasto puntual solo en su mes, gastos fuera del plan y ritmo diario', () => {
  const oct = monthSummary(sample(), 2026, 10, '2026-10-11');
  assert.equal(oct.budget, round2(200 + 25 + 33.33 + 856));
  assert.equal(oct.spent, 90);
  assert.equal(oct.rows.find((r) => r.name === 'Sin plan').budget, 0);
  assert.equal(oct.rows.find((r) => r.name === 'Sin plan').over, true);
  assert.equal(oct.daysLeft, 21);               // 31 - 11 + 1
  assert.equal(oct.daily, round2(oct.remaining / 21));
  assert.equal(oct.free, round2(2465 - oct.budget - 400));
  const nov = monthSummary(sample(), 2026, 11, '2026-10-11');
  assert.equal(nov.budget, round2(200 + 25 + 33.33));   // sin el viaje
  assert.equal(nov.spent, 0);
  assert.equal(nov.daysLeft, 30);               // mes futuro: todos los dias
});

test('monthSummary: mes pasado no tiene ritmo diario; bisiesto', () => {
  const sep = monthSummary(sample(), 2026, 9, '2026-10-11');
  assert.equal(sep.daysLeft, 0);
  assert.equal(sep.daily, 0);
  assert.equal(daysInMonth(2028, 2), 29);
});

test('expensesCSV escapa comillas', () => {
  const csv = expensesCSV([{ date: '2026-10-01', amount: 5, category: 'Ocio', concept: 'cena "buena"' }]);
  assert.equal(csv.split('\n')[1], '2026-10-01,5.00,"Ocio","cena ""buena"""');
});

test('validateBackup: filtra datos invalidos y rechaza basura', () => {
  assert.throws(() => validateBackup({}), /no valido/);
  const d = validateBackup({ income: '100', categories: [{ name: 'A', budget: 5 }, { x: 1 }],
    expenses: [{ date: '2026-10-01', amount: 3, category: 'A' }, { date: 'mal', amount: 3 }, { date: '2026-10-02', amount: -1 }] });
  assert.equal(d.categories.length, 1);
  assert.equal(d.expenses.length, 1);
  assert.equal(d.income, 100);
});
