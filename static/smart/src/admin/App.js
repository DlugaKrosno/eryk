import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import './App.css';

// Import tab components
import GeneralSettings from './components/GeneralSettings';
import FieldsConfig from './components/FieldsConfig';
import PriorityRules from './components/PriorityRules';
import DomainsConfig from './components/DomainsConfig';
import SetupChecklist from './components/SetupChecklist';
import ConfigTransfer from './components/ConfigTransfer';
import EscalationPolicy from './components/EscalationPolicy';
import TeamsEscalation from './components/TeamsEscalation';
import AuditLog from './components/AuditLog';

function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [flags, setFlags] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [timeRange, setTimeRange] = useState('all'); // '24h', 'week', 'month', 'all'
  const [showActionDialog, setShowActionDialog] = useState(null); // 'reprocess' or null
  const [issuesForRecalculation, setIssuesForRecalculation] = useState([]); // Lista zgłoszeń do przeliczenia
  const [selectedIssues, setSelectedIssues] = useState([]); // Wybrane zgłoszenia do przeliczenia
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

  // Wybór projektu w panelu dotyczy tylko konfiguracji; formularz alertu sam wybiera projekt
  const handleProjectChange = (projectKey) => {
    setSelectedProject(projectKey);
  };

  const showFlag = (type, title, description) => {
    const id = Date.now();
    setFlags(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setFlags(prev => prev.filter(f => f.id !== id));
    }, 5000);
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
        showFlag('error', 'Błąd', result.error || 'Nie udało się pobrać alertów');
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
      showFlag('error', 'Błąd', 'Wybierz przynajmniej jeden alert do przeliczenia');
      return;
    }
    
    if (!window.confirm(`Czy na pewno chcesz przeliczyć ${selectedIssues.length} wybranych alertów? To może zająć chwilę.`)) {
      return;
    }
    
    try {
      setLoading(true);
      const result = await invoke('reprocessSelectedIssues', {
        projectKey: selectedProject,
        issueKeys: selectedIssues
      });
      
      if (result.success) {
        showFlag('success', 'Przetworzono alerty', result.message);
        // Wyczyść listę i wybór
        setIssuesForRecalculation([]);
        setSelectedIssues([]);
        setShowActionDialog(null);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się przetworzyć alertów');
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

  const tabs = [
    { label: 'Ustawienia Ogólne', component: <><GeneralSettings showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /><ConfigTransfer showFlag={showFlag} selectedProject={selectedProject} /></> },
    { label: 'Domeny', component: <DomainsConfig showFlag={showFlag} selectedProject={selectedProject} /> },
    { label: 'Zespoły', component: <TeamsEscalation showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Eskalacje', component: <EscalationPolicy showFlag={showFlag} selectedProject={selectedProject} /> },
    { label: 'Konfiguracja Pól', component: <FieldsConfig showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
    { label: 'Reguły Priorytetyzacji', component: <PriorityRules showFlag={showFlag} selectedProject={selectedProject} onProjectChange={handleProjectChange} /> },
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
            <h1>drEryk Alert - Panel Administratora</h1>
            <p>Skonfiguruj domeny, zespoły z dyżurami, powiadomienia Microsoft Teams, pola formularza i reguły priorytetyzacji</p>
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
                            {loadingIssues ? 'Pobieram...' : 'Pobierz alerty'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h3 style={{ margin: 0 }}>Znaleziono {issuesForRecalculation.length} alertów</h3>
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

      <SetupChecklist
        key={`${selectedProject}-${activeTab}-${flags.length}`}
        projectKey={selectedProject}
        onNavigate={(label) => { const i = tabs.findIndex(t => t.label === label); if (i >= 0) setActiveTab(i); }}
      />

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
