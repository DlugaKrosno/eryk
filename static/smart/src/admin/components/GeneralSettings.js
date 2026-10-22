import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function GeneralSettings({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issueTypes, setIssueTypes] = useState([]);
  const [config, setConfig] = useState({
    projectKey: '',
    incidentIssueTypeId: '',
    defaultPriority: 'P3',
    enableAutoProcessing: true,
    jiraInstanceUrl: '',
    moduleFieldMapping: '',
    projectIconUrl: ''
  });
  const [availableFields, setAvailableFields] = useState([]);

  useEffect(() => {
    if (selectedProject) {
      loadProjectConfig();
      loadIssueTypes();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);
  
  useEffect(() => {
    if (selectedProject && config.incidentIssueTypeId) {
      loadAvailableFields();
    }
  }, [selectedProject, config.incidentIssueTypeId]);


  const loadProjectConfig = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      const result = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (result.success && result.config) {
        setConfig(result.config);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować konfiguracji projektu');
    } finally {
      setLoading(false);
    }
  };

  const loadIssueTypes = async () => {
    try {
      const result = await invoke('getProjectIssueTypes', { projectKey: selectedProject });
      
      if (result.success && result.issueTypes) {
        const issueTypesData = Array.isArray(result.issueTypes) ? result.issueTypes : [];
        setIssueTypes(issueTypesData);
      } else {
        setIssueTypes([]);
      }
    } catch (error) {
      setIssueTypes([]);
      showFlag('error', 'Błąd', 'Nie udało się załadować typów zgłoszeń');
    }
  };
  
  const loadAvailableFields = async () => {
    if (!selectedProject || !config.incidentIssueTypeId) return;
    
    try {
      const result = await invoke('getIssueTypeFields', {
        projectKey: selectedProject,
        issueTypeId: config.incidentIssueTypeId
      });
      
      if (result.success && result.fields) {
        setAvailableFields(result.fields);
      } else {
        setAvailableFields([]);
      }
    } catch (error) {
      setAvailableFields([]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      // Zapisz konfigurację projektu
      const projectResult = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: { ...config, projectKey: selectedProject }
      });
      
      if (!projectResult.success) {
        showFlag('error', 'Błąd', projectResult.error);
        return;
      }
      
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zapisać konfiguracji');
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
        <h3 className="section-title">Ustawienia Projektu</h3>
        <p className="section-description">
          Wybierz projekt i skonfiguruj ustawienia dla zgłaszania alertów.
        </p>
      </div>

      {!selectedProject ? (
        <div className="message-box message-warning">
          <strong>Wybierz projekt:</strong> Wybierz projekt z listy powyżej, aby skonfigurować ustawienia.
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="incidentIssueTypeId">
                Typ Zgłoszenia "Alert" *
              </label>
              <select
                id="incidentIssueTypeId"
                className="form-select"
                value={config.incidentIssueTypeId || ''}
                onChange={(e) => setConfig({ ...config, incidentIssueTypeId: e.target.value })}
                required
              >
                <option value="">-- Wybierz typ zgłoszenia --</option>
                {issueTypes.map(issueType => (
                  <option key={issueType.id} value={issueType.id}>
                    {issueType.name}
                  </option>
                ))}
              </select>
              <div className="form-helper">
                Wybierz typ zgłoszenia, który będzie używany do tworzenia alertów
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="jiraInstanceUrl">
                URL Instancji Jira *
              </label>
              <input
                id="jiraInstanceUrl"
                type="url"
                className="form-input"
                value={config.jiraInstanceUrl || ''}
                onChange={(e) => setConfig({ ...config, jiraInstanceUrl: e.target.value })}
                placeholder="https://dreryk.atlassian.net"
                required
              />
              <div className="form-helper">
                URL Twojej instancji Jira Cloud (używany w linkach do zgłoszeń i powiadomieniach Teams). 
                Przykład: https://dreryk.atlassian.net
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="projectIconUrl">
                URL Ikony Projektu
              </label>
              <input
                id="projectIconUrl"
                type="url"
                className="form-input"
                value={config.projectIconUrl || ''}
                onChange={(e) => setConfig({ ...config, projectIconUrl: e.target.value })}
                placeholder="https://dreryk.atlassian.net/rest/api/3/universal_avatar/view/type/project/avatar/10400"
              />
              <div className="form-helper">
                URL ikony projektu, która będzie wyświetlana w formularzu zgłoszenia (opcjonalne)
              </div>
              {config.projectIconUrl && (
                <div style={{ marginTop: '8px' }}>
                  <img 
                    src={config.projectIconUrl} 
                    alt="Podgląd ikony" 
                    style={{ width: '32px', height: '32px', borderRadius: '3px' }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="defaultPriority">
                Domyślny Priorytet
              </label>
              <select
                id="defaultPriority"
                className="form-select"
                value={config.defaultPriority}
                onChange={(e) => setConfig({ ...config, defaultPriority: e.target.value })}
              >
                <option value="P1">P1 - Krytyczny</option>
                <option value="P2">P2 - Wysoki</option>
                <option value="P3">P3 - Średni</option>
                <option value="P4">P4 - Niski</option>
              </select>
              <div className="form-helper">
                Priorytet używany gdy reguły nie określą inaczej
              </div>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={config.enableAutoProcessing || false}
                  onChange={(e) => setConfig({ ...config, enableAutoProcessing: e.target.checked })}
                />
                Włącz automatyczne przetwarzanie
              </label>
              <div className="form-helper">
                Automatycznie kalkuluj priorytet i przypisuj zespoły przy tworzeniu alertu
              </div>
            </div>

            {config.incidentIssueTypeId && (
              <div className="form-group">
                <label className="form-label" htmlFor="moduleFieldMapping">
                  Pole "Moduł aplikacji" (dla statystyk)
                </label>
                <select
                  id="moduleFieldMapping"
                  className="form-select"
                  value={config.moduleFieldMapping || ''}
                  onChange={(e) => setConfig({ ...config, moduleFieldMapping: e.target.value })}
                >
                  <option value="">-- Nie wybrano (opcjonalne) --</option>
                  {availableFields
                    .filter(field => field.type === 'select' || field.type === 'option' || field.type === 'string' || field.type === 'text')
                    .map(field => (
                      <option key={field.id} value={field.id}>
                        {field.name} ({field.type})
                      </option>
                    ))}
                </select>
                <div className="form-helper">
                  Wybierz pole, które reprezentuje moduł aplikacji. Będzie używane w statystykach do grupowania zgłoszeń według modułu.
                </div>
              </div>
            )}

            <div className="flex flex-gap mt-16">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? 'Zapisywanie...' : 'Zapisz Ustawienia'}
              </button>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => {
                  loadProjectConfig();
                  loadIssueTypes();
                  if (config.incidentIssueTypeId) {
                    loadAvailableFields();
                  }
                }}
                disabled={saving}
              >
                Odśwież
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

export default GeneralSettings;
