import React, { useState, useEffect } from 'react';
import { invoke, router } from '@forge/bridge';

// Podobne alerty dla alertu, który już istnieje (weryfikacja po zgłoszeniu). Uruchamia się po kliknięciu "Podobne".
function SimilarToAlert({ showFlag, target, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Odpowiedź dla poprzednio wybranego alertu nie może nadpisać aktualnej
    let cancelled = false;
    setLoading(true);
    invoke('findSimilarToAlert', { issueKey: target.key })
      .then(result => {
        if (cancelled) return;
        if (result.success) {
          setData(result);
        } else {
          showFlag('error', 'Błąd', result.error || 'Nie udało się znaleźć podobnych alertów');
        }
      })
      .catch(() => { if (!cancelled) showFlag('error', 'Błąd', 'Nie udało się znaleźć podobnych alertów'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target.key]);

  const open = (key) => { if (data && data.jiraBaseUrl) router.open(`${data.jiraBaseUrl}/browse/${key}`); };

  return (
    <div style={{ margin: '4px 0 8px', padding: '12px 16px', background: '#F4F5F7', borderLeft: '4px solid #0052CC', borderRadius: '3px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Podobne do {target.key}</div>
          <div style={{ color: '#5E6C84', fontSize: '13px' }}>{target.summary}</div>
        </div>
        <button className="btn btn-default btn-small" onClick={onClose}>Zamknij</button>
      </div>

      {loading ? (
        <div style={{ marginTop: '12px', color: '#5E6C84' }}>Szukam...</div>
      ) : !data || data.similar.length === 0 ? (
        <div style={{ marginTop: '12px', color: '#5E6C84' }}>Nie znaleziono podobnych alertów.</div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {data.similar.map(item => (
              <li key={item.key} style={{ padding: '6px 0', borderTop: '1px solid #DFE1E6' }}>
                <button
                  type="button"
                  onClick={() => open(item.key)}
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
          {data.suggestion && (
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#5E6C84' }}>
              Podobne alerty należą najczęściej do kategorii <strong>{data.suggestion.name}</strong>.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SimilarToAlert;
