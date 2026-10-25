import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import JiraFieldImport from './JiraFieldImport';

const EMPTY_DOMAIN = { name: '', description: '', teamId: '' };

// Domeny (kategorie alertów). Każda domena należy do jednego zespołu;
// dodanie domeny bez wskazania zespołu automatycznie tworzy zespół o tej samej nazwie.
function DomainsConfig({ showFlag, selectedProject }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [domains, setDomains] = useState([]);
  const [teams, setTeams] = useState([]);
  const [defaultDomainId, setDefaultDomainId] = useState('');
  const [domainFieldId, setDomainFieldId] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [newDomain, setNewDomain] = useState(EMPTY_DOMAIN);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (selectedProject) {
      load();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);

  const load = async () => {
    try {
      setLoading(true);
      const configResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      if (configResult.success && configResult.config) {
        setDomains(configResult.config.domains || []);
        setTeams(configResult.config.escalationTeams || []);
        setDefaultDomainId(configResult.config.defaultDomainId || '');
        setDomainFieldId(configResult.config.domainFieldId || '');
        setIssueTypeId(configResult.config.incidentIssueTypeId || '');
      }
    } catch (error) {
      console.error('Błąd ładowania domen:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować domen');
    } finally {
      setLoading(false);
    }
  };

  // Zapis czyta świeżą konfigurację, żeby nie nadpisać zmian zrobionych w innych zakładkach
  const persist = async (updatedDomains, updatedTeams, extra = {}) => {
    const configResult = await invoke('getProjectConfig', { projectKey: selectedProject });
    const currentConfig = configResult.success && configResult.config
      ? configResult.config
      : { projectKey: selectedProject };
    const result = await invoke('saveProjectConfig', {
      projectKey: selectedProject,
      config: { ...currentConfig, domains: updatedDomains, escalationTeams: updatedTeams, ...extra }
    });
    return result.success;
  };

  const handleAdd = async () => {
    const name = newDomain.name.trim();
    if (!name) {
      showFlag('error', 'Błąd', 'Nazwa domeny jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const stamp = Date.now().toString();
      let updatedTeams = teams;
      let teamId = newDomain.teamId;

      if (!teamId) {
        teamId = `team-${stamp}`;
        updatedTeams = [...teams, {
          id: teamId,
          name,
          description: newDomain.description,
          teamLeaders: [],
          productOwners: [],
          delegates: [],
          teamsWebhookUrl: '',
          dutyDmWorkflowUrl: ''
        }];
      }

      const updatedDomains = [...domains, {
        id: `domain-${stamp}`,
        name,
        description: newDomain.description,
        teamId,
        enabled: true
      }];

      if (await persist(updatedDomains, updatedTeams)) {
        setDomains(updatedDomains);
        setTeams(updatedTeams);
        setNewDomain(EMPTY_DOMAIN);
        showFlag('success', 'Sukces', newDomain.teamId
          ? 'Domena dodana'
          : 'Domena dodana wraz z nowym zespołem - uzupełnij go w zakładce Zespoły');
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać domeny');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się dodać domeny');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      setSaving(true);
      const updatedDomains = domains.map(d => d.id === editing.id ? editing : d);
      if (await persist(updatedDomains, teams)) {
        setDomains(updatedDomains);
        setEditing(null);
        showFlag('success', 'Zapisano', 'Domena zaktualizowana');
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać domeny');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDefaultChange = async (value) => {
    if (await persist(domains, teams, { defaultDomainId: value })) {
      setDefaultDomainId(value);
      showFlag('success', 'Zapisano', value ? 'Domena domyślna ustawiona' : 'Usunięto domenę domyślną');
    } else {
      showFlag('error', 'Błąd', 'Nie udało się zapisać domeny domyślnej');
    }
  };

  const handleToggle = async (domain) => {
    const updatedDomains = domains.map(d => d.id === domain.id ? { ...d, enabled: d.enabled === false } : d);
    if (await persist(updatedDomains, teams)) {
      setDomains(updatedDomains);
    } else {
      showFlag('error', 'Błąd', 'Nie udało się zapisać zmiany');
    }
  };

  const handleDelete = async (domain) => {
    if (!window.confirm(`Usunąć domenę "${domain.name}"? Zespół zostanie zachowany.`)) return;
    const updatedDomains = domains.filter(d => d.id !== domain.id);
    // Usunięta domena nie może zostać domyślną
    const clearDefault = domain.id === defaultDomainId;
    if (await persist(updatedDomains, teams, clearDefault ? { defaultDomainId: '' } : {})) {
      setDomains(updatedDomains);
      if (clearDefault) setDefaultDomainId('');
      showFlag('success', 'Usunięto', 'Domena usunięta');
    } else {
      showFlag('error', 'Błąd', 'Nie udało się usunąć domeny');
    }
  };

  const teamName = (teamId) => (teams.find(t => t.id === teamId) || {}).name || '-';

  if (loading) {
    return <div className="loading-container"><div className="spinner"></div></div>;
  }

  return (
    <div>
      <div className="section-header">
        <h3 className="section-title">Domeny (kategorie alertów)</h3>
        <p className="section-description">
          Użytkownik wybiera domenę w formularzu, a alert trafia do zespołu przypisanego do tej domeny
          i do jego dyżurnego. Team leaderów, product ownerów i delegatów do dyżuru ustawia się w zakładce Zespoły.
        </p>
      </div>

      {!selectedProject ? (
        <div className="message-box message-info">Wybierz projekt z listy powyżej.</div>
      ) : (
        <>
          <div className="mb-16">
            {domains.length === 0 ? (
              <div className="message-box message-info">Brak domen. Dodaj pierwszą poniżej.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Domena</th>
                    <th>Zespół</th>
                    <th>Aktywna</th>
                    <th>Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map(domain => {
                    const isEditing = editing && editing.id === domain.id;
                    return (
                      <tr key={domain.id}>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              className="form-input"
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            />
                          ) : (
                            <strong>{domain.name}</strong>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              className="form-select"
                              value={editing.teamId}
                              onChange={(e) => setEditing({ ...editing, teamId: e.target.value })}
                            >
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          ) : teamName(domain.teamId)}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={domain.enabled !== false}
                            onChange={() => handleToggle(domain)}
                          />
                        </td>
                        <td>
                          {isEditing ? (
                            <>
                              <button className="btn btn-primary btn-small" onClick={handleSaveEdit} disabled={saving}>Zapisz</button>
                              <button className="btn btn-default btn-small" onClick={() => setEditing(null)}>Anuluj</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-default btn-small" onClick={() => setEditing({ ...domain })}>Edytuj</button>
                              <button className="btn btn-default btn-small" onClick={() => handleDelete(domain)}>Usuń</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {domains.length > 0 && (
            <div className="mb-16" style={{ padding: '12px 16px', background: '#F4F5F7', borderRadius: '3px' }}>
              <label className="form-label" htmlFor="default-domain">Domena domyślna</label>
              <select
                id="default-domain"
                className="form-select"
                value={defaultDomainId}
                onChange={(e) => handleDefaultChange(e.target.value)}
              >
                <option value="">-- Brak (alerty bez domeny nie dostają zespołu) --</option>
                {domains.filter(d => d.enabled !== false).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <div className="form-helper">
                Alerty utworzone poza formularzem (np. bezpośrednio w Jirze) trafią do zespołu tej domeny.
              </div>
            </div>
          )}

          <JiraFieldImport
            showFlag={showFlag}
            selectedProject={selectedProject}
            issueTypeId={issueTypeId}
            domains={domains}
            teams={teams}
            domainFieldId={domainFieldId}
            persist={persist}
            onApplied={(newDomains, newTeams, fieldId) => { setDomains(newDomains); setTeams(newTeams); setDomainFieldId(fieldId); }}
          />

          <div className="mb-16">
            <h4 className="section-subtitle">Dodaj domenę</h4>
            <div className="form-group">
              <label className="form-label">Nazwa domeny *</label>
              <input
                type="text"
                className="form-input"
                placeholder="np. Płatności"
                value={newDomain.name}
                onChange={(e) => setNewDomain({ ...newDomain, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Opis</label>
              <input
                type="text"
                className="form-input"
                value={newDomain.description}
                onChange={(e) => setNewDomain({ ...newDomain, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Zespół</label>
              <select
                className="form-select"
                value={newDomain.teamId}
                onChange={(e) => setNewDomain({ ...newDomain, teamId: e.target.value })}
              >
                <option value="">-- Utwórz nowy zespół o tej nazwie --</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !newDomain.name.trim()}>
              {saving ? 'Dodawanie...' : 'Dodaj domenę'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default DomainsConfig;
