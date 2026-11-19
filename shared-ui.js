// Pantallas del modo COMPARTIDO (Saldo, Movimientos, Ajustes) y su formulario.
import { MONTHS, eur, localISO, parseAmount, uid } from './core.js';
import { SHARED_CATS, defaultShared, createGroup, partnerOf, nameOf, balance, periodRange, periodEntries, periodStats,
  makeExport, validateExport, applyImport, validateShared, sharedCSV, knownPlaces } from './shared.js';
import { $, esc, dec, toast, banner, deliver, copyText, h2, icon, avatar, APP_VERSION, autoReadOn, setAutoRead,
  setScanStatus, scanTicket, describeScan } from './ui.js';
import { putPhoto, getPhoto, delPhoto, compress, blobToDataURL, dataURLToBlob } from './photos.js';

const KEY = 'gastos.shared.v1';
const FILE_ACCEPT = '.json,application/json,text/plain,.txt';
let S = load();
let period = { kind: 'week', ref: new Date() };
let rerender = () => {};
let editing = null;                      // id del movimiento que se edita
let f = { settle: false, payerId: '', pct: 50, splitKind: 'half', cat: SHARED_CATS[0], photo: null, photoFile: null, removed: false,
  photoId: '', dateTouched: false, catTouched: false };
let scanToken = 0;

export function init(opts) { rerender = opts.render; }

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return validateShared(JSON.parse(raw));
  } catch {
    try { if (raw) localStorage.setItem(`${KEY}.corrupt`, raw); } catch { /* nada */ }
    queueMicrotask(() => banner('Los datos compartidos estaban dañados: se guardó una copia aparte.'));
  }
  return defaultShared();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { banner('No se puede guardar en este navegador (modo privado o sin espacio).'); }
}

export const hasGroup = () => !!S.groupId && !!S.meId;
export const tabLabels = () => ({ mes: 'Saldo', hist: 'Movimientos', ajustes: 'Ajustes' });

// ---------- periodo ----------
const range = () => periodRange(period.kind, period.ref);
const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

export function title() {
  if (!hasGroup()) return 'Compartido';
  const r = range();
  if (period.kind === 'all') return 'Todo el tiempo';
  if (period.kind === 'month') return `${MONTHS[period.ref.getMonth()]} ${period.ref.getFullYear()}`;
  return `${fmtDay(r.from)} - ${fmtDay(r.to)}`;
}
export function shift(dir) {
  if (period.kind === 'all') return;
  const d = new Date(period.ref);
  if (period.kind === 'month') d.setMonth(d.getMonth() + dir, 1); else d.setDate(d.getDate() + 7 * dir);
  period.ref = d;
}
const periodLabelFile = () => {
  const r = range();
  return period.kind === 'all' ? 'todo' : period.kind === 'month' ? r.from.slice(0, 7) : `semana-${r.from}`;
};

// ---------- vistas ----------
const pasteBox = (id, btnId, label) => `<label style="margin-top:14px">O pega aquí el texto copiado<textarea id="${id}" rows="3" placeholder="Pega el texto que te mandó tu pareja"></textarea></label>
  <div class="row"><button class="btn" id="${btnId}">${label}</button></div>`;

function setupView() {
  return `<section class="card set">${h2('Configurar compartido', 'Cada uno guarda su copia en su móvil y os pasáis un archivo para fusionar. Ninguna nube. El primero crea el grupo; el otro se une con el archivo que reciba.')}
    <label>Tu nombre<input id="gMe" maxlength="30" placeholder="Ej. Priyank"></label>
    <label>Nombre de tu pareja<input id="gPartner" maxlength="30" placeholder="Ej. Bea"></label>
    <div class="row"><button class="btn primary" id="gCreate">Crear grupo</button></div></section>
  <section class="card set">${h2('O unirte con su archivo', 'Si tu pareja ya creó el grupo, pídele que exporte (pestaña Saldo) y abre aquí el archivo que te mande, o pega el texto copiado. No crees otro grupo: os saldría cada uno por su lado.')}
    <input type="file" id="gJoin" accept="${FILE_ACCEPT}">
    ${pasteBox('gPaste', 'gPasteBtn', 'Unirme con el texto')}</section>`;
}

const chips = (items, on) => items.map(([v, l]) => `<button type="button" class="chip${on === v ? ' on' : ''}" data-v="${esc(v)}" aria-pressed="${on === v}">${esc(l)}</button>`).join('');

function periodBar() {
  return `<div class="seg" role="group" aria-label="Periodo">
    ${[['week', 'Semana'], ['month', 'Mes'], ['all', 'Todo']].map(([k, l]) => `<button data-period="${k}" aria-selected="${period.kind === k}">${l}</button>`).join('')}</div>`;
}

function saldoView() {
  const s = S, partner = partnerOf(s), bal = balance(s), st = periodStats(s, range());
  const head = bal > 0 ? `${esc(partner.name)} te debe` : bal < 0 ? `Le debes a ${esc(partner.name)}` : 'Estáis en paz';
  return `<section class="card"><div class="hero">${avatar(partner.name, 56)}
      <div class="txt"><div class="lbl">Saldo total</div><div class="big">${eur(Math.abs(bal))}</div><div class="state ${bal === 0 ? 'ok' : 'warn'}">${head}</div></div></div>
      <div class="row"><button class="btn" id="gSettle">Registrar pago entre vosotros</button></div></section>
    ${periodBar()}
    <section class="card"><h2>${esc(title())}</h2>
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><span>Gastado en total</span><b>${eur(st.total)}</b></div>
        <div class="kpi"><span>Tu parte</span><b>${eur(st.myShare)}</b></div>
        <div class="kpi"><span>Pagaste tú</span><b>${eur(st.paidMe)}</b></div>
        <div class="kpi"><span>Pagó ${esc(partner.name)}</span><b>${eur(st.paidPartner)}</b></div>
      </div><div class="small mut" style="margin-top:10px">${st.count} gasto(s) en el periodo</div></section>
    <section class="card set">${h2(`Exportar ${esc(title())}`, '<b>Enviar para fusionar</b>: archivo que tu pareja abre en su app para recibir tus gastos (con fotos si lo marcas). Si no puede abrir archivos, usa <b>Copiar texto</b> y pégalo en un mensaje (sin fotos). <b>CSV</b>: registro con fechas y local para Excel.')}
      <label class="check"><input type="checkbox" id="gPhotos" checked> Incluir fotos de tickets</label>
      <div class="row"><button class="btn primary" id="gExpJson">${icon('share')}Enviar para fusionar</button></div>
      <div class="row"><button class="btn" id="gExpCsv">CSV (Excel)</button><button class="btn" id="gExpCopy">Copiar texto</button></div></section>`;
}

function listView() {
  const list = periodEntries(S, range());
  const body = list.length ? list.map((e) => {
    const who = nameOf(S, e.payerId);
    const sub = e.settle ? `Pago entre vosotros · lo hizo ${esc(who)}` : `${esc(e.category)} · pagó ${esc(who)}${e.payerPct !== 50 ? ` (${e.payerPct}% suyo)` : ''}`;
    const lead = e.photoId ? `<img class="thumb" alt="" data-photo="${esc(e.photoId)}">` : avatar(e.place || e.category);
    return `<button class="item" data-sid="${esc(e.id)}"><span>${lead}<span><span class="t">${esc(e.place || (e.settle ? 'Liquidación' : e.category))}</span><small>${fmtDay(e.date)} · ${sub}</small></span></span><b>${eur(e.amount)}</b></button>`;
  }).join('') : `<div class="empty">${icon('receipt')}<br>Sin movimientos en este periodo.<br>Pulsa + para añadir el primero.</div>`;
  return `${periodBar()}${body}`;
}

function ajustesView() {
  const p = partnerOf(S), me = S.members.find((m) => m.id === S.meId);
  return `<section class="card set">${h2('Nombres', `Código del grupo: ${esc(S.groupId.slice(0, 6))} (debe coincidir en los dos móviles).`)}
      <label>Tu nombre<input id="aMe" maxlength="30" value="${esc(me.name)}"></label>
      <label>Tu pareja<input id="aPartner" maxlength="30" value="${esc(p.name)}"></label></section>
    <section class="card set">${h2('Recibir de tu pareja', 'Abre el archivo que te mande o pega el texto que te copió. Se fusiona: los movimientos nuevos se añaden, los editados se actualizan y no se duplica nada. En iPhone, si el archivo llega por WhatsApp, guárdalo antes en la app Archivos y elígelo desde aquí.')}
      <input type="file" id="aImport" accept="${FILE_ACCEPT}">
      ${pasteBox('aPaste', 'aPasteBtn', 'Fusionar texto pegado')}</section>
    <section class="card set">${h2('Lectura de tickets', 'Al añadir una foto de un ticket, la app intenta leer importe, fecha y local y rellena el formulario para que lo revises. La foto se lee en tu móvil y no se envía a ningún sitio. La primera vez descarga el lector (unos 7 MB) y necesita conexión. Es una ayuda: a veces se equivoca.')}
      <label class="check"><input type="checkbox" id="aAuto" ${autoReadOn() ? 'checked' : ''}> Leer automáticamente al añadir la foto</label></section>
    <section class="card set">${h2('Zona de riesgo', 'Borra los gastos compartidos de ESTE móvil (no los de tu pareja). Exporta antes si quieres conservarlos.')}
      <button class="btn danger" id="aLeave" style="width:100%">Salir del grupo y borrar</button></section>
    <p class="ver">Versión ${APP_VERSION}</p>`;
}

export function view(tab) {
  if (!hasGroup()) return setupView();
  return tab === 'mes' ? saldoView() : tab === 'hist' ? listView() : ajustesView();
}

// ---------- eventos de las vistas ----------
export function afterRender(tab) {
  document.querySelectorAll('[data-period]').forEach((b) => {
    b.onclick = () => { period = { kind: b.dataset.period, ref: new Date() }; rerender(); };
  });
  document.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const blob = await getPhoto(img.dataset.photo);
    if (blob) { img.src = URL.createObjectURL(blob); img.onload = () => URL.revokeObjectURL(img.src); }
  });
  document.querySelectorAll('[data-sid]').forEach((b) => { b.onclick = () => openForm(b.dataset.sid); });

  if (!hasGroup()) {
    $('#gCreate').onclick = () => {
      S = createGroup($('#gMe').value, $('#gPartner').value);
      save(); rerender(); toast('Grupo creado. Exporta desde Saldo para que tu pareja se una.');
    };
    $('#gJoin').onchange = (e) => importFile(e);
    $('#gPasteBtn').onclick = () => importText($('#gPaste').value);
    return;
  }
  if (tab === 'mes') {
    $('#gSettle').onclick = () => openForm(null, true);
    $('#gExpJson').onclick = exportJson;
    $('#gExpCsv').onclick = exportCsv;
    $('#gExpCopy').onclick = exportCopy;
  }
  if (tab === 'ajustes') {
    const rename = () => {
      const me = S.members.find((m) => m.id === S.meId), p = partnerOf(S);
      me.name = $('#aMe').value.trim().slice(0, 30) || me.name;
      p.name = $('#aPartner').value.trim().slice(0, 30) || p.name;
      save();
    };
    $('#aMe').onchange = rename; $('#aPartner').onchange = rename;
    $('#aImport').onchange = (e) => importFile(e);
    $('#aPasteBtn').onclick = () => importText($('#aPaste').value);
    $('#aAuto').onchange = (e) => setAutoRead(e.target.checked);
    $('#aLeave').onclick = async () => {
      if (prompt('Se borrarán los gastos compartidos de este móvil. Escribe BORRAR para confirmar') !== 'BORRAR') return;
      for (const e of S.entries) if (e.photoId) await delPhoto(e.photoId).catch(() => {});
      S = defaultShared(); save(); rerender(); toast('Grupo borrado de este móvil');
    };
  }
}

// ---------- exportar / importar ----------
async function buildExport(withPhotos) {
  const r = range();
  const entries = S.entries.filter((e) => !r || (e.date >= r.from && e.date <= r.to));
  const photos = {};
  if (withPhotos) {
    for (const e of entries) {
      if (!e.photoId) continue;
      const blob = await getPhoto(e.photoId);
      if (blob) photos[e.photoId] = await blobToDataURL(blob);
    }
  }
  return makeExport(S, r, photos);
}

async function exportJson() {
  try {
    const exp = await buildExport($('#gPhotos').checked);
    const res = await deliver(`gastos-compartidos-${periodLabelFile()}.json`, JSON.stringify(exp), 'application/json');
    if (res !== 'cancelled') toast(res === 'shared' ? 'Listo. Tu pareja lo abre en Ajustes → Recibir.' : 'Archivo descargado (busca en Descargas / Archivos).', null, null, 8000);
  } catch { toast('No se pudo exportar'); }
}
async function exportCsv() {
  const res = await deliver(`gastos-compartidos-${periodLabelFile()}.csv`, sharedCSV(S, periodEntries(S, range())), 'text/csv');
  if (res !== 'cancelled') toast(res === 'shared' ? 'CSV enviado' : 'CSV descargado (busca en Descargas / Archivos)');
}
async function exportCopy() {
  try {
    const exp = await buildExport(false);
    const ok = await copyText(JSON.stringify(exp));
    toast(ok ? 'Copiado (sin fotos). Pégalo en un mensaje a tu pareja.' : 'No se pudo copiar. Usa "Enviar para fusionar".', null, null, 8000);
  } catch { toast('No se pudo exportar'); }
}

async function importFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try { await importText(await file.text()); }
  finally { ev.target.value = ''; }
}

async function importText(raw) {
  try {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('No es un archivo de gastos compartidos');
    const exp = validateExport(JSON.parse(raw.slice(a, b + 1)));
    const joining = !hasGroup();
    if (joining) {
      const iAm = exp.members.find((m) => m.id !== exp.from);
      if (!confirm(`Te unes al grupo de ${exp.members.find((m) => m.id === exp.from).name} como "${iAm.name}". ¿Continuar?`)) return;
    }
    const { shared, stats } = applyImport(S, exp);
    S = shared; save();
    for (const [id, url] of Object.entries(exp.photos)) {
      if (!(await getPhoto(id))) await putPhoto(id, await dataURLToBlob(url)).catch(() => {});
    }
    rerender();
    toast(joining ? `Te uniste al grupo: ${stats.added} movimientos` : `Fusionado: ${stats.added} nuevos, ${stats.updated} actualizados, ${stats.skipped} ya estaban`, null, null, 8000);
  } catch (err) { toast(err instanceof SyntaxError ? 'El texto no es válido (¿se copió entero?)' : (err.message || 'Archivo no válido'), null, null, 8000); }
}

// ---------- formulario de movimiento ----------
const dlg = $('#dlgS');
const find = (id) => S.entries.find((e) => e.id === id);

export function openAdd() { openForm(null, false); }

function openForm(id = null, settle = false) {
  editing = id;
  scanToken++;
  const e = id ? find(id) : null;
  const isSettle = e ? e.settle : settle;
  f = { settle: isSettle, payerId: e ? e.payerId : S.meId, pct: e ? e.payerPct : 50,
    splitKind: e ? (e.payerPct === 50 ? 'half' : e.payerPct === 0 ? 'other' : 'custom') : 'half',
    cat: e ? e.category : SHARED_CATS[0], photo: null, photoFile: null, removed: false, photoId: e ? e.photoId : '',
    dateTouched: !!e, catTouched: !!e };
  const bal = balance(S);
  $('#sTitle').textContent = isSettle ? (e ? 'Editar pago entre vosotros' : 'Pago entre vosotros') : (e ? 'Editar gasto compartido' : 'Nuevo gasto compartido');
  $('#sAmount').value = e ? dec(e.amount) : (isSettle && bal !== 0 ? dec(Math.abs(bal)) : '');
  $('#sPlace').value = e ? e.place : '';
  $('#sNote').value = e ? e.note : '';
  $('#sDate').value = e ? e.date : localISO();
  for (const x of ['sAmount', 'sPlace', 'sDate']) $(`#${x}`).classList.remove('auto');
  setScanStatus($('#sScanStatus'), '');
  $('#sPlaces').replaceChildren(...knownPlaces(S).slice(0, 30).map((p) => Object.assign(document.createElement('option'), { value: p })));
  if (isSettle && !e) f.payerId = bal > 0 ? partnerOf(S).id : S.meId;      // paga quien debe
  for (const id2 of ['sPlaceLabel', 'sCatWrap', 'sSplitWrap', 'sNoteLabel', 'sPhotoWrap']) $(`#${id2}`).hidden = isSettle;
  $('#sDelete').hidden = !e;
  $('#sError').hidden = true;
  drawForm();
  dlg.showModal();
  $('#sAmount').focus();
}

function drawForm() {
  const members = S.members.map((m) => [m.id, m.id === S.meId ? `${m.name} (tú)` : m.name]);
  $('#sPayerLegend').textContent = f.settle ? 'Quién paga' : 'Quién pagó';
  const other = S.members.find((m) => m.id !== f.payerId)?.name || 'el otro';
  $('#sPayer').innerHTML = chips(members, f.payerId);
  $('#sCats').innerHTML = chips(SHARED_CATS.map((c) => [c, c]), f.cat);
  $('#sSplit').innerHTML = chips([['half', 'Mitad y mitad'], ['other', `Todo para ${other}`], ['custom', 'Otro %']], f.splitKind);
  $('#sPctLabel').hidden = f.splitKind !== 'custom';
  if (f.splitKind === 'custom') $('#sPct').value = String(f.pct);
  const pv = $('#sPhotoPrev');
  const showing = !!(f.photo || (f.photoId && !f.removed));
  $('#sPhotoRemove').hidden = !showing;
  $('#sRead').hidden = !f.photoFile;
  pv.hidden = !showing;
  if (f.photo) pv.src = URL.createObjectURL(f.photo.blob);
  else if (f.photoId && !f.removed) getPhoto(f.photoId).then((b) => { if (b) pv.src = URL.createObjectURL(b); else pv.hidden = true; });
}

const pick = (sel, key, after) => $(sel).addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-v]');
  if (!b) return;
  f[key] = b.dataset.v;
  if (after) after();
  drawForm();
});
pick('#sPayer', 'payerId');
pick('#sCats', 'cat', () => { f.catTouched = true; });
pick('#sSplit', 'splitKind', () => { f.pct = f.splitKind === 'half' ? 50 : f.splitKind === 'other' ? 0 : (Number($('#sPct').value) || 50); });

// --- foto y lectura del ticket ---
for (const id of ['sAmount', 'sPlace']) $(`#${id}`).addEventListener('input', (e) => e.target.classList.remove('auto'));
$('#sDate').addEventListener('input', (e) => { f.dateTouched = true; e.target.classList.remove('auto'); });

async function readPhoto(file) {
  const my = ++scanToken;
  const st = $('#sScanStatus');
  try {
    const p = await scanTicket(file, { categories: SHARED_CATS, el: st });
    if (my !== scanToken) return;
    const free = (el) => !el.value.trim() || el.classList.contains('auto');
    const put = (el, v) => { el.value = v; el.classList.add('auto'); };
    if (p.amount != null && free($('#sAmount'))) put($('#sAmount'), dec(p.amount));
    if (p.place && free($('#sPlace'))) put($('#sPlace'), p.place);
    if (p.date && !f.dateTouched) put($('#sDate'), p.date);
    if (p.category && !f.catTouched && SHARED_CATS.includes(p.category)) { f.cat = p.category; drawForm(); }
    const d = describeScan(p);
    setScanStatus(st, d.text, d.kind);
  } catch (err) {
    if (my === scanToken) setScanStatus(st, `${err.message || 'No se pudo leer el ticket'}. Rellénalo a mano.`, 'warn');
  }
}

async function onPhoto(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    f.photo = { blob: await compress(file), id: f.photoId || uid() };
    f.photoFile = file;
    f.removed = false;
    drawForm();
  } catch { toast('No se pudo leer la foto'); return; }
  if (autoReadOn()) readPhoto(file);
  else setScanStatus($('#sScanStatus'), 'Pulsa "Leer el ticket" para rellenar los datos.', '');
}
$('#sShot').onclick = () => $('#sFileCam').click();
$('#sPick').onclick = () => $('#sFilePick').click();
$('#sFileCam').onchange = onPhoto;
$('#sFilePick').onchange = onPhoto;
$('#sRead').onclick = () => { if (f.photoFile) readPhoto(f.photoFile); };
$('#sPhotoRemove').onclick = () => { f.photo = null; f.photoFile = null; f.removed = true; scanToken++; setScanStatus($('#sScanStatus'), ''); drawForm(); };
$('#sCancel').onclick = () => dlg.close();
dlg.addEventListener('close', () => { scanToken++; });

const fail = (m) => { const p = $('#sError'); p.textContent = m; p.hidden = false; };

$('#sForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const amount = parseAmount($('#sAmount').value);
  const date = $('#sDate').value;
  if (amount === null) return fail('Escribe un importe válido (mayor que 0).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Elige una fecha.');
  const pct = f.settle ? 0 : f.splitKind === 'half' ? 50 : f.splitKind === 'other' ? 0 : Number($('#sPct').value);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return fail('El % debe ser un número entero entre 0 y 100.');
  let photoId = f.removed ? '' : f.photoId || '';
  try {
    if (f.photo) { photoId = f.photo.id; await putPhoto(photoId, f.photo.blob); }
    else if (f.removed && f.photoId) await delPhoto(f.photoId).catch(() => {});
  } catch { toast('No se pudo guardar la foto; el gasto se guarda sin ella'); photoId = f.removed ? '' : f.photoId || ''; }
  const entry = { id: editing || uid(), date, amount, place: f.settle ? '' : $('#sPlace').value.trim().slice(0, 60),
    category: f.settle ? 'Liquidación' : f.cat, note: f.settle ? '' : $('#sNote').value.trim().slice(0, 120),
    payerId: f.payerId, payerPct: pct, settle: f.settle, photoId, updated: Date.now(), deleted: false };
  const i = S.entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) S.entries[i] = entry; else S.entries.push(entry);
  save();
  scanToken++;
  dlg.close();
  rerender();
  toast(f.settle ? `Pago registrado: ${eur(amount)}` : `Guardado: ${eur(amount)} en ${entry.place || entry.category}`);
});

$('#sDelete').onclick = () => {
  const e = find(editing);
  if (!e) return;
  const before = { ...e };
  e.deleted = true; e.updated = Date.now();                    // tombstone: el borrado también se propaga al fusionar
  save(); dlg.close(); rerender();
  toast('Borrado', 'Deshacer', () => { Object.assign(e, before, { deleted: false, updated: Date.now() }); save(); rerender(); });
};
