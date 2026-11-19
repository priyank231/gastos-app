// Logica pura (sin DOM): plan, resumen mensual, ahorro, objetivos, CSV, copias. Probada con `node --test`.

export const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const SPREADS = [12, 6, 1];            // meses en los que se reparte un gran pago

const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
export const eur = (n) => fmt.format(Number.isFinite(n) ? n : 0);
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const pad = (n) => String(n).padStart(2, '0');
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultData() {
  return { version: 2, income: 0, investment: 0, savingsFrom: '', categories: [], payments: [],
    expenses: [], incomes: [], goals: [], contributions: [],
    investments: [], imported: [], rules: [], includeShared: true };
}

/** Acepta "12,5" o "12.50"; devuelve un numero > 0 y <= 100000, o null. */
export function parseAmount(text) {
  const n = Number(String(text).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? round2(n) : null;
}

/**
 * Filas de la hoja "Gastos" del Excel (desde la fila 5, columnas A..N) -> plan.
 * - Pagos al anio > 1: media mensual (importe x pagos / 12) dentro del presupuesto de su categoria.
 * - 1 pago al anio: gran pago (se repite cada anio) repartido segun "Prorratear en (meses)": 12, 6 o 1.
 * - Columna N ("Solo en el anio") con valor: gasto puntual de ese anio, solo en su mes.
 */
export function parsePlan(rows, startYear = new Date().getFullYear()) {
  const byCat = new Map();
  const payments = [];
  for (const r of rows) {
    const concept = r[0] == null ? '' : String(r[0]).trim();
    if (concept.toUpperCase() === 'TOTAL') break;
    const importe = Number(r[3]);
    const pagos = Number(r[4]);
    if (!concept || !(importe > 0) || !(pagos > 0)) continue;
    const category = r[1] ? String(r[1]).trim() : 'Otros';
    const month = Number(r[5]) >= 1 && Number(r[5]) <= 12 ? Number(r[5]) : 1;
    const soloAnio = r[13];
    if (!byCat.has(category)) byCat.set(category, 0);
    if (soloAnio !== undefined && soloAnio !== null && soloAnio !== '') {
      payments.push({ id: uid(), name: concept, category, amount: round2(importe * pagos), month,
        year: Number(soloAnio), spread: 1, repeat: false });
    } else if (pagos === 1) {
      const g = Number(r[6]) || 1;
      payments.push({ id: uid(), name: concept, category, amount: round2(importe), month, year: startYear,
        spread: g >= 9 ? 12 : g >= 4 ? 6 : 1, repeat: true });
    } else {
      byCat.set(category, byCat.get(category) + (importe * pagos) / 12);
    }
  }
  const categories = [...byCat].map(([name, budget]) => ({ name, budget: round2(budget) }));
  return { categories, payments };
}

/** Parte del gran pago `p` que toca apartar en el mes (y, m). Ventana: los `spread` meses que terminan en el mes de pago. */
export function paymentShare(p, y, m) {
  const idx = y * 12 + (m - 1);
  const last = p.repeat ? y + 1 : p.year;
  for (let py = p.year; py <= last; py++) {
    const off = idx - (py * 12 + (p.month - 1));
    if (off <= 0 && off > -p.spread) return p.amount / p.spread;
  }
  return 0;
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

const inMonth = (item, y, m) => item.date.startsWith(`${y}-${pad(m)}`);
const sum = (arr) => arr.reduce((a, x) => a + x.amount, 0);

export const monthExtraIncome = (data, y, m) => round2(sum(data.incomes.filter((i) => inMonth(i, y, m))));
export const monthIncome = (data, y, m) => round2(data.income + monthExtraIncome(data, y, m));

/** Resumen de un mes (m = 1..12) frente al plan. `todayISO` permite probar con fechas fijas. */
export function monthSummary(data, y, m, todayISO = localISO(), opts = {}) {
  const budgets = new Map(data.categories.map((c) => [c.name, c.budget]));
  for (const p of data.payments) {
    const share = paymentShare(p, y, m);
    if (share > 0) budgets.set(p.category, (budgets.get(p.category) || 0) + share);
  }
  const spent = new Map();
  let spentTotal = 0;
  for (const e of data.expenses) {
    if (!inMonth(e, y, m)) continue;
    spent.set(e.category, (spent.get(e.category) || 0) + e.amount);
    spentTotal += e.amount;
  }
  // gastos que no están en `expenses` pero cuentan como gasto (p. ej. "mi parte" de los gastos compartidos)
  const extraNames = new Set();
  for (const x of opts.extra || []) {
    if (!(x.amount > 0)) continue;
    spent.set(x.name, (spent.get(x.name) || 0) + x.amount);
    spentTotal += x.amount;
    extraNames.add(x.name);
  }
  const names = new Set([...budgets.keys(), ...spent.keys()]);
  const rows = [...names].map((name) => {
    const budget = round2(budgets.get(name) || 0);
    const s = round2(spent.get(name) || 0);
    const extra = extraNames.has(name) && budget === 0;
    return { name, budget, spent: s, remaining: round2(budget - s), extra,
      pct: budget > 0 ? s / budget : (s > 0 && !extra ? Infinity : 0), over: !extra && s > budget };
  }).sort((a, b) => (b.spent - a.spent) || a.name.localeCompare(b.name));
  const budget = round2([...budgets.values()].reduce((a, b) => a + b, 0));
  const remaining = round2(budget - spentTotal);
  const dim = daysInMonth(y, m);
  const prefix = `${y}-${pad(m)}`;
  let daysLeft;
  if (todayISO.startsWith(prefix)) daysLeft = dim - Number(todayISO.slice(8, 10)) + 1;
  else daysLeft = todayISO < prefix ? dim : 0;
  const extra = monthExtraIncome(data, y, m);
  const income = round2(data.income + extra);
  return {
    budget, spent: round2(spentTotal), remaining, rows, daysLeft,
    daily: daysLeft > 0 && remaining > 0 ? round2(remaining / daysLeft) : 0,
    income, extra,
    invested: round2(sum(data.investments.filter((i) => inMonth(i, y, m)))),   // dinero que has movido a inversión
    saved: round2(income - spentTotal),              // ahorro del mes = ingresos - gastos reales (invertir NO es gastar)
    contributed: round2(sum(data.contributions.filter((c) => inMonth(c, y, m)))),
    free: round2(income - budget - data.investment),
    pct: budget > 0 ? spentTotal / budget : 0,
  };
}

/**
 * Ahorro medio mensual sobre MESES COMPLETOS (el mes en curso no cuenta).
 * Empieza en `data.savingsFrom` (YYYY-MM) o, si no hay, en el primer mes con registros
 * (se salta ese mes si el primer registro es posterior al dia 5: seria un mes a medias).
 */
export function savingsStats(data, todayISO = localISO(), extraFn = () => 0) {
  if (!(data.income > 0)) return { ready: false, reason: 'income', months: [], count: 0, avg: 0, total: 0 };
  const dates = [...data.expenses, ...data.incomes, ...data.contributions].map((x) => x.date).sort();
  if (!dates.length && !data.savingsFrom) return { ready: false, reason: 'data', months: [], count: 0, avg: 0, total: 0 };
  let start = data.savingsFrom;
  if (!start) {
    start = dates[0].slice(0, 7);
    if (Number(dates[0].slice(8, 10)) > 5) {
      let [sy, sm] = start.split('-').map(Number);
      sm++; if (sm > 12) { sm = 1; sy++; }
      start = `${sy}-${pad(sm)}`;
    }
  }
  const cur = todayISO.slice(0, 7);
  const months = [];
  let [y, m] = start.split('-').map(Number);
  while (`${y}-${pad(m)}` < cur && months.length < 600) {
    const s = round2(monthIncome(data, y, m) - sum(data.expenses.filter((e) => inMonth(e, y, m))) - (extraFn(y, m) || 0));
    months.push({ y, m, saved: s });
    m++; if (m > 12) { m = 1; y++; }
  }
  const total = round2(months.reduce((a, x) => a + x.saved, 0));
  return { ready: months.length > 0, reason: months.length ? '' : 'months', months, count: months.length,
    total, avg: months.length ? round2(total / months.length) : 0 };
}

export function goalTotals(data) {
  return data.goals.map((g) => {
    const items = data.contributions.filter((c) => c.goalId === g.id);
    const total = round2(sum(items));
    return { ...g, total, pct: g.target > 0 ? total / g.target : 0 };
  });
}

export function expensesCSV(data) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const goalName = new Map(data.goals.map((g) => [g.id, g.name]));
  const rows = [
    ...data.expenses.map((e) => ({ date: e.date, tipo: 'gasto', amount: -e.amount, cat: e.category, concept: e.concept })),
    ...data.incomes.map((i) => ({ date: i.date, tipo: 'ingreso extra', amount: i.amount, cat: '', concept: i.concept })),
    ...data.contributions.map((c) => ({ date: c.date, tipo: 'aportacion', amount: -c.amount, cat: goalName.get(c.goalId) || '', concept: c.concept || '' })),
    ...(data.investments || []).map((i) => ({ date: i.date, tipo: 'inversion', amount: -i.amount, cat: '', concept: i.concept || '' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return ['fecha,tipo,importe,categoria_u_objetivo,concepto',
    ...rows.map((r) => [r.date, r.tipo, r.amount.toFixed(2), q(r.cat), q(r.concept)].join(','))].join('\n');
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Valida y normaliza datos guardados o una copia JSON (y migra la version 1). Lanza Error si no es valida. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.expenses) || !Array.isArray(obj.categories)) {
    throw new Error('Archivo no valido');
  }
  const d = defaultData();
  d.income = Math.max(0, Number(obj.income) || 0);
  d.investment = Math.max(0, Number(obj.investment) || 0);
  d.savingsFrom = /^\d{4}-\d{2}$/.test(obj.savingsFrom || '') ? obj.savingsFrom : '';
  d.categories = obj.categories.filter((c) => c && typeof c.name === 'string')
    .map((c) => ({ name: c.name.slice(0, 40), budget: round2(Number(c.budget) || 0) }));
  const rawPayments = Array.isArray(obj.payments) ? obj.payments
    : (obj.oneOffs || []).map((o) => ({ ...o, spread: 1, repeat: false }));       // migracion v1
  d.payments = rawPayments.filter((p) => p && typeof p.name === 'string' && Number(p.month) >= 1 && Number(p.month) <= 12)
    .map((p) => ({ id: String(p.id || uid()), name: p.name.slice(0, 60), category: String(p.category || 'Otros').slice(0, 40),
      amount: round2(Number(p.amount) || 0), month: Number(p.month), year: Number(p.year) || new Date().getFullYear(),
      spread: SPREADS.includes(Number(p.spread)) ? Number(p.spread) : 1, repeat: !!p.repeat }));
  d.expenses = obj.expenses.filter((e) => e && isDate(e.date) && Number(e.amount) > 0)
    .map((e) => ({ id: String(e.id || uid()), date: e.date, amount: round2(Number(e.amount)),
      category: String(e.category || 'Otros').slice(0, 40), concept: String(e.concept || '').slice(0, 80) }));
  d.incomes = (obj.incomes || []).filter((i) => i && isDate(i.date) && Number(i.amount) > 0)
    .map((i) => ({ id: String(i.id || uid()), date: i.date, amount: round2(Number(i.amount)), concept: String(i.concept || '').slice(0, 80) }));
  d.goals = (obj.goals || []).filter((g) => g && typeof g.name === 'string' && g.id)
    .map((g) => ({ id: String(g.id), name: g.name.slice(0, 40), target: Math.max(0, round2(Number(g.target) || 0)) }));
  d.investments = (obj.investments || []).filter((i) => i && isDate(i.date) && Number(i.amount) !== 0 && Number.isFinite(Number(i.amount)))
    .map((i) => ({ id: String(i.id || uid()), date: i.date, amount: round2(Number(i.amount)), concept: String(i.concept || '').slice(0, 80) }));
  d.imported = (Array.isArray(obj.imported) ? obj.imported : []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(-5000);
  const KINDS = ['expense', 'shared', 'partner', 'income', 'invest', 'ignore'];
  d.rules = (Array.isArray(obj.rules) ? obj.rules : []).filter((r) => r && typeof r.key === 'string' && KINDS.includes(r.kind))
    .map((r) => ({ key: r.key.slice(0, 40), kind: r.kind, category: String(r.category || '').slice(0, 40) })).slice(-500);
  d.includeShared = obj.includeShared !== false;
  const goalIds = new Set(d.goals.map((g) => g.id));
  d.contributions = (obj.contributions || []).filter((c) => c && isDate(c.date) && Number(c.amount) > 0 && goalIds.has(String(c.goalId)))
    .map((c) => ({ id: String(c.id || uid()), goalId: String(c.goalId), date: c.date, amount: round2(Number(c.amount)),
      concept: String(c.concept || '').slice(0, 80) }));
  return d;
}
