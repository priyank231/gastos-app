// Extractos bancarios: reconstruye la tabla (columnas por posicion), comprueba la cadena de saldos
// y clasifica cada movimiento. Logica pura (sin DOM). Pensado para Trade Republic; otros bancos necesitan su muestra.
import { round2 } from './core.js';
import { norm, guessCategory } from './ticket.js';

export const KINDS = {
  expense: 'Gasto',
  shared: 'Gasto compartido',
  partner: 'Pago de/a pareja',
  income: 'Ingreso',
  invest: 'Inversión',
  ignore: 'Ignorar',
};

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** "1.001,13 €" -> 1001.13 (acepta tambien "1.001.13" por fallos del OCR). null si no es un importe. */
export function parseEuro(s) {
  const t = String(s).replace(/[€\s]/g, '');
  const m = t.match(/^(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})$/);
  return m ? Number(`${m[1].replace(/\./g, '')}.${m[2]}`) : null;
}

/** El OCR a veces pierde la coma ("750 €" por "7,50 €"): solo si lleva el símbolo € pegado, últimas 2 cifras = céntimos. */
export function parseEuroLoose(s) {
  const strict = parseEuro(s);
  if (strict !== null) return { value: strict, loose: false };
  const m = String(s).trim().match(/^(\d{3,7})€$/) || String(s).trim().match(/^(0\d)€$/);
  return m ? { value: Number(m[1]) / 100, loose: true } : null;
}

const monthOf = (t) => {
  const k = norm(t).replace(/[^a-z]/g, '');
  return /^(ene|feb|mar|abr|may|jun|jul|ago|sept?|set|oct|nov|dic)$/.test(k) ? MONTHS[k] : 0;
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * words: [{text, x0, x1, y0, y1}] de UNA pagina, ya enderezada. Devuelve filas
 * [{date, type, desc, in, out, balance}] usando la cabecera FECHA/TIPO/DESCRIPCION/ENTRADA/SALIDA/BALANCE.
 * La fecha se arma con su trío vertical día / mes / año (el día va POR ENCIMA del mes).
 */
export function reconstructRows(words) {
  const ws = words.filter((w) => String(w.text).trim()).map((w) => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
  const head = (pref) => ws.filter((w) => norm(w.text).replace(/[^a-z]/g, '').startsWith(pref));
  const hF = head('fecha')[0];
  if (!hF) return [];
  const near = (w) => w && Math.abs(w.cy - hF.cy) < 40;
  const hT = head('tipo').find(near), hD = head('descrip').find(near), hE = head('entrada').find(near),
    hS = head('salida').find(near), hB = head('balance').find(near);
  if (!hT || !hD || !hB) return [];
  const fechaMax = hT.x0 - 3, tipoMin = hT.x0 - 3, descMin = hD.x0 - 3;
  const descMax = (hE || hS || hB).x0 - 6;
  const bodyTop = hF.cy + 28;

  // anclas: mes con un día numérico justo encima y un año justo debajo (descarta frases como "a 18 nov 2026")
  const col = ws.filter((w) => w.cx < fechaMax && w.cy > bodyTop);
  const dayAbove = (m) => col.filter((d) => /^\d{1,2}$/.test(d.text.trim()) && Math.abs(d.cx - m.cx) < 40 && m.cy - d.cy > 0.5 * d.h && m.cy - d.cy < 3.5 * d.h)
    .sort((p, q) => q.cy - p.cy)[0];
  const yearBelow = (m) => col.filter((y) => /^20\d{2}$/.test(y.text.trim()) && Math.abs(y.cx - m.cx) < 40 && y.cy - m.cy > 0.5 * y.h && y.cy - m.cy < 3.5 * y.h)
    .sort((p, q) => p.cy - q.cy)[0];
  const anchors = col.filter((w) => monthOf(w.text)).map((m) => ({ m, d: dayAbove(m), y: yearBelow(m) })).filter((a) => a.d && a.y)
    .sort((p, q) => p.d.cy - q.d.cy);
  if (!anchors.length) return [];
  const tops = anchors.map((a) => a.d.y0 - 4);
  const spacing = median(tops.slice(1).map((t, i) => t - tops[i])) || 110;

  const rows = [];
  anchors.forEach((a, i) => {
    const top = tops[i], bottom = i + 1 < tops.length ? tops[i + 1] : top + spacing;
    const inRow = ws.filter((w) => w.cy >= top && w.cy < bottom && w.cy > bodyTop);
    const line = (arr) => arr.sort((p, q) => (Math.abs(p.cy - q.cy) > p.h * 0.6 ? p.cy - q.cy : p.x0 - q.x0)).map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
    const type = line(inRow.filter((w) => w.cx >= tipoMin && w.cx < descMin));
    const desc = line(inRow.filter((w) => w.cx >= descMin && w.cx < descMax));
    // importes por COLUMNA (no por orden): saldo a la derecha; entrada/salida según la cabecera más cercana
    const amts = inRow.filter((w) => w.x0 >= descMax - 4 && w.cx >= descMax - 4).map((w) => ({ w, v: parseEuroLoose(w.text) })).filter((a) => a.v)
      .concat([]);
    const balCut = ((hS || hE || hD).x0 + hB.x0) / 2;
    const balTok = inRow.filter((w) => w.x0 >= balCut && parseEuro(w.text) !== null).sort((p, q) => q.x0 - p.x0)[0];
    const flowToks = amts.filter((a) => a.w.x0 < balCut);
    let inn = null, out = null, loose = false;
    if (flowToks.length) {
      const t = flowToks[0];
      const toE = hE ? Math.abs(t.w.x0 - hE.x0) : Infinity, toS = hS ? Math.abs(t.w.x0 - hS.x0) : Infinity;
      if (toE < toS) inn = t.v.value; else out = t.v.value;
      loose = t.v.loose;
    }
    const date = `${a.y.text.trim()}-${pad(monthOf(a.m.text))}-${pad(Number(a.d.text))}`;
    rows.push({ date, type, desc, in: inn, out, balance: balTok ? parseEuro(balTok.text) : null, loose });
  });
  return rows;
}

/** Filas -> movimientos con importe con signo (entrada +, salida -). Un importe ilegible queda en null. */
export function toMovements(rows) {
  return rows.map((r, i) => ({
    id: i, date: r.date, type: r.type, desc: r.desc, balance: r.balance, loose: !!r.loose,
    amount: r.in != null ? round2(r.in) : r.out != null ? round2(-r.out) : null,
  }));
}

/**
 * Comprueba la cadena de saldos (saldo anterior + importe = saldo) y REPARA lo que el OCR rompe:
 * - falta el saldo: se calcula (anterior + importe);
 * - falta el importe: se deduce (saldo - anterior);
 * - importe con el signo cambiado: se corrige.
 * Lo recuperado así queda marcado `inferred`. Lo que no se puede cuadrar queda `ok:false`.
 */
export function checkBalances(mvs) {
  const near = (a, b) => Math.abs(a - b) < 0.005;     // los bancos cuadran al céntimo
  let bad = 0, inferred = 0;
  mvs.forEach((m, i) => {
    m.ok = true; m.problem = ''; m.inferred = false;
    const prev = i > 0 ? mvs[i - 1] : null;
    const pb = prev && prev.balance != null ? prev.balance : null;
    if (!m.date) { m.ok = false; m.problem = 'fecha no legible'; }
    else if (m.amount != null && m.balance != null) {
      if (pb != null && !near(round2(pb + m.amount), m.balance)) {
        if (near(round2(pb - m.amount), m.balance)) { m.amount = round2(-m.amount); m.inferred = true; m.problem = 'signo corregido por el saldo'; }
        else { m.ok = false; m.problem = 'no cuadra con el saldo'; }
      }
    } else if (m.amount != null && m.balance == null) {
      if (pb != null) { m.balance = round2(pb + m.amount); m.inferred = true; m.problem = 'saldo calculado'; }
      else { m.ok = false; m.problem = 'saldo no legible'; }
    } else if (m.amount == null && m.balance != null) {
      const d = pb != null ? round2(m.balance - pb) : null;
      if (d != null && Math.abs(d) >= 0.005) { m.amount = d; m.inferred = true; m.problem = 'importe deducido del saldo'; }
      else { m.ok = false; m.problem = 'importe no legible'; }
    } else { m.ok = false; m.problem = 'importe y saldo no legibles'; }
    if (!m.ok) bad++; else if (m.inferred) inferred++;
  });
  return { bad, inferred };
}

// ---------- clasificacion ----------
const RULES = [
  { re: /mercadona|carrefour|consum|lidl|\bdia\b|aldi|alcampo|eroski|supermerc|hipercor|bonpreu|ahorramas|caprabo|condis|froiz|gadis/, names: ['Alimentación', 'Súper', 'Supermercado', 'Comida'] },
  { re: /benzina|repsol|cepsa|galp|shell|\bbp\b|gasolinera|ballenoil|plenergy|carburantes|estacion de servicio|peaje|autopista|parking|aparcamiento|renfe|\bemt\b|\btaxi\b|uber|cabify|\bbolt\b/, names: ['Transporte', 'Gasolina', 'Coche'] },
  { re: /restaurante|cafeteria|cerveceria|taberna|pizz|kebab|burger|mcdonald|\bbar\b|hosteleria|tapas|sushi|heladeria|panaderia|starbucks|glovo|just eat|bocadill/, names: ['Ocio', 'Comida fuera', 'Restaurantes', 'Alimentación'] },
  { re: /ticketmaster|uscustoms|esta appl|\bcine\b|teatro|concierto|museo|netflix|spotify|\bhbo\b|disney|steam|eldorado|playstation|xbox|nintendo|booking|airbnb|hotel|vueling|ryanair|iberia/, names: ['Ocio', 'Viajes'] },
  { re: /estanco|tabac/, names: ['Personal', 'Otros'] },
  { re: /fitness|gimnasio|\bgym\b|piscina|deport|decathlon|crossfit/, names: ['Personal', 'Ocio'] },
  { re: /corte ingles|zara|primark|h&m|mango|bershka|ropa|calzado/, names: ['Personal'] },
  { re: /farmacia|parafarmacia|clinica|dentista|optica|medic/, names: ['Salud'] },
  { re: /vending|teika/, names: ['Alimentación', 'Otros'] },
  { re: /bazar|ikea|leroy|brico|ferreteria/, names: ['Otros', 'Casa', 'Vivienda'] },
  { re: /iberdrola|endesa|naturgy|aguas de|vodafone|movistar|orange|telefonica|\bdigi\b|masmovil|yoigo/, names: ['Suministros'] },
  { re: /seguro|mapfre|mutua|\baxa\b|linea directa|allianz/, names: ['Seguros e impuestos'] },
];

const firstAvailable = (names, available) => {
  const byNorm = new Map(available.map((a) => [norm(a), a]));
  for (const n of names) if (byNorm.has(norm(n))) return byNorm.get(norm(n));
  return '';
};

/** Categoria por comercio entre las `available`; '' si no hay pista. */
export function categoryFor(desc, available = []) {
  const d = norm(desc);
  for (const r of RULES) if (r.re.test(d)) { const c = firstAvailable(r.names, available); if (c) return c; }
  return guessCategory(d, available);
}

/** Clave estable del comercio para recordar reglas ("MERCADONA NOVENES" y "MERCADONA VIRGEN" -> "mercadona"). */
export function merchantKey(desc) {
  const w = norm(desc).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return w[0].length >= 3 ? w[0] : w.slice(0, 2).join(' ');
}

const matchesPartner = (name, partner) => {
  const p = norm(partner).trim().split(/\s+/)[0];
  if (!p || p.length < 3) return false;
  return norm(name).split(/\s+/).some((t) => t.length >= 3 && (t.startsWith(p) || p.startsWith(t)));
};

/** Propone tipo y categoria de un movimiento. ctx: { categories, partnerName, rules }. */
export function classify(mv, ctx = {}) {
  const cats = ctx.categories || [];
  const d = norm(mv.desc), ty = norm(mv.type);
  const learned = (ctx.rules || []).find((r) => r.key === merchantKey(mv.desc));
  if (learned) return { kind: learned.kind, category: learned.category || '', reason: 'regla aprendida', sure: true };
  if (/\boperar\b/.test(ty) || /savings plan|buy trade|sell trade|plan de ahorro/.test(d)) return { kind: 'invest', category: '', reason: 'inversión', sure: true };
  if (/revolut/.test(d)) return { kind: 'invest', category: '', reason: 'Revolut → inversión (cámbialo a gasto si no lo es)', sure: false };
  if (/rentabilidad/.test(ty) || /dividend|interes|interest/.test(d)) return { kind: mv.amount > 0 ? 'income' : 'expense', category: '', reason: 'rendimiento', sure: true };
  const inc = d.match(/incoming transfer from (.+?)(?:\(|$)/);
  if (inc) {
    return matchesPartner(inc[1], ctx.partnerName || '')
      ? { kind: 'partner', category: '', reason: 'transferencia de tu pareja', sure: true }
      : { kind: 'income', category: '', reason: 'transferencia recibida', sure: false };
  }
  const outg = d.match(/outgoing transfer for (.+?)(?:\(|$)/);
  if (outg) {
    return matchesPartner(outg[1], ctx.partnerName || '')
      ? { kind: 'partner', category: '', reason: 'transferencia a tu pareja', sure: true }
      : { kind: 'ignore', category: '', reason: 'traspaso entre tus cuentas', sure: false };
  }
  if (mv.amount > 0) return { kind: 'income', category: '', reason: 'entrada de dinero', sure: false };
  const category = categoryFor(mv.desc, cats);
  return { kind: 'expense', category, reason: category ? 'comercio conocido' : 'sin pista', sure: !!category };
}

/** Huella para no importar dos veces el mismo movimiento. */
export const fingerprint = (mv) => `${mv.date}|${Math.abs(mv.amount).toFixed(2)}|${norm(mv.desc).replace(/[^a-z]/g, '').slice(0, 24)}`;

/** ¿Ya está apuntado? ctx.imported: Set de huellas; ctx.existing: [{date, amount}] de lo ya registrado. */
export function isDuplicate(mv, ctx = {}) {
  if ((ctx.imported || new Set()).has(fingerprint(mv))) return 'ya importado antes';
  const hit = (ctx.existing || []).some((e) => e.date === mv.date && Math.abs(Math.abs(e.amount) - Math.abs(mv.amount)) < 0.005);
  return hit ? 'ya hay un movimiento igual ese día' : '';
}
