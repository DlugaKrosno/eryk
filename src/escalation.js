// Czysta logika eskalacji alertów: czas pracy, etapy przypomnień i eskalacji, wykrywanie "podjęcia" alertu.
// Bez zależności od Forge, testowane w test/escalation.test.js.

const MS_PER_MINUTE = 60000;

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

// Domyślne czasy (w minutach CZASU PRACY). 0 przy eskalacji oznacza "wyłączona".
export const DEFAULT_POLICY = {
  enabled: false,
  workingHours: { timeZone: 'Europe/Warsaw', days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00' },
  priorities: {
    P1: { reminderAfterMin: 15, reminderEveryMin: 30, maxReminders: 3, escalateLeadersAfterMin: 60, escalateFinalAfterMin: 120 },
    P2: { reminderAfterMin: 30, reminderEveryMin: 60, maxReminders: 3, escalateLeadersAfterMin: 120, escalateFinalAfterMin: 240 },
    P3: { reminderAfterMin: 120, reminderEveryMin: 120, maxReminders: 3, escalateLeadersAfterMin: 240, escalateFinalAfterMin: 480 },
    P4: { reminderAfterMin: 240, reminderEveryMin: 240, maxReminders: 2, escalateLeadersAfterMin: 480, escalateFinalAfterMin: 0 }
  },
  finalEscalationPeople: []
};

// ---------------------------------------------------------------------------
// Strefy czasowe (bez zewnętrznych bibliotek)
// ---------------------------------------------------------------------------
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return { y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute, ss: +parts.second };
}

// Przesunięcie strefy względem UTC w minutach dla danej chwili
function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - date.getTime()) / MS_PER_MINUTE);
}

// Lokalna godzina w strefie -> chwila (ms UTC); uwzględnia zmianę czasu
function zonedToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(new Date(guess), timeZone);
  let t = guess - first * MS_PER_MINUTE;
  const second = offsetMinutes(new Date(t), timeZone);
  if (second !== first) t = guess - second * MS_PER_MINUTE;
  return t;
}

const parseHM = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const h = +match[1];
  const m = +match[2];
  return h <= 24 && m < 60 ? { h, m } : null;
};

// Minuty czasu pracy między dwiema chwilami. Dni: 1 = poniedziałek ... 7 = niedziela.
// Bez workingHours liczy zwykłe minuty (24/7).
export function businessMinutesBetween(start, end, workingHours) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!(endMs > startMs)) return 0;
  if (!workingHours) return Math.floor((endMs - startMs) / MS_PER_MINUTE);

  const { timeZone, days } = workingHours;
  const from = parseHM(workingHours.start);
  const to = parseHM(workingHours.end);
  if (!from || !to) return 0;

  const first = zonedParts(new Date(startMs), timeZone);
  const last = zonedParts(new Date(endMs), timeZone);
  const lastDay = Date.UTC(last.y, last.m - 1, last.d);

  let totalMs = 0;
  // Dzień po dniu, w kalendarzu strefy (limit chroni przed absurdalnie starym alertem)
  for (let day = Date.UTC(first.y, first.m - 1, first.d), n = 0; day <= lastDay && n < 400; day += 86400000, n++) {
    const date = new Date(day);
    const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (!days.includes(isoWeekday)) continue;
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
    const windowStart = zonedToUtc(y, m, d, from.h, from.m, timeZone);
    const windowEnd = zonedToUtc(y, m, d, to.h, to.m, timeZone);
    totalMs += Math.max(0, Math.min(endMs, windowEnd) - Math.max(startMs, windowStart));
  }
  return Math.floor(totalMs / MS_PER_MINUTE);
}

// ---------------------------------------------------------------------------
// Etapy: przypomnienia, eskalacja do leaderów i PO, eskalacja końcowa
// ---------------------------------------------------------------------------
export function freshState() {
  return { reminders: 0, lastReminderAge: null, leadersAt: null, finalAt: null, takenAt: null };
}

// Co trzeba zrobić teraz dla alertu w danym wieku (minuty czasu pracy). Jedno przypomnienie na uruchomienie.
export function planActions({ ageMin, state, rule }) {
  const next = { ...freshState(), ...state };
  const actions = [];
  if (!rule) return { actions, state: next };

  if (
    next.reminders < (rule.maxReminders || 0) &&
    ageMin >= rule.reminderAfterMin &&
    (next.lastReminderAge === null || ageMin - next.lastReminderAge >= Math.max(1, rule.reminderEveryMin || 1))
  ) {
    next.reminders += 1;
    next.lastReminderAge = ageMin;
    actions.push({ type: 'reminder', number: next.reminders });
  }
  if (rule.escalateLeadersAfterMin > 0 && next.leadersAt === null && ageMin >= rule.escalateLeadersAfterMin) {
    next.leadersAt = ageMin;
    actions.push({ type: 'escalate_leaders' });
  }
  if (rule.escalateFinalAfterMin > 0 && next.finalAt === null && ageMin >= rule.escalateFinalAfterMin) {
    next.finalAt = ageMin;
    actions.push({ type: 'escalate_final' });
  }
  return { actions, state: next };
}

// Alert jest "podjęty", gdy zmienił się status (kategoria inna niż "new") albo komentuje go człowiek.
// Komentarze aplikacji i samego zgłaszającego (chyba że to ten sam, co przypisany) się nie liczą.
export function isTaken({ statusCategoryKey, comments, reporterId, assigneeId }) {
  if (statusCategoryKey && statusCategoryKey !== 'new') return true;
  return (comments || []).some(comment => {
    const author = comment.author || {};
    if (author.accountType === 'app') return false;
    if (author.accountId && author.accountId === reporterId && author.accountId !== assigneeId) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Walidacja ustawień (zwraca listę błędów; pusta = poprawne)
// ---------------------------------------------------------------------------
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return ['Brak ustawień eskalacji'];

  const wh = policy.workingHours;
  if (!wh) {
    errors.push('Brak godzin pracy');
  } else {
    try {
      new Intl.DateTimeFormat('en', { timeZone: wh.timeZone });
    } catch (e) {
      errors.push(`Nieznana strefa czasowa: ${wh.timeZone}`);
    }
    const from = parseHM(wh.start);
    const to = parseHM(wh.end);
    if (!from || !to) errors.push('Godziny pracy muszą mieć format GG:MM');
    else if (from.h * 60 + from.m >= to.h * 60 + to.m) errors.push('Początek pracy musi być przed końcem');
    if (!Array.isArray(wh.days) || wh.days.length === 0 || wh.days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
      errors.push('Wybierz co najmniej jeden dzień pracy');
    }
  }

  PRIORITIES.forEach(p => {
    const r = policy.priorities?.[p];
    if (!r) {
      errors.push(`${p}: brak ustawień`);
      return;
    }
    const nonNegative = ['reminderAfterMin', 'reminderEveryMin', 'maxReminders', 'escalateLeadersAfterMin', 'escalateFinalAfterMin'];
    nonNegative.forEach(key => {
      if (!Number.isInteger(r[key]) || r[key] < 0) errors.push(`${p}: pole ${key} musi być liczbą całkowitą >= 0`);
    });
    if (r.escalateLeadersAfterMin > 0 && r.escalateFinalAfterMin > 0 && r.escalateFinalAfterMin <= r.escalateLeadersAfterMin) {
      errors.push(`${p}: eskalacja końcowa musi być później niż eskalacja do leaderów`);
    }
  });

  if (!Array.isArray(policy.finalEscalationPeople)) errors.push('Lista osób eskalacji końcowej musi być listą');
  return errors;
}

// Uzupełnia brakujące pola wartościami domyślnymi (np. po starszej wersji konfiguracji)
export function withDefaults(policy) {
  const p = policy || {};
  const priorities = {};
  PRIORITIES.forEach(key => { priorities[key] = { ...DEFAULT_POLICY.priorities[key], ...(p.priorities?.[key] || {}) }; });
  return {
    ...DEFAULT_POLICY,
    ...p,
    workingHours: { ...DEFAULT_POLICY.workingHours, ...(p.workingHours || {}) },
    priorities,
    finalEscalationPeople: Array.isArray(p.finalEscalationPeople) ? p.finalEscalationPeople : []
  };
}
