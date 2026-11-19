// Pantallas del modo COMPARTIDO (Saldo, Movimientos, Ajustes) y su formulario.
import { MONTHS, eur, localISO, parseAmount, uid } from './core.js';
import { SHARED_CATS, defaultShared, createGroup, partnerOf, nameOf, balance, periodRange, periodEntries, periodStats,
  makeExport, validateExport, applyImport, validateShared, sharedCSV, knownPlaces } from './shared.js';
import { $, esc, dec, toast, banner, deliver } from './ui.js';
import { putPhoto, getPhoto, delPhoto, compress, blobToDataURL, dataURLToBlob } from './photos.js';

const KEY = 'gastos.shared.v1';
let S = load();
let period = { kind: 'week', ref: new Date() };
let rerender = () => {};
let editing = null;                      // id del movimiento que se edita
let f = { settle: false, payerId: '', pct: 50, splitKind: 'half', cat: SHARED_CATS[0], photo: null, removed: false };

export function init(opts) { rerender = opts.render; }

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return validateShared(JSON.parse(raw));
  } catch {
    try { if (raw) localStorage.setItem(`${KEY}.corrupt`, raw); } catch { /* nada */ }
    queueMicrotask(() => banner('Los datos compartidos estaban danados: se guardo una copia aparte.'));
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
function setupView() {
  return `<section class="card set"><h2>Configurar compartido</h2>
    <p class="small mut">Cada uno guarda su copia en su movil y os pasais un archivo para fusionar. Ninguna nube.</p>
    <label>Tu nombre<input id="gMe" maxlength="30" placeholder="Ej. Priyank"></label>
    <label>Nombre de tu pareja<input id="gPartner" maxlength="30" placeholder="Ej. Ana"></label>
    <div class="row"><button class="btn primary" id="gCreate">Crear grupo</button></div></section>
  <section class="card set"><h2>O unirte con su archivo</h2>
    <p class="small mut">Si tu pareja ya creo el grupo, pidele que exporte (Ajustes o Saldo) y abre aqui el archivo que te mande.</p>
    <input type="file" id="gJoin" accept=".json,application/json"></section>`;
}

const chips = (items, on) => items.map(([v, l]) => `<button class="chip${on === v ? ' on' : ''}" data-v="${esc(v)}" aria-pressed="${on === v}">${esc(l)}</button>`).join('');

function periodBar() {
  return `<div class="seg" role="group" aria-label="Periodo">
    ${[['week', 'Semana'], ['month', 'Mes'], ['all', 'Todo']].map(([k, l]) => `<button data-period="${k}" aria-selected="${period.kind === k}">${l}</button>`).join('')}</div>`;
}

function saldoView() {
  const s = S, partner = partnerOf(s), bal = balance(s), st = periodStats(s, range());
  const head = bal > 0 ? `${esc(partner.name)} te debe` : bal < 0 ? `Le debes a ${esc(partner.name)}` : 'Estais en paz';
  return `<section class="card"><h2>Saldo total</h2>
      <div class="state ${bal === 0 ? 'ok' : 'warn'}">${head}</div>
      <div class="big">${eur(Math.abs(bal))}</div>
      <div class="row"><button class="btn" id="gSettle">Registrar pago entre vosotros</button></div></section>
    ${periodBar()}
    <section class="card"><h2>${esc(title())}</h2>
      <div class="kpis">
        <div class="kpi"><span>Gastado en total</span><b>${eur(st.total)}</b></div>
        <div class="kpi"><span>Tu parte</span><b>${eur(st.myShare)}</b></div>
        <div class="kpi"><span>Pagaste tu</span><b>${eur(st.paidMe)}</b></div>
        <div class="kpi"><span>Pago ${esc(partner.name)}</span><b>${eur(st.paidPartner)}</b></div>
      </div><div class="small mut" style="margin-top:8px">${st.count} gasto(s) en el periodo</div></section>
    <section class="card set"><h2>Exportar ${esc(title())}</h2>
      <p class="small mut">Para que ella fusione tus gastos, o para guardar el registro con fechas y local.</p>
      <label class="check"><input type="checkbox" id="gPhotos" checked> Incluir fotos de tickets</label>
      <div class="row"><button class="btn primary" id="gExpJson">Enviar para fusionar</button><button class="btn" id="gExpCsv">CSV (Excel)</button></div></section>`;
}

function listView() {
  const list = periodEntries(S, range());
  const body = list.length ? list.map((e) => {
    const who = nameOf(S, e.payerId);
    const sub = e.settle ? `Pago entre vosotros - lo hizo ${esc(who)}` : `${esc(e.category)} - pago ${esc(who)}${e.payerPct !== 50 ? ` (${e.payerPct}% suyo)` : ''}`;
    const photo = e.photoId ? `<img class="thumb" alt="" data-photo="${esc(e.photoId)}">` : '';
    return `<button class="item" data-sid="${esc(e.id)}"><span>${photo}<span>${esc(e.place || (e.settle ? 'Liquidacion' : e.category))}<small>${fmtDay(e.date)} - ${sub}</small></span></span><b>${eur(e.amount)}</b></button>`;
  }).join('') : '<p class="empty">Sin movimientos en este periodo.<br>Pulsa + para anadir el primero.</p>';
  return `${periodBar()}${body}`;
}

function ajustesView() {
  const p = partnerOf(S), me = S.members.find((m) => m.id === S.meId);
  return `<section class="card set"><h2>Nombres</h2>
      <label>Tu nombre<input id="aMe" maxlength="30" value="${esc(me.name)}"></label>
      <label>Tu pareja<input id="aPartner" maxlength="30" value="${esc(p.name)}"></label>
      <p class="small mut">Codigo del grupo: ${esc(S.groupId.slice(0, 6))} (debe coincidir en los dos moviles).</p></section>
    <section class="card set"><h2>Recibir de tu pareja</h2>
      <p class="small mut">Abre el archivo que te mande. Se fusiona: los movimientos nuevos se anaden, los editados se actualizan y no se duplica nada.</p>
      <input type="file" id="aImport" accept=".json,application/json"></section>
    <section class="card set"><h2>Zona de riesgo</h2>
      <p class="small mut">Borra los gastos compartidos de ESTE movil (no los de tu pareja). Exporta antes si quieres conservarlos.</p>
      <button class="btn danger" id="aLeave">Salir del grupo y borrar</button></section>`;
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
    return;
  }
  if (tab === 'mes') {
    $('#gSettle').onclick = () => openForm(null, true);
    $('#gExpJson').onclick = exportJson;
    $('#gExpCsv').onclick = exportCsv;
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
    $('#aLeave').onclick = async () => {
      if (prompt('Se borraran los gastos compartidos de este movil. Escribe BORRAR para confirmar') !== 'BORRAR') return;
      for (const e of S.entries) if (e.photoId) await delPhoto(e.photoId).catch(() => {});
      S = defaultShared(); save(); rerender(); toast('Grupo borrado de este movil');
    };
  }
}

// ---------- exportar / importar ----------
async function exportJson() {
  try {
    const r = range();
    const entries = S.entries.filter((e) => !r || (e.date >= r.from && e.date <= r.to));
    const photos = {};
    if ($('#gPhotos').checked) {
      for (const e of entries) {
        if (!e.photoId) continue;
        const blob = await getPhoto(e.photoId);
        if (blob) photos[e.photoId] = await blobToDataURL(blob);
      }
    }
    const exp = makeExport(S, r, photos);
    const res = await deliver(`gastos-compartidos-${periodLabelFile()}.json`, JSON.stringify(exp), 'application/json');
    if (res !== 'cancelled') toast(res === 'shared' ? 'Archivo enviado' : 'Archivo descargado (busca en Descargas / Archivos)');
  } catch { toast('No se pudo exportar'); }
}
async function exportCsv() {
  const res = await deliver(`gastos-compartidos-${periodLabelFile()}.csv`, sharedCSV(S, periodEntries(S, range())), 'text/csv');
  if (res !== 'cancelled') toast(res === 'shared' ? 'CSV enviado' : 'CSV descargado (busca en Descargas / Archivos)');
}

async function importFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const exp = validateExport(JSON.parse(await file.text()));
    const joining = !hasGroup();
    if (joining) {
      const iAm = exp.members.find((m) => m.id !== exp.from);
      if (!confirm(`Te unes al grupo de ${exp.members.find((m) => m.id === exp.from).name} como "${iAm.name}". Continuar?`)) return;
    }
    const { shared, stats } = applyImport(S, exp);
    S = shared; save();
    for (const [id, url] of Object.entries(exp.photos)) {
      if (!(await getPhoto(id))) await putPhoto(id, await dataURLToBlob(url)).catch(() => {});
    }
    rerender();
    toast(joining ? `Te uniste al grupo: ${stats.added} movimientos` : `Fusionado: ${stats.added} nuevos, ${stats.updated} actualizados, ${stats.skipped} ya estaban`, null, null, 8000);
  } catch (err) { toast(err.message || 'Archivo no valido', null, null, 8000); }
  finally { ev.target.value = ''; }
}

// ---------- formulario de movimiento ----------
const dlg = $('#dlgS');
const find = (id) => S.entries.find((e) => e.id === id);

export function openAdd() { openForm(null, false); }

function openForm(id = null, settle = false) {
  editing = id;
  const e = id ? find(id) : null;
  const isSettle = e ? e.settle : settle;
  f = { settle: isSettle, payerId: e ? e.payerId : S.meId, pct: e ? e.payerPct : 50,
    splitKind: e ? (e.payerPct === 50 ? 'half' : e.payerPct === 0 ? 'other' : 'custom') : 'half',
    cat: e ? e.category : SHARED_CATS[0], photo: null, removed: false, photoId: e ? e.photoId : '' };
  const bal = balance(S);
  $('#sTitle').textContent = isSettle ? (e ? 'Editar pago entre vosotros' : 'Pago entre vosotros') : (e ? 'Editar gasto compartido' : 'Nuevo gasto compartido');
  $('#sAmount').value = e ? dec(e.amount) : (isSettle && bal !== 0 ? dec(Math.abs(bal)) : '');
  $('#sPlace').value = e ? e.place : '';
  $('#sNote').value = e ? e.note : '';
  $('#sDate').value = e ? e.date : localISO();
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
  const members = S.members.map((m) => [m.id, m.id === S.meId ? `${m.name} (tu)` : m.name]);
  const payerLabel = f.settle ? 'Quien paga' : 'Quien pago';
  $('#sPayerLegend').textContent = payerLabel;
  const other = S.members.find((m) => m.id !== f.payerId)?.name || 'el otro';
  $('#sPayer').innerHTML = chips(members, f.payerId);
  $('#sCats').innerHTML = chips(SHARED_CATS.map((c) => [c, c]), f.cat);
  $('#sSplit').innerHTML = chips([['half', 'Mitad y mitad'], ['other', `Todo para ${other}`], ['custom', 'Otro %']], f.splitKind);
  $('#sPctLabel').hidden = f.splitKind !== 'custom';
  if (f.splitKind === 'custom') $('#sPct').value = String(f.pct);
  const pv = $('#sPhotoPrev'), rm = $('#sPhotoRemove');
  const showing = f.photo || (f.photoId && !f.removed);
  rm.hidden = !showing;
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
pick('#sCats', 'cat');
pick('#sSplit', 'splitKind', () => { f.pct = f.splitKind === 'half' ? 50 : f.splitKind === 'other' ? 0 : (Number($('#sPct').value) || 50); });

async function onPhoto(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    f.photo = { blob: await compress(file), id: f.photoId || uid() };
    f.removed = false;
    drawForm();
  } catch { toast('No se pudo leer la foto'); }
}
$('#sShot').onclick = () => $('#sFileCam').click();
$('#sPick').onclick = () => $('#sFilePick').click();
$('#sFileCam').onchange = onPhoto;
$('#sFilePick').onchange = onPhoto;
$('#sPhotoRemove').onclick = () => { f.photo = null; f.removed = true; drawForm(); };
$('#sCancel').onclick = () => dlg.close();

const fail = (m) => { const p = $('#sError'); p.textContent = m; p.hidden = false; };

$('#sForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const amount = parseAmount($('#sAmount').value);
  const date = $('#sDate').value;
  if (amount === null) return fail('Escribe un importe valido (mayor que 0).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Elige una fecha.');
  let pct = f.settle ? 0 : f.splitKind === 'half' ? 50 : f.splitKind === 'other' ? 0 : Number($('#sPct').value);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return fail('El % debe ser un numero entero entre 0 y 100.');
  let photoId = f.removed ? '' : f.photoId || '';
  try {
    if (f.photo) { photoId = f.photo.id; await putPhoto(photoId, f.photo.blob); }
    else if (f.removed && f.photoId) await delPhoto(f.photoId).catch(() => {});
  } catch { toast('No se pudo guardar la foto; el gasto se guarda sin ella'); photoId = f.removed ? '' : f.photoId || ''; }
  const entry = { id: editing || uid(), date, amount, place: f.settle ? '' : $('#sPlace').value.trim().slice(0, 60),
    category: f.settle ? 'Liquidacion' : f.cat, note: f.settle ? '' : $('#sNote').value.trim().slice(0, 120),
    payerId: f.payerId, payerPct: pct, settle: f.settle, photoId, updated: Date.now(), deleted: false };
  const i = S.entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) S.entries[i] = entry; else S.entries.push(entry);
  save();
  dlg.close();
  rerender();
  toast(f.settle ? `Pago registrado: ${eur(amount)}` : `Guardado: ${eur(amount)} en ${entry.place || entry.category}`);
});

$('#sDelete').onclick = () => {
  const e = find(editing);
  if (!e) return;
  const before = { ...e };
  e.deleted = true; e.updated = Date.now();                    // tombstone: el borrado tambien se propaga al fusionar
  save(); dlg.close(); rerender();
  toast('Borrado', 'Deshacer', () => { Object.assign(e, before, { deleted: false, updated: Date.now() }); save(); rerender(); });
};
