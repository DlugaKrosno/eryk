import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport, TRANSFERABLE_KEYS } from '../static/smart/src/admin/components/configImport.js';

const valid = {
  domains: [{ id: 'domain-1', name: 'Płatności', teamId: 't1' }],
  escalationTeams: [{ id: 't1', name: 'Płatności' }],
  teamSchedule: [{ teamId: 't1', startDate: '2026-10-19', endDate: '2026-10-25' }]
};

test('poprawna konfiguracja przechodzi walidację', () => {
  assert.deepEqual(validateImport(valid), []);
});

test('pusty obiekt jest poprawny (import częściowy)', () => {
  assert.deepEqual(validateImport({}), []);
});

test('nie-obiekt jest odrzucany', () => {
  assert.equal(validateImport(null).length, 1);
  assert.equal(validateImport([]).length, 1);
  assert.equal(validateImport('tekst').length, 1);
});

test('domena wskazująca nieistniejący zespół jest odrzucana', () => {
  const errors = validateImport({ ...valid, escalationTeams: [{ id: 'inny', name: 'Inny' }] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nieistniejący zespół/);
});

test('brakujące pola wpisów są zgłaszane z indeksem', () => {
  const errors = validateImport({ teamSchedule: [{ teamId: 't1', startDate: '2026-10-19' }] });
  assert.deepEqual(errors, ['teamSchedule[0]: brak pola "endDate"']);
});

test('pole, które ma być listą, a nie jest', () => {
  assert.deepEqual(validateImport({ domains: 'x' }), ['"domains" musi być listą']);
});

test('domena domyślna musi istnieć', () => {
  assert.equal(validateImport({ ...valid, defaultDomainId: 'domain-1' }).length, 0);
  assert.equal(validateImport({ ...valid, defaultDomainId: 'brak' }).length, 1);
});

test('webhooki i dyżury są przenoszone, a sekrety środowiska (projectKey) nie', () => {
  assert.ok(TRANSFERABLE_KEYS.includes('escalationTeams'));
  assert.ok(TRANSFERABLE_KEYS.includes('teamSchedule'));
  assert.ok(!TRANSFERABLE_KEYS.includes('projectKey'));
});
