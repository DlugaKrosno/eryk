import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function Schedule({ projectKey, showFlag }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [users, setUsers] = useState([]);
  const [editingWeek, setEditingWeek] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWeek, setNewWeek] = useState({
    startDate: '',
    endDate: '',
    teamId: '',
    assignedPerson: ''
  });

  useEffect(() => {
    if (projectKey) {
      loadData();
    }
  }, [projectKey]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        // Pobierz zespoły i harmonogram
        const teamsData = projectConfigResult.config.escalationTeams || [];
        const scheduleData = projectConfigResult.config.teamSchedule || [];
        
        setTeams(Array.isArray(teamsData) ? teamsData : []);
        setSchedule(Array.isArray(scheduleData) ? scheduleData : []);
      } else {
        setTeams([]);
        setSchedule([]);
      }
      
      // Pobierz użytkowników projektu
      try {
        const usersResult = await invoke('getProjectUsers', { projectKey });
        if (usersResult.success && usersResult.users) {
          setUsers(usersResult.users);
        } else {
          setUsers([]);
        }
      } catch (userError) {
        console.error('Błąd ładowania użytkowników:', userError);
        setUsers([]);
      }
    } catch (error) {
      console.error('Błąd ładowania harmonogramu:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować harmonogramu');
    } finally {
      setLoading(false);
    }
  };

  const saveSchedule = async (updatedSchedule) => {
    try {
      setSaving(true);
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey };
      
      // Zaktualizuj konfigurację z nowym harmonogramem
      const updatedConfig = {
        ...currentConfig,
        teamSchedule: updatedSchedule
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Zapisano', 'Harmonogram dyżurów został zaktualizowany');
        setSchedule(updatedSchedule);
        return true;
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się zapisać harmonogramu');
        return false;
      }
    } catch (error) {
      console.error('Błąd zapisywania harmonogramu:', error);
      showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAddWeek = async () => {
    if (!newWeek.startDate || !newWeek.endDate || !newWeek.teamId) {
      showFlag('error', 'Błąd', 'Wypełnij wszystkie pola');
      return;
    }
    
    const weekToAdd = {
      id: Date.now().toString(),
      startDate: newWeek.startDate,
      endDate: newWeek.endDate,
      teamId: newWeek.teamId,
      assignedPerson: newWeek.assignedPerson || ''
    };
    
    const updatedSchedule = [...schedule, weekToAdd];
    const success = await saveSchedule(updatedSchedule);
    
    if (success) {
      setShowAddForm(false);
      setNewWeek({ startDate: '', endDate: '', teamId: '', assignedPerson: '' });
    }
  };

  const handleUpdateWeek = async () => {
    if (!editingWeek) return;
    
    // Znajdź wpis na podstawie ID lub pozycji
    const updatedSchedule = schedule.map((week, index) => {
      const weekId = week.id || `week-${index}-${week.startDate || Date.now()}`;
      return weekId === editingWeek.id ? editingWeek : week;
    });
    
    const success = await saveSchedule(updatedSchedule);
    
    if (success) {
      setEditingWeek(null);
    }
  };

  const handleDeleteWeek = async (weekId) => {
    if (!window.confirm('Czy na pewno chcesz usunąć ten wpis z harmonogramu?')) {
      return;
    }
    
    const updatedSchedule = schedule.filter((week, index) => {
      const currentId = week.id || `week-${index}-${week.startDate || Date.now()}`;
      return currentId !== weekId;
    });
    await saveSchedule(updatedSchedule);
  };

  const getTeamName = (teamId) => {
    const team = teams.find(t => t.id === teamId);
    return team ? team.name : 'Nieznany zespół';
  };

  const getCurrentWeek = () => {
    const today = new Date();
    return schedule.find(week => {
      if (!week.startDate || !week.endDate) return false;
      const start = new Date(week.startDate);
      const end = new Date(week.endDate);
      return today >= start && today <= end;
    });
  };

  // Upewnij się że wszystkie wpisy mają ID
  const scheduleWithIds = schedule.map((week, index) => ({
    ...week,
    id: week.id || `week-${index}-${week.startDate || Date.now()}`
  }));

  const sortedSchedule = [...scheduleWithIds].sort((a, b) => 
    new Date(a.startDate) - new Date(b.startDate)
  );

  const currentWeek = getCurrentWeek();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="message-box message-warning">
        <strong>Brak zespołów</strong>
        <div>Aby skonfigurować harmonogram dyżurów, najpierw dodaj zespoły w panelu administratora.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header flex-between mb-16">
        <div>
          <h3>Harmonogram Dyżurów</h3>
          <p style={{ fontSize: '14px', color: '#5E6C84', marginTop: '4px' }}>
            Zarządzaj harmonogramem dyżurów zespołów dla projektu {projectKey}
          </p>
        </div>
        <button 
          className="btn btn-primary"
          onClick={() => setShowAddForm(true)}
          disabled={saving}
        >
          + Dodaj Wpis
        </button>
      </div>

      {currentWeek && (
        <div className="message-box message-info" style={{ marginBottom: '16px' }}>
          <strong>Aktualny dyżur:</strong> {getTeamName(currentWeek.teamId)}
          <div style={{ fontSize: '13px', marginTop: '4px' }}>
            {new Date(currentWeek.startDate).toLocaleDateString('pl-PL')} - {new Date(currentWeek.endDate).toLocaleDateString('pl-PL')}
          </div>
        </div>
      )}

      {/* Formularz dodawania wpisu */}
      {showAddForm && (
        <div style={{
          background: '#F4F5F7',
          padding: '16px',
          borderRadius: '3px',
          marginBottom: '16px'
        }}>
          <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>Dodaj Nowy Wpis</h4>
          
          <div className="form-group">
            <label className="form-label">Data rozpoczęcia *</label>
            <input
              type="date"
              className="form-input"
              value={newWeek.startDate}
              onChange={(e) => setNewWeek({ ...newWeek, startDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Data zakończenia *</label>
            <input
              type="date"
              className="form-input"
              value={newWeek.endDate}
              onChange={(e) => setNewWeek({ ...newWeek, endDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Zespół dyżurny *</label>
            <select
              className="form-select"
              value={newWeek.teamId}
              onChange={(e) => setNewWeek({ ...newWeek, teamId: e.target.value })}
            >
              <option value="">-- Wybierz zespół --</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Osoba przypisana (Account ID)</label>
            {users.length > 0 ? (
              <select
                className="form-select"
                value={newWeek.assignedPerson || ''}
                onChange={(e) => setNewWeek({ ...newWeek, assignedPerson: e.target.value })}
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
                value={newWeek.assignedPerson || ''}
                onChange={(e) => setNewWeek({ ...newWeek, assignedPerson: e.target.value })}
              />
            )}
            <div className="form-helper">
              {users.length > 0 
                ? 'Wybierz użytkownika z listy lub wpisz email/Account ID'
                : 'Wpisz email użytkownika lub Account ID (np. 557058:abc123def456)'}
            </div>
          </div>

          <div className="flex flex-gap">
            <button 
              className="btn btn-primary"
              onClick={handleAddWeek}
              disabled={saving}
            >
              {saving ? 'Zapisywanie...' : 'Dodaj'}
            </button>
            <button 
              className="btn btn-default"
              onClick={() => {
                setShowAddForm(false);
                setNewWeek({ startDate: '', endDate: '', teamId: '', assignedPerson: '' });
              }}
              disabled={saving}
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Lista wpisów harmonogramu */}
      {sortedSchedule.length === 0 ? (
        <div className="message-box message-info">
          Brak wpisów w harmonogramie. Dodaj pierwszy wpis, aby rozpocząć planowanie dyżurów.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Data rozpoczęcia</th>
              <th>Data zakończenia</th>
              <th>Zespół dyżurny</th>
              <th>Osoba przypisana (Account ID)</th>
              <th>Status</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {sortedSchedule.map(week => {
              const isEditing = editingWeek && editingWeek.id === week.id;
              const today = new Date();
              const start = new Date(week.startDate);
              const end = new Date(week.endDate);
              const isCurrent = today >= start && today <= end;
              const isPast = today > end;
              const isFuture = today < start;

              return (
                <tr key={week.id} style={isCurrent ? { backgroundColor: '#E3FCEF' } : {}}>
                  <td>
                    {isEditing ? (
                      <input
                        type="date"
                        className="form-input"
                        value={editingWeek.startDate}
                        onChange={(e) => setEditingWeek({ ...editingWeek, startDate: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      new Date(week.startDate).toLocaleDateString('pl-PL')
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="date"
                        className="form-input"
                        value={editingWeek.endDate}
                        onChange={(e) => setEditingWeek({ ...editingWeek, endDate: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      new Date(week.endDate).toLocaleDateString('pl-PL')
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="form-select"
                        value={editingWeek.teamId}
                        onChange={(e) => setEditingWeek({ ...editingWeek, teamId: e.target.value })}
                        style={{ width: '100%' }}
                      >
                        {teams.map(team => (
                          <option key={team.id} value={team.id}>{team.name}</option>
                        ))}
                      </select>
                    ) : (
                      getTeamName(week.teamId)
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      users.length > 0 ? (
                        <select
                          className="form-select"
                          value={editingWeek.assignedPerson || ''}
                          onChange={(e) => setEditingWeek({ ...editingWeek, assignedPerson: e.target.value })}
                          style={{ width: '100%' }}
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
                          placeholder="Email lub Account ID"
                          value={editingWeek.assignedPerson || ''}
                          onChange={(e) => setEditingWeek({ ...editingWeek, assignedPerson: e.target.value })}
                          style={{ width: '100%' }}
                        />
                      )
                    ) : (
                      week.assignedPerson ? (
                        users.find(u => u.accountId === week.assignedPerson)?.displayName || week.assignedPerson
                      ) : (
                        <span style={{ color: '#5E6C84', fontStyle: 'italic' }}>Nie przypisano</span>
                      )
                    )}
                  </td>
                  <td>
                    {isCurrent && <span style={{ color: '#00875A', fontWeight: 'bold' }}>● Aktualny</span>}
                    {isPast && <span style={{ color: '#5E6C84' }}>Zakończony</span>}
                    {isFuture && <span style={{ color: '#0052CC' }}>Zaplanowany</span>}
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="flex flex-gap">
                        <button 
                          className="btn btn-primary btn-small"
                          onClick={handleUpdateWeek}
                          disabled={saving}
                        >
                          Zapisz
                        </button>
                        <button 
                          className="btn btn-default btn-small"
                          onClick={() => setEditingWeek(null)}
                          disabled={saving}
                        >
                          Anuluj
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-gap">
                        <button 
                          className="btn btn-default btn-small"
                          onClick={() => setEditingWeek({ ...week })}
                          disabled={saving}
                        >
                          Edytuj
                        </button>
                        <button 
                          className="btn btn-default btn-small"
                          onClick={() => handleDeleteWeek(week.id)}
                          disabled={saving}
                          style={{ color: '#DE350B' }}
                        >
                          Usuń
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Schedule;
