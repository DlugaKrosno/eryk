import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Lista kontrolna konfiguracji: co działa, a co jeszcze trzeba ustawić, z przejściem do właściwej zakładki
function SetupChecklist({ projectKey, onNavigate }) {
  const [items, setItems] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    let cancelled = false;
    invoke('getProjectConfig', { projectKey }).then(result => {
      if (cancelled || !result.success) return;
      const c = result.config || {};
      const teams = c.escalationTeams || [];
      const domains = (c.domains || []).filter(d => d.enabled !== false);
      const schedule = c.teamSchedule || [];
      const today = todayStr();
      const usedTeams = teams.filter(t => domains.some(d => d.teamId === t.id));
      const onDuty = (team) => schedule.some(s => s.teamId === team.id && s.startDate <= today && today <= s.endDate);
      const hasWebhook = (team) => team.teamsWebhookUrl || team.hasWebhook;

      const list = [
        { label: 'Typ alertu i adres Jiry', ok: !!c.incidentIssueTypeId && !!c.jiraInstanceUrl, tab: 'Ustawienia Ogólne', hint: 'Ustaw typ alertu i URL instancji' },
        { label: 'Pola formularza', ok: (c.fieldsConfig?.configuredFields || []).some(f => f.enabled), tab: 'Konfiguracja Pól', hint: 'Formularz wymaga co najmniej jednego pola' },
        { label: 'Domeny (kategorie)', ok: domains.length > 0, tab: 'Domeny', hint: 'Dodaj pierwszą domenę, a powstanie dla niej zespół' },
        {
          label: 'Delegaci do dyżuru w zespołach',
          ok: usedTeams.length > 0 && usedTeams.every(t => (t.delegates || []).length > 0),
          tab: 'Zespoły',
          hint: usedTeams.filter(t => (t.delegates || []).length === 0).map(t => t.name).join(', ') || 'Brak zespołów'
        },
        {
          label: 'Dyżur na dziś w każdym zespole',
          ok: usedTeams.length > 0 && usedTeams.every(onDuty),
          tab: 'Zespoły',
          hint: usedTeams.filter(t => !onDuty(t)).map(t => t.name).join(', ') || 'Brak zespołów'
        },
        { label: 'Eskalacja nieobsłużonych alertów', ok: !!c.escalationPolicy?.enabled, tab: 'Eskalacje', hint: 'Włącz przypomnienia i eskalację' },
        {
          label: 'Powiadomienia Teams (kanał zespołu)',
          ok: usedTeams.length > 0 && usedTeams.every(hasWebhook),
          tab: 'Zespoły',
          hint: usedTeams.filter(t => !hasWebhook(t)).map(t => t.name).join(', ') || 'Brak zespołów'
        }
      ];
      setItems(list);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectKey]);

  if (!items) return null;
  const missing = items.filter(i => !i.ok);

  return (
    <div style={{
      margin: '0 0 16px', border: '1px solid #DFE1E6', borderRadius: '3px', background: '#fff',
      borderLeft: `4px solid ${missing.length === 0 ? '#36B37E' : '#FF991F'}`
    }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
        aria-expanded={!collapsed}
      >
        <strong>
          {missing.length === 0 ? 'Konfiguracja kompletna' : `Do ustawienia: ${missing.length} z ${items.length}`}
        </strong>
        <span style={{ color: '#5E6C84' }}>{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 12px' }}>
          {items.map(item => (
            <li key={item.label} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', padding: '4px 0', fontSize: '14px' }}>
              <span style={{ color: item.ok ? '#006644' : '#974F0C', fontWeight: 700, width: '16px' }} aria-hidden="true">{item.ok ? '✓' : '!'}</span>
              <span style={{ flex: 1 }}>
                {item.label}
                {!item.ok && item.hint && <span style={{ color: '#5E6C84' }}> - {item.hint}</span>}
              </span>
              {!item.ok && (
                <button className="btn btn-default btn-small" onClick={() => onNavigate(item.tab)}>Przejdź</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SetupChecklist;
