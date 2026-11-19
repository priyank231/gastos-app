import { MONTHS, SPREADS, eur, round2, pad, uid, localISO, defaultData, parseAmount, parsePlan, monthSummary,
  savingsStats, goalTotals, expensesCSV, validateBackup, daysInMonth } from './core.js';
import { $, esc, dec, banner, toast, deliver, h2, icon, avatar, APP_VERSION, updateApp, autoReadOn, setAutoRead,
  setScanStatus, scanTicket, describeScan } from './ui.js';
import * as shared from './shared-ui.js';

const KEY = 'gastos.v1';          // misma clave: validateBackup migra los datos antiguos
const DEFAULT_CATS = ['Vivienda', 'Suministros', 'Transporte', 'Alimentación', 'Seguros e impuestos',
  'Personal', 'Ocio', 'Salud', 'Otros'];
const spreadLabel = (n) => (n === 1 ? 'Solo ese mes' : `En ${n} meses`);

let data = load();
let tab = 'mes';
const t0 = new Date();
let cur = { y: t0.getFullYear(), m: t0.getMonth() + 1 };
let mode = 'expense';                 // expense | income | goal (formulario)
let editing = null;                   // id del elemento que se edita
let chosen = '';                      // categoría u objetivo elegido en el formulario
let touched = { date: false, cat: false };
let scanToken = 0;
let payEditing = null, payCat = '', paySpread = 12;

// ---------- persistencia ----------
function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = validateBackup(parsed);
      if (parsed.version !== d.version) localStorage.setItem(KEY, JSON.stringify(d));   // guarda la migración v1 -> v2
      return d;
    }
  } catch {
    try { if (raw) localStorage.setItem(`${KEY}.corrupt`, raw); } catch { /* nada */ }
    queueMicrotask(() => banner('Los datos guardados estaban dañados: se guardó una copia aparte (gastos.v1.corrupt).'));
  }
  return defaultData();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { banner('No se puede guardar en este navegador (modo privado o sin espacio). Exporta una copia en Ajustes.'); }
}
try { navigator.storage?.persist?.(); } catch { /* opcional */ }

const catNames = () => {
  const names = new Set(data.categories.map((c) => c.name));
  data.expenses.forEach((e) => names.add(e.category));
  data.payments.forEach((p) => names.add(p.category));
  if (names.size === 0) DEFAULT_CATS.forEach((n) => names.add(n));
  return [...names];
};
const monthLabel = (y, m) => `${MONTHS[m - 1].slice(0, 3)} ${y}`;
const inCurrentMonth = () => cur.y === t0.getFullYear() && cur.m === t0.getMonth() + 1;

// ---------- vistas ----------
let appMode = 'choose';              // choose | ind | shared (se pregunta en cada apertura)

function render() {
  const choosing = appMode === 'choose';
  $('#chooser').hidden = !choosing;
  for (const sel of ['.top', '.modebar', 'main', '.tabs']) document.querySelector(sel).hidden = choosing;
  if (choosing) { $('#fab').hidden = true; return; }
  const sh = appMode === 'shared';
  $('#modeName').textContent = sh ? 'Modo compartido' : 'Modo individual';
  $('#monthTitle').textContent = sh ? shared.title() : `${MONTHS[cur.m - 1]} ${cur.y}`;
  const labels = sh ? shared.tabLabels() : { mes: 'Resumen', hist: 'Historial', ajustes: 'Ajustes' };
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.querySelector('span').textContent = labels[b.dataset.tab];
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#fab').hidden = tab === 'ajustes' || (sh && !shared.hasGroup());
  if (sh) { $('#view').innerHTML = shared.view(tab); shared.afterRender(tab); return; }
  $('#view').innerHTML = tab === 'mes' ? viewMes() : tab === 'hist' ? viewHist() : viewAjustes();
  if (tab === 'ajustes') bindAjustes();
}

function savingsCard(s) {
  const st = savingsStats(data);
  let avg;
  if (st.ready) {
    avg = `<div class="big" style="font-size:26px">${eur(st.avg)}</div><div class="small mut">al mes, media de ${st.count} ${st.count === 1 ? 'mes completo' : 'meses completos'}</div>`;
  } else if (st.reason === 'income') {
    avg = '<div class="small mut">Pon tu ingreso mensual en <b>Ajustes</b> para calcular el ahorro.</div>';
  } else {
    avg = '<div class="small mut">Se calcula cuando termine el primer mes completo con datos.</div>';
  }
  const last = st.months.slice(-6).reverse().map((x) => `<div class="mrow"><span>${monthLabel(x.y, x.m)}</span><b>${eur(x.saved)}</b></div>`).join('');
  return `<section class="card"><h2>Ahorro</h2>
    <div class="kpis" style="margin-top:0">
      <div class="kpi"><span>Este mes (hasta hoy)</span><b>${data.income || s.extra ? eur(s.saved) : '-'}</b></div>
      <div class="kpi"><span>Ingresos del mes</span><b>${data.income || s.extra ? eur(s.income) : '-'}</b></div>
    </div>
    ${s.extra ? `<div class="small mut" style="margin-top:6px">incluye ${eur(s.extra)} de ingresos extra</div>` : ''}
    <h2 style="margin-top:18px">Promedio mensual</h2>${avg}${last ? `<div style="margin-top:10px">${last}</div>` : ''}</section>`;
}

function goalsCard() {
  const goals = goalTotals(data);
  if (!goals.length) return '';
  const rows = goals.map((g) => {
    const p = g.target > 0 ? Math.min(100, g.pct * 100) : 0;
    return `<div class="cat"><div class="row1">${avatar(g.name)}<div class="meta"><div class="head"><span>${esc(g.name)}</span><span class="num">${eur(g.total)}${g.target > 0 ? ` <span class="mut">/ ${eur(g.target)}</span>` : ''}</span></div>
      ${g.target > 0 ? `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-label="${esc(g.name)}"><i style="width:${p}%"></i></div>` : ''}</div></div></div>`;
  }).join('');
  return `<section class="card"><h2>Objetivos de ahorro</h2>${rows}</section>`;
}

function viewMes() {
  const s = monthSummary(data, cur.y, cur.m);
  const isCur = inCurrentMonth();
  const dim = daysInMonth(cur.y, cur.m);
  let state = '', cls = 'ok';
  if (s.budget > 0) {
    const expected = isCur ? s.budget * (t0.getDate() / dim) : s.budget;
    if (s.spent > s.budget) { state = `Presupuesto superado en ${eur(s.spent - s.budget)}`; cls = 'bad'; }
    else if (isCur && s.spent > expected) { state = `Por encima del ritmo (+${eur(s.spent - expected)})`; cls = 'warn'; }
    else { state = isCur ? 'Dentro del ritmo' : 'Dentro del presupuesto'; }
  }
  const ringCls = s.pct >= 1 ? 'bad' : s.pct >= 0.85 ? 'warn' : '';
  const C = 2 * Math.PI * 42;
  const pctShown = Math.round(s.pct * 100);
  const onboarding = data.categories.length === 0 && data.payments.length === 0
    ? `<div class="card">${h2('Empieza aquí', 'Aún no hay plan de presupuesto. En <b>Ajustes</b> puedes importar tu Excel (hoja "Gastos") o escribir el presupuesto mensual de cada categoría. Con el botón + añades gastos, ingresos extra o aportaciones.')}</div>` : '';
  const rows = s.rows.map((r) => {
    const p = r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : (r.spent > 0 ? 100 : 0);
    const bc = r.over ? 'bad' : r.pct >= 0.85 ? 'warn' : '';
    const note = r.over ? `<span class="state bad">▲ superado en ${eur(r.spent - r.budget)}</span>`
      : `<span class="mut small">queda ${eur(r.remaining)}</span>`;
    return `<div class="cat"><div class="row1">${avatar(r.name)}<div class="meta"><div class="head"><span>${esc(r.name)}</span><span class="num">${eur(r.spent)} <span class="mut">/ ${eur(r.budget)}</span></span></div>
      <div class="bar ${bc}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-label="${esc(r.name)}"><i style="width:${p}%"></i></div>${note}</div></div></div>`;
  }).join('');
  return `${onboarding}
  <section class="card"><div class="hero">
    <svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${pctShown}% del presupuesto gastado">
      <circle class="ring-bg" cx="50" cy="50" r="42"/>
      <circle class="ring-fg ${ringCls}" cx="50" cy="50" r="42" transform="rotate(-90 50 50)" stroke-dasharray="${(C * Math.min(1, s.pct)).toFixed(1)} ${C.toFixed(1)}"/>
      <text class="ring-t" x="50" y="56" text-anchor="middle">${pctShown}%</text></svg>
    <div class="txt"><div class="lbl">Te queda este mes</div><div class="big">${eur(s.remaining)}</div><div class="state ${cls}">${esc(state)}</div></div></div>
    <div class="kpis">
      <div class="kpi"><span>Gastado</span><b>${eur(s.spent)}</b></div>
      <div class="kpi"><span>Presupuesto</span><b>${eur(s.budget)}</b></div>
      <div class="kpi"><span>${s.daysLeft > 0 ? `Por día (${s.daysLeft} días)` : 'Días restantes'}</span><b>${s.daysLeft > 0 ? eur(s.daily) : '0'}</b></div>
      <div class="kpi"><span>Libre tras plan e inversión</span><b>${data.income ? eur(s.free) : '-'}</b></div>
    </div></section>
  ${savingsCard(s)}${goalsCard()}
  <section class="card"><h2>Por categoría</h2>${rows || `<div class="empty">${icon('chart')}<br>Sin categorías todavía.</div>`}</section>`;
}

function viewHist() {
  const prefix = `${cur.y}-${pad(cur.m)}`;
  const goalName = new Map(data.goals.map((g) => [g.id, g.name]));
  const list = [
    ...data.expenses.map((e) => ({ type: 'expense', tag: 'Gasto', id: e.id, date: e.date, title: e.concept || e.category, sub: e.category, amount: `-${eur(e.amount)}` })),
    ...data.incomes.map((i) => ({ type: 'income', tag: 'Ingreso', id: i.id, date: i.date, title: i.concept || 'Ingreso extra', sub: 'Ingreso extra', amount: `+${eur(i.amount)}` })),
    ...data.contributions.map((c) => ({ type: 'goal', tag: 'Aportación', id: c.id, date: c.date, title: goalName.get(c.goalId) || 'Objetivo', sub: c.concept || 'Aportación', amount: eur(c.amount) })),
  ].filter((x) => x.date.startsWith(prefix)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!list.length) return `<div class="empty">${icon('receipt')}<br>Sin movimientos este mes.<br>Pulsa + para añadir el primero.</div>`;
  let html = '', day = '';
  for (const e of list) {
    if (e.date !== day) {
      day = e.date;
      html += `<div class="day">${esc(new Date(`${e.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`;
    }
    html += `<button class="item" data-type="${e.type}" data-id="${esc(e.id)}"><span>${avatar(e.sub)}<span><span class="t">${esc(e.title)}</span><small><span class="tag">${e.tag}</span>${esc(e.sub)}</small></span></span><b>${e.amount}</b></button>`;
  }
  return html;
}

function viewAjustes() {
  const cats = data.categories.map((c, i) => `<div class="budget-row"><span>${esc(c.name)}</span>
    <input data-cat="${i}" inputmode="decimal" aria-label="Presupuesto mensual de ${esc(c.name)}" value="${dec(c.budget)}"></div>`).join('');
  const pays = data.payments.map((p) => `<button class="item" data-pay="${esc(p.id)}"><span>${avatar(p.category)}<span><span class="t">${esc(p.name)}</span><small>${esc(p.category)} · ${MONTHS[p.month - 1]} ${p.year}${p.repeat ? ' (cada año)' : ''} · ${spreadLabel(p.spread)}</small></span></span><b>${eur(p.amount)}</b></button>`).join('');
  const goals = data.goals.map((g) => `<div class="budget-row"><span>${esc(g.name)} <button class="link" data-delgoal="${esc(g.id)}">quitar</button></span>
    <input data-goal="${esc(g.id)}" inputmode="decimal" aria-label="Meta de ${esc(g.name)}" placeholder="meta €" value="${g.target ? dec(g.target) : ''}"></div>`).join('');
  return `<section class="card set"><h2>Plan mensual</h2>
    <label>Sueldo / ingreso neto mensual (€)<input id="sIncome" inputmode="decimal" value="${data.income ? dec(data.income) : ''}"></label>
    <label>Inversión mensual (€) · se resta del libre<input id="sInvest" inputmode="decimal" value="${data.investment ? dec(data.investment) : ''}"></label>
    ${h2('Presupuesto mensual por categoría', 'Lo que quieres gastar al mes en cada categoría. Puedes importarlo del Excel o escribirlo a mano.', 'margin-top:18px')}${cats}
    <div class="row"><input id="sNewCat" placeholder="Nueva categoría" maxlength="40"><button class="btn" id="sAddCat">Añadir</button></div></section>
  <section class="card set">${h2('Grandes pagos', 'Seguro, ITV, vacaciones... Elige si se reparte en 12 meses, en 6 o solo en el mes del pago.')}
    ${pays}
    <div class="row"><button class="btn primary" id="sAddPay">Añadir gran pago</button></div></section>
  <section class="card set">${h2('Objetivos de ahorro', 'Por ejemplo "Viaje". Las aportaciones se añaden con el botón + (pestaña Aportación).')}
    ${goals}
    <div class="row"><input id="sNewGoal" placeholder="Nuevo objetivo (ej. Viaje)" maxlength="40"><button class="btn" id="sAddGoal">Añadir</button></div></section>
  <section class="card set">${h2('Ahorro medio', 'El promedio usa meses completos; el mes en curso no cuenta. Si dejas el campo vacío empieza solo en el primer mes con datos.')}
    <label>Contar desde (mes)<input id="sFrom" type="month" value="${esc(data.savingsFrom)}"></label></section>
  <section class="card set">${h2('Lectura de tickets', 'Al añadir una foto de un ticket, la app intenta leer importe, fecha y local y rellena el formulario para que lo revises. La foto se lee en tu móvil y no se envía a ningún sitio. La primera vez descarga el lector (unos 7 MB) y necesita conexión. Es una ayuda: a veces se equivoca.')}
    <label class="check"><input type="checkbox" id="sAuto" ${autoReadOn() ? 'checked' : ''}> Leer automáticamente al añadir la foto (modo compartido)</label></section>
  <section class="card set">${h2('Importar desde Excel', 'Lee la hoja "Gastos": los pagos de varias veces al año van a la media mensual; los de un solo pago anual pasan a "Grandes pagos" (repartidos según tu columna "Prorratear"); "Solo en el año" = pago de ese mes. El archivo se procesa en tu dispositivo. Importa solo archivos tuyos. Tus gastos registrados no se tocan.')}
    <input type="file" id="sXlsx" accept=".xlsx,.xlsm"></section>
  <section class="card set">${h2('Copia de seguridad', 'Los datos viven solo en este dispositivo. Haz copia de vez en cuando.')}
    <div class="row"><button class="btn" id="sCsv">Exportar movimientos (CSV)</button><button class="btn" id="sJson">Copia completa (JSON)</button></div>
    <label style="margin-top:14px">Restaurar copia (JSON)<input type="file" id="sRestore" accept=".json,application/json"></label></section>
  <section class="card set"><h2>Zona de riesgo</h2>
    <button class="btn danger" id="sWipe" style="width:100%">Borrar todos los datos</button></section>
  <p class="ver">Versión ${APP_VERSION}</p>`;
}

function bindAjustes() {
  const num = (el) => { const t = el.value.trim(); if (t === '') return 0; const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? round2(n) : null; };
  $('#sIncome').onchange = (e) => { const n = num(e.target); if (n === null) return toast('Importe no válido'); data.income = n; save(); };
  $('#sInvest').onchange = (e) => { const n = num(e.target); if (n === null) return toast('Importe no válido'); data.investment = n; save(); };
  $('#sFrom').onchange = (e) => { data.savingsFrom = e.target.value; save(); };
  $('#sAuto').onchange = (e) => setAutoRead(e.target.checked);
  document.querySelectorAll('[data-cat]').forEach((el) => {
    el.onchange = () => { const n = num(el); if (n === null) return toast('Importe no válido'); data.categories[Number(el.dataset.cat)].budget = n; save(); };
  });
  document.querySelectorAll('[data-goal]').forEach((el) => {
    el.onchange = () => { const n = num(el); if (n === null) return toast('Importe no válido'); data.goals.find((g) => g.id === el.dataset.goal).target = n; save(); };
  });
  document.querySelectorAll('[data-delgoal]').forEach((el) => {
    el.onclick = () => {
      const g = data.goals.find((x) => x.id === el.dataset.delgoal);
      const n = data.contributions.filter((c) => c.goalId === g.id).length;
      if (!confirm(`¿Quitar "${g.name}"${n ? ` y sus ${n} aportaciones` : ''}?`)) return;
      data.goals = data.goals.filter((x) => x.id !== g.id);
      data.contributions = data.contributions.filter((c) => c.goalId !== g.id);
      save(); render();
    };
  });
  $('#sAddCat').onclick = () => {
    const name = $('#sNewCat').value.trim();
    if (!name) return;
    if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('Esa categoría ya existe');
    data.categories.push({ name, budget: 0 }); save(); render();
  };
  $('#sAddGoal').onclick = () => {
    const name = $('#sNewGoal').value.trim();
    if (!name) return;
    if (data.goals.some((g) => g.name.toLowerCase() === name.toLowerCase())) return toast('Ese objetivo ya existe');
    data.goals.push({ id: uid(), name, target: 0 }); save(); render();
  };
  $('#sAddPay').onclick = () => openPay();
  document.querySelectorAll('[data-pay]').forEach((el) => { el.onclick = () => openPay(el.dataset.pay); });
  $('#sXlsx').onchange = importExcel;
  $('#sCsv').onclick = () => send('movimientos.csv', expensesCSV(data), 'text/csv');
  $('#sJson').onclick = () => send(`gastos-copia-${localISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  $('#sRestore').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = validateBackup(JSON.parse(await f.text()));
      if (!confirm(`¿Restaurar ${d.expenses.length} gastos, ${d.incomes.length} ingresos extra y ${d.categories.length} categorías? Sustituye los datos actuales.`)) return;
      data = d; save(); render(); toast('Copia restaurada');
    } catch { toast('Archivo no válido'); }
  };
  $('#sWipe').onclick = () => {
    if (prompt('Se borrarán TODOS los datos de este dispositivo. Escribe BORRAR para confirmar') === 'BORRAR') {
      data = defaultData(); save(); render(); toast('Datos borrados');
    }
  };
}

async function send(name, text, type) {
  const r = await deliver(name, text, type);
  if (r !== 'cancelled') toast(r === 'shared' ? 'Enviado' : 'Descargado (busca en Descargas / Archivos)');
}

// ---------- importar Excel (SheetJS bajo demanda) ----------
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel (necesita conexión la primera vez)'));
    document.head.append(s);
  });
}

async function importExcel(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    await loadSheetJS();
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'gastos');
    if (!name) throw new Error('No encuentro la hoja "Gastos"');
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, range: 4, defval: null });
    const plan = parsePlan(rows, t0.getFullYear());
    if (!plan.categories.length) throw new Error('La hoja "Gastos" no tiene filas válidas');
    const dash = wb.Sheets[wb.SheetNames.find((n) => n.trim().toLowerCase() === 'dashboard')] || {};
    const income = Number(dash.B7?.v) || 0;
    const investment = dash.C7?.v === 'Fijo' ? Number(dash.E7?.v) || 0 : round2(income * (Number(dash.G7?.v) || 0));
    const avg = round2(plan.categories.reduce((a, c) => a + c.budget, 0));
    if (!confirm(`Plan encontrado: ${plan.categories.length} categorías (${eur(avg)} al mes de media) y ${plan.payments.length} gran(des) pago(s)`
      + `${income ? `. Sueldo ${eur(income)}, inversión ${eur(investment)}` : ''}.\n\nSustituye categorías y grandes pagos actuales. Tus gastos, ingresos extra y aportaciones no se tocan. ¿Continuar?`)) return;
    data.categories = plan.categories; data.payments = plan.payments;
    if (income) { data.income = income; data.investment = investment; }
    save(); render(); toast('Plan importado');
  } catch (err) { toast(err.message || 'No se pudo importar', null, null, 8000); }
  finally { e.target.value = ''; }
}

// ---------- formulario: gasto / ingreso extra / aportación ----------
const dlg = $('#dlg');
const MODE_TEXT = {
  expense: { new: 'Nuevo gasto', edit: 'Editar gasto', legend: 'Categoría', concept: 'Concepto (opcional)', ph: 'Ej. supermercado' },
  income: { new: 'Nuevo ingreso extra', edit: 'Editar ingreso extra', legend: '', concept: 'Concepto (opcional)', ph: 'Ej. paga extra, regalo...' },
  goal: { new: 'Nueva aportación', edit: 'Editar aportación', legend: 'Objetivo', concept: 'Nota (opcional)', ph: 'Ej. ahorro de octubre' },
};
const findItem = (type, id) => (type === 'expense' ? data.expenses : type === 'income' ? data.incomes : data.contributions).find((x) => x.id === id);

function openForm(m = 'expense', id = null) {
  mode = m; editing = id;
  touched = { date: false, cat: false };
  scanToken++;
  if (mode === 'goal' && data.goals.length === 0) { data.goals.push({ id: uid(), name: 'Viaje', target: 0 }); save(); }
  const item = id ? findItem(mode, id) : null;
  $('#modes').hidden = !!id;                                  // al editar no se cambia de tipo
  $('#fDelete').hidden = !id;
  $('#fError').hidden = true;
  setScanStatus($('#fScanStatus'), '');
  for (const f of ['fAmount', 'fConcept', 'fDate']) $(`#${f}`).classList.remove('auto');
  $('#fAmount').value = item ? dec(item.amount) : '';
  $('#fConcept').value = item ? (item.concept || '') : '';
  $('#fDate').value = item ? item.date : (inCurrentMonth() ? localISO() : `${cur.y}-${pad(cur.m)}-01`);
  const last = (() => { try { return localStorage.getItem('gastos.lastcat'); } catch { return null; } })();
  if (mode === 'expense') { const n = catNames(); chosen = item ? item.category : (last && n.includes(last) ? last : n[0]); }
  if (mode === 'goal') { chosen = item ? item.goalId : data.goals[0].id; }
  refreshForm();
  dlg.showModal();
  $('#fAmount').focus();
}

function refreshForm() {
  const tx = MODE_TEXT[mode];
  $('#dlgTitle').textContent = editing ? tx.edit : tx.new;
  document.querySelectorAll('#modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('#scanWrap').hidden = mode !== 'expense' || !!editing;
  $('#fCatsWrap').hidden = mode === 'income';
  $('#fCatsLegend').textContent = tx.legend;
  $('#fConceptLabel').firstChild.textContent = `${tx.concept} `;
  $('#fConcept').placeholder = tx.ph;
  const options = mode === 'goal' ? data.goals.map((g) => ({ id: g.id, label: g.name })) : mode === 'expense' ? catNames().map((n) => ({ id: n, label: n })) : [];
  $('#fCats').replaceChildren(...options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = o.label; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(o.id === chosen));
    b.onclick = () => { chosen = o.id; touched.cat = true; refreshForm(); };
    return b;
  }));
}

document.querySelectorAll('#modes button').forEach((b) => {
  b.onclick = () => {
    mode = b.dataset.mode;
    if (mode === 'goal' && data.goals.length === 0) { data.goals.push({ id: uid(), name: 'Viaje', target: 0 }); save(); }
    if (mode === 'expense') chosen = catNames()[0];
    if (mode === 'goal') chosen = data.goals[0].id;
    refreshForm();
  };
});
function fail(msg) { const p = $('#fError'); p.textContent = msg; p.hidden = false; }

// --- escanear ticket (modo individual) ---
for (const id of ['fAmount', 'fConcept']) $(`#${id}`).addEventListener('input', (e) => e.target.classList.remove('auto'));
$('#fDate').addEventListener('input', (e) => { touched.date = true; e.target.classList.remove('auto'); });
$('#fScanCam').onclick = () => $('#fFileCam').click();
$('#fScanPick').onclick = () => $('#fFilePick').click();
for (const id of ['fFileCam', 'fFilePick']) {
  $(`#${id}`).onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const my = ++scanToken;
    const st = $('#fScanStatus');
    try {
      const p = await scanTicket(file, { categories: catNames(), el: st });
      if (my !== scanToken) return;                              // se cerró el formulario o se escaneó otro
      const free = (el) => !el.value.trim() || el.classList.contains('auto');
      const put = (el, v) => { el.value = v; el.classList.add('auto'); };
      if (p.amount != null && free($('#fAmount'))) put($('#fAmount'), dec(p.amount));
      if (p.place && free($('#fConcept'))) put($('#fConcept'), p.place);
      if (p.date && !touched.date) put($('#fDate'), p.date);
      if (p.category && !touched.cat) { chosen = p.category; refreshForm(); }
      const d = describeScan(p);
      setScanStatus(st, d.text, d.kind);
    } catch (err) {
      if (my === scanToken) setScanStatus(st, `${err.message || 'No se pudo leer el ticket'}. Rellénalo a mano.`, 'warn');
    }
  };
}

$('#form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const amount = parseAmount($('#fAmount').value);
  const date = $('#fDate').value;
  if (amount === null) return fail('Escribe un importe válido (mayor que 0).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Elige una fecha.');
  if (mode !== 'income' && !chosen) return fail(mode === 'goal' ? 'Elige un objetivo.' : 'Elige una categoría.');
  const concept = $('#fConcept').value.trim().slice(0, 80);
  const list = mode === 'expense' ? data.expenses : mode === 'income' ? data.incomes : data.contributions;
  const fields = mode === 'expense' ? { amount, date, category: chosen, concept }
    : mode === 'income' ? { amount, date, concept } : { amount, date, goalId: chosen, concept };
  if (editing) Object.assign(findItem(mode, editing), fields);
  else list.push({ id: uid(), ...fields });
  if (mode === 'expense') { try { localStorage.setItem('gastos.lastcat', chosen); } catch { /* opcional */ } }
  save();
  scanToken++;
  dlg.close();
  const [y, m] = date.split('-').map(Number);
  cur = { y, m };                                            // salta al mes del movimiento
  render();
  const what = mode === 'expense' ? `gasto de ${eur(amount)} en ${chosen}` : mode === 'income' ? `ingreso extra de ${eur(amount)}`
    : `aportación de ${eur(amount)} a ${data.goals.find((g) => g.id === chosen)?.name}`;
  toast(`Guardado: ${what}`);
});
$('#fCancel').onclick = () => { scanToken++; dlg.close(); };
dlg.addEventListener('close', () => { scanToken++; });
$('#fDelete').onclick = () => {
  const list = mode === 'expense' ? data.expenses : mode === 'income' ? data.incomes : data.contributions;
  const i = list.findIndex((x) => x.id === editing);
  if (i < 0) return;
  const [gone] = list.splice(i, 1);
  save(); dlg.close(); render();
  toast('Borrado', 'Deshacer', () => { list.push(gone); save(); render(); });
};

// ---------- formulario: gran pago ----------
const dlgPay = $('#dlgPay');
$('#pMonth').replaceChildren(...MONTHS.map((n, i) => Object.assign(document.createElement('option'), { value: String(i + 1), textContent: n })));

function openPay(id = null) {
  payEditing = id;
  const p = id ? data.payments.find((x) => x.id === id) : null;
  $('#payTitle').textContent = p ? 'Editar gran pago' : 'Nuevo gran pago';
  $('#pName').value = p ? p.name : '';
  $('#pAmount').value = p ? dec(p.amount) : '';
  $('#pMonth').value = String(p ? p.month : t0.getMonth() + 1);
  $('#pYear').value = String(p ? p.year : t0.getFullYear());
  $('#pRepeat').checked = p ? p.repeat : false;
  payCat = p ? p.category : catNames()[0];
  paySpread = p ? p.spread : 12;
  $('#pDelete').hidden = !p;
  $('#pError').hidden = true;
  drawPay();
  dlgPay.showModal();
  $('#pName').focus();
}

function drawPay() {
  const mk = (items, isOn, onPick) => items.map(([val, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(isOn(val)));
    b.onclick = () => { onPick(val); drawPay(); };
    return b;
  });
  $('#pCats').replaceChildren(...mk(catNames().map((n) => [n, n]), (v) => v === payCat, (v) => { payCat = v; }));
  $('#pSpreads').replaceChildren(...mk(SPREADS.map((n) => [n, spreadLabel(n)]), (v) => v === paySpread, (v) => { paySpread = v; }));
  const a = parseAmount($('#pAmount').value);
  const m = Number($('#pMonth').value), y = Number($('#pYear').value);
  let txt = '';
  if (a && m && y) {
    if (paySpread === 1) txt = `Se cuenta ${eur(a)} entero en ${MONTHS[m - 1]} ${y}.`;
    else {
      const idx = y * 12 + (m - 1) - (paySpread - 1);
      const sm = (idx % 12) + 1, sy = Math.floor(idx / 12);
      txt = `Apartas ${eur(a / paySpread)} al mes durante ${paySpread} meses (de ${monthLabel(sy, sm)} a ${monthLabel(y, m)}) y el mes del pago ya está cubierto.`;
    }
  }
  $('#pPreview').textContent = txt;
}
['pAmount', 'pMonth', 'pYear'].forEach((id) => $(`#${id}`).addEventListener('input', drawPay));

$('#payForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const err = (msg) => { const p = $('#pError'); p.textContent = msg; p.hidden = false; };
  const name = $('#pName').value.trim();
  const amount = parseAmount($('#pAmount').value);
  const year = Number($('#pYear').value), month = Number($('#pMonth').value);
  if (!name) return err('Escribe qué es el pago.');
  if (amount === null) return err('Escribe un importe válido (mayor que 0).');
  if (!(year >= 2020 && year <= 2100)) return err('Año no válido.');
  const item = { name: name.slice(0, 60), category: payCat, amount, month, year, spread: paySpread, repeat: $('#pRepeat').checked };
  if (payEditing) Object.assign(data.payments.find((x) => x.id === payEditing), item);
  else data.payments.push({ id: uid(), ...item });
  save(); dlgPay.close(); render(); toast('Gran pago guardado');
});
$('#pCancel').onclick = () => dlgPay.close();
$('#pDelete').onclick = () => {
  const i = data.payments.findIndex((x) => x.id === payEditing);
  if (i < 0) return;
  const [gone] = data.payments.splice(i, 1);
  save(); dlgPay.close(); render();
  toast('Gran pago borrado', 'Deshacer', () => { data.payments.push(gone); save(); render(); });
};

// ---------- navegación ----------
$('#fab').onclick = () => (appMode === 'shared' ? shared.openAdd() : openForm('expense'));
$('#view').addEventListener('click', (e) => {
  const it = e.target.closest('.item[data-type]');
  if (it) openForm(it.dataset.type, it.dataset.id);
});
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
const shift = (d) => {
  if (appMode === 'shared') { shared.shift(d); render(); return; }
  cur.m += d; if (cur.m < 1) { cur.m = 12; cur.y--; } if (cur.m > 12) { cur.m = 1; cur.y++; } render();
};
$('#prev').onclick = () => shift(-1);
$('#next').onclick = () => shift(1);

// Delegado en document: funciona aunque se re-dibuje la pantalla
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-appmode]');
  if (pick) { appMode = pick.dataset.appmode; tab = 'mes'; render(); return; }
  if (e.target.closest('#modeSwitch')) { appMode = 'choose'; render(); return; }
  if (e.target.closest('#updateApp')) updateApp();
});
shared.init({ render });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
