import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fold, tokenize, stem, extractTerms, adfToText, scoreCandidate, rankCandidates, suggestDomain, toCandidate
} from '../src/similarity.js';

test('fold zwija polskie znaki', () => {
  assert.equal(fold('Łączenie żółtą gęś'), 'laczenie zolta ges');
});

test('tokenize pomija słowa funkcyjne i krótkie', () => {
  assert.deepEqual(tokenize('Nie działa logowanie do systemu'), ['dziala', 'logowanie', 'systemu']);
});

test('odmiany słowa mają ten sam rdzeń', () => {
  assert.equal(stem('logowanie'), stem('logowania'));
  assert.equal(stem('logowaniu'), stem('logowanie'));
});

test('hasła: podsumowanie waży więcej niż opis, bez duplikatów', () => {
  const terms = extractTerms('Awaria bramki płatności', 'Bramka płatności zwraca błąd 500 przy płatności kartą');
  assert.equal(terms.length, new Set(terms).size);
  assert.ok(terms.includes(stem('bramki')));
  assert.ok(terms.includes(stem('platnosci')));
  assert.ok(terms.length <= 8);
});

test('brak treści daje brak haseł', () => {
  assert.deepEqual(extractTerms('', ''), []);
  assert.deepEqual(extractTerms('a to i', 'nie ale'), []);
});

test('ADF jest zamieniany na tekst', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Błąd' }, { type: 'text', text: 'bramki' }] }] };
  assert.equal(adfToText(adf), 'Błąd bramki');
  assert.equal(adfToText(null), '');
  assert.equal(adfToText('zwykły tekst'), 'zwykły tekst');
});

test('podobieństwo: pasujący alert ma wyższy wynik niż niepasujący', () => {
  const terms = extractTerms('Awaria bramki płatności', 'bramka zwraca błąd');
  const close = scoreCandidate(terms, { summary: 'Bramka płatności nie odpowiada', description: 'awaria po aktualizacji' });
  const far = scoreCandidate(terms, { summary: 'Logowanie do konta', description: 'reset hasła' });
  assert.ok(close > far);
  assert.equal(far, 0);
  assert.equal(scoreCandidate([], { summary: 'x', description: 'y' }), 0);
});

test('ranking: sortuje malejąco, odcina słabe i ogranicza liczbę', () => {
  const terms = extractTerms('Awaria bramki płatności', '');
  const ranked = rankCandidates(terms, [
    { key: 'A', summary: 'Nieistotne', description: '' },
    { key: 'B', summary: 'Awaria bramki płatności', description: '' },
    { key: 'C', summary: 'Bramka płatności', description: '' }
  ], { limit: 2 });
  assert.deepEqual(ranked.map(r => r.key), ['B', 'C']);
});

const domains = [
  { id: 'domain-1', name: 'Płatności' },
  { id: 'domain-2', name: 'Konta' },
  { id: 'domain-3', name: 'Wyłączona', enabled: false }
];

test('domena: wygrywa ta z największą sumą podobieństw', () => {
  const s = suggestDomain([
    { key: 'A', score: 0.9, domainId: 'domain-1' },
    { key: 'B', score: 0.6, domainId: 'domain-1' },
    { key: 'C', score: 0.3, domainId: 'domain-2' }
  ], domains);
  assert.equal(s.domainId, 'domain-1');
  assert.equal(s.name, 'Płatności');
  assert.deepEqual(s.basedOn, ['A', 'B']);
  assert.ok(s.confidence > 0.8);
});

test('domena: brak wyraźnego zwycięzcy daje null', () => {
  assert.equal(suggestDomain([
    { key: 'A', score: 0.5, domainId: 'domain-1' },
    { key: 'B', score: 0.5, domainId: 'domain-2' }
  ], domains, { minConfidence: 0.6 }), null);
});

test('domena: ignoruje alerty bez domeny, wyłączone i nieznane domeny', () => {
  assert.equal(suggestDomain([
    { key: 'A', score: 0.9, domainId: null },
    { key: 'B', score: 0.9, domainId: 'domain-3' },
    { key: 'C', score: 0.9, domainId: 'nieznana' }
  ], domains), null);
  assert.equal(suggestDomain([], domains), null);
});

test('alert z Jiry jest zamieniany na kandydata z domeną z labelu', () => {
  const candidate = toCandidate({
    key: 'KAN-5',
    fields: {
      summary: 'Test',
      description: { type: 'doc', content: [{ type: 'text', text: 'opis' }] },
      status: { name: 'Gotowe', statusCategory: { key: 'done' } },
      priority: { name: 'Medium' },
      labels: ['domain-1792684109202']
    }
  });
  assert.equal(candidate.domainId, 'domain-1792684109202');
  assert.equal(candidate.done, true);
  assert.equal(candidate.description, 'opis');
});
