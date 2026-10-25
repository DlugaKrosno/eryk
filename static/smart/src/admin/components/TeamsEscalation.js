import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import UserMultiSelect from './UserMultiSelect';
import DutySchedule from './DutySchedule';

// Wpisy harmonogramu zapisane wcześniej nie mają id - potrzebne do edycji i usuwania
const withIds = (list) => (Array.isArray(list) ? list : []).map((entry, i) => (
  entry.id ? entry : { ...entry, id: `shift-legacy-${i}` }
));

function TeamsEscalation({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [editingTeam, setEditingTeam] = useState(null);
  const [showAddTeamForm, setShowAddTeamForm] = useState(false);
  const [users, setUsers] = useState([]);
  const [newTeam, setNewTeam] = useState({
    name: '',
    description: '',
    teamLeaders: [],
    productOwners: [],
    delegates: [],
    teamsWebhookUrl: '',
    dutyDmWorkflowUrl: ''
  });

  useEffect(() => {
    if (selectedProject) {
      loadTeams();
      loadSchedule();
      loadUsers();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);

  const loadUsers = async () => {
    if (!selectedProject) return;
    
    try {
      const result = await invoke('getProjectUsers', { projectKey: selectedProject });
      
      if (result.success && result.users) {
        setUsers(result.users);
      } else {
        setUsers([]);
      }
    } catch (error) {
      console.error('Błąd ładowania użytkowników:', error);
      setUsers([]);
    }
  };

  const loadTeams = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        const teamsData = projectConfigResult.config.escalationTeams || [];
        setTeams(Array.isArray(teamsData) ? teamsData : []);
      } else {
        setTeams([]);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować zespołów');
      setTeams([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedule = async () => {
    if (!selectedProject) return;
    
    try {
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        const scheduleData = projectConfigResult.config.teamSchedule || [];
        setSchedule(withIds(scheduleData));
      } else {
        setSchedule([]);
      }
    } catch (error) {
      console.error('Błąd ładowania harmonogramu:', error);
      setSchedule([]);
    }
  };

  const saveTeamsToProject = async (updatedTeams) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return false;
    }
    
    // Pobierz aktualną konfigurację projektu
    const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
    const currentConfig = projectConfigResult.success && projectConfigResult.config 
      ? projectConfigResult.config 
      : { projectKey: selectedProject };
    
    // Zaktualizuj konfigurację z nowymi zespołami
    const updatedConfig = {
      ...currentConfig,
      escalationTeams: updatedTeams
    };
    
    const result = await invoke('saveProjectConfig', {
      projectKey: selectedProject,
      config: updatedConfig
    });
    
    return result.success;
  };

  const userLabels = (ids) => (ids || [])
    .map(id => (users.find(u => u.accountId === id) || {}).displayName || id)
    .join(', ') || '-';

  const handleTestTeamWebhook = async (team) => {
    if (!team.teamsWebhookUrl || !team.teamsWebhookUrl.trim()) {
      showFlag('error', 'Błąd', 'Zespół nie ma ustawionego adresu Teams Workflow');
      return;
    }
    
    try {
      showFlag('info', 'Testowanie', `Wysyłanie testowej wiadomości do zespołu ${team.name}...`);
      
      const result = await invoke('testTeamsWebhook', { 
        webhookUrl: team.teamsWebhookUrl,
        projectKey: selectedProject 
      });
      
      if (result.success) {
        showFlag('success', 'Sukces', result.message || `Testowa wiadomość wysłana pomyślnie do zespołu ${team.name}. Sprawdź kanał Teams.`);
      } else {
        showFlag('error', 'Błąd', result.error || `Nie udało się wysłać testowej wiadomości do zespołu ${team.name}`);
      }
    } catch (error) {
      console.error('Błąd testowania webhooka zespołu:', error);
      showFlag('error', 'Błąd', `Błąd: ${error.message || 'Nie udało się wysłać testowej wiadomości'}`);
    }
  };

  const handleAddTeam = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!newTeam.name.trim()) {
      showFlag('error', 'Błąd', 'Nazwa zespołu jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const updatedTeams = [...teams, { ...newTeam, id: Date.now().toString() }];
      
      const success = await saveTeamsToProject(updatedTeams);
      
      if (success) {
        showFlag('success', 'Sukces', 'Zespół dodany');
        setTeams(updatedTeams);
        setNewTeam({
          name: '',
          description: '',
          teamLeaders: [],
          productOwners: [],
          delegates: [],
          teamsWebhookUrl: '',
          dutyDmWorkflowUrl: ''
        });
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać zespołu');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się dodać zespołu');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async (teamId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!window.confirm('Czy na pewno chcesz usunąć ten zespół?')) {
      return;
    }

    try {
      setSaving(true);
      const updatedTeams = teams.filter(t => t.id !== teamId);
      
      const success = await saveTeamsToProject(updatedTeams);
      
      if (success) {
        showFlag('success', 'Usunięto', 'Zespół usunięty');
        setTeams(updatedTeams);
      } else {
        showFlag('error', 'Błąd', 'Nie udało się usunąć zespołu');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się usunąć zespołu');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTeam = async (teamId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    try {
      setSaving(true);
      const updatedTeams = teams.map(t => 
        t.id === teamId ? editingTeam : t
      );
      
      const success = await saveTeamsToProject(updatedTeams);
      
      if (success) {
        showFlag('success', 'Zaktualizowano', 'Zespół zaktualizowany');
        setTeams(updatedTeams);
        setEditingTeam(null);
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zaktualizować zespołu');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zaktualizować zespołu');
    } finally {
      setSaving(false);
    }
  };

  const saveScheduleToProject = async (updatedSchedule) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return false;
    }
    
    // Pobierz aktualną konfigurację projektu
    const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
    const currentConfig = projectConfigResult.success && projectConfigResult.config 
      ? projectConfigResult.config 
      : { projectKey: selectedProject };
    
    // Zaktualizuj konfigurację z nowym harmonogramem
    const updatedConfig = {
      ...currentConfig,
      teamSchedule: updatedSchedule
    };
    
    const result = await invoke('saveProjectConfig', {
      projectKey: selectedProject,
      config: updatedConfig
    });
    
    return result.success;
  };

  const handleSaveSchedule = async (updatedSchedule) => {
    try {
      setSaving(true);
      const success = await saveScheduleToProject(updatedSchedule);
      if (success) {
        setSchedule(updatedSchedule);
        showFlag('success', 'Zapisano', 'Harmonogram dyżurów zapisany');
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
      }
      return success;
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h3 className="section-title">Zespoły i dyżury</h3>
        <p className="section-description">
          Zarządzaj zespołami, delegatami do dyżuru, harmonogramem i powiadomieniami Teams. Zespoły powstają też automatycznie przy dodawaniu domeny.
        </p>
      </div>

      {/* Lista Zespołów */}
      <div className="mb-16">
        <h4 className="section-subtitle">Zespoły</h4>
        
        {teams.length === 0 ? (
          <div className="message-box message-info">
            Brak zdefiniowanych zespołów. Dodaj pierwszy zespół poniżej.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Opis</th>
                <th>Team leaderzy</th>
                <th>Product ownerzy</th>
                <th>Delegaci do dyżuru</th>
                <th>Powiadomienia Teams</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <input
                        type="text"
                        className="form-input"
                        value={editingTeam.name}
                        onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                      />
                    ) : (
                      <strong>{team.name}</strong>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <input
                        type="text"
                        className="form-input"
                        value={editingTeam.description}
                        onChange={(e) => setEditingTeam({ ...editingTeam, description: e.target.value })}
                      />
                    ) : (
                      team.description || '-'
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <UserMultiSelect
                        users={users}
                        value={editingTeam.teamLeaders}
                        onChange={(teamLeaders) => setEditingTeam({ ...editingTeam, teamLeaders })}
                      />
                    ) : (
                      <small>{userLabels(team.teamLeaders)}</small>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <UserMultiSelect
                        users={users}
                        value={editingTeam.productOwners}
                        onChange={(productOwners) => setEditingTeam({ ...editingTeam, productOwners })}
                      />
                    ) : (
                      <small>{userLabels(team.productOwners)}</small>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <UserMultiSelect
                        users={users}
                        value={editingTeam.delegates}
                        onChange={(delegates) => setEditingTeam({ ...editingTeam, delegates })}
                      />
                    ) : (
                      <small>{userLabels(team.delegates)}</small>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <div>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="Workflow: kanał zespołu"
                          value={editingTeam.teamsWebhookUrl || ''}
                          onChange={(e) => setEditingTeam({ ...editingTeam, teamsWebhookUrl: e.target.value })}
                        />
                        <input
                          type="url"
                          className="form-input"
                          style={{ marginTop: '6px' }}
                          placeholder="Workflow: wiadomość do dyżurnego (opcjonalnie)"
                          value={editingTeam.dutyDmWorkflowUrl || ''}
                          onChange={(e) => setEditingTeam({ ...editingTeam, dutyDmWorkflowUrl: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {team.teamsWebhookUrl ? (
                          <>
                            <span>✓ Kanał{team.dutyDmWorkflowUrl ? ' + DM' : ''}</span>
                            <button
                              className="btn btn-default btn-small"
                              onClick={() => handleTestTeamWebhook(team)}
                              title="Testuj webhook"
                            >
                              Test
                            </button>
                          </>
                        ) : (
                          <span>✗ Nie ustawiono</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <>
                        <button
                          className="btn btn-primary btn-small"
                          onClick={() => handleUpdateTeam(team.id)}
                          disabled={saving}
                        >
                          Zapisz
                        </button>
                        <button
                          className="btn btn-default btn-small"
                          onClick={() => setEditingTeam(null)}
                        >
                          Anuluj
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-default btn-small"
                          onClick={() => setEditingTeam(team)}
                        >
                          Edytuj
                        </button>
                        <button
                          className="btn btn-default btn-small"
                          onClick={() => handleDeleteTeam(team.id)}
                          disabled={saving}
                        >
                          Usuń
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dodaj Nowy Zespół */}
      <div className="mb-16">
        <div className="flex flex-between mb-16">
          <h4 className="section-subtitle">Dodaj Nowy Zespół</h4>
          <button
            className="btn btn-default"
            onClick={() => setShowAddTeamForm(!showAddTeamForm)}
          >
            {showAddTeamForm ? '▼ Ukryj' : '▶ Pokaż formularz'}
          </button>
        </div>
        
        {showAddTeamForm && (
        <div>
        <div className="form-group">
          <label className="form-label">Nazwa Zespołu *</label>
          <input
            type="text"
            className="form-input"
            placeholder="np. Backend Team, Infrastruktura"
            value={newTeam.name}
            onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Opis</label>
          <input
            type="text"
            className="form-input"
            placeholder="Zakres odpowiedzialności zespołu"
            value={newTeam.description}
            onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Team leaderzy (obserwatorzy alertów zespołu)</label>
          <UserMultiSelect
            users={users}
            value={newTeam.teamLeaders}
            onChange={(teamLeaders) => setNewTeam({ ...newTeam, teamLeaders })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Product ownerzy domeny (obserwatorzy alertów zespołu)</label>
          <UserMultiSelect
            users={users}
            value={newTeam.productOwners}
            onChange={(productOwners) => setNewTeam({ ...newTeam, productOwners })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Delegaci do dyżuru</label>
          <UserMultiSelect
            users={users}
            value={newTeam.delegates}
            onChange={(delegates) => setNewTeam({ ...newTeam, delegates })}
          />
          <div className="form-helper">
            Osoby, które zespół deleguje do dyżurów - tylko je można wybrać w harmonogramie
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Teams Workflow URL - kanał zespołu</label>
          <input
            type="url"
            className="form-input"
            placeholder="https://prod-xx.westeurope.logic.azure.com/workflows/..."
            value={newTeam.teamsWebhookUrl}
            onChange={(e) => setNewTeam({ ...newTeam, teamsWebhookUrl: e.target.value })}
          />
          <div className="form-helper">
            Adres z Teams Workflows (szablon "Post to a channel when a webhook request is received").
            Webhooki Office 365 zostały wycofane.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Teams Workflow URL - wiadomość do dyżurnego (opcjonalnie)</label>
          <input
            type="url"
            className="form-input"
            placeholder="https://prod-xx.westeurope.logic.azure.com/workflows/..."
            value={newTeam.dutyDmWorkflowUrl}
            onChange={(e) => setNewTeam({ ...newTeam, dutyDmWorkflowUrl: e.target.value })}
          />
          <div className="form-helper">
            Workflow dostaje pola recipientEmail i recipientName oraz kartę w attachments i wysyła ją w czacie do dyżurnego
          </div>
        </div>


        <button
          className="btn btn-primary"
          onClick={handleAddTeam}
          disabled={saving || !newTeam.name.trim()}
        >
          {saving ? 'Dodawanie...' : 'Dodaj Zespół'}
        </button>
        </div>
        )}
      </div>

      <DutySchedule
        teams={teams}
        schedule={schedule}
        users={users}
        saving={saving}
        onSave={handleSaveSchedule}
      />
    </div>
  );
}

export default TeamsEscalation;
