import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function FieldsConfig({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableFields, setAvailableFields] = useState([]);
  const [configuredFields, setConfiguredFields] = useState([]);
  const [issueTypeId, setIssueTypeId] = useState(null);
  const [projectConfig, setProjectConfig] = useState(null);

  useEffect(() => {
    if (selectedProject) {
      loadProjectConfig();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject && issueTypeId) {
      loadAvailableFields();
    }
  }, [selectedProject, issueTypeId]);

  const loadProjectConfig = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      const result = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (result.success && result.config) {
        setProjectConfig(result.config);
        setIssueTypeId(result.config.incidentIssueTypeId || null);
        
        // Załaduj skonfigurowane pola
        if (result.config.fieldsConfig && result.config.fieldsConfig.configuredFields) {
          setConfiguredFields(result.config.fieldsConfig.configuredFields);
        } else {
          setConfiguredFields([]);
        }
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować konfiguracji pól');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableFields = async () => {
    if (!selectedProject || !issueTypeId) return;
    
    try {
      const result = await invoke('getIssueTypeFields', {
        projectKey: selectedProject,
        issueTypeId: issueTypeId
      });
      
      if (result.success && result.fields) {
        setAvailableFields(result.fields);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się załadować dostępnych pól');
        setAvailableFields([]);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować dostępnych pól');
      setAvailableFields([]);
    }
  };

  const handleToggleField = (fieldId) => {
    setConfiguredFields(prev => {
      const existing = prev.find(f => f.id === fieldId);
      if (existing) {
        // Usuń pole z konfiguracji
        return prev.filter(f => f.id !== fieldId);
      } else {
        // Dodaj pole do konfiguracji
        const field = availableFields.find(f => f.id === fieldId);
        if (field) {
          return [...prev, {
            id: field.id,
            name: field.name,
            type: field.type,
            required: field.required, // Domyślnie używaj wymagalności z Jira
            enabled: true,
            description: '' // Domyślny pusty opis
          }];
        }
        return prev;
      }
    });
  };

  const handleDescriptionChange = (fieldId, description) => {
    setConfiguredFields(prev =>
      prev.map(f =>
        f.id === fieldId ? { ...f, description: description } : f
      )
    );
  };

  const handleToggleRequired = (fieldId) => {
    setConfiguredFields(prev =>
      prev.map(f =>
        f.id === fieldId ? { ...f, required: !f.required } : f
      )
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!issueTypeId) {
      showFlag('error', 'Błąd', 'Najpierw wybierz typ zgłoszenia w zakładce "Ustawienia ogólne"');
      return;
    }
    
    try {
      setSaving(true);
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (!projectConfigResult.success) {
        showFlag('error', 'Błąd', 'Nie udało się załadować konfiguracji projektu');
        return;
      }
      
      const currentConfig = projectConfigResult.config;
      
      // Zaktualizuj fieldsConfig
      currentConfig.fieldsConfig = {
        configuredFields: configuredFields
      };
      
      // Zapisz zaktualizowaną konfigurację projektu
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: currentConfig
      });
      
      if (result.success) {
        showFlag('success', 'Zapisano', 'Konfiguracja pól zapisana pomyślnie dla projektu ' + selectedProject);
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zapisać konfiguracji pól');
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

  if (!selectedProject) {
    return (
      <div className="message-box message-warning">
        <strong>Wybierz projekt:</strong> Wybierz projekt z listy powyżej, aby skonfigurować pola formularza.
      </div>
    );
  }

  if (!issueTypeId) {
    return (
      <div className="message-box message-warning">
        <strong>Najpierw wybierz typ zgłoszenia:</strong> Przejdź do zakładki "Ustawienia ogólne" i wybierz typ zgłoszenia dla projektu {selectedProject}, a następnie wróć tutaj aby skonfigurować pola formularza.
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h3 className="section-title">Konfiguracja Pól Formularza</h3>
        <p className="section-description">
          Wybierz pola, które mają być dostępne w formularzu zgłaszania alertów. Możesz oznaczyć pola jako obowiązkowe.
        </p>
      </div>

      <div className="message-box message-info">
        <strong>Informacja:</strong> Wyświetlane są tylko pola dostępne dla typu zgłoszenia wybranego w "Ustawienia ogólne".
        <br />
        Pola oznaczone jako "Wymagane w Jira" są automatycznie wymagane w formularzu.
      </div>

      {availableFields.length === 0 ? (
        <div className="message-box message-warning">
          <strong>Brak dostępnych pól:</strong> Nie znaleziono dostępnych pól dla wybranego typu zgłoszenia. Sprawdź czy typ zgłoszenia jest poprawnie skonfigurowany.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Dostępne pola:</label>
            <div style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px', borderRadius: '4px' }}>
              {availableFields.map(field => {
                const isConfigured = configuredFields.find(f => f.id === field.id);
                return (
                  <div key={field.id} style={{ 
                    padding: '10px', 
                    marginBottom: '8px', 
                    border: '1px solid #e0e0e0', 
                    borderRadius: '4px',
                    backgroundColor: isConfigured ? '#f0f8ff' : '#fff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!isConfigured}
                            onChange={() => handleToggleField(field.id)}
                            style={{ marginRight: '10px' }}
                          />
                          <strong>{field.name}</strong>
                          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                            ({field.type})
                          </span>
                          {field.required && (
                            <span style={{ marginLeft: '10px', fontSize: '11px', color: '#d63031', fontWeight: 'bold' }}>
                              [Wymagane w Jira]
                            </span>
                          )}
                        </label>
                      </div>
                      {isConfigured && (
                        <label style={{ display: 'flex', alignItems: 'center', marginLeft: '20px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={isConfigured.required}
                            onChange={() => handleToggleRequired(field.id)}
                            disabled={field.required} // Nie można zmienić jeśli wymagane w Jira
                            style={{ marginRight: '5px' }}
                          />
                          <span style={{ fontSize: '12px' }}>Wymagane w formularzu</span>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="form-helper">
              Zaznacz pola, które mają być dostępne w formularzu zgłoszenia. Pola oznaczone jako "Wymagane w Jira" są automatycznie wymagane.
            </div>
          </div>

          {configuredFields.length > 0 && (
            <div className="form-group">
              <label className="form-label">Wybrane pola ({configuredFields.length}):</label>
              <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', marginTop: '10px' }}>
                {configuredFields.map(field => (
                  <div key={field.id} style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>{field.name}</strong>
                      {field.required && <strong style={{ color: '#d63031', marginLeft: '10px' }}>(wymagane)</strong>}
                    </div>
                    <div className="form-group" style={{ marginBottom: '0' }}>
                      <label className="form-label" style={{ fontSize: '13px' }} htmlFor={`desc-${field.id}`}>
                        Opis pola (wyświetlany jako podpowiedź w formularzu):
                      </label>
                      <input
                        id={`desc-${field.id}`}
                        type="text"
                        className="form-input"
                        value={field.description || ''}
                        onChange={(e) => handleDescriptionChange(field.id, e.target.value)}
                        placeholder="np. Wprowadź nazwę systemu, którego dotyczy alert"
                        style={{ fontSize: '13px' }}
                      />
                      <div className="form-helper" style={{ fontSize: '12px' }}>
                        Opis będzie wyświetlany jako podpowiedź pod tytułem pola w formularzu zgłoszenia
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-gap mt-16">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Zapisywanie...' : 'Zapisz Konfigurację Pól'}
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={loadProjectConfig}
              disabled={saving}
            >
              Odśwież
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default FieldsConfig;
