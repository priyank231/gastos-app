import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTicket, moneyIn, findAmount, findDate, findPlace, guessCategory } from '../ticket.js';

const today = new Date(2026, 10, 19);

test('moneyIn: formatos espanoles y ruido del OCR', () => {
  assert.deepEqual(moneyIn('TOTAL  42,50 EUR'), [42.5]);
  assert.deepEqual(moneyIn('1.234,56'), [1234.56]);
  assert.deepEqual(moneyIn('12 ,50'), [12.5]);
  assert.deepEqual(moneyIn('Ref 123456 caja 3'), []);
  assert.deepEqual(moneyIn('3,5 kg x 2,10'), [2.1]);
});

const MERCADONA = `MERCADONA, S.A.
A-46103834
C/ MAYOR 12  46001 VALENCIA
TELEFONO: 960 000 000
17/11/2026 18:42  OP: 123456
DESCRIPCION P. UNIT IMPORTE
1 LECHE ENTERA 0,89 0,89
2 PAN BARRA 0,60 1,20
1 AGUA 6X1,5L 2,25 2,25
TOTAL (EUR) 42,50
TARJETA BANCARIA 42,50
ENTREGADO 50,00
CAMBIO 7,50
IVA 10% BASE 38,64 CUOTA 3,86`;

test('parseTicket: supermercado completo', () => {
  const r = parseTicket(MERCADONA, { categories: ['Vivienda', 'Súper', 'Ocio'], today });
  assert.equal(r.amount, 42.5);
  assert.equal(r.amountSure, true);
  assert.equal(r.date, '2026-11-17');
  assert.equal(r.place, 'Mercadona');
  assert.equal(r.category, 'Súper');
});

test('importe: ignora subtotal, IVA, entregado y cambio', () => {
  const lines = ['SUBTOTAL 38,64', 'TOTAL IVA 3,86', 'TOTAL A PAGAR 42,50', 'ENTREGADO 100,00', 'CAMBIO 57,50'];
  assert.deepEqual(findAmount(lines), { value: 42.5, sure: true });
});

test('importe en la linea siguiente a TOTAL', () => {
  assert.deepEqual(findAmount(['Bar Pepe', 'TOTAL', '18,60 EUR']), { value: 18.6, sure: true });
});

test('sin palabra TOTAL: usa el pago con tarjeta y marca duda', () => {
  const r = findAmount(['Cafe 1,50', 'Tostada 2,40', 'VISA 3,90', 'CAMBIO 0,00']);
  assert.deepEqual(r, { value: 3.9, sure: false });
});

test('sin pista: el mayor importe, con duda; sin importes: null', () => {
  assert.deepEqual(findAmount(['x 1,00', 'y 7,25']), { value: 7.25, sure: false });
  assert.deepEqual(findAmount(['hola', 'mundo']), { value: null, sure: false });
});

test('fechas: varios formatos, anio de 2 cifras, descarta futuro y absurdos', () => {
  assert.equal(findDate('Fecha 05-11-26 12:30', today), '2026-11-05');
  assert.equal(findDate('2026/11/03', today), '2026-11-03');
  assert.equal(findDate('3.11.2026', today), '2026-11-03');
  assert.equal(findDate('31/12/2030', today), '');          // futuro
  assert.equal(findDate('40/13/2026', today), '');          // invalida
  assert.equal(findDate('sin fecha', today), '');
  assert.equal(findDate('99/99/9999 y luego 10/11/2026', today), '2026-11-10');
});

test('local: salta CIF, direccion y telefono; quita S.A./S.L.', () => {
  assert.equal(findPlace(['A-46103834', 'C/ MAYOR 12', 'BAR EL SOL, S.L.', 'TOTAL 5,00']), 'Bar El Sol');
  assert.equal(findPlace(['12345', '---', '987']), '');
  assert.equal(findPlace(['FACTURA SIMPLIFICADA', 'LIDL SUPERMERCADOS S.A.U.']), 'Lidl Supermercados');
});

test('categoria: respeta las categorias disponibles y no inventa', () => {
  assert.equal(guessCategory('REPSOL ESTACION', ['Transporte', 'Ocio']), 'Transporte');
  assert.equal(guessCategory('REPSOL ESTACION', ['Ocio']), '');
  assert.equal(guessCategory('Farmacia Lopez', ['salud']), 'salud');
  assert.equal(guessCategory('Restaurante La Casa', ['Comida fuera', 'Ocio']), 'Comida fuera');
  assert.equal(guessCategory('Tienda cualquiera', ['Ocio']), '');
});

test('ticket vacio o ilegible no revienta', () => {
  const r = parseTicket('', { today });
  assert.equal(r.empty, true);
  assert.equal(r.amount, null);
  assert.equal(parseTicket('@@## ??', { today }).empty, true);
});
