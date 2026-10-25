import test from 'node:test';
import assert from 'node:assert/strict';
import { filterUsers, normalize } from '../static/smart/src/admin/components/userFilter.js';

const users = [
  { accountId: '1', displayName: 'Jan Kowalski', emailAddress: 'jan.kowalski@firma.pl' },
  { accountId: '2', displayName: 'Anna Nowak', emailAddress: 'anna.nowak@firma.pl' },
  { accountId: '3', displayName: 'Łukasz Żółć', emailAddress: null },
  { accountId: '4', displayName: 'Maria Kowalska' }
];
const ids = (list) => list.map(u => u.accountId);

test('puste zapytanie zwraca wszystkich', () => {
  assert.deepEqual(ids(filterUsers(users, '')), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterUsers(users, '   ')), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterUsers(users, undefined)), ['1', '2', '3', '4']);
});

test('szukanie po nazwisku, bez względu na wielkość liter', () => {
  assert.deepEqual(ids(filterUsers(users, 'KOWAL')), ['1', '4']);
});

test('szukanie po fragmencie imienia i nazwiska w dowolnej kolejności', () => {
  assert.deepEqual(ids(filterUsers(users, 'jan kow')), ['1']);
  assert.deepEqual(ids(filterUsers(users, 'kowalski jan')), ['1']);
});

test('szukanie po adresie e-mail', () => {
  assert.deepEqual(ids(filterUsers(users, 'anna.nowak@')), ['2']);
  assert.deepEqual(ids(filterUsers(users, 'firma.pl')), ['1', '2']);
});

test('polskie znaki: "lukasz zolc" znajdzie "Łukasz Żółć" i odwrotnie', () => {
  assert.deepEqual(ids(filterUsers(users, 'lukasz zolc')), ['3']);
  assert.deepEqual(ids(filterUsers(users, 'ŁUKASZ')), ['3']);
  assert.equal(normalize('Żółć'), 'zolc');
});

test('brak wyników i brak pola e-mail nie powodują błędu', () => {
  assert.deepEqual(filterUsers(users, 'xyz'), []);
  assert.deepEqual(ids(filterUsers(users, 'maria')), ['4']);
});
