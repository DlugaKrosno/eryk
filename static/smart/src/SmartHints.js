import React, { useState } from 'react';
import { invoke, router } from '@forge/bridge';

// Podpowiedzi na żądanie: kategoria (domena) i podobne alerty. Nic nie dzieje się samo - tylko po kliknięciu.
function SmartHints({ showFlag, projectKey, summary, description, onPickDomain }) {
  const [loading, setLoading] = useState(null); // 'domain' | 'similar'
  const [result, setResult] = useState(null);   // { forText, data, mode }

  const textKey = `${summary || ''}\n${description || ''}`;
  const tooShort = (summary || '').trim().length < 3;

  const run = async (mode) => {
    // Ten sam tekst: korzystamy z poprzedniej odpowiedzi zamiast pytać Jirę drugi raz
    if (result && result.forText === textKey) {
      setResult({ ...result, mode });
      return;
    }
    setLoading(mode);
    try {
      const data = await invoke('suggestForAlert', { projectKey, summary, description });
      if (data.success) {
        setResult({ forText: textKey, data, mode });
      } else {
        showFlag('error', 'Błąd', data.error || 'Nie udało się pobrać podpowiedzi');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się pobrać podpowiedzi');
    } finally {
      setLoading(null);
    }
  };

  // Wynik dotyczy tekstu sprzed edycji - nie pokazujemy go jako aktualnego
  const current = result && result.forText === textKey ? result : null;
  const data = current && current.data;

  const openIssue = (key) => {
    if (data && data.jiraBaseUrl) router.open(`${data.jiraBaseUrl}/browse/${key}`);
  };

  return (
    <div style={{ margin: '0 0 16px', padding: '12px 16px', background: '#F4F5F7', border: '1px solid #DFE1E6', borderRadius: '3px' }}>
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>Podpowiedzi (opcjonalnie)</div>
      <div className="form-helper" style={{ marginBottom: '8px' }}>
        Szukamy podobnych alertów w tym projekcie po słowach kluczowych. Nic nie jest zmieniane automatycznie.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-default btn-small" disabled={tooShort || loading !== null} onClick={() => run('domain')}>
          {loading === 'domain' ? 'Szukam...' : 'Podpowiedz kategorię'}
        </button>
        <button type="button" className="btn btn-default btn-small" disabled={tooShort || loading !== null} onClick={() => run('similar')}>
          {loading === 'similar' ? 'Szukam...' : 'Sprawdź podobne alerty'}
        </button>
      </div>
      {tooShort && <div className="form-helper" style={{ marginTop: '8px' }}>Wpisz podsumowanie, aby skorzystać z podpowiedzi.</div>}

      {data && current.mode === 'domain' && (
        <div style={{ marginTop: '12px' }}>
          {data.suggestion ? (
            <div>
              Podpowiedź: <strong>{data.suggestion.name}</strong>
              <span style={{ color: '#5E6C84' }}>
                {' '}(na podstawie {data.suggestion.basedOn.length} podobnych: {data.suggestion.basedOn.join(', ')})
              </span>
              <div style={{ marginTop: '6px' }}>
                <button type="button" className="btn btn-primary btn-small" onClick={() => onPickDomain(data.suggestion.domainId)}>
                  Użyj tej kategorii
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: '#5E6C84' }}>
              Brak wyraźnej podpowiedzi{data.similar.length === 0 ? ': nie znaleziono podobnych alertów.' : ': podobne alerty należą do różnych kategorii albo nie mają kategorii.'}
            </div>
          )}
        </div>
      )}

      {data && current.mode === 'similar' && (
        <div style={{ marginTop: '12px' }}>
          {data.similar.length === 0 ? (
            <div style={{ color: '#5E6C84' }}>Nie znaleziono podobnych alertów.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.similar.map(item => (
                <li key={item.key} style={{ padding: '6px 0', borderTop: '1px solid #DFE1E6' }}>
                  <button
                    type="button"
                    onClick={() => openIssue(item.key)}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#0052CC', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
                  >
                    {item.key}
                  </button>{' '}
                  {item.summary}
                  <div style={{ fontSize: '12px', color: '#5E6C84' }}>
                    {item.status}{item.done ? ' (zamknięty)' : ''}
                    {item.domainName ? ` | ${item.domainName}` : ''}
                    {` | podobieństwo ${Math.round(item.score * 100)}%`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default SmartHints;
