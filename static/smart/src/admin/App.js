import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import './App.css';

// Import tab components
import GeneralSettings from './components/GeneralSettings';
import FieldsConfig from './components/FieldsConfig';
import PriorityRules from './components/PriorityRules';
import EscalationRules from './components/EscalationRules';
import TeamsEscalation from './components/TeamsEscalation';
import TeamsIntegration from './components/TeamsIntegration';
import AuditLog from './components/AuditLog';

function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [flags, setFlags] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [timeRange, setTimeRange] = useState('all'); // '24h', 'week', 'month', 'all'
  const [showActionDialog, setShowActionDialog] = useState(null); // 'reprocess' or 'sla' or null
  const [issuesForRecalculation, setIssuesForRecalculation] = useState([]); // Lista zgłoszeń do przeliczenia
  const [issuesForSLACheck, setIssuesForSLACheck] = useState([]); // Lista zgłoszeń z przekroczonym SLA
  const [selectedIssues, setSelectedIssues] = useState([]); // Wybrane zgłoszenia do przeliczenia
  const [selectedSLAIssues, setSelectedSLAIssues] = useState([]); // Wybrane zgłoszenia do przypomnienia SLA
  const [loadingIssues, setLoadingIssues] = useState(false); // Ładowanie listy zgłoszeń

  useEffect(() => {
    loadProjectsAndConfig();
  }, []);

  const loadProjectsAndConfig = async () => {
    try {
      setLoading(true);
      
      // Załaduj listę projektów
      const projectsResult = await invoke('getProjects', {});
      if (projectsResult.success && projectsResult.projects) {
        const projectsData = Array.isArray(projectsResult.projects) ? projectsResult.projects : [];
        setProjects(projectsData);
        
        // Załaduj domyślny projekt z global_config
        const configResult = await invoke('getConfig', { configType: 'global' });
        let defaultProjectKey = '';
        
        if (configResult.success && configResult.config) {
          defaultProjectKey = configResult.config.defaultProjectKey || 
                             configResult.config.targetProjectKey || 
                             '';
        }
        
        // Ustaw wybrany projekt (domyślny lub pierwszy z listy)
        if (defaultProjectKey && projectsData.find(p => p.key === defaultProjectKey)) {
          setSelectedProject(defaultProjectKey);
        } else if (projectsData.length > 0) {
          setSelectedProject(projectsData[0].key);
        }
      }
    } catch (error) {
      console.error('Błąd ładowania projektów:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować projektów');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectChange = async (projectKey) => {
    setSelectedProject(projectKey);
    
    // Zapisz wybrany projekt jako domyślny w global_config
    try {
      await invoke('saveConfig', {
        configType: 'global',
        data: { 
          defaultProjectKey: projectKey,
          targetProjectKey: projectKey // dla kompatybilności wstecznej
        }
      });
      showFlag('success', 'Zapisano', `Wybrano projekt: ${projectKey}`);
    } catch (error) {
      console.error('Błąd zapisywania projektu:', error);
    }
  };

  const showFlag = (type, title, description) => {
    const id = Date.now();
    setFlags(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setFlags(prev => prev.filter(f => f.id !== id));
    }, 5000);
  };

  // Pobierz zgłoszenia dla SLA check
  const handleLoadIssuesForSLACheck = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Najpierw wybierz projekt');
      return;
    }
    
    try {
      setLoadingIssues(true);
      const result = await invoke('getIssuesForSLACheck', {
        projectKey: selectedProject,
        timeRange: timeRange
      });
      
      if (result.success && result.issues) {
        setIssuesForSLACheck(result.issues);
        setSelectedSLAIssues([]); // Reset wyboru
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się pobrać zgłoszeń');
      }
    } catch (error) {
      showFlag('error', 'Błąd', error.message);
    } finally {
      setLoadingIssues(false);
    }
  };

  // Wyślij zbiorcze przypomnienie SLA dla wybranych zgłoszeń
  const handleSendBatchSLAReminder = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Najpierw wybierz projekt');
      return;
    }
    
    if (selectedSLAIssues.length === 0) {
      showFlag('error', 'Błąd', 'Nie wybrano żadnych zgłoszeń');
      return;
    }
    
    try {
      setLoading(true);
      const result = await invoke('sendBatchSLAReminder', {
        projectKey: selectedProject,
        issueKeys: selectedSLAIssues
      });
      
      if (result.success) {
        showFlag('success', 'Sukces', result.message || 'Zbiorcze przypomnienie wysłane pomyślnie');
        setShowActionDialog(null);
        setIssuesForSLACheck([]);
        setSelectedSLAIssues([]);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się wysłać przypomnienia');
      }
    } catch (error) {
      showFlag('error', 'Błąd', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Pobierz zgłoszenia do przeliczenia
  const handleLoadIssuesForRecalculation = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Najpierw wybierz projekt');
      return;
    }
    
    try {
      setLoadingIssues(true);
      const result = await invoke('getIssuesForRecalc', {
        projectKey: selectedProject,
        timeRange: timeRange
      });
      
      if (result.success && result.issues) {
        setIssuesForRecalculation(result.issues);
        setSelectedIssues([]); // Reset wyboru
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się pobrać zgłoszeń');
      }
    } catch (error) {
      showFlag('error', 'Błąd', error.message);
    } finally {
      setLoadingIssues(false);
    }
  };

  // Przelicz wybrane zgłoszenia
  const handleReprocessSelected = async () => {
    if (selectedIssues.length === 0) {
      showFlag('error', 'Błąd', 'Wybierz przynajmniej jedno zgłoszenie do przeliczenia');
      return;
    }
    
    if (!window.confirm(`Czy na pewno chcesz przeliczyć ${selectedIssues.length} wybranych zgłoszeń? To może zająć chwilę.`)) {
      return;
    }
    
    try {
      setLoading(true);
      const result = await invoke('reprocessSelectedIssues', {
        projectKey: selectedProject,
        issueKeys: selectedIssues
      });
      
      if (result.success) {
        showFlag('success', 'Przetworzono zgłoszenia', result.message);
        // Wyczyść listę i wybór
        setIssuesForRecalculation([]);
        setSelectedIssues([]);
        setShowActionDialog(null);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się przetworzyć zgłoszeń');
      }
    } catch (error) {
      showFlag('error', 'Błąd', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Obsługa wyboru/zaznaczenia zgłoszenia
  const handleToggleIssueSelection = (issueKey) => {
    setSelectedIssues(prev => {
      if (prev.includes(issueKey)) {
        return prev.filter(key => key !== issueKey);
      } else {
        return [...prev, issueKey];
      }
    });
  };

  // Zaznacz/odznacz wszystkie (przeliczenie)
  const handleToggleAllIssues = (checked) => {
    if (checked) {
      setSelectedIssues(issuesForRecalculation.map(issue => issue.key));
    } else {
      setSelectedIssues([]);
    }
  };

  // Toggle dla zgłoszeń SLA
  const handleToggleSLAIssue = (issueKey) => {
    setSelectedSLAIssues(prev => {
      if (prev.includes(issueKey)) {
        return prev.filter(key => key !== issueKey);
      } else {
        return [...prev, issueKey];
      }
    });
  };

  // Zaznacz/odznacz wszystkie (SLA)
  const handleToggleAllSLAIssues = (checked) => {
    if (checked) {
      setSelectedSLAIssues(issuesForSLACheck.map(issue => issue.key));
    } else {
      setSelectedSLAIssues([]);
    }
  };

  const tabs = [
    { label: 'Ustawienia Ogólne', component: <GeneralSettings showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Konfiguracja Pól', component: <FieldsConfig showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Reguły Priorytetyzacji', component: <PriorityRules showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Reguły Eskalacji', component: <EscalationRules showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Zespoły', component: <TeamsEscalation showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Integracja Teams', component: <TeamsIntegration showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Dziennik Audytu', component: <AuditLog selectedProject={selectedProject} /> }
  ];

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      {/* Notifications */}
      <div className="flag-container">
        {flags.map(flag => (
          <div key={flag.id} className={`flag flag-${flag.type}`}>
            <div className="flag-icon">
              {flag.type === 'success' ? '✓' : '✕'}
            </div>
            <div className="flag-content">
              <strong>{flag.title}</strong>
              {flag.description && <div>{flag.description}</div>}
            </div>
            <button 
              className="flag-close" 
              onClick={() => setFlags(prev => prev.filter(f => f.id !== flag.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="admin-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h1>DrEryk Alert - Panel Administratora</h1>
            <p>Skonfiguruj pola, reguły priorytetyzacji, eskalacje zespołów i integrację Microsoft Teams</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', alignItems: 'flex-end', position: 'relative' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="button button-secondary"
                onClick={() => setShowActionDialog('reprocess')}
                disabled={loading || !selectedProject}
                style={{ height: 'fit-content' }}
              >
                🔄 Przelicz Wszystkie
              </button>
              <button 
                className="button button-primary"
                onClick={() => setShowActionDialog('sla')}
                disabled={loading || !selectedProject}
                style={{ height: 'fit-content' }}
              >
                🔍 Sprawdź SLA
              </button>
            </div>
            {showActionDialog && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '10px',
                backgroundColor: '#fff',
                border: '1px solid #dfe1e6',
                borderRadius: '4px',
                padding: '15px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                zIndex: 1000,
                minWidth: showActionDialog === 'reprocess' && issuesForRecalculation.length > 0 ? '600px' : '300px',
                maxWidth: showActionDialog === 'reprocess' && issuesForRecalculation.length > 0 ? '800px' : '400px',
                maxHeight: '80vh',
                overflow: 'auto'
              }}>
                {showActionDialog === 'reprocess' ? (
                  <>
                    {issuesForRecalculation.length === 0 ? (
                      <>
                        <div style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Przedział czasowy:
                          </label>
                          <select
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              fontSize: '14px',
                              border: '1px solid #dfe1e6',
                              borderRadius: '4px'
                            }}
                          >
                            <option value="24h">Ostatnie 24 godziny</option>
                            <option value="week">Ostatni tydzień</option>
                            <option value="month">Ostatni miesiąc</option>
                            <option value="all">Wszystkie</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                          <button
                            className="button button-secondary"
                            onClick={() => {
                              setShowActionDialog(null);
                              setIssuesForRecalculation([]);
                              setSelectedIssues([]);
                            }}
                            style={{ height: 'fit-content' }}
                          >
                            Anuluj
                          </button>
                          <button
                            className="button button-primary"
                            onClick={handleLoadIssuesForRecalculation}
                            disabled={loadingIssues}
                            style={{ height: 'fit-content' }}
                          >
                            {loadingIssues ? 'Pobieram...' : 'Pobierz zgłoszenia'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h3 style={{ margin: 0 }}>Znaleziono {issuesForRecalculation.length} zgłoszeń</h3>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selectedIssues.length === issuesForRecalculation.length && issuesForRecalculation.length > 0}
                              onChange={(e) => handleToggleAllIssues(e.target.checked)}
                              style={{ cursor: 'pointer' }}
                            />
                            <span>Zaznacz wszystkie</span>
                          </label>
                        </div>
                        <div style={{ 
                          maxHeight: '400px', 
                          overflowY: 'auto', 
                          border: '1px solid #dfe1e6', 
                          borderRadius: '4px',
                          padding: '10px',
                          marginBottom: '15px'
                        }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #dfe1e6' }}>
                                <th style={{ padding: '8px', textAlign: 'left', width: '30px' }}></th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Klucz</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Tytuł</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Priorytet</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Data utworzenia</th>
                              </tr>
                            </thead>
                            <tbody>
                              {issuesForRecalculation.map(issue => (
                                <tr 
                                  key={issue.key}
                                  style={{ 
                                    borderBottom: '1px solid #f4f5f7',
                                    backgroundColor: selectedIssues.includes(issue.key) ? '#f4f5f7' : 'transparent'
                                  }}
                                >
                                  <td style={{ padding: '8px' }}>
                                    <input
                                      type="checkbox"
                                      checked={selectedIssues.includes(issue.key)}
                                      onChange={() => handleToggleIssueSelection(issue.key)}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </td>
                                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{issue.key}</td>
                                  <td style={{ padding: '8px' }}>{issue.summary}</td>
                                  <td style={{ padding: '8px' }}>{issue.status}</td>
                                  <td style={{ padding: '8px' }}>{issue.priority}</td>
                                  <td style={{ padding: '8px' }}>
                                    {issue.created ? new Date(issue.created).toLocaleString('pl-PL') : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '14px', color: '#5e6c84' }}>
                            Wybrano: {selectedIssues.length} z {issuesForRecalculation.length}
                          </span>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                              className="button button-secondary"
                              onClick={() => {
                                setIssuesForRecalculation([]);
                                setSelectedIssues([]);
                              }}
                              style={{ height: 'fit-content' }}
                            >
                              Wróć
                            </button>
                            <button
                              className="button button-secondary"
                              onClick={() => {
                                setShowActionDialog(null);
                                setIssuesForRecalculation([]);
                                setSelectedIssues([]);
                              }}
                              style={{ height: 'fit-content' }}
                            >
                              Anuluj
                            </button>
                            <button
                              className="button button-primary"
                              onClick={handleReprocessSelected}
                              disabled={loading || selectedIssues.length === 0}
                              style={{ height: 'fit-content' }}
                            >
                              {loading ? 'Przetwarzam...' : `Przelicz (${selectedIssues.length})`}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : showActionDialog === 'sla' ? (
                  <>
                    {issuesForSLACheck.length === 0 ? (
                      <>
                        <div style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Przedział czasowy:
                          </label>
                          <select
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              fontSize: '14px',
                              border: '1px solid #dfe1e6',
                              borderRadius: '4px'
                            }}
                          >
                            <option value="24h">Ostatnie 24 godziny</option>
                            <option value="week">Ostatni tydzień</option>
                            <option value="month">Ostatni miesiąc</option>
                            <option value="all">Wszystkie</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                          <button
                            className="button button-secondary"
                            onClick={() => setShowActionDialog(null)}
                            style={{ height: 'fit-content' }}
                          >
                            Anuluj
                          </button>
                          <button
                            className="button button-primary"
                            onClick={handleLoadIssuesForSLACheck}
                            disabled={loadingIssues}
                            style={{ height: 'fit-content' }}
                          >
                            {loadingIssues ? 'Ładuję...' : 'Pobierz listę'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h4 style={{ marginTop: 0, marginBottom: '15px' }}>
                          Zgłoszenia z przekroczonym SLA
                        </h4>
                        <div style={{ 
                          maxHeight: '400px', 
                          overflow: 'auto',
                          border: '1px solid #dfe1e6',
                          borderRadius: '4px',
                          marginBottom: '15px'
                        }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f4f5f7', zIndex: 1 }}>
                              <tr>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedSLAIssues.length === issuesForSLACheck.length && issuesForSLACheck.length > 0}
                                    onChange={(e) => handleToggleAllSLAIssues(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                  />
                                </th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Klucz</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Podsumowanie</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Status</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Priorytet</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Przypisane</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dfe1e6' }}>Czas w statusie</th>
                              </tr>
                            </thead>
                            <tbody>
                              {issuesForSLACheck.map(issue => (
                                <tr key={issue.key} style={{ borderBottom: '1px solid #dfe1e6' }}>
                                  <td style={{ padding: '8px' }}>
                                    <input
                                      type="checkbox"
                                      checked={selectedSLAIssues.includes(issue.key)}
                                      onChange={() => handleToggleSLAIssue(issue.key)}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </td>
                                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{issue.key}</td>
                                  <td style={{ padding: '8px' }}>{issue.summary}</td>
                                  <td style={{ padding: '8px' }}>{issue.status}</td>
                                  <td style={{ padding: '8px' }}>{issue.priority}</td>
                                  <td style={{ padding: '8px' }}>{issue.assignee}</td>
                                  <td style={{ padding: '8px' }}>
                                    {Math.floor(issue.ageInMinutes / 60)}h {issue.ageInMinutes % 60}min
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '14px', color: '#5e6c84' }}>
                            Wybrano: {selectedSLAIssues.length} z {issuesForSLACheck.length}
                          </span>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                              className="button button-secondary"
                              onClick={() => {
                                setIssuesForSLACheck([]);
                                setSelectedSLAIssues([]);
                              }}
                              style={{ height: 'fit-content' }}
                            >
                              Wróć
                            </button>
                            <button
                              className="button button-secondary"
                              onClick={() => {
                                setShowActionDialog(null);
                                setIssuesForSLACheck([]);
                                setSelectedSLAIssues([]);
                              }}
                              style={{ height: 'fit-content' }}
                            >
                              Anuluj
                            </button>
                            <button
                              className="button button-primary"
                              onClick={handleSendBatchSLAReminder}
                              disabled={loading || selectedSLAIssues.length === 0}
                              style={{ height: 'fit-content' }}
                            >
                              {loading ? 'Wysyłam...' : `Wyślij przypomnienie (${selectedSLAIssues.length})`}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
        
        {/* Globalny selektor projektu */}
        <div style={{ 
          backgroundColor: '#f4f5f7', 
          padding: '15px', 
          borderRadius: '4px',
          border: '1px solid #dfe1e6',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <label style={{ fontWeight: 'bold', minWidth: '120px' }} htmlFor="globalProjectSelector">
              Wybierz Projekt:
            </label>
            <select
              id="globalProjectSelector"
              value={selectedProject}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={loading || projects.length === 0}
              style={{
                flex: 1,
                maxWidth: '400px',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #dfe1e6',
                borderRadius: '4px',
                backgroundColor: '#fff'
              }}
            >
              {projects.length === 0 ? (
                <option value="">Ładowanie projektów...</option>
              ) : (
                <>
                  <option value="">-- Wybierz projekt --</option>
                  {projects.map(project => (
                    <option key={project.key} value={project.key}>
                      {project.name} ({project.key})
                    </option>
                  ))}
                </>
              )}
            </select>
            {selectedProject && (
              <div style={{ 
                fontSize: '12px', 
                color: '#6b778c',
                fontStyle: 'italic'
              }}>
                Wszystkie zakładki będą konfigurowane dla tego projektu
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <div className="tab-list">
          {tabs.map((tab, index) => (
            <button
              key={index}
              className={`tab-button ${activeTab === index ? 'active' : ''}`}
              onClick={() => setActiveTab(index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="tab-panel">
          {tabs[activeTab].component}
        </div>
      </div>
    </div>
  );
}

export default App;
