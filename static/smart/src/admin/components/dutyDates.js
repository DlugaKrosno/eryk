// Czyste funkcje dat harmonogramu dyżurów (YYYY-MM-DD, czas lokalny). Testowane w test/dutyDates.test.js.

const pad = (n) => String(n).padStart(2, '0');

export const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromStr = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = fromStr(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
};

export const formatDate = (s) => (
  s ? fromStr(s).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
);

// Najbliższy poniedziałek: dziś, jeśli dziś jest poniedziałek
export const nextMonday = (fromDate) => {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  return toStr(d);
};

export const shiftStatus = (shift, today) => {
  if (shift.endDate < today) return 'past';
  if (shift.startDate > today) return 'upcoming';
  return 'active';
};

// Zakresy dat (włącznie z końcami) nakładają się
export const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;
