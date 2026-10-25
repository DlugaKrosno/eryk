import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessMinutesBetween, planActions, freshState, isTaken, validatePolicy, withDefaults, DEFAULT_POLICY
} from '../src/escalation.js';

const WARSAW = { timeZone: 'Europe/Warsaw', days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00' };
// 2026-10-19 to poniedziałek; w październiku Warszawa ma czas letni do 25.10 (UTC+2), potem zimowy (UTC+1)
const at = (iso) => new Date(iso);

test('godziny pracy: w ciągu jednego dnia roboczego', () => {
  // 10:00-12:30 lokalnie = 08:00-10:30 UTC
  assert.equal(businessMinutesBetween(at('2026-10-19T08:00:00Z'), at('2026-10-19T10:30:00Z'), WARSAW), 150);
});

test('godziny pracy: poza oknem pracy nic nie liczy', () => {
  // 17:00-21:00 lokalnie (po pracy)
  assert.equal(businessMinutesBetween(at('2026-10-19T15:00:00Z'), at('2026-10-19T19:00:00Z'), WARSAW), 0);
  // 05:00-07:00 lokalnie (przed pracą)
  assert.equal(businessMinutesBetween(at('2026-10-19T03:00:00Z'), at('2026-10-19T05:00:00Z'), WARSAW), 0);
});

test('godziny pracy: alert z końca dnia czeka do rana', () => {
  // zgłoszony w poniedziałek 15:30 lokalnie, sprawdzany we wtorek 08:30 lokalnie = 30 + 30 min
  assert.equal(businessMinutesBetween(at('2026-10-19T13:30:00Z'), at('2026-10-20T06:30:00Z'), WARSAW), 60);
});

test('godziny pracy: weekend jest pominięty', () => {
  // piątek 15:00 lokalnie -> poniedziałek 09:00 lokalnie = 60 + 60 min
  assert.equal(businessMinutesBetween(at('2026-10-23T13:00:00Z'), at('2026-10-26T08:00:00Z'), WARSAW), 120);
  // cały weekend
  assert.equal(businessMinutesBetween(at('2026-10-24T08:00:00Z'), at('2026-10-25T20:00:00Z'), WARSAW), 0);
});

test('godziny pracy: pełny tydzień roboczy to 5 x 8h (także przy zmianie czasu 25.10)', () => {
  const minutes = businessMinutesBetween(at('2026-10-19T00:00:00Z'), at('2026-10-26T00:00:00Z'), WARSAW);
  assert.equal(minutes, 5 * 8 * 60);
});

test('godziny pracy: koniec przed początkiem daje 0, a brak godzin pracy liczy zwykłe minuty', () => {
  assert.equal(businessMinutesBetween(at('2026-10-19T10:00:00Z'), at('2026-10-19T09:00:00Z'), WARSAW), 0);
  assert.equal(businessMinutesBetween(at('2026-10-19T10:00:00Z'), at('2026-10-19T12:00:00Z'), null), 120);
});

test('godziny pracy: niepoprawny format godzin nie wywala funkcji', () => {
  assert.equal(businessMinutesBetween(at('2026-10-19T08:00:00Z'), at('2026-10-19T10:00:00Z'), { ...WARSAW, start: 'rano' }), 0);
});

const rule = { reminderAfterMin: 30, reminderEveryMin: 60, maxReminders: 3, escalateLeadersAfterMin: 120, escalateFinalAfterMin: 240 };

test('etapy: przed czasem reakcji nic się nie dzieje', () => {
  assert.deepEqual(planActions({ ageMin: 29, state: freshState(), rule }).actions, []);
});

test('etapy: pierwsze przypomnienie po czasie reakcji, potem co interwał', () => {
  let { actions, state } = planActions({ ageMin: 30, state: freshState(), rule });
  assert.deepEqual(actions, [{ type: 'reminder', number: 1 }]);
  ({ actions, state } = planActions({ ageMin: 59, state, rule }));
  assert.deepEqual(actions, []);
  ({ actions, state } = planActions({ ageMin: 90, state, rule }));
  assert.deepEqual(actions, [{ type: 'reminder', number: 2 }]);
});

test('etapy: przypomnień nie więcej niż maxReminders', () => {
  let state = freshState();
  const sent = [];
  for (let age = 30; age <= 600; age += 60) {
    const plan = planActions({ ageMin: age, state, rule: { ...rule, escalateLeadersAfterMin: 0, escalateFinalAfterMin: 0 } });
    state = plan.state;
    plan.actions.forEach(a => sent.push(a.number));
  }
  assert.deepEqual(sent, [1, 2, 3]);
});

test('etapy: eskalacja do leaderów i końcowa każda tylko raz, we właściwej kolejności', () => {
  let { actions, state } = planActions({ ageMin: 120, state: freshState(), rule });
  assert.deepEqual(actions.map(a => a.type), ['reminder', 'escalate_leaders']);
  ({ actions, state } = planActions({ ageMin: 130, state, rule }));
  assert.deepEqual(actions, []);
  ({ actions, state } = planActions({ ageMin: 240, state, rule }));
  assert.ok(actions.some(a => a.type === 'escalate_final'));
  ({ actions } = planActions({ ageMin: 500, state, rule }));
  assert.ok(!actions.some(a => a.type.startsWith('escalate')));
});

test('etapy: po przestoju oba progi nadrabiane w jednym uruchomieniu, a przypomnienie tylko jedno', () => {
  const { actions } = planActions({ ageMin: 300, state: freshState(), rule });
  assert.deepEqual(actions.map(a => a.type), ['reminder', 'escalate_leaders', 'escalate_final']);
});

test('etapy: próg 0 wyłącza eskalację', () => {
  const { actions } = planActions({ ageMin: 9999, state: freshState(), rule: { ...rule, maxReminders: 0, escalateLeadersAfterMin: 0, escalateFinalAfterMin: 0 } });
  assert.deepEqual(actions, []);
});

test('podjęcie: zmiana statusu z "new" liczy się jako podjęcie', () => {
  assert.equal(isTaken({ statusCategoryKey: 'indeterminate', comments: [] }), true);
  assert.equal(isTaken({ statusCategoryKey: 'done', comments: [] }), true);
  assert.equal(isTaken({ statusCategoryKey: 'new', comments: [] }), false);
});

test('podjęcie: komentarz człowieka liczy się, komentarz aplikacji nie', () => {
  const human = { author: { accountId: 'anna', accountType: 'atlassian' } };
  const app = { author: { accountId: 'app1', accountType: 'app' } };
  assert.equal(isTaken({ statusCategoryKey: 'new', comments: [app] }), false);
  assert.equal(isTaken({ statusCategoryKey: 'new', comments: [app, human], reporterId: 'jan', assigneeId: 'anna' }), true);
});

test('podjęcie: komentarz samego zgłaszającego nie liczy się, chyba że jest też dyżurnym', () => {
  const reporter = { author: { accountId: 'jan', accountType: 'atlassian' } };
  assert.equal(isTaken({ statusCategoryKey: 'new', comments: [reporter], reporterId: 'jan', assigneeId: 'anna' }), false);
  assert.equal(isTaken({ statusCategoryKey: 'new', comments: [reporter], reporterId: 'jan', assigneeId: 'jan' }), true);
});

test('walidacja: domyślne ustawienia są poprawne', () => {
  assert.deepEqual(validatePolicy(DEFAULT_POLICY), []);
});

test('walidacja: zła strefa, godziny i dni', () => {
  const policy = withDefaults({ workingHours: { timeZone: 'Nie/Istnieje', days: [], start: '16:00', end: '08:00' } });
  const errors = validatePolicy(policy);
  assert.ok(errors.some(e => e.includes('strefa')));
  assert.ok(errors.some(e => e.includes('Początek pracy')));
  assert.ok(errors.some(e => e.includes('dzień pracy')));
});

test('walidacja: eskalacja końcowa musi być po eskalacji do leaderów, wartości nie mogą być ujemne', () => {
  const policy = withDefaults({ priorities: { P1: { escalateLeadersAfterMin: 100, escalateFinalAfterMin: 50, reminderAfterMin: -1 } } });
  const errors = validatePolicy(policy);
  assert.ok(errors.some(e => e.startsWith('P1') && e.includes('eskalacja końcowa')));
  assert.ok(errors.some(e => e.startsWith('P1') && e.includes('reminderAfterMin')));
});

test('withDefaults uzupełnia brakujące pola i nie gubi własnych', () => {
  const p = withDefaults({ enabled: true, priorities: { P2: { reminderAfterMin: 5 } }, finalEscalationPeople: ['x'] });
  assert.equal(p.enabled, true);
  assert.equal(p.priorities.P2.reminderAfterMin, 5);
  assert.equal(p.priorities.P2.maxReminders, DEFAULT_POLICY.priorities.P2.maxReminders);
  assert.equal(p.priorities.P1.reminderAfterMin, DEFAULT_POLICY.priorities.P1.reminderAfterMin);
  assert.deepEqual(p.finalEscalationPeople, ['x']);
});
