import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDutyEntry, resolveDomainTeam, domainIdFromLabels, collectWatchers,
  redactTeamSecrets, extractMetricValues, parseScheduleDate
} from '../src/routing.js';

const teams = [
  { id: 't1', name: 'Płatności', teamLeaders: ['lead1'], productOwners: ['po1'] },
  { id: 't2', name: 'Konta' }
];
const domains = [
  { id: 'domain-1', name: 'Płatności', teamId: 't1', enabled: true },
  { id: 'domain-2', name: 'Konta', teamId: 't2' },
  { id: 'domain-3', name: 'Wyłączona', teamId: 't1', enabled: false },
  { id: 'domain-4', name: 'Sierota', teamId: 'brak-takiego' }
];

test('domena trafia do swojego zespołu', () => {
  const { domain, team } = resolveDomainTeam({ domains, teams }, 'domain-1');
  assert.equal(domain.name, 'Płatności');
  assert.equal(team.id, 't1');
});

test('wyłączona lub nieznana domena nie routuje', () => {
  assert.equal(resolveDomainTeam({ domains, teams }, 'domain-3').team, null);
  assert.equal(resolveDomainTeam({ domains, teams }, 'nieistnieje').domain, null);
});

test('domena wskazująca nieistniejący zespół zwraca domenę bez zespołu', () => {
  const { domain, team } = resolveDomainTeam({ domains, teams }, 'domain-4');
  assert.equal(domain.id, 'domain-4');
  assert.equal(team, null);
});

test('brak konfiguracji nie powoduje wyjątku', () => {
  assert.deepEqual(resolveDomainTeam({}, 'domain-1'), { domain: null, team: null });
});

const schedule = [
  { teamId: 't1', startDate: '2026-10-19', endDate: '2026-10-30', assignedPerson: 'anna' },
  { teamId: 't2', startDate: '2026-10-19', endDate: '2026-10-25', assignedPerson: 'jan' }
];

test('dyżur jest szukany w harmonogramie właściwego zespołu', () => {
  const now = new Date('2026-10-22T12:00:00');
  assert.equal(findDutyEntry(schedule, 't1', now).assignedPerson, 'anna');
  assert.equal(findDutyEntry(schedule, 't2', now).assignedPerson, 'jan');
});

test('ostatni dzień dyżuru obejmuje cały dzień', () => {
  assert.equal(findDutyEntry(schedule, 't2', new Date('2026-10-25T22:30:00')).assignedPerson, 'jan');
  assert.equal(findDutyEntry(schedule, 't2', new Date('2026-10-26T00:30:00')), null);
});

test('dyżury różnych zespołów nie mieszają się', () => {
  assert.equal(findDutyEntry(schedule, 't2', new Date('2026-10-28T12:00:00')), null);
  assert.equal(findDutyEntry(schedule, 't1', new Date('2026-10-28T12:00:00')).assignedPerson, 'anna');
});

test('wpisy bez dat są ignorowane, a zły harmonogram nie wywala funkcji', () => {
  assert.equal(findDutyEntry([{ teamId: 't1' }], 't1', new Date()), null);
  assert.equal(findDutyEntry(undefined, 't1', new Date()), null);
  assert.equal(parseScheduleDate('nie-data', false), null);
});

test('domena jest odczytywana z labelu alertu', () => {
  assert.equal(domainIdFromLabels(['inny', 'domain-123']), 'domain-123');
  assert.equal(domainIdFromLabels(['inny']), null);
  assert.equal(domainIdFromLabels(undefined), null);
});

test('obserwatorzy: leaderzy i PO zespołu bez duplikatów', () => {
  const watchers = collectWatchers(
    { teamLeaders: ['a', 'b'], productOwners: ['b', 'c'] },
    { productOwners: ['c', 'd'] }
  );
  assert.deepEqual(watchers.sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(collectWatchers(null, null), []);
});

test('webhooki są ukrywane przed zwykłym użytkownikiem', () => {
  const safe = redactTeamSecrets({
    escalationTeams: [{ id: 't1', teamsWebhookUrl: 'https://tajny', dutyDmWorkflowUrl: '' }]
  });
  const team = safe.escalationTeams[0];
  assert.equal(team.teamsWebhookUrl, undefined);
  assert.equal(team.dutyDmWorkflowUrl, undefined);
  assert.equal(team.hasWebhook, true);
  assert.equal(team.hasDutyDm, false);
  assert.equal(JSON.stringify(safe).includes('tajny'), false);
});

const ctx = { domains, teams, defaultDomainId: 'domain-2' };

test('metryki: zgłaszający grupowani po koncie', () => {
  const issue = { fields: { reporter: { accountId: 'acc1', displayName: 'Anna' } } };
  assert.deepEqual(extractMetricValues(issue, 'reporter', ctx), [{ key: 'acc1', label: 'Anna' }]);
});

test('metryki: alert bez labelu trafia do domeny domyślnej', () => {
  const issue = { fields: { labels: [] } };
  assert.equal(extractMetricValues(issue, 'domain', ctx)[0].label, 'Konta');
  assert.equal(extractMetricValues(issue, 'team', ctx)[0].label, 'Konta');
});

test('metryki: bez labelu i bez domeny domyślnej to "Bez domeny"', () => {
  const issue = { fields: { labels: [] } };
  assert.equal(extractMetricValues(issue, 'domain', { domains, teams })[0].label, 'Bez domeny');
});

test('metryki: pole wielokrotnego wyboru liczy alert w każdej wartości', () => {
  const issue = { fields: { customfield_1: [{ value: 'A' }, { value: 'B' }] } };
  const values = extractMetricValues(issue, 'customfield_1', ctx);
  assert.deepEqual(values.map(v => v.label), ['A', 'B']);
});

test('metryki: puste pole to "Brak wartości"', () => {
  const issue = { fields: { customfield_1: [] } };
  assert.equal(extractMetricValues(issue, 'customfield_1', ctx)[0].label, 'Brak wartości');
});

// --- harmonogram: uprawnienia, walidacja, scalanie ---
import { editableTeamIds, validateSchedule, mergeSchedule } from '../src/routing.js';

const scheduleTeams = [
  { id: 't1', name: 'Płatności', teamLeaders: ['lead1'], delegates: ['anna', 'jan'] },
  { id: 't2', name: 'Konta', teamLeaders: ['lead2'], delegates: ['ola'] },
  { id: 't3', name: 'Bez delegatów', teamLeaders: ['lead1'] }
];

test('administrator edytuje wszystkie zespoły, leader tylko swoje, inni nic', () => {
  assert.deepEqual(editableTeamIds({ isAdmin: true, teams: scheduleTeams, accountId: 'x' }), ['t1', 't2', 't3']);
  assert.deepEqual(editableTeamIds({ isAdmin: false, teams: scheduleTeams, accountId: 'lead1' }), ['t1', 't3']);
  assert.deepEqual(editableTeamIds({ isAdmin: false, teams: scheduleTeams, accountId: 'anna' }), []);
  assert.deepEqual(editableTeamIds({ isAdmin: false, teams: scheduleTeams, accountId: undefined }), []);
});

const shift = (o) => ({ teamId: 't1', startDate: '2026-10-19', endDate: '2026-10-25', assignedPerson: 'anna', ...o });

test('poprawny harmonogram przechodzi walidację', () => {
  assert.deepEqual(validateSchedule([shift({}), shift({ startDate: '2026-10-26', endDate: '2026-11-01', assignedPerson: 'jan' })], scheduleTeams), []);
});

test('dyżurny spoza delegatów zespołu jest odrzucany', () => {
  assert.equal(validateSchedule([shift({ assignedPerson: 'ola' })], scheduleTeams).length, 1);
});

test('zespół bez delegatów nie przyjmie dyżuru', () => {
  assert.equal(validateSchedule([shift({ teamId: 't3' })], scheduleTeams).length, 1);
});

test('nakładające się dyżury tego samego zespołu są odrzucane, różnych zespołów nie', () => {
  const overlapSame = validateSchedule([shift({}), shift({ startDate: '2026-10-25', endDate: '2026-10-31', assignedPerson: 'jan' })], scheduleTeams);
  assert.equal(overlapSame.length, 1);
  const overlapOther = validateSchedule([shift({}), shift({ teamId: 't2', assignedPerson: 'ola' })], scheduleTeams);
  assert.deepEqual(overlapOther, []);
});

test('zła data, koniec przed początkiem i nieznany zespół', () => {
  assert.equal(validateSchedule([shift({ startDate: '19.10.2026' })], scheduleTeams).length, 1);
  assert.equal(validateSchedule([shift({ endDate: '2026-10-01' })], scheduleTeams).length, 1);
  assert.equal(validateSchedule([shift({ teamId: 'nieistnieje' })], scheduleTeams).length, 1);
});

test('scalanie nie pozwala zmienić wpisów cudzych zespołów', () => {
  const existing = [shift({ teamId: 't1', id: 'a' }), shift({ teamId: 't2', id: 'b', assignedPerson: 'ola' })];
  const submitted = [shift({ teamId: 't1', id: 'a2', assignedPerson: 'jan' }), shift({ teamId: 't2', id: 'hack', assignedPerson: 'ola' })];
  const merged = mergeSchedule(existing, submitted, ['t1']);
  assert.deepEqual(merged.map(e => e.id).sort(), ['a2', 'b']);
});

test('scalanie: leader może też usunąć wszystkie dyżury swojego zespołu', () => {
  const existing = [shift({ teamId: 't1', id: 'a' }), shift({ teamId: 't2', id: 'b', assignedPerson: 'ola' })];
  assert.deepEqual(mergeSchedule(existing, [], ['t1']).map(e => e.id), ['b']);
});

// --- domena z pola Jira ---
import { domainIdFromField, pickDomainId } from '../src/routing.js';

const fieldDomains = [
  { id: 'domain-1', name: 'Płatności', optionId: '10001' },
  { id: 'domain-2', name: 'Konta', optionId: 10002 },
  { id: 'domain-3', name: 'Bez pola' }
];

test('pole Jira: opcja wskazuje domenę (id jako tekst lub liczba)', () => {
  assert.equal(domainIdFromField({ id: '10001', value: 'Płatności' }, fieldDomains), 'domain-1');
  assert.equal(domainIdFromField({ id: '10002' }, fieldDomains), 'domain-2');
  assert.equal(domainIdFromField('10001', fieldDomains), 'domain-1');
});

test('pole Jira: pusta, nieznana lub brak powiązania', () => {
  assert.equal(domainIdFromField(null, fieldDomains), null);
  assert.equal(domainIdFromField({ id: '99999' }, fieldDomains), null);
  assert.equal(domainIdFromField({ value: 'bez id' }, fieldDomains), null);
  assert.equal(domainIdFromField({ id: undefined }, []), null);
});

test('kolejność wyboru domeny: pole > label > zapis > domyślna', () => {
  const base = { domains: fieldDomains };
  assert.equal(pickDomainId({ ...base, fieldValue: { id: '10001' }, labels: ['domain-2'], stored: 'domain-3', fallback: 'domain-3' }), 'domain-1');
  assert.equal(pickDomainId({ ...base, fieldValue: null, labels: ['domain-2'], stored: 'domain-3', fallback: 'x' }), 'domain-2');
  assert.equal(pickDomainId({ ...base, labels: [], stored: 'domain-3', fallback: 'x' }), 'domain-3');
  assert.equal(pickDomainId({ ...base, labels: [], fallback: 'domain-1' }), 'domain-1');
  assert.equal(pickDomainId({ ...base, labels: [] }), null);
});

test('zmiana wartości pola w alercie zmienia domenę (przekierowanie do innego zespołu)', () => {
  const before = pickDomainId({ domains: fieldDomains, fieldValue: { id: '10001' }, labels: ['domain-1'] });
  const after = pickDomainId({ domains: fieldDomains, fieldValue: { id: '10002' }, labels: ['domain-1'] });
  assert.equal(before, 'domain-1');
  assert.equal(after, 'domain-2');
});

test('metryki: domena z pola Jira ma pierwszeństwo', () => {
  const ctx = { domains: fieldDomains, teams: [], domainFieldId: 'customfield_10500' };
  const issue = { fields: { customfield_10500: { id: '10002' }, labels: ['domain-1'] } };
  assert.equal(extractMetricValues(issue, 'domain', ctx)[0].label, 'Konta');
});

// --- pole wielokrotnego wyboru jako źródło domeny ---
test('pole wielokrotnego wyboru: pierwsza wartość z przypisaną domeną', () => {
  assert.equal(domainIdFromField([{ id: '10002' }, { id: '10001' }], fieldDomains), 'domain-2');
  assert.equal(domainIdFromField([{ id: '99999' }, { id: '10001' }], fieldDomains), 'domain-1');
});

test('pole wielokrotnego wyboru: pusta lista, nieznane wartości i puste elementy', () => {
  assert.equal(domainIdFromField([], fieldDomains), null);
  assert.equal(domainIdFromField([null, { id: '99999' }], fieldDomains), null);
  assert.equal(domainIdFromField([{ value: 'bez id' }], fieldDomains), null);
});

test('pole wielokrotnego wyboru działa też w wyborze domeny alertu i metrykach', () => {
  assert.equal(pickDomainId({ domains: fieldDomains, fieldValue: [{ id: '10001' }], labels: ['domain-2'] }), 'domain-1');
  const ctx = { domains: fieldDomains, teams: [], domainFieldId: 'customfield_1' };
  const issue = { fields: { customfield_1: [{ id: '10002' }], labels: [] } };
  assert.equal(extractMetricValues(issue, 'domain', ctx)[0].label, 'Konta');
});

// --- wartość pola domeny przy tworzeniu alertu ---
import { domainFieldPayload } from '../src/routing.js';

test('pole domeny: lista z jednym elementem dla wielokrotnego wyboru, obiekt dla jednokrotnego', () => {
  assert.deepEqual(domainFieldPayload(10001, true), [{ id: '10001' }]);
  assert.deepEqual(domainFieldPayload('10001', false), { id: '10001' });
  assert.deepEqual(domainFieldPayload(10001, undefined), { id: '10001' });
});
