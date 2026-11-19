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

// ---------- categorías ----------
const normName = (s) => String(s).trim().toLowerCase();

/** Cuántos movimientos usan una categoría (para avisar antes de borrarla). */
export function categoryUse(data, name) {
  return {
    expenses: data.expenses.filter((e) => e.category === name).length,
    payments: data.payments.filter((p) => p.category === name).length,
    rules: data.rules.filter((r) => r.category === name).length,
  };
}

/** Renombra una categoría en TODAS partes (presupuesto, gastos, grandes pagos, reglas aprendidas). */
export function renameCategory(data, from, to) {
  const name = String(to).trim().slice(0, 40);
  if (!name) return { ok: false, error: 'El nombre no puede estar vacío' };
  const cat = data.categories.find((c) => c.name === from);
  if (!cat) return { ok: false, error: 'La categoría ya no existe' };
  if (name === from) return { ok: true, changed: 0 };
  if (data.categories.some((c) => c !== cat && normName(c.name) === normName(name))) return { ok: false, error: 'Ya existe una categoría con ese nombre' };
  cat.name = name;
  let changed = 0;
  for (const list of [data.expenses, data.payments, data.rules]) for (const x of list) if (x.category === from) { x.category = name; changed++; }
  return { ok: true, changed };
}

/**
 * Borra una categoría y mueve sus gastos, grandes pagos y reglas a `target` (que se crea con presupuesto 0 si no existe).
 * Los gastos NUNCA se pierden.
 */
export function deleteCategory(data, name, target) {
  const to = String(target || 'Otros').trim().slice(0, 40) || 'Otros';
  if (normName(to) === normName(name)) return { ok: false, error: 'Elige otra categoría para mover los gastos' };
  const i = data.categories.findIndex((c) => c.name === name);
  if (i < 0) return { ok: false, error: 'La categoría ya no existe' };
  data.categories.splice(i, 1);
  if (!data.categories.some((c) => normName(c.name) === normName(to))) data.categories.push({ name: to, budget: 0 });
  const dest = data.categories.find((c) => normName(c.name) === normName(to)).name;
  let moved = 0;
  for (const list of [data.expenses, data.payments, data.rules]) for (const x of list) if (x.category === name) { x.category = dest; moved++; }
  return { ok: true, moved, target: dest };
}

// ---------- CSV de movimientos (se abre bien en Excel en español y se puede volver a importar) ----------
export const CSV_HEADER = ['Fecha', 'Mes', 'Tipo', 'Categoría u objetivo', 'Concepto', 'Importe (€)'];
export const CSV_TYPES = { expense: 'Gasto', income: 'Ingreso', goal: 'Aportación a objetivo', invest: 'Inversión' };
const csvText = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csvNum = (n) => n.toFixed(2).replace('.', ',');

/** Todos los movimientos del modo individual. Importe con signo: gastos, aportaciones e inversiones en negativo. */
export function movementsCSV(data) {
  const goalName = new Map(data.goals.map((g) => [g.id, g.name]));
  const rows = [
    ...data.expenses.map((e) => ({ date: e.date, type: CSV_TYPES.expense, cat: e.category, concept: e.concept, amount: -e.amount })),
    ...data.incomes.map((i) => ({ date: i.date, type: CSV_TYPES.income, cat: '', concept: i.concept, amount: i.amount })),
    ...data.contributions.map((c) => ({ date: c.date, type: CSV_TYPES.goal, cat: goalName.get(c.goalId) || '', concept: c.concept || '', amount: -c.amount })),
    ...data.investments.map((i) => ({ date: i.date, type: CSV_TYPES.invest, cat: '', concept: i.concept || '', amount: -i.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  const lines = [CSV_HEADER.join(';'), ...rows.map((r) => [r.date, r.date.slice(0, 7), r.type, csvText(r.cat), csvText(r.concept), csvNum(r.amount)].join(';'))];
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

/** Trocea una línea CSV respetando comillas ("" = comilla). */
function splitCSVLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const plain = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const TYPE_KEYS = { gasto: 'expense', ingreso: 'income', 'aportacion a objetivo': 'goal', aportacion: 'goal', inversion: 'invest' };

/** "1.234,50", "-42,5" o "42.5" -> número; NaN si no es un importe. */
export function parseNumberES(s) {
  let t = String(s).replace(/[€\s]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Lee el CSV que genera `movementsCSV` (separador ; o ,). Devuelve { rows, errors:[texto] }. */
export function parseMovementsCSV(text) {
  const lines = String(text).replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  const rows = [], errors = [];
  if (!lines.length) return { rows, errors: ['El archivo está vacío'] };
  const delim = lines[0].includes(';') ? ';' : ',';
  const head = splitCSVLine(lines[0], delim).map(plain);
  const col = (...names) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const ci = { date: col('fecha'), type: col('tipo'), cat: col('categoria'), concept: col('concepto'), amount: col('importe') };
  if (ci.date < 0 || ci.type < 0 || ci.amount < 0) return { rows, errors: ['No reconozco las columnas (se esperan Fecha, Tipo e Importe)'] };
  lines.slice(1).forEach((line, n) => {
    const f = splitCSVLine(line, delim);
    const date = (f[ci.date] || '').trim();
    const kind = TYPE_KEYS[plain(f[ci.type] || '')];
    const amount = parseNumberES(f[ci.amount] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !kind || !Number.isFinite(amount) || amount === 0) { errors.push(`Línea ${n + 2}: no se pudo leer`); return; }
    rows.push({ date, kind, category: (f[ci.cat] || '').trim().slice(0, 40), concept: (f[ci.concept] || '').trim().slice(0, 80), amount: round2(Math.abs(amount)) });
  });
  return { rows, errors };
}

/** Añade las filas leídas del CSV sin duplicar lo que ya hay (mismo tipo, fecha, importe y concepto). */
export function applyMovements(data, rows) {
  const key = (k, d, a, c) => `${k}|${d}|${a.toFixed(2)}|${plain(c)}`;
  const have = new Set([
    ...data.expenses.map((e) => key('expense', e.date, e.amount, e.concept)),
    ...data.incomes.map((i) => key('income', i.date, i.amount, i.concept)),
    ...data.contributions.map((c) => key('goal', c.date, c.amount, c.concept || '')),
    ...data.investments.map((i) => key('invest', i.date, i.amount, i.concept)),
  ]);
  const res = { expense: 0, income: 0, goal: 0, invest: 0, skipped: 0 };
  for (const r of rows) {
    const k = key(r.kind, r.date, r.amount, r.concept);
    if (have.has(k)) { res.skipped++; continue; }
    have.add(k);
    if (r.kind === 'expense') {
      data.expenses.push({ id: uid(), date: r.date, amount: r.amount, category: r.category || 'Otros', concept: r.concept });
      const cat = r.category || 'Otros';
      if (!data.categories.some((c) => plain(c.name) === plain(cat))) data.categories.push({ name: cat, budget: 0 });
    } else if (r.kind === 'income') data.incomes.push({ id: uid(), date: r.date, amount: r.amount, concept: r.concept });
    else if (r.kind === 'invest') data.investments.push({ id: uid(), date: r.date, amount: r.amount, concept: r.concept });
    else {
      let g = data.goals.find((x) => plain(x.name) === plain(r.category || 'Ahorro'));
      if (!g) { g = { id: uid(), name: r.category || 'Ahorro', target: 0 }; data.goals.push(g); }
      data.contributions.push({ id: uid(), goalId: g.id, date: r.date, amount: r.amount, concept: r.concept });
    }
    res[r.kind]++;
  }
  return res;
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
