import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, nextMonday, shiftStatus, overlaps, toStr } from '../static/smart/src/admin/components/dutyDates.js';

test('addDays przechodzi przez granicę miesiąca i roku', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('tydzień dyżuru: start + 6 dni obejmuje 7 dni', () => {
  assert.equal(addDays('2026-10-19', 6), '2026-10-25');
});

test('nextMonday zwraca poniedziałek (dziś, gdy dziś poniedziałek)', () => {
  assert.equal(nextMonday(new Date(2026, 9, 19)), '2026-10-19'); // poniedziałek
  assert.equal(nextMonday(new Date(2026, 9, 22)), '2026-10-26'); // czwartek
  assert.equal(nextMonday(new Date(2026, 9, 25)), '2026-10-26'); // niedziela
  assert.equal(toStr(new Date(2026, 0, 5)), '2026-01-05');
});

test('status dyżuru względem dnia dzisiejszego', () => {
  const shift = { startDate: '2026-10-19', endDate: '2026-10-25' };
  assert.equal(shiftStatus(shift, '2026-10-18'), 'upcoming');
  assert.equal(shiftStatus(shift, '2026-10-19'), 'active');
  assert.equal(shiftStatus(shift, '2026-10-25'), 'active');
  assert.equal(shiftStatus(shift, '2026-10-26'), 'past');
});

test('nakładanie dyżurów: styczność końców też jest kolizją', () => {
  const a = { startDate: '2026-10-19', endDate: '2026-10-25' };
  assert.equal(overlaps(a, { startDate: '2026-10-25', endDate: '2026-10-31' }), true);
  assert.equal(overlaps(a, { startDate: '2026-10-26', endDate: '2026-11-01' }), false);
  assert.equal(overlaps(a, { startDate: '2026-10-01', endDate: '2026-10-18' }), false);
  assert.equal(overlaps(a, { startDate: '2026-10-20', endDate: '2026-10-21' }), true);
});
