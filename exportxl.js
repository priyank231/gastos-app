// Exportar por periodo (Hoy / Semana / Mes / Año / Todo) a un Excel entendible: hoja "Movimientos" y hoja "Resumen".
// Lógica pura (sin DOM); la escritura del .xlsx usa SheetJS, que se le pasa ya cargado.
import { MONTHS, monthSummary, monthIncome, round2, pad } from './core.js';
import { nameOf, periodStats } from './shared.js';

export const PERIODS = { today: 'Hoy', week: 'Semana', month: 'Mes', year: 'Año', all: 'Todo' };
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MOV_HEADER = ['Fecha', 'Tipo', 'Categoría u objetivo', 'Concepto', 'Importe (€)', 'Pagó', 'Local', 'Mi parte (€)'];

const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso) => new Date(`${iso}T12:00:00`);
const dmy = (iso) => iso.split('-').reverse().join('/');
const lastDay = (y, m) => new Date(y, m, 0).getDate();

/**
 * Límites de un periodo. opts: { today:'YYYY-MM-DD', month:'YYYY-MM', year:number }.
 * allDates: todas las fechas con datos (solo para "Todo"). Devuelve { from, to, label, file, aligned }.
 * `aligned` = el periodo son meses completos (se puede comparar con el presupuesto mensual).
 */
export function periodBounds(kind, opts = {}, allDates = []) {
  const today = opts.today || isoOf(new Date());
  if (kind === 'today') return { from: today, to: today, label: `Hoy (${dmy(today)})`, file: today, aligned: false };
  if (kind === 'week') {
    const d = dateOf(today);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const from = isoOf(start), to = isoOf(end);
    return { from, to, label: `Semana del ${dmy(from)} al ${dmy(to)}`, file: `semana-${from}`, aligned: false };
  }
  if (kind === 'month') {
    const ym = /^\d{4}-\d{2}$/.test(opts.month || '') ? opts.month : today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    return { from: `${ym}-01`, to: `${ym}-${pad(lastDay(y, m))}`, label: `${MONTHS[m - 1]} ${y}`, file: ym, aligned: true };
  }
  if (kind === 'year') {
    const y = Number.isInteger(opts.year) && opts.year >= 2000 ? opts.year : Number(today.slice(0, 4));
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Año ${y}`, file: String(y), aligned: true };
  }
  const sorted = [...allDates].sort();
  const from = sorted[0] ? `${sorted[0].slice(0, 7)}-01` : `${today.slice(0, 7)}-01`;
  const last = sorted[sorted.length - 1] || today;
  const [ly, lm] = last.split('-').map(Number);
  return { from, to: `${last.slice(0, 7)}-${pad(lastDay(ly, lm))}`, label: `Todo (desde ${dmy(from)})`, file: 'todo', aligned: true };
}

/** Meses [{y, m}] que toca un rango. */
export function monthsIn(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push({ y, m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export const inRange = (date, r) => date >= r.from && date <= r.to;

/** Todas las fechas con datos (individual + compartido), para el periodo "Todo". */
export function allDates(data, shared) {
  return [
    ...data.expenses, ...data.incomes, ...data.investments, ...data.contributions,
    ...((shared && shared.groupId ? shared.entries.filter((e) => !e.deleted) : [])),
  ].map((x) => x.date);
}

/** Parte que me toca de un gasto compartido (lo que pagó cada uno según el reparto). */
const myShareOf = (s, e) => {
  const payerPart = (e.amount * e.payerPct) / 100;
  return round2(e.payerId === s.meId ? payerPart : e.amount - payerPart);
};

/**
 * Filas de la hoja "Movimientos" del rango. Importes con signo (igual que el CSV): gastos, aportaciones e
 * inversiones en negativo; ingresos en positivo. En lo compartido, "Importe" es lo que cuesta la compra entera
 * y "Mi parte" lo que me toca a mí.
 */
export function buildMovements(data, shared, range, { includeShared = true } = {}) {
  const goalName = new Map(data.goals.map((g) => [g.id, g.name]));
  const rows = [
    ...data.expenses.map((e) => ({ date: e.date, type: 'Gasto', category: e.category, concept: e.concept, amount: -e.amount })),
    ...data.incomes.map((i) => ({ date: i.date, type: 'Ingreso extra', category: '', concept: i.concept, amount: i.amount })),
    ...data.investments.map((i) => ({ date: i.date, type: 'Inversión', category: '', concept: i.concept || '', amount: -i.amount })),
    ...data.contributions.map((c) => ({ date: c.date, type: 'Aportación a objetivo', category: goalName.get(c.goalId) || '', concept: c.concept || '', amount: -c.amount })),
  ];
  if (includeShared && shared && shared.groupId) {
    for (const e of shared.entries.filter((x) => !x.deleted)) {
      const who = nameOf(shared, e.payerId);
      if (e.settle) {
        rows.push({ date: e.date, type: 'Pago entre vosotros', category: '', concept: e.note || '', amount: e.payerId === shared.meId ? -e.amount : e.amount, paidBy: who });
      } else {
        rows.push({ date: e.date, type: 'Gasto compartido', category: e.category, concept: e.note || '', amount: -e.amount, paidBy: who, place: e.place || '', myShare: -myShareOf(shared, e) });
      }
    }
  }
  return rows.filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.category.localeCompare(b.category))
    .map((r) => ({ paidBy: '', place: '', myShare: null, ...r }));
}

/** Resumen por categoría y totales del rango. */
export function buildSummary(data, shared, range, { includeShared = true, today = '' } = {}) {
  const hasShared = includeShared && shared && shared.groupId;
  const shareIn = (from, to) => (hasShared ? periodStats(shared, { from, to }).myShare : 0);
  const rows = new Map();
  const bump = (name, k, v) => { const r = rows.get(name) || { name, budget: 0, spent: 0 }; r[k] += v; rows.set(name, r); };
  const totals = [];
  let income = 0, spent = 0, invested = 0, contributed = 0;
  let monthsCount = 0;
  if (range.aligned) {
    // un periodo en curso solo cuenta hasta el mes actual (no presupuesto ni sueldo de meses que no han llegado)
    const cap = /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : '';
    for (const { y, m } of monthsIn(range.from, range.to)) {
      if (cap && `${y}-${pad(m)}` > cap) continue;
      monthsCount++;
      const share = shareIn(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`);
      const s = monthSummary(data, y, m, '9999-12-31', { extra: share > 0 ? [{ name: 'Compartido (mi parte)', amount: share }] : [] });
      for (const r of s.rows) { bump(r.name, 'budget', r.budget); bump(r.name, 'spent', r.spent); }
      income += monthIncome(data, y, m); spent += s.spent; invested += s.invested; contributed += s.contributed;
    }
  } else {
    for (const e of data.expenses.filter((x) => inRange(x.date, range))) { bump(e.category, 'spent', e.amount); spent += e.amount; }
    const share = shareIn(range.from, range.to);
    if (share > 0) { bump('Compartido (mi parte)', 'spent', share); spent += share; }
    income = data.incomes.filter((x) => inRange(x.date, range)).reduce((a, x) => a + x.amount, 0);
    invested = data.investments.filter((x) => inRange(x.date, range)).reduce((a, x) => a + x.amount, 0);
    contributed = data.contributions.filter((x) => inRange(x.date, range)).reduce((a, x) => a + x.amount, 0);
  }
  // "Compartido (mi parte)" no tiene presupuesto propio: sin diferencia (no es un exceso)
  const list = [...rows.values()].map((r) => {
    const own = range.aligned && r.name !== 'Compartido (mi parte)';
    return { name: r.name, budget: own ? round2(r.budget) : null, spent: round2(r.spent), diff: own ? round2(r.budget - r.spent) : null };
  }).sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
  totals.push({ label: range.aligned ? 'Ingresos (sueldo + extras)' : 'Ingresos extra', value: round2(income) });
  totals.push({ label: 'Gastos (incluye mi parte de lo compartido)', value: round2(-spent) });
  if (range.aligned) totals.push({ label: 'Ahorro (ingresos - gastos)', value: round2(income - spent) });
  totals.push({ label: 'Invertido (no cuenta como gasto)', value: round2(invested) });
  totals.push({ label: 'Aportado a objetivos', value: round2(contributed) });
  return { rows: list, totals, aligned: range.aligned, months: monthsCount };
}

const csvText = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csvNum = (n) => (n == null ? '' : n.toFixed(2).replace('.', ','));

/** CSV (separador ;, coma decimal, BOM) con las mismas columnas que la hoja "Movimientos". */
export function periodCSV(movs) {
  const lines = [MOV_HEADER.join(';'), ...movs.map((r) => [r.date, csvText(r.type), csvText(r.category), csvText(r.concept), csvNum(r.amount), csvText(r.paidBy), csvText(r.place), csvNum(r.myShare)].join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Libro de Excel (ArrayBuffer). `XLSX` = SheetJS ya cargado. */
export function toXlsx(XLSX, { movements, summary, label }) {
  const wb = XLSX.utils.book_new();
  const EUR = '#,##0.00 "€";[Red]-#,##0.00 "€"';

  const mv = XLSX.utils.aoa_to_sheet([MOV_HEADER, ...movements.map((r) => [dateOf(r.date), r.type, r.category, r.concept, r.amount, r.paidBy, r.place, r.myShare])], { cellDates: true });
  const rng = XLSX.utils.decode_range(mv['!ref']);
  for (let R = 1; R <= rng.e.r; R++) {
    const d = mv[XLSX.utils.encode_cell({ r: R, c: 0 })]; if (d) d.z = 'dd/mm/yyyy';
    for (const c of [4, 7]) { const x = mv[XLSX.utils.encode_cell({ r: R, c })]; if (x && typeof x.v === 'number') x.z = EUR; }
  }
  mv['!cols'] = [{ wch: 11 }, { wch: 21 }, { wch: 22 }, { wch: 34 }, { wch: 13 }, { wch: 12 }, { wch: 24 }, { wch: 13 }];
  mv['!autofilter'] = { ref: mv['!ref'] };
  XLSX.utils.book_append_sheet(wb, mv, 'Movimientos');

  const head = summary.aligned ? ['Categoría', 'Presupuesto (€)', 'Gastado (€)', 'Diferencia (€)'] : ['Categoría', 'Gastado (€)'];
  const body = summary.rows.map((r) => (summary.aligned ? [r.name, r.budget, r.spent, r.diff] : [r.name, r.spent]));
  const aoa = [[`Resumen · ${label}`], ...(summary.aligned && summary.months ? [[`Meses contados: ${summary.months}`]] : [[]]), head, ...body, [], ['Totales'], ...summary.totals.map((t) => [t.label, t.value])];
  const rs = XLSX.utils.aoa_to_sheet(aoa);
  const r2 = XLSX.utils.decode_range(rs['!ref']);
  for (let R = 3; R <= r2.e.r; R++) {
    for (let C = 1; C <= r2.e.c; C++) { const x = rs[XLSX.utils.encode_cell({ r: R, c: C })]; if (x && typeof x.v === 'number') x.z = EUR; }
  }
  rs['!cols'] = [{ wch: 44 }, { wch: 16 }, { wch: 14 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, rs, 'Resumen');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
