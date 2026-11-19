// Interpreta el TEXTO que el OCR saca de un ticket: importe, fecha, local y categoria probable.
// Es heuristico: el OCR falla y los tickets son muy distintos. Siempre se devuelve algo revisable, nunca se guarda solo.

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MONEY = /(\d{1,3}(?:[.\s]\d{3})+|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;

const TOTAL_RE = /\btotal\b|a\s*pagar|importe\s*(?:total|factura)?|\bsuma\b|\bpvp\b/;
const NOT_TOTAL_RE = /subtotal|sub-total|base\s*imp|\biva\b|cuota|cambio|entregad|recibid|descuento|dto\b|propina|ahorro|puntos|saldo/;
const PAY_RE = /tarjeta|visa|mastercard|efectivo|contado|bizum|credito|debito/;

function toNumber(intPart, dec) {
  const n = Number(`${intPart.replace(/[.\s]/g, '')}.${dec}`);
  return Number.isFinite(n) ? n : NaN;
}

/** Todos los importes de una linea. */
export function moneyIn(line) {
  const out = [];
  for (const m of String(line).matchAll(MONEY)) {
    const n = toNumber(m[1], m[2]);
    if (n > 0 && n < 100000) out.push(n);
  }
  return out;
}

export function findAmount(lines) {
  const keyed = [];
  for (let i = 0; i < lines.length; i++) {
    const l = norm(lines[i]);
    if (!TOTAL_RE.test(l) || NOT_TOTAL_RE.test(l)) continue;
    let vals = moneyIn(lines[i]);
    if (!vals.length && lines[i + 1] && !NOT_TOTAL_RE.test(norm(lines[i + 1]))) vals = moneyIn(lines[i + 1]);   // importe en la linea siguiente
    if (vals.length) keyed.push(vals[vals.length - 1]);
  }
  if (keyed.length) return { value: Math.max(...keyed), sure: true };
  const paid = [];
  for (const raw of lines) {
    const l = norm(raw);
    if (PAY_RE.test(l) && !NOT_TOTAL_RE.test(l)) paid.push(...moneyIn(raw));
  }
  if (paid.length) return { value: Math.max(...paid), sure: false };
  const all = lines.flatMap(moneyIn);
  return all.length ? { value: Math.max(...all), sure: false } : { value: null, sure: false };
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function findDate(text, today = new Date()) {
  const cands = [];
  for (const m of text.matchAll(/\b(\d{1,2})\s?[\/\-.]\s?(\d{1,2})\s?[\/\-.]\s?(\d{4}|\d{2})\b/g)) {
    let [, d, mo, y] = m; d = +d; mo = +mo; y = +y;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) cands.push(iso(y, mo, d));
  }
  for (const m of text.matchAll(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g)) {
    const [, y, mo, d] = m;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) cands.push(iso(+y, +mo, +d));
  }
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const ok = cands.filter((c) => {
    const t = Date.parse(`${c}T00:00:00Z`);
    return Number.isFinite(t) && t <= now + 86400000 && t >= now - 800 * 86400000;     // ni futuro ni muy antiguo
  });
  return ok[0] || '';
}

const LEGAL = /\b(s\.?\s?a\.?u?\.?|s\.?\s?l\.?u?\.?|s\.?\s?coop\.?|c\.?b\.?)\s*$/i;
const SKIP_PLACE = /\b(cif|nif|n\.?i\.?f|tel|telf|tlf|www|http|factura|ticket|simplificada|fecha|hora|c\/|calle|avda|avenida|plaza|c\.p|cp\b|gracias|bienvenid|operacion|terminal|caja)\b/i;

export function findPlace(lines) {
  for (const raw of lines.slice(0, 10)) {
    if (SKIP_PLACE.test(norm(raw))) continue;                      // se filtra sobre el texto original (antes de quitar "/")
    const line = raw.replace(/[^\p{L}\p{N}&.\-' ]/gu, ' ').replace(/\s+/g, ' ').trim();
    const letters = (line.match(/\p{L}/gu) || []).length;
    if (letters < 3 || line.length > 40 || letters / line.length < 0.6) continue;
    if ((line.match(/\d/g) || []).length >= 2) continue;          // numeros de calle, CP, telefonos
    const clean = line.replace(LEGAL, '').trim();
    if (clean.length < 3) continue;
    return clean.toLowerCase().replace(/(^|[\s\-'])\p{L}/gu, (c) => c.toUpperCase());
  }
  return '';
}

const RULES = [
  { re: /mercadona|carrefour|lidl|\bdia\b|alcampo|eroski|consum|aldi|supermerc|hipercor|bonpreu|ahorramas|caprabo|condis|froiz|gadis/, names: ['Súper', 'Supermercado', 'Alimentación', 'Comida'] },
  { re: /repsol|cepsa|galp|shell|\bbp\b|gasolinera|diesel|gasoleo|gasolina|estacion de servicio|ballenoil|plenergy/, names: ['Transporte', 'Gasolina', 'Coche'] },
  { re: /farmacia|parafarmacia|optica|clinica|dentista|medic/, names: ['Salud', 'Farmacia'] },
  { re: /restaurante|cafeteria|cerveceria|taberna|pizzer|burger|mcdonald|telepizza|kebab|bocadill|\bbar\b|tapas|sushi|heladeria|panaderia|starbucks|foster|vips|glovo|just eat/, names: ['Comida fuera', 'Restaurantes', 'Ocio', 'Comida'] },
  { re: /zara|h&m|primark|decathlon|pull\s?&?\s?bear|bershka|mango|ropa|calzado|el corte ingles/, names: ['Personal', 'Ropa', 'Compras'] },
  { re: /cine|teatro|entradas|ticketmaster|concierto|museo|parque/, names: ['Ocio'] },
  { re: /ikea|leroy|bricomart|bauhaus|brico|ferreteria|bazar/, names: ['Casa', 'Hogar'] },
  { re: /hotel|hostal|booking|airbnb|vueling|ryanair|renfe|aeropuerto|peaje|autopista/, names: ['Viajes', 'Transporte', 'Ocio'] },
];

/** Categoria probable entre las `available` (comparacion sin tildes ni mayusculas); '' si no hay pista. */
export function guessCategory(text, available = []) {
  const t = norm(text);
  const byNorm = new Map(available.map((a) => [norm(a), a]));
  for (const r of RULES) {
    if (!r.re.test(t)) continue;
    for (const n of r.names) if (byNorm.has(norm(n))) return byNorm.get(norm(n));
  }
  return '';
}

export function parseTicket(text, { categories = [], today = new Date() } = {}) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const a = findAmount(lines);
  const place = findPlace(lines);
  return {
    amount: a.value, amountSure: a.sure, date: findDate(String(text), today), place,
    category: guessCategory(`${place} ${lines.slice(0, 6).join(' ')}`, categories),
    empty: a.value === null && !place,
  };
}
