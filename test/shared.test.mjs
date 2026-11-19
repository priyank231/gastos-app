import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, balance, periodRange, periodStats, periodEntries, mergeEntries, makeExport, validateExport,
  applyImport, validateShared, sharedCSV, knownPlaces, normEntry, partnerOf } from '../shared.js';

function setup() {
  const s = createGroup('Priyank', 'Ella');
  return { s, me: s.meId, her: partnerOf(s).id };
}
let n = 0;
const entry = (s, over) => ({ id: `e${++n}`, date: '2026-11-18', amount: 40, place: 'Mercadona', category: 'Súper', note: '',
  payerId: s.meId, payerPct: 50, settle: false, photoId: '', updated: 1000 + n, deleted: false, ...over });

test('saldo: quien paga 50/50 es acreedor de la mitad; liquidar lo deja a cero', () => {
  const { s, me, her } = setup();
  s.entries = [entry(s, { amount: 40, payerId: me }),                // ella me debe 20
    entry(s, { amount: 30, payerId: her })];                         // yo le debo 15
  assert.equal(balance(s), 5);
  s.entries.push(entry(s, { amount: 5, payerId: her, payerPct: 0, settle: true }));   // ella me paga 5
  assert.equal(balance(s), 0);
  s.entries.push(entry(s, { amount: 60, payerId: me, payerPct: 0 }));                // gasto 100% de ella
  assert.equal(balance(s), 60);
  s.entries.push(entry(s, { amount: 10, payerId: me, payerPct: 100 }));              // gasto solo mio: no genera deuda
  assert.equal(balance(s), 60);
});

test('saldo: cada gasto se redondea al centimo y ambos moviles ven lo mismo con signo contrario', () => {
  const { s, me } = setup();
  s.entries = Array.from({ length: 3 }, () => entry(s, { amount: 0.01, payerId: me }));
  assert.equal(balance(s), 0.03);                                   // media peseta redondea hacia arriba por apunte
  const other = { ...s, meId: partnerOf(s).id };
  assert.equal(balance(other), -balance(s));
  s.entries = [entry(s, { amount: 10.01, payerId: me })];           // 5,005 -> 5,01
  assert.equal(balance(s), 5.01);
});

test('saldo ignora borrados (tombstones)', () => {
  const { s, me } = setup();
  s.entries = [entry(s, { amount: 100, payerId: me }), entry(s, { amount: 100, payerId: me, deleted: true })];
  assert.equal(balance(s), 50);
});

test('periodRange: semana lunes-domingo, mes y todo', () => {
  assert.deepEqual(periodRange('week', new Date(2026, 10, 19)), { from: '2026-11-16', to: '2026-11-22' });   // jueves
  assert.deepEqual(periodRange('week', new Date(2026, 10, 22)), { from: '2026-11-16', to: '2026-11-22' });   // domingo
  assert.deepEqual(periodRange('week', new Date(2026, 10, 23)), { from: '2026-11-23', to: '2026-11-29' });   // lunes
  assert.deepEqual(periodRange('month', new Date(2026, 1, 10)), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(periodRange('all'), null);
});

test('periodStats: total, quien pago y mi parte (sin liquidaciones)', () => {
  const { s, me, her } = setup();
  s.entries = [entry(s, { amount: 40, payerId: me }), entry(s, { amount: 30, payerId: her }),
    entry(s, { amount: 5, payerId: her, payerPct: 0, settle: true }),
    entry(s, { amount: 99, date: '2026-10-01', payerId: me })];
  const st = periodStats(s, periodRange('month', new Date(2026, 10, 18)));
  assert.deepEqual([st.count, st.total, st.paidMe, st.paidPartner, st.myShare, st.partnerShare], [2, 70, 40, 30, 35, 35]);
  assert.equal(periodEntries(s, null).length, 4);
});

test('mergeEntries: idempotente, gana la edicion mas reciente, propaga borrados', () => {
  const { s, me } = setup();
  const a = entry(s, { id: 'x', amount: 10, updated: 100, payerId: me });
  const local = [a];
  const same = mergeEntries(local, [a]);
  assert.deepEqual([same.added, same.updated, same.skipped], [0, 0, 1]);
  const newer = mergeEntries(local, [{ ...a, amount: 12, updated: 200 }]);
  assert.equal(newer.entries[0].amount, 12);
  const older = mergeEntries(newer.entries, [{ ...a, amount: 99, updated: 150 }]);
  assert.equal(older.entries[0].amount, 12);
  const del = mergeEntries(newer.entries, [{ ...a, amount: 12, updated: 300, deleted: true }]);
  assert.equal(del.entries[0].deleted, true);
  const added = mergeEntries(local, [entry(s, { id: 'y' })]);
  assert.equal(added.entries.length, 2);
});

test('flujo de dos moviles: A crea, B se une con el archivo, B anade, A fusiona', () => {
  const { s: A } = setup();
  A.entries = [entry(A, { id: 'a1', amount: 50, payerId: A.meId })];
  const fileA = JSON.parse(JSON.stringify(makeExport(A, null)));            // viaja como JSON
  const expA = validateExport(fileA);
  // B es un movil nuevo sin grupo
  const joined = applyImport(validateShared({}), expA);
  const B = joined.shared;
  assert.equal(joined.stats.joined, true);
  assert.equal(B.meId, partnerOf(A).id);                                    // B es "la otra persona"
  assert.equal(B.groupId, A.groupId);
  assert.equal(balance(B), -25);                                            // B le debe 25 a A
  // B apunta un gasto y se lo devuelve a A
  B.entries.push(entry(B, { id: 'b1', amount: 20, payerId: B.meId, updated: 5000 }));
  const back = applyImport(A, validateExport(JSON.parse(JSON.stringify(makeExport(B, null)))));
  assert.equal(back.stats.added, 1);
  assert.equal(back.stats.joined, false);
  assert.equal(balance(back.shared), 15);                                   // 25 - 10
  assert.equal(balance(B), -15);                                            // misma deuda vista desde el otro lado
  // reimportar no duplica
  const again = applyImport(back.shared, validateExport(JSON.parse(JSON.stringify(makeExport(B, null)))));
  assert.equal(again.shared.entries.length, 2);
});

test('applyImport rechaza otro grupo y archivos invalidos', () => {
  const { s: A } = setup();
  const { s: Z } = setup();
  const exp = validateExport(JSON.parse(JSON.stringify(makeExport(Z, null))));
  assert.throws(() => applyImport(A, exp), /otro grupo/);
  for (const bad of [null, {}, { app: 'otra' }, { app: 'gastos-compartido', groupId: 'g', members: [{ id: '1' }], entries: [] }]) {
    assert.throws(() => validateExport(bad), /No es un archivo/);
  }
  const dup = makeExport(A, null); dup.members = [dup.members[0], dup.members[0]];
  assert.throws(() => validateExport(dup), /No es un archivo/);
});

test('normEntry filtra basura y limita campos; las fotos solo si son imagenes', () => {
  const { s } = setup();
  const ids = s.members.map((m) => m.id);
  assert.equal(normEntry({ id: 'a', date: 'mal', amount: 5, payerId: ids[0] }, ids), null);
  assert.equal(normEntry({ id: 'a', date: '2026-11-01', amount: -5, payerId: ids[0] }, ids), null);
  assert.equal(normEntry({ id: 'a', date: '2026-11-01', amount: 5, payerId: 'extrano' }, ids), null);
  const e = normEntry({ id: 'a', date: '2026-11-01', amount: 5, payerId: ids[0], payerPct: 'x', place: 'p'.repeat(200) }, ids);
  assert.equal(e.payerPct, 50);
  assert.equal(e.place.length, 60);
  const exp = makeExport(s, null);
  exp.photos = { ok: 'data:image/jpeg;base64,AAAA', mal: 'javascript:alert(1)', otra: 'data:text/html;base64,AAAA' };
  assert.deepEqual(Object.keys(validateExport(exp).photos), ['ok']);
});

test('makeExport por semana incluye solo ese rango y sus fotos', () => {
  const { s } = setup();
  s.entries = [entry(s, { date: '2026-11-18', photoId: 'p1' }), entry(s, { date: '2026-10-01', photoId: 'p2' })];
  const exp = makeExport(s, periodRange('week', new Date(2026, 10, 19)), { p1: 'data:image/jpeg;base64,AA', p2: 'data:image/jpeg;base64,BB' });
  assert.equal(exp.entries.length, 1);
  assert.deepEqual(Object.keys(exp.photos), ['p1']);
});

test('sharedCSV con BOM, comillas escapadas y lugares frecuentes', () => {
  const { s, me } = setup();
  s.entries = [entry(s, { id: 'c1', place: 'Bar "El Sol"', amount: 12.5, payerId: me, note: 'cena' }),
    entry(s, { place: 'Mercadona' }), entry(s, { place: 'Mercadona' })];
  const csv = sharedCSV(s, s.entries);
  assert.ok(csv.startsWith('﻿fecha,local'));
  assert.ok(csv.includes('"Bar ""El Sol""","Súper","Priyank",12.50,50,gasto,"cena"'));
  assert.deepEqual(knownPlaces(s), ['Mercadona', 'Bar "El Sol"']);
});
