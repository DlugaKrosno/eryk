import test from 'node:test';
import assert from 'node:assert/strict';
import { planFieldImport, applyFieldImport } from '../static/smart/src/admin/components/domainImport.js';

const options = [
  { id: '1', name: 'Płatności' },
  { id: '2', name: 'Konta' },
  { id: '3', value: 'Logistyka' }
];

test('wszystkie opcje nowe: powstają domeny', () => {
  const plan = planFieldImport(options, []);
  assert.deepEqual(plan.toCreate.map(c => c.name), ['Płatności', 'Konta', 'Logistyka']);
  assert.equal(plan.toLink.length, 0);
  assert.equal(plan.unchanged, 0);
});

test('opcja już powiązana z domeną jest pomijana', () => {
  const plan = planFieldImport(options, [{ id: 'd1', name: 'Płatności', optionId: '1' }]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.toCreate.map(c => c.optionId), ['2', '3']);
});

test('domena o tej samej nazwie (bez powiązania) jest łączona, a nie dublowana', () => {
  const plan = planFieldImport(options, [{ id: 'd9', name: '  konta ' }]);
  assert.deepEqual(plan.toLink, [{ domainId: 'd9', optionId: '2', name: 'Konta' }]);
  assert.deepEqual(plan.toCreate.map(c => c.name), ['Płatności', 'Logistyka']);
});

test('duplikaty opcji i puste nazwy nie tworzą domen', () => {
  const plan = planFieldImport([{ id: '1', name: 'A' }, { id: '1', name: 'A' }, { id: '2', name: '  ' }], []);
  assert.equal(plan.toCreate.length, 1);
});

test('powtórny import nic nie zmienia (idempotentny)', () => {
  const first = applyFieldImport(planFieldImport(options, []), [], [], 100);
  const second = planFieldImport(options, first.domains);
  assert.equal(second.toCreate.length, 0);
  assert.equal(second.toLink.length, 0);
  assert.equal(second.unchanged, 3);
});

test('zastosowanie planu: nowe domeny dostają zespoły, istniejące są łączone, nic nie ginie', () => {
  const domains = [{ id: 'd9', name: 'Konta', teamId: 't9', enabled: true }];
  const teams = [{ id: 't9', name: 'Konta' }];
  const result = applyFieldImport(planFieldImport(options, domains), domains, teams, 500);
  assert.equal(result.domains.length, 3);
  assert.equal(result.domains.find(d => d.id === 'd9').optionId, '2');
  assert.equal(result.domains.find(d => d.id === 'd9').teamId, 't9');
  const created = result.domains.find(d => d.name === 'Płatności');
  assert.equal(result.teams.find(t => t.id === created.teamId).name, 'Płatności');
  assert.equal(result.teams.length, 3);
  assert.ok(result.teams.every(t => t.id));
});
