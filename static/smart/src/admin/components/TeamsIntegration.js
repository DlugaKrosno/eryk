import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function TeamsIntegration({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [webhooks, setWebhooks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    webhookUrl: '',
    priorities: []
  });

  useEffect(() => {
    if (selectedProject) {
      loadWebhooks();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);

  const loadWebhooks = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        // Pobierz teamsWebhooks z konfiguracji projektu lub z globalnych
        const webhooksData = projectConfigResult.config.teamsWebhooks;
        if (webhooksData && webhooksData.webhooks) {
          setWebhooks(Array.isArray(webhooksData.webhooks) ? webhooksData.webhooks : []);
        } else {
          // Fallback do globalnych webhooków
          const result = await invoke('getConfig', { configType: 'webhooks' });
          setWebhooks(result.success && result.data && result.data.webhooks 
            ? (Array.isArray(result.data.webhooks) ? result.data.webhooks : []) 
            : []);
        }
      } else {
        // Fallback do globalnych webhooków
        const result = await invoke('getConfig', { configType: 'webhooks' });
        setWebhooks(result.success && result.data && result.data.webhooks 
          ? (Array.isArray(result.data.webhooks) ? result.data.webhooks : []) 
          : []);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować webhooków');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    try {
      const newWebhook = {
        id: Date.now(),
        ...formData
      };

      const newWebhooks = [...webhooks, newWebhook];
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi webhookami
      const updatedConfig = {
        ...currentConfig,
        teamsWebhooks: { webhooks: newWebhooks }
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Dodano', 'Webhook został dodany');
        await loadWebhooks();
        resetForm();
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się dodać webhooka');
    }
  };

  const handleDelete = async (id) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!window.confirm('Czy na pewno chcesz usunąć ten webhook?')) return;
    
    try {
      const newWebhooks = webhooks.filter(w => w.id !== id);
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi webhookami
      const updatedConfig = {
        ...currentConfig,
        teamsWebhooks: { webhooks: newWebhooks }
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Usunięto', 'Webhook został usunięty');
        await loadWebhooks();
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się usunąć webhooka');
    }
  };

  const handleTest = async (webhookUrl) => {
    if (!webhookUrl || !webhookUrl.trim()) {
      showFlag('error', 'Błąd', 'Webhook URL jest pusty');
      return;
    }
    
    try {
      showFlag('info', 'Testowanie', 'Wysyłanie testowej wiadomości...');
      
      const result = await invoke('testTeamsWebhook', { 
        webhookUrl: webhookUrl,
        projectKey: selectedProject 
      });
      
      if (result.success) {
        showFlag('success', 'Sukces', result.message || 'Testowa wiadomość wysłana pomyślnie. Sprawdź kanał Teams.');
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się wysłać testowej wiadomości');
      }
    } catch (error) {
      console.error('Błąd testowania webhooka:', error);
      showFlag('error', 'Błąd', `Błąd: ${error.message || 'Nie udało się wysłać testowej wiadomości'}`);
    }
  };

  const togglePriority = (priority) => {
    const priorities = formData.priorities.includes(priority)
      ? formData.priorities.filter(p => p !== priority)
      : [...formData.priorities, priority];
    setFormData({ ...formData, priorities });
  };

  const resetForm = () => {
    setFormData({ name: '', webhookUrl: '', priorities: [] });
    setShowForm(false);
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
      <div className="section-header flex-between">
        <div>
          <h3 className="section-title">Integracja Microsoft Teams</h3>
          <p className="section-description">
            Skonfiguruj webhooki do powiadamiania kanałów Teams o alertach.
          </p>
        </div>
      </div>

      {!selectedProject && (
        <div className="message-box message-warning">
          <strong>Wybierz projekt:</strong> Wybierz projekt z listy powyżej, aby skonfigurować integrację Teams.
        </div>
      )}

      {selectedProject && (
        <>
        <div style={{ marginBottom: '20px' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Anuluj' : '+ Dodaj Webhook'}
          </button>
        </div>

      <div className="message-box message-info mb-16">
        <strong>Jak uzyskać Incoming Webhook URL:</strong><br />
        1. W Microsoft Teams, przejdź do kanału → ⋯ → Connectors<br />
        2. Znajdź "Incoming Webhook" i kliknij "Configure"<br />
        3. Nadaj nazwę (np. "Incident Reporter") i skopiuj URL
      </div>

      {showForm && (
        <div className="message-box message-info mb-16">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Nazwa *</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="np. Kanał Incidents"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Webhook URL *</label>
              <input
                type="url"
                className="form-input"
                value={formData.webhookUrl}
                onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                placeholder="https://outlook.office.com/webhook/..."
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Priorytety (które mają wysyłać powiadomienia)</label>
              <div className="flex flex-gap">
                {['P1', 'P2', 'P3', 'P4'].map(priority => (
                  <label key={priority}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={formData.priorities.includes(priority)}
                      onChange={() => togglePriority(priority)}
                    />
                    {priority}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-gap">
              <button type="submit" className="btn btn-primary btn-small">
                Dodaj Webhook
              </button>
              <button type="button" className="btn btn-default btn-small" onClick={resetForm}>
                Anuluj
              </button>
            </div>
          </form>
        </div>
      )}

      {webhooks.length === 0 ? (
        <div className="message-box message-warning">
          Brak skonfigurowanych webhooków. Dodaj pierwszy webhook Teams.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nazwa</th>
              <th>Webhook URL</th>
              <th>Priorytety</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((webhook) => (
              <tr key={webhook.id}>
                <td><strong>{webhook.name}</strong></td>
                <td><code>{webhook.webhookUrl.substring(0, 50)}...</code></td>
                <td>{webhook.priorities && webhook.priorities.length > 0 ? webhook.priorities.join(', ') : 'Wszystkie'}</td>
                <td>
                  <div className="flex flex-gap">
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => handleTest(webhook.webhookUrl)}
                    >
                      Test
                    </button>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleDelete(webhook.id)}
                    >
                      Usuń
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
        </>
      )}
    </div>
  );
}

export default TeamsIntegration;
