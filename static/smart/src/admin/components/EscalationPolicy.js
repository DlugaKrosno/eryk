import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import UserMultiSelect from './UserMultiSelect';

const DAYS = [
  { id: 1, label: 'Pn' }, { id: 2, label: 'Wt' }, { id: 3, label: 'Śr' }, { id: 4, label: 'Cz' },
  { id: 5, label: 'Pt' }, { id: 6, label: 'So' }, { id: 7, label: 'Nd' }
];

const COLUMNS = [
  { key: 'reminderAfterMin', label: 'Pierwsze przypomnienie po (min)' },
  { key: 'reminderEveryMin', label: 'Kolejne co (min)' },
  { key: 'maxReminders', label: 'Maks. przypomnień' },
  { key: 'escalateLeadersAfterMin', label: 'Eskalacja do leaderów i PO po (min)' },
  { key: 'escalateFinalAfterMin', label: 'Eskalacja końcowa po (min)' }
];

const toInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
};

// Przypomnienia i eskalacje alertów, które nie zostały podjęte. Czasy w minutach CZASU PRACY.
function EscalationPolicy({ showFlag, selectedProject }) {
  const [policy, setPolicy] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState(null);

  useEffect(() => {
    if (!selectedProject) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      invoke('getEscalationPolicy', { projectKey: selectedProject }),
      invoke('getProjectUsers', { projectKey: selectedProject })
    ]).then(([policyResult, usersResult]) => {
      if (cancelled) return;
      if (policyResult.success) setPolicy(policyResult.policy);
      else showFlag('error', 'Błąd', policyResult.error || 'Nie udało się załadować ustawień');
      setUsers(usersResult.success && usersResult.users ? usersResult.users : []);
    }).catch(() => { if (!cancelled) showFlag('error', 'Błąd', 'Nie udało się załadować ustawień'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedProject]);

  const setHours = (patch) => setPolicy(prev => ({ ...prev, workingHours: { ...prev.workingHours, ...patch } }));
  const setRule = (priority, key, value) => setPolicy(prev => ({
    ...prev,
    priorities: { ...prev.priorities, [priority]: { ...prev.priorities[priority], [key]: toInt(value) } }
  }));
  const toggleDay = (day) => setPolicy(prev => {
    const days = prev.workingHours.days.includes(day)
      ? prev.workingHours.days.filter(d => d !== day)
      : [...prev.workingHours.days, day].sort();
    return { ...prev, workingHours: { ...prev.workingHours, days } };
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      // Zapis na świeżej konfiguracji, żeby nie nadpisać zmian z innych zakładek
      const current = await invoke('getProjectConfig', { projectKey: selectedProject });
      const base = current.success && current.config ? current.config : { projectKey: selectedProject };
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: { ...base, escalationPolicy: policy }
      });
      if (result.success) showFlag('success', 'Zapisano', 'Ustawienia eskalacji zapisane');
      else showFlag('error', 'Błąd', result.error || 'Nie udało się zapisać ustawień');
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setSaving(true);
    setRunResult(null);
    try {
      const result = await invoke('runEscalationCheckNow', { projectKey: selectedProject });
      if (result.success) setRunResult(result.result);
      else showFlag('error', 'Błąd', result.error || 'Nie udało się uruchomić sprawdzenia');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-container"><div className="spinner"></div></div>;
  if (!selectedProject) return <div className="message-box message-info">Wybierz projekt z listy powyżej.</div>;
  if (!policy) return null;

  return (
    <div>
      <div className="section-header">
        <h3 className="section-title">Eskalacja alertów</h3>
        <p className="section-description">
          Jeśli alert nie zostanie podjęty (zmiana statusu albo komentarz człowieka), dyżurny dostaje przypomnienia,
          potem eskalacja trafia do team leaderów i product ownerów, a na końcu do wskazanych osób.
          Sprawdzanie działa co godzinę, a czas liczony jest tylko w godzinach pracy.
        </p>
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={!!policy.enabled}
            onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
          />
          Włącz przypomnienia i eskalację w tym projekcie
        </label>
      </div>

      <h4 className="section-subtitle">Godziny pracy</h4>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
        <div>
          <label className="form-label" htmlFor="esc-tz">Strefa czasowa</label>
          <input
            id="esc-tz"
            className="form-input"
            list="esc-timezones"
            value={policy.workingHours.timeZone}
            onChange={(e) => setHours({ timeZone: e.target.value })}
          />
          <datalist id="esc-timezones">
            {['Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'UTC', 'America/New_York'].map(z => <option key={z} value={z} />)}
          </datalist>
        </div>
        <div>
          <label className="form-label" htmlFor="esc-start">Od</label>
          <input id="esc-start" type="time" className="form-input" value={policy.workingHours.start} onChange={(e) => setHours({ start: e.target.value })} />
        </div>
        <div>
          <label className="form-label" htmlFor="esc-end">Do</label>
          <input id="esc-end" type="time" className="form-input" value={policy.workingHours.end} onChange={(e) => setHours({ end: e.target.value })} />
        </div>
        <div>
          <div className="form-label">Dni pracy</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {DAYS.map(day => (
              <label key={day.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input type="checkbox" checked={policy.workingHours.days.includes(day.id)} onChange={() => toggleDay(day.id)} />
                {day.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="form-helper mb-16">Święta nie są uwzględniane: w dni ustawowo wolne, które wypadają w dni pracy, czas biegnie normalnie.</div>

      <h4 className="section-subtitle">Czasy według priorytetu (minuty czasu pracy)</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Priorytet</th>
              {COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {['P1', 'P2', 'P3', 'P4'].map(priority => (
              <tr key={priority}>
                <td><strong>{priority}</strong></td>
                {COLUMNS.map(c => (
                  <td key={c.key}>
                    <input
                      type="number"
                      min="0"
                      className="form-input"
                      style={{ width: '110px' }}
                      value={policy.priorities[priority][c.key]}
                      onChange={(e) => setRule(priority, c.key, e.target.value)}
                      aria-label={`${priority}: ${c.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-helper mb-16">
        Wartość 0 przy eskalacji lub maksymalnej liczbie przypomnień wyłącza dany etap. Przykład: P1, pierwsze przypomnienie po 15 min,
        eskalacja do leaderów po 60 min, końcowa po 120 min pracy.
      </div>

      <h4 className="section-subtitle">Eskalacja końcowa: wskazane osoby</h4>
      <UserMultiSelect
        users={users}
        value={policy.finalEscalationPeople}
        onChange={(finalEscalationPeople) => setPolicy({ ...policy, finalEscalationPeople })}
      />
      <div className="form-helper mb-16">
        Pierwsza eskalacja trafia do team leaderów i product ownerów zespołu alertu. Te osoby dostają dopiero ostatnią.
        Wiadomości prywatne wymagają workflow DM zespołu; kanał zespołu dostaje kartę zawsze, gdy jest ustawiony.
      </div>

      <div className="flex flex-gap mt-16">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>Zapisz ustawienia</button>
        <button className="btn btn-default" onClick={handleRunNow} disabled={saving} title="Wykonuje to samo, co automatyczne sprawdzanie co godzinę">
          Uruchom sprawdzenie teraz
        </button>
      </div>

      {runResult && (
        <div className={`message-box ${runResult.skipped ? 'message-warning' : 'message-info'}`} style={{ marginTop: '16px' }}>
          {runResult.skipped
            ? `Pominięto: ${runResult.skipped}`
            : `Sprawdzono ${runResult.checked} alertów, wysłano ${runResult.actions.length} powiadomień${runResult.actions.length ? `: ${runResult.actions.map(a => `${a.key} (${a.type})`).join(', ')}` : ''}.`}
          {runResult.truncated && ' Część alertów zostanie sprawdzona przy kolejnym uruchomieniu (limit czasu).'}
        </div>
      )}
    </div>
  );
}

export default EscalationPolicy;
