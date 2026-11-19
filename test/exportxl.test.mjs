import test from 'node:test';
import assert from 'node:assert/strict';
import { periodBounds, monthsIn, allDates, buildMovements, buildSummary, periodCSV, MOV_HEADER } from '../exportxl.js';
import { defaultData } from '../core.js';
import { createGroup, partnerOf } from '../shared.js';

function sample() {
  const d = defaultData();
  d.income = 2000;
  d.categories = [{ name: 'Alimentación', budget: 300 }, { name: 'Ocio', budget: 100 }];
  d.expenses = [
    { id: '1', date: '2026-10-05', amount: 50, category: 'Alimentación', concept: 'Súper "grande"; con coma, y punto y coma' },
    { id: '2', date: '2026-11-03', amount: 40, category: 'Ocio', concept: 'Cine' },
    { id: '3', date: '2026-11-18', amount: 20, category: 'Alimentación', concept: 'Fruta' },
  ];
  d.incomes = [{ id: 'i', date: '2026-11-10', amount: 550, concept: 'Extra' }];
  d.investments = [{ id: 'v', date: '2026-11-12', amount: 400, concept: 'ETF' }];
  d.goals = [{ id: 'g', name: 'Viaje', target: 0 }];
  d.contributions = [{ id: 'c', goalId: 'g', date: '2026-11-15', amount: 100, concept: '' }];
  const s = createGroup('Priyank', 'Bea');
  const her = partnerOf(s).id;
  s.entries = [
    { id: 'a', date: '2026-11-18', amount: 60, place: 'Bar Sol', category: 'Ocio', note: 'cena', payerId: s.meId, payerPct: 50, settle: false, photoId: '', updated: 1, deleted: false },
    { id: 'b', date: '2026-11-19', amount: 30, place: 'Cine', category: 'Ocio', note: '', payerId: her, payerPct: 50, settle: false, photoId: '', updated: 2, deleted: false },
    { id: 'c', date: '2026-11-19', amount: 10, place: '', category: 'Liquidación', note: '', payerId: her, payerPct: 0, settle: true, photoId: '', updated: 3, deleted: false },
    { id: 'd', date: '2026-11-19', amount: 99, place: 'Borrado', category: 'Ocio', note: '', payerId: s.meId, payerPct: 50, settle: false, photoId: '', updated: 4, deleted: true },
  ];
  return { d, s };
}

test('periodBounds: hoy, semana (lunes-domingo), mes, año y todo', () => {
  const today = '2026-11-19';                                    // jueves
  assert.deepEqual(periodBounds('today', { today }), { from: today, to: today, label: 'Hoy (19/11/2026)', file: today, aligned: false });
  const w = periodBounds('week', { today });
  assert.deepEqual([w.from, w.to, w.file, w.aligned], ['2026-11-16', '2026-11-22', 'semana-2026-11-16', false]);
  assert.equal(periodBounds('week', { today: '2026-11-22' }).from, '2026-11-16');              // domingo
  assert.equal(periodBounds('week', { today: '2026-11-23' }).from, '2026-11-23');              // lunes
  const m = periodBounds('month', { today, month: '2028-02' });
  assert.deepEqual([m.from, m.to, m.label, m.aligned], ['2028-02-01', '2028-02-29', 'Febrero 2028', true]);   // bisiesto
  assert.equal(periodBounds('month', { today }).label, 'Noviembre 2026');                      // sin mes elegido: el actual
  const y = periodBounds('year', { today, year: 2025 });
  assert.deepEqual([y.from, y.to, y.label], ['2025-01-01', '2025-12-31', 'Año 2025']);
  const all = periodBounds('all', { today }, ['2026-10-05', '2026-11-18', '2026-03-02']);
  assert.deepEqual([all.from, all.to, all.file], ['2026-03-01', '2026-11-30', 'todo']);
  assert.equal(periodBounds('all', { today }, []).from, '2026-11-01');                         // sin datos no revienta
});

test('monthsIn cruza años', () => {
  assert.deepEqual(monthsIn('2026-11-01', '2027-02-28'), [{ y: 2026, m: 11 }, { y: 2026, m: 12 }, { y: 2027, m: 1 }, { y: 2027, m: 2 }]);
});

test('movimientos: signos, tipos, compartido con mi parte y sin borrados', () => {
  const { d, s } = sample();
  const r = periodBounds('month', { today: '2026-11-19', month: '2026-11' });
  const mv = buildMovements(d, s, r);
  const by = (t, c) => mv.find((x) => x.type === t && (c === undefined || x.concept === c || x.place === c));
  assert.equal(by('Gasto', 'Cine').amount, -40);
  assert.equal(by('Ingreso extra').amount, 550);
  assert.equal(by('Inversión').amount, -400);
  assert.deepEqual([by('Aportación a objetivo').category, by('Aportación a objetivo').amount], ['Viaje', -100]);
  const bar = by('Gasto compartido', 'Bar Sol');
  assert.deepEqual([bar.amount, bar.myShare, bar.paidBy], [-60, -30, 'Priyank']);               // pagué yo 60: me toca 30
  assert.deepEqual([by('Gasto compartido', 'Cine').amount, by('Gasto compartido', 'Cine').myShare, by('Gasto compartido', 'Cine').paidBy], [-30, -15, 'Bea']);
  const liq = by('Pago entre vosotros');
  assert.deepEqual([liq.amount, liq.paidBy, liq.myShare], [10, 'Bea', null]);                  // Bea me paga 10: entra dinero
  assert.equal(mv.some((x) => x.place === 'Borrado'), false);
  assert.equal(mv.some((x) => x.date.startsWith('2026-10')), false);                           // fuera del periodo
  assert.deepEqual(mv.map((x) => x.date), [...mv.map((x) => x.date)].sort());                  // ordenado por fecha
  assert.equal(buildMovements(d, s, r, { includeShared: false }).some((x) => x.type.includes('ompartido')), false);
  assert.equal(buildMovements(d, null, r).length, mv.filter((x) => !x.paidBy).length);         // sin grupo: solo individual
});

test('resumen de un mes: presupuesto frente a gasto real, con mi parte de lo compartido', () => {
  const { d, s } = sample();
  const sum = buildSummary(d, s, periodBounds('month', { today: '2026-11-19', month: '2026-11' }), { today: '2026-11-19' });
  assert.equal(sum.aligned, true);
  const row = (n) => sum.rows.find((x) => x.name === n);
  assert.deepEqual([row('Alimentación').budget, row('Alimentación').spent, row('Alimentación').diff], [300, 20, 280]);
  assert.deepEqual([row('Ocio').budget, row('Ocio').spent, row('Ocio').diff], [100, 40, 60]);
  assert.deepEqual([row('Compartido (mi parte)').spent, row('Compartido (mi parte)').diff, row('Compartido (mi parte)').budget], [45, null, null]);   // 30 + 15, sin presupuesto propio
  const t = Object.fromEntries(sum.totals.map((x) => [x.label, x.value]));
  assert.equal(t['Ingresos (sueldo + extras)'], 2550);
  assert.equal(t['Gastos (incluye mi parte de lo compartido)'], -105);                          // 20 + 40 + 45
  assert.equal(t['Ahorro (ingresos - gastos)'], 2445);
  assert.equal(t['Invertido (no cuenta como gasto)'], 400);
  assert.equal(t['Aportado a objetivos'], 100);
});

test('resumen de un año suma los meses transcurridos; semana y hoy no llevan presupuesto', () => {
  const { d, s } = sample();
  const year = buildSummary(d, s, periodBounds('year', { today: '2026-11-19', year: 2026 }), { today: '2026-11-19' });
  const ali = year.rows.find((x) => x.name === 'Alimentación');
  assert.deepEqual([ali.budget, ali.spent, year.months], [3300, 70, 11]);                       // enero-noviembre: 11 x 300; no cuenta diciembre
  assert.equal(year.totals.find((t) => t.label.startsWith('Ingresos')).value, 11 * 2000 + 550);
  const pastYear = buildSummary(d, s, periodBounds('year', { today: '2026-11-19', year: 2025 }), { today: '2026-11-19' });
  assert.equal(pastYear.months, 12);                                                            // un año ya terminado cuenta los 12
  assert.equal(buildSummary(d, s, periodBounds('year', { today: '2026-11-19', year: 2026 })).months, 12);   // sin "hoy" no recorta
  const wk = buildSummary(d, s, periodBounds('week', { today: '2026-11-19' }));
  assert.equal(wk.aligned, false);
  assert.equal(wk.rows.find((x) => x.name === 'Alimentación').budget, null);
  assert.equal(wk.rows.find((x) => x.name === 'Alimentación').spent, 20);
  assert.equal(wk.totals.some((t) => t.label.startsWith('Ahorro')), false);
});

test('CSV del periodo: ; coma decimal, comillas escapadas, BOM y misma cabecera que el Excel', () => {
  const { d, s } = sample();
  const csv = periodCSV(buildMovements(d, s, periodBounds('all', { today: '2026-11-19' }, allDates(d, s))));
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], MOV_HEADER.join(';'));
  assert.ok(csv.startsWith('﻿'));
  assert.ok(lines.some((l) => l.includes('"Súper ""grande""; con coma, y punto y coma"') && l.includes('-50,00')));
  assert.ok(lines.some((l) => l.includes('"Gasto compartido"') && l.endsWith('-30,00')));
  assert.ok(lines.some((l) => l.includes('"Gasto"') && l.endsWith(';"";"";')));                  // sin parte compartida: columnas vacías
});
