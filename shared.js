// Logica pura del modo COMPARTIDO (tipo Splitwise de dos personas, sin servidor).
// Cada movil guarda su copia; se intercambian archivos y se FUSIONAN por id (ultima edicion gana).

import { round2, pad, uid } from './core.js';

export const SHARED_CATS = ['Súper', 'Comida fuera', 'Casa', 'Ocio', 'Viajes', 'Otros'];
export const EXPORT_APP = 'gastos-compartido';
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function defaultShared() {
  return { version: 1, groupId: '', meId: '', members: [], entries: [] };
}

/** Crea el grupo en ESTE movil: yo y mi pareja (su id real se enlaza cuando importe un archivo mio). */
export function createGroup(myName, partnerName) {
  const me = { id: uid(), name: (myName || '').trim().slice(0, 30) || 'Yo' };
  const partner = { id: uid(), name: (partnerName || '').trim().slice(0, 30) || 'Pareja' };
  return { ...defaultShared(), groupId: uid(), meId: me.id, members: [me, partner] };
}

export const partnerOf = (s) => s.members.find((m) => m.id !== s.meId);
export const nameOf = (s, id) => s.members.find((m) => m.id === id)?.name || '?';
export const active = (s) => s.entries.filter((e) => !e.deleted);

/** Lo que el otro le debe al que pago (en centimos, sin errores de redondeo acumulados). */
export const owedCents = (e) => Math.round((e.amount * 100 * (100 - e.payerPct)) / 100);

/** Saldo global: positivo = mi pareja me debe; negativo = yo le debo. */
export function balance(s) {
  let cents = 0;
  for (const e of active(s)) cents += e.payerId === s.meId ? owedCents(e) : -owedCents(e);
  return round2(cents / 100);
}

// ---------- periodos ----------
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Semana lunes-domingo que contiene `ref`; mes natural; o todo (null). */
export function periodRange(kind, ref = new Date()) {
  if (kind === 'all') return null;
  if (kind === 'month') {
    const y = ref.getFullYear(), m = ref.getMonth();
    return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ((ref.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { from: iso(start), to: iso(end) };
}

export const inRange = (e, range) => !range || (e.date >= range.from && e.date <= range.to);

export function periodEntries(s, range) {
  return active(s).filter((e) => inRange(e, range))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated);
}

/** Totales del periodo (las liquidaciones no son gasto). */
export function periodStats(s, range) {
  let total = 0, paidMe = 0, paidPartner = 0, myShare = 0, count = 0;
  for (const e of periodEntries(s, range)) {
    if (e.settle) continue;
    count++;
    total += e.amount;
    const payerShare = (e.amount * e.payerPct) / 100;
    if (e.payerId === s.meId) { paidMe += e.amount; myShare += payerShare; }
    else { paidPartner += e.amount; myShare += e.amount - payerShare; }
  }
  return { count, total: round2(total), paidMe: round2(paidMe), paidPartner: round2(paidPartner),
    myShare: round2(myShare), partnerShare: round2(total - myShare) };
}

// ---------- validacion y fusion ----------
export function normEntry(e, memberIds) {
  if (!e || typeof e.id !== 'string' || !isDate(e.date) || !memberIds.includes(e.payerId)) return null;
  const amount = Number(e.amount);
  if (!(amount > 0 && amount <= 100000)) return null;
  const pct = Number(e.payerPct);
  return {
    id: e.id.slice(0, 40), date: e.date, amount: round2(amount),
    place: String(e.place || '').slice(0, 60), category: String(e.category || 'Otros').slice(0, 40),
    note: String(e.note || '').slice(0, 120), payerId: e.payerId,
    payerPct: Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : 50,
    settle: !!e.settle, photoId: typeof e.photoId === 'string' ? e.photoId.slice(0, 40) : '',
    updated: Number(e.updated) || 0, deleted: !!e.deleted,
  };
}

/** Valida datos guardados en este movil. Lanza Error si no son validos. */
export function validateShared(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Datos no validos');
  const d = defaultShared();
  d.groupId = typeof obj.groupId === 'string' ? obj.groupId : '';
  d.members = (Array.isArray(obj.members) ? obj.members : []).filter((m) => m && typeof m.id === 'string')
    .map((m) => ({ id: m.id, name: String(m.name || '').slice(0, 30) || '?' })).slice(0, 2);
  d.meId = d.members.some((m) => m.id === obj.meId) ? obj.meId : '';
  const ids = d.members.map((m) => m.id);
  d.entries = (Array.isArray(obj.entries) ? obj.entries : []).map((e) => normEntry(e, ids)).filter(Boolean);
  if (!d.members.length || !d.meId) return defaultShared();
  return d;
}

/** Fusiona entradas entrantes con las locales por id: gana la de `updated` mayor. */
export function mergeEntries(local, incoming) {
  const map = new Map(local.map((e) => [e.id, e]));
  const stats = { added: 0, updated: 0, skipped: 0 };
  for (const e of incoming) {
    const cur = map.get(e.id);
    if (!cur) { map.set(e.id, e); stats.added++; }
    else if (e.updated > cur.updated) { map.set(e.id, e); stats.updated++; }
    else stats.skipped++;
  }
  return { entries: [...map.values()], ...stats };
}

/** Archivo para fusionar. `photos`: { photoId: dataURL } ya filtradas por el llamador. */
export function makeExport(s, range, photos = {}) {
  const entries = s.entries.filter((e) => inRange(e, range));
  const wanted = new Set(entries.map((e) => e.photoId).filter(Boolean));
  const ph = Object.fromEntries(Object.entries(photos).filter(([k]) => wanted.has(k)));
  return { app: EXPORT_APP, version: 1, groupId: s.groupId, from: s.meId, members: s.members,
    exportedAt: new Date().toISOString(), range: range || null, entries, photos: ph };
}

export function validateExport(obj) {
  if (!obj || obj.app !== EXPORT_APP || typeof obj.groupId !== 'string' || !obj.groupId
      || !Array.isArray(obj.members) || obj.members.length !== 2 || !Array.isArray(obj.entries)) {
    throw new Error('No es un archivo de gastos compartidos');
  }
  const members = obj.members.map((m) => ({ id: String(m?.id || ''), name: String(m?.name || '').slice(0, 30) || '?' }));
  if (members.some((m) => !m.id) || members[0].id === members[1].id) throw new Error('No es un archivo de gastos compartidos');
  if (!members.some((m) => m.id === obj.from)) throw new Error('No es un archivo de gastos compartidos');
  const ids = members.map((m) => m.id);
  const photos = {};
  for (const [k, v] of Object.entries(obj.photos || {})) {
    if (typeof v === 'string' && v.startsWith('data:image/') && v.length < 4_000_000) photos[String(k).slice(0, 40)] = v;
  }
  return { groupId: obj.groupId.slice(0, 40), from: obj.from, members,
    entries: obj.entries.map((e) => normEntry(e, ids)).filter(Boolean), photos };
}

/**
 * Aplica un archivo recibido. Si este movil aun no tiene grupo, se UNE: adopta el grupo y los ids,
 * y "yo" pasa a ser la persona que NO exporto. Devuelve { shared, stats }.
 */
export function applyImport(local, exp) {
  let s = local;
  if (!s.groupId) {
    const me = exp.members.find((m) => m.id !== exp.from);
    s = { ...defaultShared(), groupId: exp.groupId, members: exp.members, meId: me.id };
  } else if (s.groupId !== exp.groupId) {
    throw new Error('Este archivo es de otro grupo');
  }
  const merged = mergeEntries(s.entries, exp.entries);
  return { shared: { ...s, entries: merged.entries },
    stats: { added: merged.added, updated: merged.updated, skipped: merged.skipped, joined: !local.groupId } };
}

/** CSV legible en Excel (BOM UTF-8). Importe en positivo; `parte_pagador_pct` = % que consume quien pago. */
export function sharedCSV(s, entries) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['fecha,local,categoria,pagado_por,importe,parte_pagador_pct,tipo,nota'];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([e.date, q(e.place), q(e.category), q(nameOf(s, e.payerId)), e.amount.toFixed(2),
      e.payerPct, e.settle ? 'liquidacion' : 'gasto', q(e.note)].join(','));
  }
  return `﻿${lines.join('\n')}`;
}

/** Lugares ya usados, mas frecuentes primero (para autocompletar). */
export function knownPlaces(s) {
  const count = new Map();
  for (const e of active(s)) if (e.place) count.set(e.place, (count.get(e.place) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}
