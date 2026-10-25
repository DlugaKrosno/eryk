import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

const formatDuration = (ms) => {
  if (ms === null || ms === undefined) return '-';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
};

// Wartość, którą rysuje słupek, i jej format
const METRICS = {
  total: { label: 'Liczba alertów', value: (r) => r.total, format: (v) => String(v) },
  open: { label: 'Otwarte', value: (r) => r.open, format: (v) => String(v) },
  resolved: { label: 'Rozwiązane', value: (r) => r.resolved, format: (v) => String(v) },
  avgResolutionMs: { label: 'Średni czas rozwiązania', value: (r) => r.avgResolutionMs, format: formatDuration },
  avgOpenAgeMs: { label: 'Średni wiek otwartych', value: (r) => r.avgOpenAgeMs, format: formatDuration }
};

const th = { textAlign: 'left', padding: '8px 12px', fontSize: '12px', color: '#5E6C84', textTransform: 'uppercase', borderBottom: '2px solid #DFE1E6' };
const td = { padding: '8px 12px', borderBottom: '1px solid #EBECF0', fontSize: '14px' };

// Metryki dla wybranego pola (np. zgłaszający, dyżurny, domena) w osobnym module
function FieldMetrics({ showFlag, projectKey, issueTypeId, timeRange }) {
  const [options, setOptions] = useState([]);
  const [field, setField] = useState('reporter');
  const [metric, setMetric] = useState('total');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    invoke('getFieldMetricOptions', { projectKey })
      .then(result => { if (result.success) setOptions(result.options); })
      .catch(error => console.error('Błąd ładowania pól metryk:', error));
  }, [projectKey]);

  useEffect(() => {
    if (!projectKey || !issueTypeId || !field) return;
    // Odpowiedź dla poprzednio wybranego pola nie może nadpisać aktualnej
    let cancelled = false;
    setLoading(true);
    invoke('getFieldMetrics', { projectKey, issueTypeId, timeRange, field })
      .then(result => {
        if (cancelled) return;
        if (result.success) {
          setData(result);
        } else {
          setData(null);
          showFlag('error', 'Błąd', result.error || 'Nie udało się załadować metryk');
        }
      })
      .catch(() => { if (!cancelled) showFlag('error', 'Błąd', 'Nie udało się załadować metryk'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectKey, issueTypeId, timeRange, field]);

  const selectedMetric = METRICS[metric];
  const rows = data ? data.rows : [];
  const maxValue = Math.max(...rows.map(r => selectedMetric.value(r) || 0), 1);
  const fieldName = (options.find(o => o.id === field) || {}).name || field;

  return (
    <div style={{ marginTop: '32px', padding: '20px', border: '1px solid #DFE1E6', borderRadius: '3px', background: '#fff' }}>
      <h3 style={{ marginBottom: '4px', color: '#172B4D', fontSize: '18px', fontWeight: 600 }}>Metryki wg pola</h3>
      <div style={{ fontSize: '13px', color: '#5E6C84', marginBottom: '16px' }}>
        Porównaj alerty w wybranym okresie według dowolnego pola, np. zgłaszającego, dyżurnego albo domeny.
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <label className="form-label" htmlFor="metric-field">Pole</label>
          <select id="metric-field" className="form-select" value={field} onChange={(e) => setField(e.target.value)}>
            {(options.length > 0 ? options : [{ id: 'reporter', name: 'Zgłaszający (user)' }]).map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="metric-kind">Pokaż na wykresie</label>
          <select id="metric-kind" className="form-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.entries(METRICS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner"></div></div>
      ) : !data || rows.length === 0 ? (
        <div className="message-box message-info">Brak alertów w wybranym okresie.</div>
      ) : (
        <>
          <div style={{ fontSize: '13px', color: '#5E6C84', marginBottom: '12px' }}>
            {fieldName}: {data.totalIssues} alertów
            {data.hiddenValues > 0 && `, pokazano ${rows.length} najliczniejszych wartości (pominięto ${data.hiddenValues})`}
            {data.truncated && ' - wyniki obcięte do pierwszych 2000 alertów'}
          </div>

          <div role="img" aria-label={`Wykres: ${selectedMetric.label} wg pola ${fieldName}`} style={{ marginBottom: '24px' }}>
            {rows.map(row => {
              const value = selectedMetric.value(row);
              const width = value ? Math.max((value / maxValue) * 100, 1) : 0;
              return (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ width: '180px', fontSize: '14px', color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.label}>
                    {row.label}
                  </div>
                  <div style={{ flex: 1, background: '#F4F5F7', borderRadius: '3px', height: '22px' }}>
                    <div
                      style={{ width: `${width}%`, height: '100%', background: '#0052CC', borderRadius: '3px' }}
                      title={`${row.label}: ${selectedMetric.format(value)}`}
                    />
                  </div>
                  <div style={{ width: '90px', fontSize: '14px', fontWeight: 600, color: '#172B4D', textAlign: 'right' }}>
                    {value === null || value === undefined ? '-' : selectedMetric.format(value)}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{fieldName}</th>
                  <th style={th}>Alertów</th>
                  <th style={th}>Otwarte</th>
                  <th style={th}>Rozwiązane</th>
                  <th style={th}>Śr. czas rozwiązania</th>
                  <th style={th}>Śr. wiek otwartych</th>
                  <th style={th}>Priorytety</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    <td style={{ ...td, fontWeight: 600 }}>{row.label}</td>
                    <td style={td}>{row.total}</td>
                    <td style={td}>{row.open}</td>
                    <td style={td}>{row.resolved}</td>
                    <td style={td}>{formatDuration(row.avgResolutionMs)}</td>
                    <td style={td}>{formatDuration(row.avgOpenAgeMs)}</td>
                    <td style={{ ...td, fontSize: '12px', color: '#5E6C84' }}>
                      {Object.entries(row.byPriority).map(([p, n]) => `${p}: ${n}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default FieldMetrics;
