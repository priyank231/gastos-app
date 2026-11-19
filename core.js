// Logica pura (sin DOM): plan de gastos, resumen mensual, CSV. Probada con `node --test`.

export const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
export const eur = (n) => fmt.format(Number.isFinite(n) ? n : 0);
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const pad = (n) => String(n).padStart(2, '0');

export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultData() {
  return { version: 1, income: 0, investment: 0, categories: [], oneOffs: [], expenses: [] };
}

/** Acepta "12,5" o "12.50"; devuelve un numero > 0 y <= 100000, o null. */
export function parseAmount(text) {
  const n = Number(String(text).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? round2(n) : null;
}

/**
 * Convierte las filas de la hoja "Gastos" del Excel (desde la fila 5, columnas A..N) en plan.
 * Media mensual = importe * pagos / 12. Si la columna N ("Solo en el anio") tiene valor, el gasto
 * es puntual: solo cuenta en su mes/anio y no entra en la media.
 */
export function parsePlan(rows) {
  const byCat = new Map();
  const oneOffs = [];
  for (const r of rows) {
    const concept = r[0] == null ? '' : String(r[0]).trim();
    if (concept.toUpperCase() === 'TOTAL') break;
    const importe = Number(r[3]);
    const pagos = Number(r[4]);
    if (!concept || !(importe > 0) || !(pagos > 0)) continue;
    const category = r[1] ? String(r[1]).trim() : 'Otros';
    const soloAnio = r[13];
    if (soloAnio !== undefined && soloAnio !== null && soloAnio !== '') {
      oneOffs.push({ name: concept, category, year: Number(soloAnio), month: Number(r[5]) || 1,
        amount: round2(importe * pagos) });
      if (!byCat.has(category)) byCat.set(category, 0);
      continue;
    }
    byCat.set(category, (byCat.get(category) || 0) + (importe * pagos) / 12);
  }
  const categories = [...byCat].map(([name, budget]) => ({ name, budget: round2(budget) }));
  return { categories, oneOffs };
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/** Resumen de un mes (m = 1..12) frente al plan. `todayISO` permite probar con fechas fijas. */
export function monthSummary(data, y, m, todayISO = localISO()) {
  const prefix = `${y}-${pad(m)}`;
  const budgets = new Map(data.categories.map((c) => [c.name, c.budget]));
  for (const o of data.oneOffs) {
    if (o.year === y && o.month === m) budgets.set(o.category, (budgets.get(o.category) || 0) + o.amount);
  }
  const spent = new Map();
  let spentTotal = 0;
  for (const e of data.expenses) {
    if (!e.date.startsWith(prefix)) continue;
    spent.set(e.category, (spent.get(e.category) || 0) + e.amount);
    spentTotal += e.amount;
  }
  const names = new Set([...budgets.keys(), ...spent.keys()]);
  const rows = [...names].map((name) => {
    const budget = round2(budgets.get(name) || 0);
    const s = round2(spent.get(name) || 0);
    return { name, budget, spent: s, remaining: round2(budget - s),
      pct: budget > 0 ? s / budget : (s > 0 ? Infinity : 0), over: s > budget };
  }).sort((a, b) => (b.spent - a.spent) || a.name.localeCompare(b.name));
  const budget = round2([...budgets.values()].reduce((a, b) => a + b, 0));
  const remaining = round2(budget - spentTotal);
  const dim = daysInMonth(y, m);
  let daysLeft;
  if (todayISO.startsWith(prefix)) daysLeft = dim - Number(todayISO.slice(8, 10)) + 1;
  else daysLeft = todayISO < prefix ? dim : 0;
  return {
    budget, spent: round2(spentTotal), remaining, rows, daysLeft,
    daily: daysLeft > 0 && remaining > 0 ? round2(remaining / daysLeft) : 0,
    free: round2(data.income - budget - data.investment),
    pct: budget > 0 ? spentTotal / budget : 0,
  };
}

export function expensesCSV(expenses) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['fecha,importe,categoria,concepto'];
  for (const e of [...expenses].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([e.date, e.amount.toFixed(2), q(e.category), q(e.concept)].join(','));
  }
  return lines.join('\n');
}

/** Valida y normaliza una copia de seguridad JSON. Lanza Error si no es valida. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.expenses) || !Array.isArray(obj.categories)) {
    throw new Error('Archivo no valido');
  }
  const d = defaultData();
  d.income = Number(obj.income) || 0;
  d.investment = Number(obj.investment) || 0;
  d.categories = obj.categories.filter((c) => c && typeof c.name === 'string')
    .map((c) => ({ name: c.name.slice(0, 40), budget: round2(Number(c.budget) || 0) }));
  d.oneOffs = (obj.oneOffs || []).filter((o) => o && typeof o.name === 'string')
    .map((o) => ({ name: o.name.slice(0, 60), category: String(o.category || 'Otros').slice(0, 40),
      year: Number(o.year), month: Number(o.month), amount: round2(Number(o.amount) || 0) }));
  d.expenses = obj.expenses.filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0)
    .map((e) => ({ id: String(e.id || `${e.date}-${Math.random().toString(36).slice(2, 8)}`),
      date: e.date, amount: round2(Number(e.amount)), category: String(e.category || 'Otros').slice(0, 40),
      concept: String(e.concept || '').slice(0, 80) }));
  return d;
}
