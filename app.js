import { MONTHS, eur, round2, pad, localISO, defaultData, parseAmount, parsePlan, monthSummary,
  expensesCSV, validateBackup, daysInMonth } from './core.js';

const KEY = 'gastos.v1';
const DEFAULT_CATS = ['Vivienda', 'Suministros', 'Transporte', 'Alimentación', 'Seguros e impuestos',
  'Personal', 'Ocio', 'Salud', 'Otros'];
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = load();
let tab = 'mes';
const t0 = new Date();
let cur = { y: t0.getFullYear(), m: t0.getMonth() + 1 };
let editing = null;       // id del gasto que se edita
let chosenCat = '';

// ---------- persistencia ----------
function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return validateBackup(JSON.parse(raw));
  } catch (e) {
    try { if (raw) localStorage.setItem(`${KEY}.corrupt`, raw); } catch { /* nada */ }   // no se pierde el original
    queueMicrotask(() => banner('Los datos guardados estaban danados: se guardo una copia aparte (gastos.v1.corrupt).'));
  }
  return defaultData();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { banner('No se puede guardar en este navegador (modo privado o sin espacio). Exporta una copia en Ajustes.'); }
}
try { navigator.storage?.persist?.(); } catch { /* opcional */ }

function banner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }
let toastTimer;
function toast(msg, actionLabel, fn, ms = 6000) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { fn(); t.hidden = true; };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const catNames = () => {
  const names = new Set(data.categories.map((c) => c.name));
  data.expenses.forEach((e) => names.add(e.category));
  if (names.size === 0) DEFAULT_CATS.forEach((n) => names.add(n));
  return [...names];
};

// ---------- vistas ----------
function render() {
  $('#monthTitle').textContent = `${MONTHS[cur.m - 1]} ${cur.y}`;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#fab').hidden = tab === 'ajustes';
  const v = $('#view');
  v.innerHTML = tab === 'mes' ? viewMes() : tab === 'hist' ? viewHist() : viewAjustes();
  if (tab === 'ajustes') bindAjustes();
}

function viewMes() {
  const s = monthSummary(data, cur.y, cur.m);
  const isCur = cur.y === t0.getFullYear() && cur.m === t0.getMonth() + 1;
  const dim = daysInMonth(cur.y, cur.m);
  let state = '', cls = 'ok';
  if (s.budget > 0) {
    const expected = isCur ? s.budget * (t0.getDate() / dim) : s.budget;
    if (s.spent > s.budget) { state = `Presupuesto superado en ${eur(s.spent - s.budget)}`; cls = 'bad'; }
    else if (isCur && s.spent > expected) { state = `Por encima del ritmo (+${eur(s.spent - expected)})`; cls = 'warn'; }
    else { state = isCur ? 'Dentro del ritmo' : 'Dentro del presupuesto'; }
  }
  const barCls = s.pct >= 1 ? 'bad' : s.pct >= 0.85 ? 'warn' : '';
  const onboarding = data.categories.length === 0
    ? `<div class="card"><h2>Empieza aqui</h2><p>Aun no hay plan de presupuesto. En <b>Ajustes</b> puedes importar tu Excel
       (hoja "Gastos") o escribir el presupuesto mensual de cada categoria. Puedes anadir gastos ya mismo con el boton +.</p></div>` : '';
  const rows = s.rows.map((r) => {
    const p = r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : (r.spent > 0 ? 100 : 0);
    const bc = r.over ? 'bad' : r.pct >= 0.85 ? 'warn' : '';
    const note = r.over ? `<span class="state bad">&#9650; superado en ${eur(r.spent - r.budget)}</span>`
      : `<span class="mut small">queda ${eur(r.remaining)}</span>`;
    return `<div class="cat"><div class="head"><span>${esc(r.name)}</span><span>${eur(r.spent)} <span class="mut">/ ${eur(r.budget)}</span></span></div>
      <div class="bar ${bc}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-label="${esc(r.name)}"><i style="width:${p}%"></i></div>${note}</div>`;
  }).join('');
  return `${onboarding}
  <section class="card"><h2>Te queda este mes</h2>
    <div class="big">${eur(s.remaining)}</div>
    <div class="bar ${barCls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, s.pct) * 100)}" aria-label="Gastado del presupuesto"><i style="width:${Math.min(100, s.pct * 100)}%"></i></div>
    <div class="state ${cls}">${esc(state)}</div>
    <div class="kpis">
      <div class="kpi"><span>Gastado</span><b>${eur(s.spent)}</b></div>
      <div class="kpi"><span>Presupuesto</span><b>${eur(s.budget)}</b></div>
      <div class="kpi"><span>${s.daysLeft > 0 ? `Por dia (${s.daysLeft} dias)` : 'Dias restantes'}</span><b>${s.daysLeft > 0 ? eur(s.daily) : '0'}</b></div>
      <div class="kpi"><span>Libre tras plan e inversion</span><b>${data.income ? eur(s.free) : '-'}</b></div>
    </div></section>
  <section class="card"><h2>Por categoria</h2>${rows || '<p class="empty">Sin categorias todavia.</p>'}</section>`;
}

function viewHist() {
  const prefix = `${cur.y}-${pad(cur.m)}`;
  const list = data.expenses.filter((e) => e.date.startsWith(prefix))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!list.length) return '<p class="empty">Sin gastos este mes.<br>Pulsa + para anadir el primero.</p>';
  let html = '', day = '';
  for (const e of list) {
    if (e.date !== day) {
      day = e.date;
      const d = new Date(`${e.date}T12:00:00`);
      html += `<div class="day">${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`;
    }
    html += `<button class="item" data-id="${esc(e.id)}"><span>${esc(e.concept || e.category)}<small>${esc(e.category)}</small></span><b>${eur(e.amount)}</b></button>`;
  }
  return html;
}

function viewAjustes() {
  const cats = data.categories.map((c, i) => `<div class="budget-row"><span>${esc(c.name)}</span>
    <input data-cat="${i}" inputmode="decimal" aria-label="Presupuesto mensual de ${esc(c.name)}" value="${String(c.budget).replace('.', ',')}"></div>`).join('');
  const oneOffs = data.oneOffs.length
    ? data.oneOffs.map((o) => `<div class="small mut">${esc(o.name)} - ${MONTHS[o.month - 1] || o.month} ${o.year}: ${eur(o.amount)} (${esc(o.category)})</div>`).join('')
    : '<div class="small mut">Ninguno</div>';
  return `<section class="card set"><h2>Plan mensual</h2>
    <label>Ingreso neto mensual (EUR)<input id="sIncome" inputmode="decimal" value="${String(data.income || '').replace('.', ',')}"></label>
    <label>Inversion mensual (EUR)<input id="sInvest" inputmode="decimal" value="${String(data.investment || '').replace('.', ',')}"></label>
    <h2 style="margin-top:16px">Presupuesto mensual por categoria</h2>${cats || '<p class="small mut">Importa el Excel o anade categorias.</p>'}
    <div class="row"><input id="sNewCat" placeholder="Nueva categoria" maxlength="40"><button class="btn" id="sAddCat">Anadir</button></div>
    <h2 style="margin-top:16px">Gastos puntuales planificados</h2>${oneOffs}</section>
  <section class="card set"><h2>Importar desde Excel</h2>
    <p class="small mut">Lee la hoja "Gastos" de tu libro (media mensual = importe x pagos / 12; los marcados "Solo en el anio" cuentan solo en su mes).
    El archivo se procesa en tu dispositivo y no se sube a ningun sitio. Importa solo archivos tuyos. Tus gastos registrados no se tocan.</p>
    <input type="file" id="sXlsx" accept=".xlsx,.xlsm"></section>
  <section class="card set"><h2>Copia de seguridad</h2>
    <div class="row"><button class="btn" id="sCsv">Exportar gastos (CSV)</button><button class="btn" id="sJson">Copia completa (JSON)</button></div>
    <label>Restaurar copia (JSON)<input type="file" id="sRestore" accept=".json,application/json"></label>
    <p class="small mut">Los datos viven solo en este dispositivo. Haz copia de vez en cuando.</p></section>
  <section class="card set"><h2>Zona de riesgo</h2>
    <button class="btn danger" id="sWipe">Borrar todos los datos</button></section>`;
}

function bindAjustes() {
  const num = (el) => { const t = el.value.trim(); if (t === '') return 0; const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? round2(n) : null; };
  $('#sIncome').onchange = (e) => { const n = num(e.target); if (n === null) return toast('Importe no valido'); data.income = n; save(); };
  $('#sInvest').onchange = (e) => { const n = num(e.target); if (n === null) return toast('Importe no valido'); data.investment = n; save(); };
  document.querySelectorAll('[data-cat]').forEach((el) => {
    el.onchange = () => { const n = num(el); if (n === null) return toast('Importe no valido'); data.categories[Number(el.dataset.cat)].budget = n; save(); };
  });
  $('#sAddCat').onclick = () => {
    const name = $('#sNewCat').value.trim();
    if (!name) return;
    if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('Esa categoria ya existe');
    data.categories.push({ name, budget: 0 }); save(); render();
  };
  $('#sXlsx').onchange = importExcel;
  $('#sCsv').onclick = () => download('gastos.csv', expensesCSV(data.expenses), 'text/csv');
  $('#sJson').onclick = () => download(`gastos-copia-${localISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  $('#sRestore').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = validateBackup(JSON.parse(await f.text()));
      if (!confirm(`Restaurar ${d.expenses.length} gastos y ${d.categories.length} categorias? Sustituye los datos actuales.`)) return;
      data = d; save(); render(); toast('Copia restaurada');
    } catch { toast('Archivo no valido'); }
  };
  $('#sWipe').onclick = () => {
    if (prompt('Se borraran TODOS los datos de este dispositivo. Escribe BORRAR para confirmar') === 'BORRAR') {
      data = defaultData(); save(); render(); toast('Datos borrados');
    }
  };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- importar Excel (SheetJS bajo demanda) ----------
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel (necesita conexion la primera vez)'));
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
    const plan = parsePlan(rows);
    if (!plan.categories.length) throw new Error('La hoja "Gastos" no tiene filas validas');
    const dash = wb.Sheets[wb.SheetNames.find((n) => n.trim().toLowerCase() === 'dashboard')] || {};
    const income = Number(dash.B7?.v) || 0;
    const investment = dash.C7?.v === 'Fijo' ? Number(dash.E7?.v) || 0 : round2(income * (Number(dash.G7?.v) || 0));
    const total = round2(plan.categories.reduce((a, c) => a + c.budget, 0));
    if (!confirm(`Plan encontrado: ${plan.categories.length} categorias, ${eur(total)} al mes de media`
      + `${plan.oneOffs.length ? `, ${plan.oneOffs.length} gasto(s) puntual(es)` : ''}`
      + `${income ? `. Ingreso ${eur(income)}, inversion ${eur(investment)}` : ''}.\n\nSustituye el plan actual. Tus gastos registrados no se tocan. Continuar?`)) return;
    data.categories = plan.categories; data.oneOffs = plan.oneOffs;
    if (income) { data.income = income; data.investment = investment; }
    save(); render(); toast('Plan importado');
  } catch (err) { toast(err.message || 'No se pudo importar', null, null, 8000); }
  finally { e.target.value = ''; }
}

// ---------- alta / edicion de gastos ----------
const dlg = $('#dlg');
function openForm(id = null) {
  editing = id;
  const e = id ? data.expenses.find((x) => x.id === id) : null;
  const names = catNames();
  chosenCat = e ? e.category : (localStorage.getItem('gastos.lastcat') && names.includes(localStorage.getItem('gastos.lastcat'))
    ? localStorage.getItem('gastos.lastcat') : names[0]);
  $('#dlgTitle').textContent = e ? 'Editar gasto' : 'Nuevo gasto';
  $('#fAmount').value = e ? String(e.amount).replace('.', ',') : '';
  $('#fConcept').value = e ? e.concept : '';
  const inCur = cur.y === t0.getFullYear() && cur.m === t0.getMonth() + 1;
  $('#fDate').value = e ? e.date : (inCur ? localISO() : `${cur.y}-${pad(cur.m)}-01`);
  $('#fDelete').hidden = !e;
  $('#fError').hidden = true;
  drawChips(names);
  dlg.showModal();
  $('#fAmount').focus();
}
function drawChips(names) {
  const box = $('#fCats');
  box.replaceChildren(...names.map((n) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = n; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(n === chosenCat));
    b.onclick = () => { chosenCat = n; drawChips(names); };
    return b;
  }));
}
function fail(msg) { const p = $('#fError'); p.textContent = msg; p.hidden = false; }

$('#form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const amount = parseAmount($('#fAmount').value);
  const date = $('#fDate').value;
  if (amount === null) return fail('Escribe un importe valido (mayor que 0).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Elige una fecha.');
  if (!chosenCat) return fail('Elige una categoria.');
  const concept = $('#fConcept').value.trim().slice(0, 80);
  if (editing) {
    Object.assign(data.expenses.find((x) => x.id === editing), { amount, date, category: chosenCat, concept });
  } else {
    data.expenses.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, amount, category: chosenCat, concept });
  }
  try { localStorage.setItem('gastos.lastcat', chosenCat); } catch { /* opcional */ }
  save();
  dlg.close();
  const [y, m] = date.split('-').map(Number);
  cur = { y, m };                                  // salta al mes del gasto para verlo reflejado
  render();
  toast(`Guardado: ${eur(amount)} en ${chosenCat}`);
});
$('#fCancel').onclick = () => dlg.close();
$('#fDelete').onclick = () => {
  const i = data.expenses.findIndex((x) => x.id === editing);
  if (i < 0) return;
  const [gone] = data.expenses.splice(i, 1);
  save(); dlg.close(); render();
  toast('Gasto borrado', 'Deshacer', () => { data.expenses.push(gone); save(); render(); });
};

// ---------- navegacion ----------
$('#fab').onclick = () => openForm();
$('#view').addEventListener('click', (e) => {
  const it = e.target.closest('.item');
  if (it) openForm(it.dataset.id);
});
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
const shift = (d) => { cur.m += d; if (cur.m < 1) { cur.m = 12; cur.y--; } if (cur.m > 12) { cur.m = 1; cur.y++; } render(); };
$('#prev').onclick = () => shift(-1);
$('#next').onclick = () => shift(1);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
