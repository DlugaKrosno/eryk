// Podobieństwo alertów i podpowiedź domeny BEZ modelu językowego: słowa kluczowe + wyszukiwanie w Jirze.
// Czyste funkcje, testowane w test/similarity.test.js.
import { asArray, pickDomainId } from './routing.js';

const STOPWORDS = new Set((
  'oraz ale albo lub czy jak jest sie nie tak tym ten ta to te tej tego ich jego jej dla nad pod przy bez przez ' +
  'jako gdy kiedy gdzie ktory ktora ktore tylko juz jeszcze bardzo moze mozna musi bylo byla byly beda bedzie ' +
  'ktos cos nic wiec ze po na do od za we ze z w i o u a the and for with that this from are was not but have has'
).split(/\s+/));

// Zwija polskie znaki, żeby "łączenie" i "laczenie" były tym samym słowem
export function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function tokenize(text) {
  return fold(text).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

// Prosty "rdzeń" słowa: pierwsze 6 znaków. Łączy odmiany (logowanie / logowania / logowaniu)
export const stem = (token) => token.slice(0, 6);

// Najważniejsze hasła alertu: częstsze i z podsumowania ważą więcej
export function extractTerms(summary, description, max = 8) {
  const weights = new Map();
  tokenize(summary).forEach(t => weights.set(stem(t), (weights.get(stem(t)) || 0) + 3));
  tokenize(description).forEach(t => weights.set(stem(t), (weights.get(stem(t)) || 0) + 1));
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([term]) => term);
}

// Tekst z formatu ADF (opis w Jirze v3)
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  return asArray(node.content).map(adfToText).join(' ');
}

// 0..1: jaka część haseł występuje w alercie (podsumowanie liczy się podwójnie)
export function scoreCandidate(terms, candidate) {
  if (terms.length === 0) return 0;
  const summaryStems = new Set(tokenize(candidate.summary).map(stem));
  const descriptionStems = new Set(tokenize(candidate.description).map(stem));
  const points = terms.reduce((sum, term) => sum + (summaryStems.has(term) ? 2 : 0) + (descriptionStems.has(term) ? 1 : 0), 0);
  return points / (terms.length * 3);
}

export function rankCandidates(terms, candidates, { limit = 5, minScore = 0.2 } = {}) {
  return candidates
    .map(candidate => ({ ...candidate, score: scoreCandidate(terms, candidate) }))
    .filter(candidate => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Domena podpowiadana głosami podobnych alertów (waga = podobieństwo). null, gdy brak wyraźnego zwycięzcy
export function suggestDomain(ranked, domains, { minConfidence = 0.5 } = {}) {
  const valid = new Map(asArray(domains).filter(d => d.enabled !== false).map(d => [d.id, d]));
  const votes = new Map();
  const support = new Map();
  let total = 0;

  ranked.forEach(candidate => {
    const domainId = candidate.domainId;
    if (!valid.has(domainId)) return;
    votes.set(domainId, (votes.get(domainId) || 0) + candidate.score);
    support.set(domainId, [...(support.get(domainId) || []), candidate.key]);
    total += candidate.score;
  });
  if (votes.size === 0 || total === 0) return null;

  const [domainId, weight] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = weight / total;
  if (confidence < minConfidence) return null;
  return { domainId, name: valid.get(domainId).name, confidence, basedOn: support.get(domainId) };
}

// Alert z wyniku wyszukiwania Jiry -> uproszczona postać do rankingu
export function toCandidate(issue, ctx = {}) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    description: adfToText(f.description).slice(0, 1500),
    status: f.status?.name || '',
    done: f.status?.statusCategory?.key === 'done',
    priority: f.priority?.name || '',
    domainId: pickDomainId({ fieldValue: ctx.domainFieldId ? f[ctx.domainFieldId] : null, labels: f.labels, domains: ctx.domains })
  };
}
