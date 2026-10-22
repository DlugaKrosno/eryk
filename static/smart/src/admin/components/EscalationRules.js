import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function EscalationRules({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState([]);
  const [teams, setTeams] = useState([]);
  const [editingRule, setEditingRule] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    enabled: true,
    order: 0,
    conditions: {
      priorities: [],
      categories: [],
      environments: [],
      impacts: []
    },
      actions: {
        assignToTeam: '',
        sendNotification: true
      },
    sla: {
      responseTimeMinutes: {
        P1: 15,
        P2: 30,
        P3: 60,
        P4: 240
      },
      resolutionTimeHours: {
        P1: 4,
        P2: 8,
        P3: 24,
        P4: 72
      }
    },
    reminders: {
      enabled: true,
      intervalMinutes: 30,
      maxReminders: 5,
      notifyChannels: ['teams', 'email']
    },
    escalationPath: [
      {
        level: 1,
        afterMinutes: 30,
        assignToTeam: '',
        notifyManagement: false
      }
    ]
  });

  useEffect(() => {
    if (selectedProject) {
      loadRules();
      loadTeams();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);

  const loadRules = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        // Pobierz escalationRules z konfiguracji projektu lub z globalnych
        const rulesData = projectConfigResult.config.escalationRules || 
                         (await invoke('getConfig', { configType: 'escalation_rules' })).data || [];
        setRules(Array.isArray(rulesData) ? rulesData : []);
      } else {
        // Fallback do globalnych reguł
        const result = await invoke('getConfig', { configType: 'escalation_rules' });
        setRules(result.success && result.data ? (Array.isArray(result.data) ? result.data : []) : []);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować reguł eskalacji');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTeams = async () => {
    try {
      const result = await invoke('getConfig', { configType: 'teams' });
      
      if (result.success && result.data) {
        const teamsData = Array.isArray(result.data) ? result.data : [];
        setTeams(teamsData);
      } else {
        setTeams([]);
      }
    } catch (error) {
      console.error('Błąd ładowania zespołów:', error);
      setTeams([]);
    }
  };

  const handleAddRule = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!newRule.name.trim()) {
      showFlag('error', 'Błąd', 'Nazwa reguły jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const updatedRules = [...rules, { ...newRule, id: Date.now().toString() }];
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        escalationRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Sukces', 'Reguła eskalacji dodana');
        setRules(updatedRules);
        setShowAddForm(false);
        resetNewRule();
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się dodać reguły');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!window.confirm('Czy na pewno chcesz usunąć tę regułę eskalacji?')) {
      return;
    }

    try {
      setSaving(true);
      const updatedRules = rules.filter(r => r.id !== ruleId);
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        escalationRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Usunięto', 'Reguła eskalacji usunięta');
        setRules(updatedRules);
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się usunąć reguły');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRule = async (ruleId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    try {
      setSaving(true);
      const updatedRules = rules.map(r => 
        r.id === ruleId ? editingRule : r
      );
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        escalationRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Zaktualizowano', 'Reguła eskalacji zaktualizowana');
        setRules(updatedRules);
        setEditingRule(null);
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zaktualizować reguły');
    } finally {
      setSaving(false);
    }
  };

  const resetNewRule = () => {
    setNewRule({
      name: '',
      description: '',
      enabled: true,
      order: 0,
      conditions: {
        priorities: [],
        categories: [],
        environments: [],
        impacts: []
      },
      actions: {
        sendNotification: true
      },
      sla: {
        responseTimeMinutes: {
          P1: 15,
          P2: 30,
          P3: 60,
          P4: 240
        },
        resolutionTimeHours: {
          P1: 4,
          P2: 8,
          P3: 24,
          P4: 72
        }
      },
      reminders: {
        enabled: true,
        intervalMinutes: 30,
        maxReminders: 5,
        notifyChannels: ['teams', 'email']
      },
      escalationPath: [
        {
          level: 1,
          afterMinutes: 30,
          assignToTeam: '',
          assignToUser: '',
          notifyManagement: false
        }
      ]
    });
  };

  const addEscalationLevel = (rule, setRule) => {
    const newLevel = {
      level: rule.escalationPath.length + 1,
      afterMinutes: 60,
      assignToTeam: '',
      notifyManagement: false
    };
    setRule({ ...rule, escalationPath: [...rule.escalationPath, newLevel] });
  };

  const removeEscalationLevel = (rule, setRule, index) => {
    const updatedPath = rule.escalationPath.filter((_, i) => i !== index);
    setRule({ ...rule, escalationPath: updatedPath });
  };

  const updateEscalationLevel = (rule, setRule, index, field, value) => {
    const updatedPath = [...rule.escalationPath];
    updatedPath[index][field] = value;
    setRule({ ...rule, escalationPath: updatedPath });
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
        <h3 className="section-title">Reguły Eskalacji</h3>
        <p className="section-description">
          Skonfiguruj reguły eskalacji, SLA, przypomnienia i ścieżki eskalacji dla alertów.
        </p>
      </div>

      {!selectedProject && (
        <div className="message-box message-warning">
          <strong>Wybierz projekt:</strong> Wybierz projekt z listy powyżej, aby skonfigurować reguły eskalacji.
        </div>
      )}

      {/* Lista Reguł */}
      <div className="mb-16">
        <div className="flex flex-between mb-16">
          <h4 className="section-subtitle">Reguły ({rules.length})</h4>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Anuluj' : 'Dodaj Regułę'}
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="message-box message-info">
            Brak reguł eskalacji. Dodaj pierwszą regułę.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Warunki</th>
                <th>SLA (min)</th>
                <th>Przypisanie</th>
                <th>Przypomnienia</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {rules.sort((a, b) => a.order - b.order).map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <strong>{rule.name}</strong>
                    <br />
                    <small>{rule.description}</small>
                  </td>
                  <td>
                    <small>
                      {rule.conditions.priorities.length > 0 && `Priorytety: ${rule.conditions.priorities.join(', ')}`}
                      {rule.conditions.categories.length > 0 && <><br />Kategorie: {rule.conditions.categories.join(', ')}</>}
                    </small>
                  </td>
                  <td>
                    <small>
                      P1: {rule.sla?.responseTimeMinutes?.P1 || 15}m<br />
                      P2: {rule.sla?.responseTimeMinutes?.P2 || 30}m<br />
                      P3: {rule.sla?.responseTimeMinutes?.P3 || 60}m<br />
                      P4: {rule.sla?.responseTimeMinutes?.P4 || 240}m
                    </small>
                  </td>
                  <td>
                    <small>
                      {teams.find(t => t.id === rule.actions.assignToTeam)?.name || '-'}
                      <br />
                      <em>Przypisanie z harmonogramu dyżurów</em>
                    </small>
                  </td>
                  <td>
                    <small>
                      {rule.reminders?.enabled ? `Co ${rule.reminders.intervalMinutes}m (max ${rule.reminders.maxReminders})` : 'Wyłączone'}
                    </small>
                  </td>
                  <td>
                    <span className={rule.enabled ? 'badge-success' : 'badge-disabled'}>
                      {rule.enabled ? 'Aktywna' : 'Nieaktywna'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => setEditingRule(rule)}
                    >
                      Edytuj
                    </button>
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={saving}
                    >
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Formularz Dodawania/Edycji Reguły */}
      {(showAddForm || editingRule) && (
        <div className="rule-form-container">
          <h4 className="section-subtitle">{editingRule ? 'Edytuj Regułę' : 'Nowa Reguła Eskalacji'}</h4>
          
          {renderRuleForm(
            editingRule || newRule,
            editingRule ? setEditingRule : setNewRule,
            editingRule ? () => handleUpdateRule(editingRule.id) : handleAddRule,
            editingRule ? () => setEditingRule(null) : () => setShowAddForm(false)
          )}
        </div>
      )}
    </div>
  );

  function renderRuleForm(rule, setRule, onSave, onCancel) {
    return (
      <div className="form-container">
        {/* Podstawowe Informacje */}
        <div className="form-section">
          <h5>Informacje Podstawowe</h5>
          
          <div className="form-group">
            <label className="form-label">Nazwa Reguły *</label>
            <input
              type="text"
              className="form-input"
              placeholder="np. Eskalacja dla alertów P1"
              value={rule.name}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Opis</label>
            <textarea
              className="form-textarea"
              placeholder="Opis zasady eskalacji"
              value={rule.description}
              onChange={(e) => setRule({ ...rule, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                className="form-checkbox"
                checked={rule.enabled}
                onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
              />
              Reguła aktywna
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">Kolejność (priorytet)</label>
            <input
              type="number"
              className="form-input"
              value={rule.order}
              onChange={(e) => setRule({ ...rule, order: parseInt(e.target.value) || 0 })}
            />
            <div className="form-helper">Niższy numer = wyższy priorytet</div>
          </div>
        </div>

        {/* Warunki */}
        <div className="form-section">
          <h5>Warunki</h5>
          
          <div className="form-group">
            <label className="form-label">Priorytety</label>
            <div className="checkbox-group">
              {['P1', 'P2', 'P3', 'P4'].map(priority => (
                <label key={priority}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={rule.conditions.priorities.includes(priority)}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...rule.conditions.priorities, priority]
                        : rule.conditions.priorities.filter(p => p !== priority);
                      setRule({ ...rule, conditions: { ...rule.conditions, priorities: updated } });
                    }}
                  />
                  {priority}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Kategorie (oddzielone przecinkami)</label>
            <input
              type="text"
              className="form-input"
              placeholder="np. Awaria, Performance, Security"
              value={rule.conditions.categories.join(', ')}
              onChange={(e) => setRule({ 
                ...rule, 
                conditions: { 
                  ...rule.conditions, 
                  categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                } 
              })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Środowiska (oddzielone przecinkami)</label>
            <input
              type="text"
              className="form-input"
              placeholder="np. Produkcja, UAT"
              value={rule.conditions.environments.join(', ')}
              onChange={(e) => setRule({ 
                ...rule, 
                conditions: { 
                  ...rule.conditions, 
                  environments: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                } 
              })}
            />
          </div>
        </div>


        {/* SLA */}
        <div className="form-section">
          <h5>SLA - Czas Reakcji (minuty)</h5>
          
          <div className="sla-grid">
            {['P1', 'P2', 'P3', 'P4'].map(priority => (
              <div key={priority} className="form-group">
                <label className="form-label">{priority}</label>
                <input
                  type="number"
                  className="form-input"
                  value={rule.sla?.responseTimeMinutes?.[priority] || 0}
                  onChange={(e) => setRule({ 
                    ...rule, 
                    sla: { 
                      ...rule.sla, 
                      responseTimeMinutes: { 
                        ...rule.sla.responseTimeMinutes, 
                        [priority]: parseInt(e.target.value) || 0 
                      } 
                    } 
                  })}
                />
              </div>
            ))}
          </div>

          <h5 className="mt-16">SLA - Czas Rozwiązania (godziny)</h5>
          
          <div className="sla-grid">
            {['P1', 'P2', 'P3', 'P4'].map(priority => (
              <div key={priority} className="form-group">
                <label className="form-label">{priority}</label>
                <input
                  type="number"
                  className="form-input"
                  value={rule.sla?.resolutionTimeHours?.[priority] || 0}
                  onChange={(e) => setRule({ 
                    ...rule, 
                    sla: { 
                      ...rule.sla, 
                      resolutionTimeHours: { 
                        ...rule.sla.resolutionTimeHours, 
                        [priority]: parseInt(e.target.value) || 0 
                      } 
                    } 
                  })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Przypomnienia */}
        <div className="form-section">
          <h5>Przypomnienia</h5>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                className="form-checkbox"
                checked={rule.reminders?.enabled}
                onChange={(e) => setRule({ ...rule, reminders: { ...rule.reminders, enabled: e.target.checked } })}
              />
              Włącz automatyczne przypomnienia
            </label>
          </div>

          {rule.reminders?.enabled && (
            <>
              <div className="form-group">
                <label className="form-label">Interwał przypomnień (minuty)</label>
                <input
                  type="number"
                  className="form-input"
                  value={rule.reminders.intervalMinutes}
                  onChange={(e) => setRule({ ...rule, reminders: { ...rule.reminders, intervalMinutes: parseInt(e.target.value) || 30 } })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Maksymalna liczba przypomnień</label>
                <input
                  type="number"
                  className="form-input"
                  value={rule.reminders.maxReminders}
                  onChange={(e) => setRule({ ...rule, reminders: { ...rule.reminders, maxReminders: parseInt(e.target.value) || 5 } })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Kanały powiadomień</label>
                <div className="checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={rule.reminders.notifyChannels.includes('teams')}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...rule.reminders.notifyChannels, 'teams']
                          : rule.reminders.notifyChannels.filter(c => c !== 'teams');
                        setRule({ ...rule, reminders: { ...rule.reminders, notifyChannels: updated } });
                      }}
                    />
                    Microsoft Teams
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={rule.reminders.notifyChannels.includes('email')}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...rule.reminders.notifyChannels, 'email']
                          : rule.reminders.notifyChannels.filter(c => c !== 'email');
                        setRule({ ...rule, reminders: { ...rule.reminders, notifyChannels: updated } });
                      }}
                    />
                    Email
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Ścieżka Eskalacji */}
        <div className="form-section">
          <h5>Ścieżka Eskalacji</h5>
          
          {rule.escalationPath.map((level, index) => (
            <div key={index} className="escalation-level">
              <h6>Poziom {level.level}</h6>
              
              <div className="form-group">
                <label className="form-label">Po ilu minutach</label>
                <input
                  type="number"
                  className="form-input"
                  value={level.afterMinutes}
                  onChange={(e) => updateEscalationLevel(rule, setRule, index, 'afterMinutes', parseInt(e.target.value) || 0)}
                />
              </div>


              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={level.notifyManagement}
                    onChange={(e) => updateEscalationLevel(rule, setRule, index, 'notifyManagement', e.target.checked)}
                  />
                  Powiadom zarząd
                </label>
              </div>

              {index > 0 && (
                <button
                  type="button"
                  className="btn btn-default btn-small"
                  onClick={() => removeEscalationLevel(rule, setRule, index)}
                >
                  Usuń Poziom
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="btn btn-default mt-16"
            onClick={() => addEscalationLevel(rule, setRule)}
          >
            Dodaj Kolejny Poziom Eskalacji
          </button>
        </div>

        {/* Przyciski Akcji */}
        <div className="flex flex-gap mt-16">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !rule.name.trim()}
          >
            {saving ? 'Zapisywanie...' : 'Zapisz Regułę'}
          </button>
          <button
            type="button"
            className="btn btn-default"
            onClick={onCancel}
          >
            Anuluj
          </button>
        </div>
      </div>
    );
  }
}

export default EscalationRules;

