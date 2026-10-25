// Wyszukiwanie osób na liście wyboru: po imieniu, nazwisku i adresie e-mail, bez względu na wielkość liter i polskie znaki.
// Testowane w test/userFilter.test.js.

export const normalize = (text) => String(text || '')
  .toLowerCase()
  .replace(/ł/g, 'l')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

// Każde słowo z zapytania musi pasować (np. "jan kow" znajdzie "Jan Kowalski", także "Kowalski Jan")
export function filterUsers(users, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return users;
  return users.filter(user => {
    const haystack = normalize(`${user.displayName || ''} ${user.emailAddress || ''}`);
    return words.every(word => haystack.includes(word));
  });
}
