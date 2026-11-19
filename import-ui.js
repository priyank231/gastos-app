// Importar extracto del banco: leer el PDF, clasificar, revisar a mano y aplicar.
import { eur, round2, uid } from './core.js';
import { SHARED_CATS } from './shared.js';
import { readStatement } from './pdfread.js';
import { toMovements, checkBalances, classify, categoryFor, merchantKey, fingerprint, isDuplicate, KINDS } from './statement.js';
import { $, esc, toast, setScanStatus } from './ui.js';

let env = null;
export function init(e) { env = e; }

const dlg = $('#dlgImp');
let items = [];
let reading = 0;

const KIND_ORDER = ['expense', 'shared', 'partner', 'income', 'invest', 'ignore'];
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
const title = (s) => s.toLowerCase().replace(/(^|[\s\-'*])\p{L}/gu, (c) => c.toUpperCase());

/** Texto corto y SIN datos sensibles (IBAN, apellidos) para guardar como concepto. */
export function cleanDesc(raw) {
  let t = String(raw).replace(/\s+/g, ' ').trim();
  t = t.replace(/\(?\bES\d{2}[\d ]{18,26}\)?/gi, '').trim();                              // IBAN
  t = t.replace(/^Savings plan execution\s+\S+\s*/i, 'Plan de ahorro ').replace(/^(Buy|Sell) trade\s+\S+\s*/i, (_, k) => (k.toLowerCase() === 'buy' ? 'Compra ' : 'Venta '));
  t = t.replace(/^Incoming transfer from\s+(\S+).*$/i, (_, n) => `Transferencia de ${title(n)}`).replace(/^Outgoing transfer for\s+.*$/i, 'Transferencia saliente');
  t = t.split(/,\s*(?:quantity|exchange rate|\d)/i)[0].replace(/\bquantity:.*$/i, '').trim();
  if (t === t.toUpperCase()) t = title(t);
  return t.slice(0, 60);
}

function defaultCategory(kind, desc, cats) {
  if (kind === 'shared') return categoryFor(desc, SHARED_CATS) || 'Otros';
  if (kind === 'expense') return categoryFor(desc, cats) || (cats.includes('Otros') ? 'Otros' : cats[0] || 'Otros');
  return '';
}

function setBusy(text, pct = null) {
  $('#impBody').hidden = true;
  setScanStatus($('#impStatus'), pct == null ? text : `${text} ${pct} %`, 'busy');
}

export async function startImport(file) {
  if (!file) return;
  const my = ++reading;
  items = [];
  dlg.showModal();
  setBusy('Abriendo el PDF…');
  try {
    const data = env.getData();
    const r = await readStatement(file, { onStatus: (t, p) => { if (my === reading) setBusy(t, p); } });
    if (my !== reading) return;
    if (!r.rows.length) throw new Error('No encontré una tabla de movimientos. Por ahora solo sé leer extractos de Trade Republic.');
    const mvs = toMovements(r.rows);
    const chk = checkBalances(mvs);
    const cats = env.catNames();
    const cx = { categories: cats, partnerName: env.shared.partnerName(), rules: data.rules };
    const imported = new Set(data.imported);
    const existing = [...data.expenses, ...data.incomes, ...data.investments, ...env.shared.sharedExisting()].map((e) => ({ date: e.date, amount: e.amount }));
    items = mvs.map((mv) => {
      const readable = mv.amount != null && !!mv.date;
      const c = readable ? classify(mv, cx) : { kind: 'ignore', category: '', reason: '', sure: false };
      const dup = readable ? isDuplicate(mv, { imported, existing }) : '';
      const kind = dup || !readable ? 'ignore' : c.kind;
      const category = defaultCategory(kind, mv.desc, cats) || c.category;
      const notes = [];
      if (!mv.ok) notes.push(mv.problem);
      else if (mv.inferred) notes.push(`recuperado por el saldo (${mv.problem})`);
      if (dup) notes.push(dup);
      else if (readable && !c.sure) notes.push(c.reason);
      return { mv, kind, category, orig: { kind, category }, dup, readable, review: !mv.ok || (!c.sure && !dup), notes };
    });
    setScanStatus($('#impStatus'), '');
    $('#impStatus').hidden = true;
    $('#impInfo').textContent = `${items.length} movimientos leídos${r.mode === 'ocr' ? ' (leído por OCR)' : ''}. `
      + (chk.bad ? `${chk.bad} no cuadran con el saldo: revísalos. ` : 'Todos cuadran con los saldos del extracto. ')
      + (chk.inferred ? `${chk.inferred} se recuperaron con el saldo.` : '');
    $('#impInfo').className = `scan-status ${chk.bad ? 'warn' : 'ok'}`;
    $('#impBody').hidden = false;
    draw();
  } catch (err) {
    if (my !== reading) return;
    $('#impBody').hidden = true;
    setScanStatus($('#impStatus'), `${err.message || 'No se pudo leer el extracto'}`, 'warn');
  }
}

function catOptions(kind, cats, current) {
  const list = kind === 'shared' ? SHARED_CATS : cats;
  const all = list.includes(current) || !current ? list : [current, ...list];
  return all.map((c) => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

function rowHtml(it, i, cats, hasGroup) {
  const m = it.mv;
  const amt = m.amount == null ? '?' : eur(m.amount);
  const kindOpts = KIND_ORDER.map((k) => {
    const off = (k === 'shared' || k === 'partner') && !hasGroup;
    return `<option value="${k}"${it.kind === k ? ' selected' : ''}${off ? ' disabled' : ''}>${KINDS[k]}${off ? ' (crea el grupo en Compartido)' : ''}</option>`;
  }).join('');
  const needCat = it.kind === 'expense' || it.kind === 'shared';
  const note = it.notes.length ? `<div class="mv-note${it.review ? ' warn' : ''}">${esc(it.notes.join(' · '))}</div>` : '';
  return `<div class="mv${it.review ? ' review' : ''}${it.kind === 'ignore' ? ' off' : ''}" data-i="${i}">
    <div class="mv-top"><span class="mv-date">${m.date ? shortDate(m.date) : '??'}</span><span class="mv-desc">${esc(cleanDesc(m.desc) || m.desc)}</span><b class="mv-amt${m.amount > 0 ? ' pos' : ''}">${amt}</b></div>
    <div class="mv-ctl"><select class="kind" aria-label="Tipo">${kindOpts}</select>${needCat ? `<select class="cat" aria-label="Categoría">${catOptions(it.kind, cats, it.category)}</select>` : ''}</div>${note}</div>`;
}

function summary() {
  const t = {};
  for (const it of items) {
    if (it.mv.amount == null) continue;
    const k = it.kind;
    t[k] = t[k] || { n: 0, sum: 0 };
    t[k].n++; t[k].sum += Math.abs(it.mv.amount);
  }
  return KIND_ORDER.filter((k) => t[k]).map((k) => `<span class="pill${k === 'ignore' ? '' : ' strong'}">${KINDS[k]} · ${k === 'ignore' ? t[k].n : `${t[k].n} · ${eur(round2(t[k].sum))}`}</span>`).join('');
}

function draw() {
  const cats = env.catNames();
  const hasGroup = env.shared.hasGroup();
  $('#impList').innerHTML = items.map((it, i) => rowHtml(it, i, cats, hasGroup)).join('');
  $('#impSummary').innerHTML = summary();
  const n = items.filter((it) => it.kind !== 'ignore').length;
  $('#impApply').textContent = n ? `Importar ${n} movimiento${n === 1 ? '' : 's'}` : 'No hay nada que importar';
  $('#impApply').disabled = !n;
}

$('#impList').addEventListener('change', (e) => {
  const row = e.target.closest('.mv');
  if (!row) return;
  const it = items[Number(row.dataset.i)];
  if (e.target.classList.contains('kind')) {
    it.kind = e.target.value;
    it.category = defaultCategory(it.kind, it.mv.desc, env.catNames()) || '';
    it.review = false;
  } else if (e.target.classList.contains('cat')) {
    it.category = e.target.value;
  }
  draw();
});

$('#impApply').onclick = () => {
  const data = env.getData();
  const remember = $('#impRemember').checked;
  const count = { expense: 0, shared: 0, partner: 0, income: 0, invest: 0, skipped: 0 };
  const sharedItems = [];
  // una regla solo se aprende si TODAS las filas de ese comercio del extracto quedan igual (p. ej. un Revolut de
  // inversión y otro de gasto no producen regla: dependen del importe, no del comercio)
  const finals = new Map();
  for (const it of items) {
    if (!it.readable || it.dup) continue;
    const k = merchantKey(it.mv.desc);
    const sig = `${it.kind}|${it.kind === 'expense' || it.kind === 'shared' ? it.category : ''}`;
    const g = finals.get(k) || { sigs: new Set(), changed: false };
    g.sigs.add(sig);
    if (it.kind !== it.orig.kind || it.category !== it.orig.category) g.changed = true;
    finals.set(k, g);
  }
  for (const it of items) {
    const m = it.mv;
    if (m.amount == null || !m.date) { count.skipped++; continue; }
    const abs = round2(Math.abs(m.amount));
    const concept = cleanDesc(m.desc) || m.desc.slice(0, 60);
    data.imported.push(fingerprint(m));
    switch (it.kind) {
      case 'expense': data.expenses.push({ id: uid(), date: m.date, amount: abs, category: it.category || 'Otros', concept }); count.expense++; break;
      case 'income': data.incomes.push({ id: uid(), date: m.date, amount: abs, concept }); count.income++; break;
      case 'invest': data.investments.push({ id: uid(), date: m.date, amount: round2(-m.amount), concept }); count.invest++; break;
      case 'shared': sharedItems.push({ kind: 'shared', date: m.date, amount: abs, place: concept, category: it.category }); count.shared++; break;
      case 'partner': sharedItems.push({ kind: 'partner', date: m.date, amount: abs, direction: m.amount > 0 ? 'in' : 'out' }); count.partner++; break;
      default: count.skipped++;
    }
    const key = merchantKey(m.desc);
    const g = finals.get(key);
    if (remember && key && g && g.changed && g.sigs.size === 1) {
      data.rules = data.rules.filter((r) => r.key !== key);
      data.rules.push({ key, kind: it.kind, category: it.kind === 'expense' || it.kind === 'shared' ? it.category : '' });
    }
  }
  if (sharedItems.length) env.shared.addImported(sharedItems);
  data.imported = data.imported.slice(-5000);
  data.rules = data.rules.slice(-500);
  env.save();
  dlg.close();
  env.render();
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bits = [];
  if (count.expense) bits.push(pl(count.expense, 'gasto', 'gastos'));
  if (count.shared) bits.push(pl(count.shared, 'compartido', 'compartidos'));
  if (count.partner) bits.push(pl(count.partner, 'pago de pareja', 'pagos de pareja'));
  if (count.income) bits.push(pl(count.income, 'ingreso', 'ingresos'));
  if (count.invest) bits.push(pl(count.invest, 'inversión', 'inversiones'));
  toast(`Importado: ${bits.join(', ') || 'nada'}`, null, null, 8000);
};

$('#impCancel').onclick = () => { reading++; dlg.close(); };
$('#impClose').onclick = () => { reading++; dlg.close(); };
dlg.addEventListener('close', () => { reading++; });
