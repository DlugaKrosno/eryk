import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

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
    members: '',
    teamsWebhookUrl: ''
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
        // Pobierz escalationTeams z konfiguracji projektu lub z globalnych
        const teamsData = projectConfigResult.config.escalationTeams || 
                         (await invoke('getConfig', { configType: 'teams' })).data || [];
        setTeams(Array.isArray(teamsData) ? teamsData : []);
      } else {
        // Fallback do globalnych zespołów
        const result = await invoke('getConfig', { configType: 'teams' });
        setTeams(result.success && result.data ? (Array.isArray(result.data) ? result.data : []) : []);
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
        // Pobierz teamSchedule z konfiguracji projektu lub z globalnych
        const scheduleData = projectConfigResult.config.teamSchedule || 
                            (await invoke('getConfig', { configType: 'schedule' })).data || [];
        setSchedule(Array.isArray(scheduleData) ? scheduleData : []);
      } else {
        // Fallback do globalnego harmonogramu
        const result = await invoke('getConfig', { configType: 'schedule' });
        setSchedule(result.success && result.data ? (Array.isArray(result.data) ? result.data : []) : []);
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

  const handleTestTeamWebhook = async (team) => {
    if (!team.teamsWebhookUrl || !team.teamsWebhookUrl.trim()) {
      showFlag('error', 'Błąd', 'Zespół nie ma skonfigurowanego webhooka Teams');
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
          members: '',
          teamsWebhookUrl: ''
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

  const handleUpdateSchedule = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    try {
      setSaving(true);
      
      const success = await saveScheduleToProject(schedule);
      
      if (success) {
        showFlag('success', 'Zapisano', 'Harmonogram zapisany');
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
    } finally {
      setSaving(false);
    }
  };

  const addWeekToSchedule = () => {
    const newWeek = {
      weekNumber: schedule.length + 1,
      teamId: teams.length > 0 ? teams[0].id : '',
      startDate: '',
      endDate: '',
      assignedPerson: '' // Account ID osoby przypisanej do zgłoszeń w tym tygodniu
    };
    setSchedule([...schedule, newWeek]);
  };

  const updateScheduleWeek = (index, field, value) => {
    const updatedSchedule = [...schedule];
    updatedSchedule[index][field] = value;
    setSchedule(updatedSchedule);
  };

  const removeWeekFromSchedule = (index) => {
    setSchedule(schedule.filter((_, i) => i !== index));
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
        <h3 className="section-title">Zespoły i Eskalacja</h3>
        <p className="section-description">
          Zarządzaj zespołami wsparcia, SLA, harmonogramem dyżurów i integracją Teams.
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
                <th>Członkowie</th>
                <th>Teams Webhook</th>
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
                      <textarea
                        className="form-textarea"
                        value={editingTeam.members || ''}
                        onChange={(e) => setEditingTeam({ ...editingTeam, members: e.target.value })}
                        rows={2}
                      />
                    ) : (
                      <small>{team.members || '-'}</small>
                    )}
                  </td>
                  <td>
                    {editingTeam && editingTeam.id === team.id ? (
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://..."
                        value={editingTeam.teamsWebhookUrl || ''}
                        onChange={(e) => setEditingTeam({ ...editingTeam, teamsWebhookUrl: e.target.value })}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {team.teamsWebhookUrl ? (
                          <>
                            <span>✓ Skonfigurowany</span>
                            <button
                              className="btn btn-default btn-small"
                              onClick={() => handleTestTeamWebhook(team)}
                              title="Testuj webhook"
                            >
                              Test
                            </button>
                          </>
                        ) : (
                          <span>✗ Brak</span>
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
          <label className="form-label">Członkowie (adresy email, oddzielone przecinkami)</label>
          <textarea
            className="form-textarea"
            placeholder="jan.kowalski@example.com, anna.nowak@example.com"
            value={newTeam.members}
            onChange={(e) => setNewTeam({ ...newTeam, members: e.target.value })}
            rows={3}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Webhook URL Microsoft Teams</label>
          <input
            type="url"
            className="form-input"
            placeholder="https://outlook.office.com/webhook/..."
            value={newTeam.teamsWebhookUrl}
            onChange={(e) => setNewTeam({ ...newTeam, teamsWebhookUrl: e.target.value })}
          />
          <div className="form-helper">
            Powiadomienia będą wysyłane na ten kanał Teams przy przypisaniu alertu do zespołu
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

      {/* Harmonogram Tygodniowy */}
      <div className="mb-16">
        <h4 className="section-subtitle">Harmonogram Dyżurów (Rotacja Tygodniowa)</h4>
        <div className="form-helper mb-16">
          Określ, który zespół jest na dyżurze w danym tygodniu
        </div>

        {schedule.length === 0 ? (
          <div className="message-box message-info">
            Brak harmonogramu. Dodaj pierwszy tydzień poniżej.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tydzień</th>
                <th>Zespół</th>
                <th>Osoba przypisana (Account ID)</th>
                <th>Data Start</th>
                <th>Data Koniec</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((week, index) => (
                <tr key={index}>
                  <td>{week.weekNumber}</td>
                  <td>
                    <select
                      className="form-select"
                      value={week.teamId}
                      onChange={(e) => updateScheduleWeek(index, 'teamId', e.target.value)}
                    >
                      <option value="">-- Wybierz zespół --</option>
                      {teams.map(team => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {users.length > 0 ? (
                      <select
                        className="form-select"
                        value={week.assignedPerson || ''}
                        onChange={(e) => updateScheduleWeek(index, 'assignedPerson', e.target.value)}
                      >
                        <option value="">-- Wybierz użytkownika --</option>
                        {users.map(user => (
                          <option key={user.accountId} value={user.accountId}>
                            {user.displayName} ({user.emailAddress || user.accountId})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Email lub Account ID (np. user@example.com lub 557058:abc123def456)"
                        value={week.assignedPerson || ''}
                        onChange={(e) => updateScheduleWeek(index, 'assignedPerson', e.target.value)}
                      />
                    )}
                    <div className="form-helper">
                      {users.length > 0 
                        ? 'Wybierz użytkownika z listy lub wpisz email/Account ID'
                        : 'Wpisz email użytkownika lub Account ID (np. 557058:abc123def456)'}
                    </div>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="form-input"
                      value={week.startDate}
                      onChange={(e) => updateScheduleWeek(index, 'startDate', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="form-input"
                      value={week.endDate}
                      onChange={(e) => updateScheduleWeek(index, 'endDate', e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => removeWeekFromSchedule(index)}
                    >
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex flex-gap mt-16">
          <button
            className="btn btn-default"
            onClick={addWeekToSchedule}
            disabled={teams.length === 0}
          >
            Dodaj Tydzień
          </button>
          <button
            className="btn btn-primary"
            onClick={handleUpdateSchedule}
            disabled={saving || schedule.length === 0}
          >
            {saving ? 'Zapisywanie...' : 'Zapisz Harmonogram'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TeamsEscalation;
