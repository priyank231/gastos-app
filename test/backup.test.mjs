import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, describeBackup, BACKUP_APP } from '../backup.js';
import { defaultData } from '../core.js';
import { createGroup, partnerOf } from '../shared.js';

function fixtures() {
  const d = defaultData();
  d.income = 2000;
  d.categories = [{ name: 'Ocio', budget: 100 }];
  d.expenses = [{ id: 'a', date: '2026-10-02', amount: 12, category: 'Ocio', concept: 'cine' }];
  d.investments = [{ id: 'i', date: '2026-10-03', amount: 40, concept: 'ETF' }];
  d.rules = [{ key: 'revolut', kind: 'invest', category: '' }];
  const s = createGroup('Priyank', 'Bea');
  s.entries = [{ id: 'e1', date: '2026-10-04', amount: 30, place: 'Bar', category: 'Ocio', note: '', payerId: s.meId, payerPct: 50, settle: false, photoId: 'ph1', updated: 5, deleted: false }];
  return { d, s };
}

test('copia completa: ida y vuelta por JSON conserva individual, compartido, fotos y ajustes', () => {
  const { d, s } = fixtures();
  const b = buildBackup({ individual: d, shared: s, photos: { ph1: 'data:image/jpeg;base64,AAAA' }, settings: { autoRead: false } });
  const back = parseBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(back.kind, 'completa');
  assert.deepEqual(back.individual.expenses, d.expenses);
  assert.deepEqual(back.individual.investments, d.investments);
  assert.deepEqual(back.individual.rules, d.rules);
  assert.equal(back.individual.income, 2000);
  assert.equal(back.shared.groupId, s.groupId);
  assert.equal(back.shared.meId, s.meId);                       // "yo" sigue siendo yo al cambiar de móvil
  assert.equal(partnerOf(back.shared).name, 'Bea');
  assert.equal(back.shared.entries[0].photoId, 'ph1');
  assert.deepEqual(Object.keys(back.photos), ['ph1']);
  assert.equal(back.settings.autoRead, false);
  assert.match(describeBackup(back), /1 gastos.*modo compartido: 1 movimientos.*1 fotos/);
});

test('copia completa sin grupo compartido y con datos vacíos', () => {
  const b = parseBackup(JSON.parse(JSON.stringify(buildBackup({ individual: defaultData(), shared: createGroup('', '') && { groupId: '' } }))));
  assert.equal(b.shared, null);
  assert.equal(b.individual.expenses.length, 0);
});

test('copia antigua (solo individual) se sigue pudiendo restaurar', () => {
  const { d } = fixtures();
  const b = parseBackup(JSON.parse(JSON.stringify(d)));
  assert.equal(b.kind, 'individual');
  assert.equal(b.individual.expenses.length, 1);
  assert.equal(b.shared, null);
});

test('copia: rechaza basura y filtra fotos que no son imágenes', () => {
  for (const bad of [null, 5, {}, { app: 'otra' }, { expenses: 'x' }]) assert.throws(() => parseBackup(bad), /no válido|No es una copia/i);
  const { d } = fixtures();
  const b = buildBackup({ individual: d, photos: { ok: 'data:image/png;base64,AA', mal: 'javascript:alert(1)', otra: 'data:text/html;base64,AA' } });
  assert.deepEqual(Object.keys(parseBackup(b).photos), ['ok']);
  assert.equal(b.app, BACKUP_APP);
});
