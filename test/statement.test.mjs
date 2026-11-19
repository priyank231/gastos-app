import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEuro, parseEuroLoose, reconstructRows, toMovements, checkBalances, classify, merchantKey, categoryFor, fingerprint, isDuplicate } from '../statement.js';

// ---- Extracto INVENTADO con la maquetación real de un extracto de Trade Republic girado y enderezado ----
// Importes de entrada/salida alineados a la izquierda (bajo su cabecera), saldo alineado a la derecha.
const X = { fecha: 194, tipo: 259, desc: 382, entrada: 1074, salida: 1161, balance: 1287, balanceR: 1350 };
const w = (text, x0, y0, h = 13, width = text.length * 9) => ({ text, x0, x1: x0 + width, y0, y1: y0 + h });
function header(y = 400) {
  return [w('FECHA', X.fecha, y + 8, 12, 45), w('TIPO', X.tipo, y + 8, 12, 31), w('DESCRIPCIÓN', X.desc, y + 5, 13, 92),
    w('ENTRADA', X.entrada, y, 12, 64), w('DE', X.entrada, y + 15, 12, 18), w('DINERO', X.entrada + 18, y + 15, 12, 50),
    w('SALIDA', X.salida, y, 12, 49), w('DE', X.salida + 53, y, 12, 17), w('DINERO', X.salida, y + 15, 12, 51), w('BALANCE', X.balance, y + 8, 12, 63)];
}
const MON = { 1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr', 5: 'may', 6: 'jun', 7: 'jul', 8: 'ago', 9: 'sep', 10: 'oct', 11: 'nov', 12: 'dic' };
const fmt = (n) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function rowWords(r, y) {
  const [Y, M, D] = r.date.split('-').map(Number);
  // día (alto 13) POR ENCIMA del mes (alto 9, más bajo): el mes empieza 23 px más abajo que el día
  const out = [w(String(D).padStart(2, '0'), X.fecha, y), w(MON[M], X.fecha, y + 23, 9, 26), w(String(Y), X.fecha, y + 39)];
  if (r.type === 'card') out.push(w('Transacción', X.tipo, y + 12), w('con', X.tipo, y + 29, 13, 27), w('tarjeta', X.tipo + 30, y + 29));
  else out.push(w(r.type, X.tipo, y + 12));
  r.desc.split('|').forEach((ln, i) => ln.split(' ').reduce((x, tk) => { out.push(w(tk, x, y + 12 + i * 17)); return x + tk.length * 9 + 8; }, X.desc));
  const num = (v, x0, right) => {
    const t = fmt(v);
    if (right) out.push(w(t, right - t.length * 9 - 14, y + 12), w('€', right - 11, y + 12, 13, 11)); else out.push(w(`${t}€`, x0, y + 12, 13, (t.length + 1) * 9));
  };
  if (r.in != null) num(r.in, X.entrada);
  if (r.out != null) num(r.out, X.salida);
  if (r.balance != null) num(r.balance, 0, X.balanceR);
  return out;
}
function page(rows, extra = []) {
  const out = [...header(), ...extra];
  rows.forEach((r, i) => out.push(...rowWords(r, 455 + i * 102)));
  out.push(w('Trade', 190, 1974, 12, 45), w('Republic', 238, 1974, 15, 70), w('Página', 1255, 2104, 12, 48));   // pie: no es una fila
  return out;
}

const ROWS = [
  { date: '2026-03-02', type: 'Operar', desc: 'Savings plan execution US0000000001 EXAMPLE INC., quantity: 0.1', out: 30, balance: 1970 },
  { date: '2026-03-03', type: 'card', desc: 'MERCADONA CENTRO', out: 12.34, balance: 1957.66 },
  { date: '2026-03-04', type: 'card', desc: 'BAR EL EJEMPLO', out: 21, balance: 1936.66 },
  { date: '2026-03-05', type: 'card', desc: 'Revolut**0000*', out: 40, balance: 1896.66 },
  { date: '2026-03-06', type: 'Operar', desc: 'Buy trade US0000000002 OTRA INC.|DL-,001, quantity: 6.62', out: 1001.13, balance: 895.53 },
  { date: '2026-03-07', type: 'Transferencia', desc: 'Incoming transfer from BEATRIZ EJEMPLO|(ES0000000000000000000000)', in: 300, balance: 1195.53 },
  { date: '2026-03-08', type: 'Rentabilidad', desc: 'Cash Dividend for ISIN US0000000001', in: 0.02, balance: 1195.55 },
  { date: '2026-03-09', type: 'Transferencia', desc: 'Outgoing transfer for NOMBRE TITULAR|(ES0000000000000000000000)', out: 200, balance: 995.55 },
];

test('parseEuro y parseEuroLoose: formatos del extracto y fallos típicos del OCR', () => {
  assert.equal(parseEuro('1.001,13 €'), 1001.13);
  assert.equal(parseEuro('6.680,79'), 6680.79);
  assert.equal(parseEuro('30,00€'), 30);
  assert.equal(parseEuro('Savings'), null);
  assert.equal(parseEuro('2026'), null);
  assert.deepEqual(parseEuroLoose('750€'), { value: 7.5, loose: true });      // se perdió la coma
  assert.deepEqual(parseEuroLoose('02€'), { value: 0.02, loose: true });
  assert.deepEqual(parseEuroLoose('7,50€'), { value: 7.5, loose: false });
  assert.equal(parseEuroLoose('750'), null);                                  // sin € no se arriesga
  assert.equal(parseEuroLoose('.326,91€'), null);
});

test('reconstructRows: cada fila recibe SU fecha (el día va encima del mes)', () => {
  // fechas todas distintas: si el día se asignara a la fila vecina, aquí se vería
  const rows = reconstructRows(page(ROWS));
  assert.equal(rows.length, ROWS.length);
  assert.deepEqual(rows.map((r) => r.date), ROWS.map((r) => r.date));
});

test('reconstructRows: tipo, descripción, entrada/salida y saldo', () => {
  const rows = reconstructRows(page(ROWS));
  assert.deepEqual({ ...rows[1], loose: undefined }, { date: '2026-03-03', type: 'Transacción con tarjeta', desc: 'MERCADONA CENTRO', in: null, out: 12.34, balance: 1957.66, loose: undefined });
  assert.equal(rows[0].type, 'Operar');
  assert.equal(rows[4].desc, 'Buy trade US0000000002 OTRA INC. DL-,001, quantity: 6.62');   // descripción de dos líneas
  assert.deepEqual([rows[4].out, rows[4].balance], [1001.13, 895.53]);
  assert.deepEqual([rows[5].in, rows[5].out, rows[5].balance], [300, null, 1195.53]);        // entrada
  assert.deepEqual([rows[6].in, rows[6].balance], [0.02, 1195.55]);
});

test('reconstructRows: una frase "a 18 nov 2026" (resumen del pie) no es una fila', () => {
  const noise = [w('a', 192, 776, 9, 9), w('18', 206, 774, 11, 18), w('nov', 230, 766, 28, 40), w('2026', 262, 774, 11, 36)];
  assert.equal(reconstructRows(page(ROWS, noise)).length, ROWS.length);
});

test('reconstructRows: página sin cabecera o sin filas no revienta', () => {
  assert.deepEqual(reconstructRows([]), []);
  assert.deepEqual(reconstructRows([w('Hola', 10, 10)]), []);
  assert.deepEqual(reconstructRows(header()), []);
});

test('cadena de saldos: lo leído bien cuadra', () => {
  const mvs = toMovements(reconstructRows(page(ROWS)));
  assert.deepEqual(checkBalances(mvs), { bad: 0, inferred: 0 });
  assert.equal(mvs[3].amount, -40);
  assert.equal(mvs[5].amount, 300);
});

test('reparación: importe sin coma ("750 €") se acepta solo si el saldo lo confirma', () => {
  const words = page(ROWS).map((t) => (t.text === '12,34€' ? { ...t, text: '1234€' } : t));
  const mvs = toMovements(reconstructRows(words));
  assert.equal(mvs[1].amount, -12.34);
  assert.deepEqual(checkBalances(mvs), { bad: 0, inferred: 0 });
  const wrong = page(ROWS).map((t) => (t.text === '12,34€' ? { ...t, text: '1235€' } : t));      // 12,35: el saldo no lo confirma
  const m2 = toMovements(reconstructRows(wrong));
  assert.equal(checkBalances(m2).bad, 1);
  assert.equal(m2[1].ok, false);
});

test('reparación: saldo ilegible se calcula; importe ilegible se deduce del saldo', () => {
  const noBalance = page(ROWS).filter((t) => !['1.957,66', '1.957,66€'].includes(t.text) && !(t.text === '€' && Math.abs(t.y0 - 467 - 102) < 2 && t.x0 > 1280));
  const sansBal = toMovements(reconstructRows(noBalance.map((t) => (t.text === '1.957,66' ? { ...t, text: '.957,66' } : t))));
  const r1 = checkBalances(sansBal);
  assert.equal(r1.bad, 0);
  assert.equal(sansBal[1].balance, 1957.66);
  assert.equal(sansBal[1].inferred, true);
  const noAmount = page(ROWS).filter((t) => t.text !== '21,00€');                // se pierde el importe de la fila 3
  const mv = toMovements(reconstructRows(noAmount));
  assert.equal(mv[2].amount, null);
  const r2 = checkBalances(mv);
  assert.equal(r2.bad, 0);
  assert.equal(mv[2].amount, -21);
  assert.equal(mv[2].inferred, true);
});

test('reparación: signo cambiado se corrige con el saldo; un importe mal leído queda marcado', () => {
  const rows = reconstructRows(page(ROWS));
  rows[5].out = rows[5].in; rows[5].in = null;                                   // entrada leída como salida
  const m = toMovements(rows);
  assert.equal(checkBalances(m).bad, 0);
  assert.equal(m[5].amount, 300);
  const bad = toMovements(reconstructRows(page(ROWS)));
  bad[2].amount = -27;                                                            // OCR leyó 27 en vez de 21
  const r = checkBalances(bad);
  assert.equal(r.bad, 1);
  assert.equal(bad[2].ok, false);
  assert.match(bad[2].problem, /no cuadra/);
  assert.equal(bad[3].ok, true);                                                  // la cadena sigue con el saldo siguiente
});

test('fecha ilegible o fila sin nada se marcan sin romper', () => {
  const mvs = toMovements(reconstructRows(page(ROWS)));
  mvs[1].date = ''; mvs[4].amount = null; mvs[4].balance = null;
  assert.equal(checkBalances(mvs).bad, 2);
});

const CATS = ['Vivienda', 'Alimentación', 'Transporte', 'Ocio', 'Personal', 'Otros'];
const ctx = { categories: CATS, partnerName: 'Bea', rules: [] };

test('clasificación por defecto de cada tipo de movimiento', () => {
  const mvs = toMovements(reconstructRows(page(ROWS)));
  checkBalances(mvs);
  const k = (i) => classify(mvs[i], ctx);
  assert.equal(k(0).kind, 'invest');
  assert.deepEqual([k(1).kind, k(1).category], ['expense', 'Alimentación']);
  assert.deepEqual([k(2).kind, k(2).category], ['expense', 'Ocio']);
  assert.equal(k(3).kind, 'invest');                              // Revolut -> inversión (decisión del usuario)
  assert.equal(k(3).sure, false);                                 // pero se marca como dudoso para revisar
  assert.equal(k(4).kind, 'invest');
  assert.equal(k(5).kind, 'partner');                             // "Beatriz" encaja con "Bea"
  assert.equal(k(6).kind, 'income');                              // dividendo
  assert.equal(k(7).kind, 'ignore');                              // traspaso entre cuentas propias
});

test('transferencia recibida de otra persona o sin pareja configurada = ingreso', () => {
  const mv = { desc: 'Incoming transfer from JUAN PEREZ (ES00)', type: 'Transferencia', amount: 50 };
  assert.equal(classify(mv, ctx).kind, 'income');
  assert.equal(classify({ ...mv, desc: 'Incoming transfer from BEATRIZ X (ES00)' }, { categories: CATS, partnerName: '', rules: [] }).kind, 'income');
});

test('reglas aprendidas mandan sobre las de fábrica (Revolut como gasto)', () => {
  const mv = { desc: 'Revolut**0000*', type: 'Transacción con tarjeta', amount: -40 };
  const learned = [{ key: merchantKey(mv.desc), kind: 'expense', category: 'Otros' }];
  const r = classify(mv, { ...ctx, rules: learned });
  assert.deepEqual([r.kind, r.category, r.sure], ['expense', 'Otros', true]);
});

test('merchantKey y categoryFor con las categorías del usuario', () => {
  assert.equal(merchantKey('MERCADONA NOVENES'), 'mercadona');
  assert.equal(merchantKey('EL CORTE INGLES PINTOR SO'), 'el corte');
  assert.equal(merchantKey('Revolut**0607*'), 'revolut');
  assert.equal(categoryFor('BENZINA CARBURANTES', CATS), 'Transporte');
  assert.equal(categoryFor('ESTANCO 22 VALENCIA', CATS), 'Personal');
  assert.equal(categoryFor('TM *TICKETMASTER, 150,00 $', CATS), 'Ocio');
  assert.equal(categoryFor('COMERCIO RARO', CATS), '');
  assert.equal(categoryFor('BENZINA CARBURANTES', ['Casa']), '');   // no inventa categorías que no existen
});

test('duplicados: por huella y por mismo día e importe', () => {
  const mv = { date: '2026-03-03', desc: 'MERCADONA CENTRO', amount: -12.34 };
  assert.equal(isDuplicate(mv, { imported: new Set([fingerprint(mv)]) }), 'ya importado antes');
  assert.match(isDuplicate(mv, { existing: [{ date: '2026-03-03', amount: 12.34 }] }), /igual/);
  assert.equal(isDuplicate(mv, { existing: [{ date: '2026-03-04', amount: 12.34 }] }), '');
  assert.equal(isDuplicate(mv, {}), '');
});
