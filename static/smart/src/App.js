import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import './App.css';
import Statistics from './Statistics';
import Schedule from './Schedule';

export default function UserApp() {
  const [loading, setLoading] = useState(false);
  const [loadingFields, setLoadingFields] = useState(true);
  const [activeTab, setActiveTab] = useState('report');
  const [flags, setFlags] = useState([]);
  const [myIncidents, setMyIncidents] = useState([]);
  const [formFields, setFormFields] = useState([]);
  const [formData, setFormData] = useState({});
  const [currentTeam, setCurrentTeam] = useState(null);
  const [assignedPerson, setAssignedPerson] = useState(null);
  const [jiraInstanceUrl, setJiraInstanceUrl] = useState(null);
  const [showAllIncidents, setShowAllIncidents] = useState(true); // Domyślnie pokazuj wszystkie (nie tylko moje)
  const [showOnlyOpen, setShowOnlyOpen] = useState(true); // Domyślnie pokaż tylko otwarte (nie zakończone)
  const [showAssignedToMe, setShowAssignedToMe] = useState(false); // Filtr: przypisane do mnie
  const [sortField, setSortField] = useState('created');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filterStatuses, setFilterStatuses] = useState([]); // Tablica wybranych statusów
  const [filterPriorities, setFilterPriorities] = useState([]); // Tablica wybranych priorytetów
  const [filterAssignees, setFilterAssignees] = useState([]); // Tablica wybranych osób przypisanych
  const [showStatusFilter, setShowStatusFilter] = useState(false); // Czy pokazać listę statusów
  const [showPriorityFilter, setShowPriorityFilter] = useState(false); // Czy pokazać listę priorytetów
  const [showAssigneeFilter, setShowAssigneeFilter] = useState(false); // Czy pokazać listę osób przypisanych
  const [statisticsProjectKey, setStatisticsProjectKey] = useState(null);
  const [statisticsIssueTypeId, setStatisticsIssueTypeId] = useState(null);
  const [slaData, setSlaData] = useState(null); // Dane SLA z konfiguracji projektu
  const [slaExpanded, setSlaExpanded] = useState(false); // Czy SLA jest rozsunięte
  const [currentPage, setCurrentPage] = useState(1); // Aktualna strona paginacji
  const itemsPerPage = 30; // Liczba zgłoszeń na stronę
  const [projectName, setProjectName] = useState(null); // Nazwa projektu Jira
  const [projectIcon, setProjectIcon] = useState(null); // Ikona projektu Jira
  const [showProjectSelector, setShowProjectSelector] = useState(false); // Czy pokazać selektor projektów
  const [configuredProjects, setConfiguredProjects] = useState([]); // Lista skonfigurowanych projektów
  const [currentProjectKey, setCurrentProjectKey] = useState(null); // Aktualny klucz projektu
  const [isProjectContext, setIsProjectContext] = useState(false); // Czy użytkownik jest w kontekście projektu (project page)
  const [currentRoute, setCurrentRoute] = useState('/report'); // Aktualny route (dla submenu)
  const [currentUserAccountId, setCurrentUserAccountId] = useState(null); // Account ID aktualnego użytkownika
  
  // Inicjalizacja routingu dla submenu (Global Page z pages)
  useEffect(() => {
    const initRouting = async () => {
      try {
        const history = await view.createHistory();
        const location = history.location;
        console.log('Aktualna lokalizacja:', location.pathname);
        
        // Ustaw aktualny route na podstawie pathname
        setCurrentRoute(location.pathname || '/report');
        
        // Nasłuchuj na zmiany route
        history.listen((location) => {
          console.log('Zmiana route na:', location.pathname);
          setCurrentRoute(location.pathname);
        });
      } catch (err) {
        console.warn('Routing nie jest dostępny (prawdopodobnie project page):', err);
        // W project page nie ma routingu submenu
        setCurrentRoute('/report');
      }
    };
    
    initRouting();
  }, []);
  
  useEffect(() => {
    if (activeTab === 'myIncidents') {
      loadMyIncidents();
    } else if (activeTab === 'report') {
      loadFormFields();
    } else if (activeTab === 'statistics') {
      loadStatisticsConfig();
    }
  }, [activeTab]);
  
  const loadStatisticsConfig = async () => {
    try {
      let projectKey = null;
      let issueTypeId = null;
      
      // Pobierz z kontekstu
      try {
        const contextResult = await invoke('getContext', {});
        if (contextResult && contextResult.context) {
          if (contextResult.context.extension && contextResult.context.extension.project) {
            projectKey = contextResult.context.extension.project.key;
          } else if (contextResult.context.project) {
            projectKey = contextResult.context.project.key;
          }
        }
      } catch (contextError) {
        console.warn('Nie udało się pobrać kontekstu:', contextError);
      }
      
      // Fallback: globalna konfiguracja
      if (!projectKey) {
        const globalConfig = await invoke('getConfig', { configType: 'global' });
        if (globalConfig.success && globalConfig.data && globalConfig.data.defaultProjectKey) {
          projectKey = globalConfig.data.defaultProjectKey;
        }
      }
      
      if (projectKey) {
        const projectConfigResult = await invoke('getProjectConfig', { projectKey });
        if (projectConfigResult.success && projectConfigResult.config && projectConfigResult.config.incidentIssueTypeId) {
          issueTypeId = projectConfigResult.config.incidentIssueTypeId;
        }
      }
      
      setStatisticsProjectKey(projectKey);
      setStatisticsIssueTypeId(issueTypeId);
    } catch (error) {
      console.error('Błąd loadStatisticsConfig:', error);
    }
  };
  
  // Osobny useEffect dla showAllIncidents, showOnlyOpen i showAssignedToMe - przeładuj gdy się zmienią
  useEffect(() => {
    if (activeTab === 'myIncidents') {
      loadMyIncidents();
    }
  }, [showAllIncidents, showOnlyOpen, showAssignedToMe]);

  const loadFormFields = async (forcedProjectKey = null) => {
    try {
      setLoadingFields(true);
      let projectKey = forcedProjectKey || currentProjectKey || null;
      let hasProjectContext = false;
      
      // PRIORYTET: Najpierw spróbuj pobrać z kontekstu Jira (projekt, w którym użytkownik aktualnie się znajduje)
      try {
        const contextResult = await invoke('getContext', {});
        if (contextResult && contextResult.context) {
          // Sprawdź różne możliwe ścieżki do projektu w kontekście
          if (contextResult.context.extension && contextResult.context.extension.project) {
            projectKey = contextResult.context.extension.project.key;
            hasProjectContext = true; // Użytkownik jest w kontekście projektu (project page)
            console.log('Pobrano projectKey z kontekstu extension (project page):', projectKey);
          } else if (contextResult.context.project) {
            projectKey = contextResult.context.project.key;
            hasProjectContext = true; // Użytkownik jest w kontekście projektu
            console.log('Pobrano projectKey z kontekstu project:', projectKey);
          }
        }
      } catch (contextError) {
        console.warn('Nie udało się pobrać kontekstu:', contextError);
      }
      
      // Ustaw czy użytkownik jest w kontekście projektu (ukryj "Zmień projekt" jeśli tak)
      setIsProjectContext(hasProjectContext);
      
      // Fallback: Jeśli nie ma kontekstu, użyj globalnej konfiguracji
      if (!projectKey) {
        const globalConfig = await invoke('getConfig', { configType: 'global' });
        if (globalConfig.success && globalConfig.data && globalConfig.data.defaultProjectKey) {
          projectKey = globalConfig.data.defaultProjectKey;
          console.log('Używam projectKey z globalnej konfiguracji:', projectKey);
        }
      }
      
      if (!projectKey) {
        showFlag('error', 'Błąd', 'Nie można określić projektu. Otwórz aplikację w kontekście projektu lub skonfiguruj domyślny projekt w panelu administratora.');
        setLoadingFields(false);
        // Ustaw domyślne SLA nawet jeśli nie ma projektu
        setSlaData({
          responseTimeMinutes: { P1: 15, P2: 30, P3: 60, P4: 240 },
          resolutionTimeHours: { P1: 4, P2: 8, P3: 24, P4: 72 }
        });
        return;
      }
      
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey });
      
      if (!projectConfigResult.success || !projectConfigResult.config) {
        showFlag('error', 'Błąd', 'Nie można załadować konfiguracji projektu.');
        setLoadingFields(false);
        // Ustaw domyślne SLA nawet jeśli nie można załadować konfiguracji
        setSlaData({
          responseTimeMinutes: { P1: 15, P2: 30, P3: 60, P4: 240 },
          resolutionTimeHours: { P1: 4, P2: 8, P3: 24, P4: 72 }
        });
        return;
      }
      
      const config = projectConfigResult.config;
      
      // WAŻNE: Pobierz SLA PRZED sprawdzaniem pól - żeby zawsze było ustawione
      const escalationRules = config.escalationRules || [];
      console.log('loadFormFields - escalationRules:', escalationRules.length, escalationRules);
      
      // Filtruj tylko aktywne reguły z SLA
      const activeRulesWithSla = escalationRules
        .filter(r => {
          const hasSla = r.enabled && r.sla && r.sla.responseTimeMinutes && r.sla.resolutionTimeHours;
          console.log(`Reguła ${r.name || 'unnamed'}: enabled=${r.enabled}, hasSla=${!!hasSla}, order=${r.order || 'undefined'}`);
          return hasSla;
        })
        .sort((a, b) => (a.order || 999) - (b.order || 999)); // Sortuj po order (niższy = wyższy priorytet)
      
      console.log('activeRulesWithSla:', activeRulesWithSla.length, activeRulesWithSla);
      
      if (activeRulesWithSla.length > 0) {
        // Wybierz regułę z najwyższym priorytetem (pierwsza po sortowaniu)
        const highestPriorityRule = activeRulesWithSla[0];
        console.log('Znaleziono regułę eskalacji z SLA:', highestPriorityRule.name, 'order:', highestPriorityRule.order, 'sla:', highestPriorityRule.sla);
        setSlaData(highestPriorityRule.sla);
      } else {
        // Domyślne wartości SLA jeśli nie ma skonfigurowanych
        console.log('Brak aktywnych reguł eskalacji z SLA, używam domyślnych wartości');
        const defaultSla = {
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
        };
        console.log('Ustawiam domyślne SLA:', defaultSla);
        setSlaData(defaultSla);
      }
      
      // Teraz sprawdź pola (po ustawieniu SLA)
      if (!config.fieldsConfig || !config.fieldsConfig.configuredFields || config.fieldsConfig.configuredFields.length === 0) {
        showFlag('warning', 'Uwaga', 'Brak skonfigurowanych pól. Administrator musi skonfigurować pola w panelu administracyjnym.');
        setFormFields([]);
        setLoadingFields(false);
        return; // SLA już jest ustawione powyżej
      }
      
      // Pobierz szczegóły pól z Jira API
      const fieldsResult = await invoke('getIssueTypeFields', {
        projectKey: projectKey,
        issueTypeId: config.incidentIssueTypeId
      });
      
      if (!fieldsResult.success) {
        showFlag('error', 'Błąd', 'Nie można załadować szczegółów pól.');
        setLoadingFields(false);
        return; // SLA już jest ustawione powyżej
      }
      
      // Połącz skonfigurowane pola z danymi z Jira
      const fieldsMap = {};
      fieldsResult.fields.forEach(f => {
        fieldsMap[f.id] = f;
      });
      
      const configuredFieldsWithDetails = config.fieldsConfig.configuredFields
        .filter(f => f.enabled)
        .map(f => ({
          ...f,
          ...fieldsMap[f.id]
        }))
        .filter(f => f.id); // Usuń pola których nie ma w Jira
      
      setFormFields(configuredFieldsWithDetails);
      
      // Pobierz nazwę i ikonę projektu
      try {
        const projectNameResult = await invoke('getProjectName', { projectKey });
        if (projectNameResult.success && projectNameResult.projectName) {
          setProjectName(projectNameResult.projectName);
          // Ustaw ikonę tylko jeśli jest dostępna
          if (projectNameResult.projectIcon) {
            setProjectIcon(projectNameResult.projectIcon);
          } else {
            setProjectIcon(null);
          }
          setCurrentProjectKey(projectKey);
        }
      } catch (error) {
        console.warn('Nie udało się pobrać nazwy projektu:', error);
        // W przypadku błędu, ustaw null dla ikony
        setProjectIcon(null);
      }
      
      // Pobierz listę skonfigurowanych projektów
      try {
        const projectsResult = await invoke('getConfiguredProjects', {});
        if (projectsResult.success && projectsResult.projects) {
          setConfiguredProjects(projectsResult.projects);
        }
      } catch (error) {
        console.warn('Nie udało się pobrać listy projektów:', error);
      }
      
      // Pobierz informacje o zespole i osobie przypisanej
      const teamResult = await invoke('getCurrentTeam', { projectKey });
      if (teamResult.success) {
        setCurrentTeam(teamResult.team);
        setAssignedPerson(teamResult.assignedPerson);
      }
      
      // Inicjalizuj formData z domyślnymi wartościami
      const initialData = {
        summary: '', // Pole standardowe
        description: '' // Pole standardowe
        // Priorytet jest ukryty - będzie ustawiany automatycznie przez reguły priorytetyzacji
      };
      configuredFieldsWithDetails.forEach(field => {
        if (field.hasDefaultValue && field.defaultValue !== undefined) {
          initialData[field.id] = field.defaultValue;
        } else if (field.type === 'array' || field.type === 'option') {
          initialData[field.id] = null;
        } else {
          initialData[field.id] = '';
        }
      });
      setFormData(initialData);
      
    } catch (error) {
      console.error('Error loading form fields:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować pól formularza');
    } finally {
      setLoadingFields(false);
    }
  };

  const renderField = (field) => {
    const value = formData[field.id] || '';
    const isRequired = field.required;
    const fieldDescription = field.description || '';
    
    const handleChange = (e) => {
      setFormData({
        ...formData,
        [field.id]: e.target.value
      });
    };
    
    const renderFieldWrapper = (fieldContent) => (
      <div key={field.id} className="form-group">
        <label className="form-label" htmlFor={field.id}>
          {field.name} {isRequired && '*'}
        </label>
        {fieldDescription && (
          <div className="form-helper" style={{ fontSize: '12px', color: '#666', marginBottom: '5px', fontStyle: 'italic' }}>
            {fieldDescription}
          </div>
        )}
        {fieldContent}
      </div>
    );
    
    // Renderuj pole w zależności od typu
    // Sprawdź czy to pole wielokrotnego wyboru (array)
    const isArrayField = field.schema?.type === 'array' || field.type === 'array';
    
    if (isArrayField && (field.allowedValues && field.allowedValues.length > 0)) {
      // Multi-select dla pól z opcjami i typem array
      const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);
      
      const handleMultiSelectChange = (e) => {
        const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
        setFormData({
          ...formData,
          [field.id]: selectedOptions
        });
      };
      
      return renderFieldWrapper(
        <select
          id={field.id}
          className="form-select"
          multiple
          value={selectedValues}
          onChange={handleMultiSelectChange}
          required={isRequired}
          style={{ minHeight: '100px' }}
        >
          {field.allowedValues && field.allowedValues.map((option, idx) => {
            const optionValue = typeof option === 'object' ? (option.value || option.id) : option;
            const optionLabel = typeof option === 'object' ? (option.name || option.value || option.displayName) : option;
            return (
              <option key={idx} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      );
    } else if (field.type === 'option' || (field.allowedValues && field.allowedValues.length > 0)) {
      // Single-select dla pól z opcjami (nie array)
      return renderFieldWrapper(
        <select
          id={field.id}
          className="form-select"
          value={value}
          onChange={handleChange}
          required={isRequired}
        >
          <option value="">-- Wybierz --</option>
          {field.allowedValues && field.allowedValues.map((option, idx) => {
            const optionValue = typeof option === 'object' ? (option.value || option.id) : option;
            const optionLabel = typeof option === 'object' ? (option.name || option.value || option.displayName) : option;
            return (
              <option key={idx} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      );
    } else if (field.type === 'string' || field.type === 'text') {
      // Textarea dla długich tekstów
      if (field.name.toLowerCase().includes('opis') || field.name.toLowerCase().includes('description') || field.name.toLowerCase().includes('komentarz') || field.name.toLowerCase().includes('comment')) {
        return renderFieldWrapper(
          <textarea
            id={field.id}
            className="form-textarea"
            value={value}
            onChange={handleChange}
            rows="5"
            required={isRequired}
            placeholder={fieldDescription || `Wprowadź ${field.name.toLowerCase()}`}
          />
        );
      } else {
        // Input dla krótkich tekstów
        return renderFieldWrapper(
          <input
            id={field.id}
            type="text"
            className="form-input"
            value={value}
            onChange={handleChange}
            required={isRequired}
            placeholder={fieldDescription || `Wprowadź ${field.name.toLowerCase()}`}
          />
        );
      }
    } else if (field.type === 'number') {
      return renderFieldWrapper(
        <input
          id={field.id}
          type="number"
          className="form-input"
          value={value}
          onChange={handleChange}
          required={isRequired}
        />
      );
    } else if (field.type === 'date') {
      return renderFieldWrapper(
        <input
          id={field.id}
          type="date"
          className="form-input"
          value={value}
          onChange={handleChange}
          required={isRequired}
        />
      );
    } else {
      // Domyślnie input text
      return renderFieldWrapper(
        <input
          id={field.id}
          type="text"
          className="form-input"
          value={value}
          onChange={handleChange}
          required={isRequired}
          placeholder={fieldDescription || `Wprowadź ${field.name.toLowerCase()}`}
        />
      );
    }
  };

  const showFlag = (type, title, description) => {
    const id = Date.now();
    setFlags(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setFlags(prev => prev.filter(f => f.id !== id));
    }, 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const result = await invoke('createIncident', { formData: formData });
      
      if (result.success) {
        showFlag('success', 'Sukces', `Alert ${result.issueKey} został utworzony`);
        // Reset form
        const initialData = {};
        formFields.forEach(field => {
          if (field.hasDefaultValue && field.defaultValue !== undefined) {
            initialData[field.id] = field.defaultValue;
          } else {
            initialData[field.id] = '';
          }
        });
        setFormData(initialData);
        
        // Refresh my incidents if on that tab
        if (activeTab === 'myIncidents') {
          await loadMyIncidents();
        }
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się utworzyć alertu');
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Wystąpił nieoczekiwany błąd');
    } finally {
      setLoading(false);
    }
  };

  const loadMyIncidents = async () => {
    try {
      // Pobierz konfigurację projektu (użyj domyślnego projektu lub z kontekstu)
      const globalConfig = await invoke('getConfig', { configType: 'global' });
      let projectKey = null;
      let issueTypeId = null;
      
      if (globalConfig.success && globalConfig.data && globalConfig.data.defaultProjectKey) {
        projectKey = globalConfig.data.defaultProjectKey;
      }
      
      if (!projectKey) {
        // Spróbuj pobrać z kontekstu
        const contextResult = await invoke('resolver', {});
        if (contextResult.context && contextResult.context.extension && contextResult.context.extension.project) {
          projectKey = contextResult.context.extension.project.key;
        }
      }
      
      // Jeśli mamy projectKey, spróbuj pobrać konfigurację projektu i issueTypeId
      if (projectKey) {
        const projectConfigResult = await invoke('getProjectConfig', { projectKey });
        
        if (projectConfigResult.success && projectConfigResult.config && projectConfigResult.config.incidentIssueTypeId) {
          issueTypeId = projectConfigResult.config.incidentIssueTypeId;
        }
      }
      
      // Wywołaj getMyIncidents z parametrami (mogą być null jeśli nie skonfigurowane)
      const result = await invoke('getMyIncidents', {
        projectKey: projectKey,
        issueTypeId: issueTypeId,
        showAll: showAllIncidents
      });
      console.log('loadMyIncidents result:', result);
      
      if (result.success && result.incidents) {
        setMyIncidents(result.incidents);
        // Zapisz jiraInstanceUrl jeśli jest dostępny
        if (result.jiraInstanceUrl) {
          setJiraInstanceUrl(result.jiraInstanceUrl);
        }
        // Zapisz currentUserAccountId jeśli jest dostępny
        if (result.currentUserAccountId) {
          setCurrentUserAccountId(result.currentUserAccountId);
        }
        console.log('Załadowano alertów:', result.incidents.length);
      } else if (result.success) {
        setMyIncidents([]);
        console.log('Brak alertów');
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się załadować alertów');
        setMyIncidents([]);
      }
    } catch (error) {
      console.error('Błąd loadMyIncidents:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować alertów');
      setMyIncidents([]);
    }
  };

  const getPriorityClass = (priority) => {
    return `priority-badge priority-${priority || 'P3'}`;
  };

  // Funkcja do obliczania czasu w statusie
  const getTimeInStatus = (statusChangedDate) => {
    if (!statusChangedDate) return '-';
    
    const now = new Date();
    const changed = new Date(statusChangedDate);
    const diffMs = now - changed;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      return `${diffDays}d ${Math.floor(diffHours % 24)}h`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes % 60}min`;
    } else {
      return `${diffMinutes}min`;
    }
  };

  // Funkcja do sortowania zgłoszeń
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Funkcja do filtrowania i sortowania zgłoszeń
  const getFilteredAndSortedIncidents = () => {
    let filtered = [...myIncidents];
    
    // Filtrowanie po statusie (wiele wartości)
    if (filterStatuses.length > 0) {
      filtered = filtered.filter(incident => filterStatuses.includes(incident.status));
    }
    
    // Filtrowanie po priorytecie (wiele wartości)
    if (filterPriorities.length > 0) {
      filtered = filtered.filter(incident => filterPriorities.includes(incident.priority));
    }
    
    // Filtrowanie po osobie przypisanej (wiele wartości)
    if (filterAssignees.length > 0) {
      filtered = filtered.filter(incident => {
        const assignee = incident.assignee || 'Nieprzypisane';
        return filterAssignees.includes(assignee);
      });
    }
    
    // Filtrowanie - pokaż tylko otwarte (nie zakończone)
    if (showOnlyOpen) {
      filtered = filtered.filter(incident => incident.statusCategory !== 'done');
    }
    
    // Filtrowanie - przypisane do mnie
    if (showAssignedToMe && currentUserAccountId) {
      filtered = filtered.filter(incident => {
        // Incident może mieć assigneeAccountId lub assignee (może być email lub accountId)
        return incident.assigneeAccountId === currentUserAccountId || 
               incident.assignee === currentUserAccountId;
      });
    }
    
    // Sortowanie
    filtered.sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];
      
      // Obsługa dat
      if (sortField === 'created' || sortField === 'statusChanged') {
        aValue = aValue ? new Date(aValue).getTime() : 0;
        bValue = bValue ? new Date(bValue).getTime() : 0;
      }
      
      // Obsługa stringów
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
    
    return filtered;
  };

  // Funkcja do pobierania zgłoszeń dla aktualnej strony
  const getPaginatedIncidents = () => {
    const allIncidents = getFilteredAndSortedIncidents();
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return allIncidents.slice(startIndex, endIndex);
  };

  // Oblicz liczbę stron
  const getTotalPages = () => {
    const totalItems = getFilteredAndSortedIncidents().length;
    return Math.ceil(totalItems / itemsPerPage);
  };

  // Resetuj stronę do 1 gdy zmieniają się filtry
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatuses, filterPriorities, filterAssignees, sortField, sortDirection]);

  // Pobierz unikalne wartości dla filtrów
  const uniqueStatuses = [...new Set(myIncidents.map(i => i.status))].sort();
  const uniquePriorities = [...new Set(myIncidents.map(i => i.priority))].filter(p => p && p !== 'None').sort();
  const uniqueAssignees = [...new Set(myIncidents.map(i => i.assignee || 'Nieprzypisane'))].sort();

  return (
    <div className="user-container">
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
      <div className="user-header" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          {projectIcon && (
            <img 
              src={projectIcon} 
              alt={projectName || 'Project icon'} 
              style={{ 
                width: '32px', 
                height: '32px', 
                borderRadius: '4px',
                flexShrink: 0
              }} 
            />
          )}
          <h1 style={{ margin: 0 }}>{projectName || 'DrEryk Alert'}</h1>
        </div>
        {projectName && (
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
            {/* Przycisk "Zmień projekt" widoczny TYLKO w global page (nie w kontekście projektu) */}
            {!isProjectContext && currentRoute === '/report' && (
              <button
                onClick={() => setShowProjectSelector(!showProjectSelector)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  backgroundColor: '#f4f5f7',
                  color: '#172B4D',
                  border: '1px solid #dfe1e6',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#e4e6ea'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#f4f5f7'}
              >
                Zmień projekt
              </button>
            )}
            {showProjectSelector && configuredProjects.length > 0 && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 999
                  }}
                  onClick={() => setShowProjectSelector(false)}
                />
                <div style={{
                  position: 'absolute',
                  marginTop: '8px',
                  backgroundColor: 'white',
                  border: '1px solid #dfe1e6',
                  borderRadius: '4px',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: '300px',
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                {configuredProjects.map(project => (
                  <div
                    key={project.key}
                    onClick={async () => {
                      if (project.key !== currentProjectKey) {
                        setShowProjectSelector(false);
                        // Zmiana projektu: przeładuj dane formularza dla wybranego projektu
                        setCurrentProjectKey(project.key);
                        setProjectName(project.name);
                        setProjectIcon(project.icon);
                        setFormData({});
                        setFormFields([]);
                        setLoadingFields(true);
                        try {
                          await loadFormFields(project.key);
                        } catch (err) {
                          console.error('Błąd ładowania konfiguracji projektu:', err);
                          showFlag('error', 'Błąd', 'Nie udało się załadować konfiguracji wybranego projektu.');
                        }
                      } else {
                        setShowProjectSelector(false);
                      }
                    }}
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      borderBottom: '1px solid #f4f5f7',
                      transition: 'background-color 0.2s',
                      backgroundColor: project.key === currentProjectKey ? '#f4f5f7' : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (project.key !== currentProjectKey) {
                        e.currentTarget.style.backgroundColor = '#f4f5f7';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (project.key !== currentProjectKey) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    {project.icon && (
                      <img 
                        src={project.icon} 
                        alt={project.name} 
                        style={{ 
                          width: '24px', 
                          height: '24px', 
                          borderRadius: '3px',
                          flexShrink: 0
                        }} 
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', color: '#172B4D' }}>{project.name}</div>
                      <div style={{ fontSize: '12px', color: '#5E6C84' }}>{project.key}</div>
                    </div>
                    {project.key === currentProjectKey && (
                      <span style={{ color: '#0052CC', fontSize: '14px' }}>✓</span>
                    )}
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
        )}
        {(currentTeam || assignedPerson) && (
          <div style={{ 
            marginBottom: '20px', 
            padding: '12px', 
            backgroundColor: '#f4f5f7', 
            borderRadius: '4px',
            borderLeft: '4px solid #0052CC'
          }}>
            {currentTeam && (
              <div style={{ marginBottom: assignedPerson ? '8px' : '0' }}>
                <strong>Zespół odpowiedzialny:</strong> {currentTeam.name}
                {currentTeam.description && (
                  <span style={{ color: '#666', fontSize: '14px', marginLeft: '8px' }}>
                    ({currentTeam.description})
                  </span>
                )}
              </div>
            )}
            {assignedPerson && (
              <div>
                <strong>Osoba przypisana do dyżuru:</strong> {assignedPerson.displayName}
                {assignedPerson.emailAddress && (
                  <span style={{ color: '#666', fontSize: '14px', marginLeft: '8px' }}>
                    ({assignedPerson.emailAddress})
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <p>Wypełnij formularz poniżej, aby zgłosić nowy alert systemowy</p>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <div className="tab-list">
          <button
            className={`tab-button ${activeTab === 'report' ? 'active' : ''}`}
            onClick={() => setActiveTab('report')}
          >
            Zgłoś Alert
          </button>
          <button
            className={`tab-button ${activeTab === 'myIncidents' ? 'active' : ''}`}
            onClick={() => setActiveTab('myIncidents')}
          >
            Zgłoszone alerty
          </button>
          <button
            className={`tab-button ${activeTab === 'statistics' ? 'active' : ''}`}
            onClick={() => setActiveTab('statistics')}
          >
            Statystyka
          </button>
          <button
            className={`tab-button ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            Harmonogram
          </button>
        </div>

        <div className="tab-panel">
          {activeTab === 'report' ? (
            loadingFields ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Ładowanie pól formularza...</p>
              </div>
            ) : formFields.length === 0 ? (
              <div className="message-box message-warning">
                <strong>Brak skonfigurowanych pól:</strong> Administrator musi najpierw skonfigurować pola formularza w panelu administracyjnym.
              </div>
            ) : (
              <div>
                {/* Komponent SLA - rozsuwany - zawsze pokazuj, nawet jeśli dane są domyślne */}
                {slaData ? (
                  <div className="sla-container">
                    <div 
                      className="sla-header"
                      onClick={() => setSlaExpanded(!slaExpanded)}
                      style={{
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        backgroundColor: '#F4F5F7',
                        borderRadius: '3px',
                        border: '1px solid #DFE1E6',
                        marginBottom: '16px',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#EBECF0'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#F4F5F7'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px', fontWeight: '600', color: '#172B4D' }}>
                          📋 SLA - Czas reakcji i rozwiązania
                        </span>
                      </div>
                      <span style={{ 
                        fontSize: '14px', 
                        color: '#5E6C84',
                        transform: slaExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s'
                      }}>
                        ▼
                      </span>
                    </div>
                    
                    {slaExpanded && (
                      <div className="sla-content" style={{
                        padding: '16px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #DFE1E6',
                        borderTop: 'none',
                        borderRadius: '0 0 3px 3px',
                        marginBottom: '16px'
                      }}>
                        <div style={{ marginBottom: '20px' }}>
                          <h4 style={{ 
                            fontSize: '14px', 
                            fontWeight: '600', 
                            color: '#172B4D',
                            marginBottom: '12px'
                          }}>
                            Czas reakcji (minuty)
                          </h4>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '12px'
                          }}>
                            {['P1', 'P2', 'P3', 'P4'].map(priority => (
                              <div key={priority} style={{
                                padding: '12px',
                                backgroundColor: priority === 'P1' ? '#FFEBE6' : 
                                               priority === 'P2' ? '#FFE6E6' : 
                                               priority === 'P3' ? '#FFF4E6' : '#E6F7E6',
                                borderRadius: '3px',
                                border: `1px solid ${priority === 'P1' ? '#DE350B' : 
                                                          priority === 'P2' ? '#FF5630' : 
                                                          priority === 'P3' ? '#FFAB00' : '#36B37E'}`
                              }}>
                                <div style={{ 
                                  fontSize: '12px', 
                                  fontWeight: '600', 
                                  color: '#5E6C84',
                                  marginBottom: '4px'
                                }}>
                                  {priority}
                                </div>
                                <div style={{ 
                                  fontSize: '18px', 
                                  fontWeight: '700', 
                                  color: '#172B4D'
                                }}>
                                  {slaData.responseTimeMinutes?.[priority] || 0} min
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <h4 style={{ 
                            fontSize: '14px', 
                            fontWeight: '600', 
                            color: '#172B4D',
                            marginBottom: '12px'
                          }}>
                            Czas rozwiązania (godziny)
                          </h4>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '12px'
                          }}>
                            {['P1', 'P2', 'P3', 'P4'].map(priority => (
                              <div key={priority} style={{
                                padding: '12px',
                                backgroundColor: priority === 'P1' ? '#FFEBE6' : 
                                               priority === 'P2' ? '#FFE6E6' : 
                                               priority === 'P3' ? '#FFF4E6' : '#E6F7E6',
                                borderRadius: '3px',
                                border: `1px solid ${priority === 'P1' ? '#DE350B' : 
                                                          priority === 'P2' ? '#FF5630' : 
                                                          priority === 'P3' ? '#FFAB00' : '#36B37E'}`
                              }}>
                                <div style={{ 
                                  fontSize: '12px', 
                                  fontWeight: '600', 
                                  color: '#5E6C84',
                                  marginBottom: '4px'
                                }}>
                                  {priority}
                                </div>
                                <div style={{ 
                                  fontSize: '18px', 
                                  fontWeight: '700', 
                                  color: '#172B4D'
                                }}>
                                  {slaData.resolutionTimeHours?.[priority] || 0} h
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ 
                    padding: '12px 16px', 
                    backgroundColor: '#F4F5F7', 
                    borderRadius: '3px', 
                    border: '1px solid #DFE1E6',
                    marginBottom: '16px',
                    color: '#5E6C84',
                    fontSize: '14px'
                  }}>
                    Ładowanie informacji o SLA...
                  </div>
                )}
                
                <form onSubmit={handleSubmit}>
                  {/* Pola standardowe Jira - zawsze widoczne */}
                <div className="form-group">
                  <label className="form-label" htmlFor="summary">
                    Podsumowanie *
                  </label>
                  <div className="form-helper" style={{ fontSize: '12px', color: '#666', marginBottom: '5px', fontStyle: 'italic' }}>
                    Krótkie podsumowanie alertu (będzie widoczne jako tytuł zgłoszenia)
                  </div>
                  <input
                    id="summary"
                    type="text"
                    className="form-input"
                    value={formData.summary || ''}
                    onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                    placeholder="np. System niedostępny w środowisku produkcyjnym"
                    required
                    maxLength={255}
                  />
                </div>


                <div className="form-group">
                  <label className="form-label" htmlFor="description">
                    Opis *
                  </label>
                  <div className="form-helper" style={{ fontSize: '12px', color: '#666', marginBottom: '5px', fontStyle: 'italic' }}>
                    Szczegółowy opis problemu, objawów i wpływu na użytkowników
                  </div>
                  <textarea
                    id="description"
                    className="form-textarea"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Opisz szczegółowo problem: co się stało, kiedy, jakie są objawy, wpływ na użytkowników..."
                    rows="5"
                    required
                  />
                </div>

                {/* Skonfigurowane pola niestandardowe */}
                {formFields.map(field => renderField(field))}
                
                <div className="flex flex-gap mt-16">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                  >
                    {loading ? 'Zgłaszanie...' : 'Zgłoś Alert'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => {
                      const initialData = {
                        summary: '',
                        description: ''
                        // Priorytet jest ukryty - będzie ustawiany automatycznie przez reguły priorytetyzacji
                      };
                      formFields.forEach(field => {
                        if (field.hasDefaultValue && field.defaultValue !== undefined) {
                          initialData[field.id] = field.defaultValue;
                        } else {
                          initialData[field.id] = '';
                        }
                      });
                      setFormData(initialData);
                    }}
                    disabled={loading}
                  >
                    Wyczyść
                  </button>
                </div>
              </form>
              </div>
            )
          ) : activeTab === 'myIncidents' ? (
            <div>
              <div className="section-header flex-between mb-16">
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!showAllIncidents}
                      onChange={(e) => {
                        setShowAllIncidents(!e.target.checked);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', color: '#172B4D' }}>Zgłoszone przeze mnie</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showAssignedToMe}
                      onChange={(e) => {
                        setShowAssignedToMe(e.target.checked);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', color: '#172B4D' }}>Przypisane do mnie</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showOnlyOpen}
                      onChange={(e) => {
                        setShowOnlyOpen(e.target.checked);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', color: '#172B4D' }}>Pokaż tylko otwarte</span>
                  </label>
                  <button className="btn btn-default" onClick={loadMyIncidents}>
                    🔄 Odśwież
                  </button>
                </div>
              </div>

              {myIncidents.length === 0 ? (
                <div className="message-box message-info">
                  Nie masz jeszcze żadnych zgłoszonych alertów.
                </div>
              ) : (
                <>
                  {/* Filtry - Kompaktowe listy rozwijane */}
                  <div style={{ 
                    marginBottom: '16px', 
                    display: 'flex', 
                    gap: '12px', 
                    flexWrap: 'wrap',
                    alignItems: 'center'
                  }}>
                    {/* Filtr Statusów */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowStatusFilter(!showStatusFilter)}
                        style={{
                          padding: '8px 12px',
                          fontSize: '13px',
                          backgroundColor: filterStatuses.length > 0 ? '#0052CC' : 'white',
                          color: filterStatuses.length > 0 ? 'white' : '#172B4D',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: filterStatuses.length > 0 ? '600' : '400',
                          boxShadow: showStatusFilter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        <span>Status {filterStatuses.length > 0 && `(${filterStatuses.length})`}</span>
                        <span style={{ fontSize: '10px' }}>{showStatusFilter ? '▲' : '▼'}</span>
                      </button>
                      {showStatusFilter && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          marginTop: '4px',
                          backgroundColor: 'white',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                          zIndex: 1000,
                          minWidth: '200px',
                          maxHeight: '250px',
                          overflowY: 'auto',
                          padding: '8px'
                        }}>
                          {uniqueStatuses.map(status => (
                            <label 
                              key={status}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                padding: '6px 8px',
                                borderRadius: '3px',
                                transition: 'background-color 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F4F5F7'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <input
                                type="checkbox"
                                checked={filterStatuses.includes(status)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilterStatuses([...filterStatuses, status]);
                                  } else {
                                    setFilterStatuses(filterStatuses.filter(s => s !== status));
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                              <span>{status}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Filtr Priorytetów */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowPriorityFilter(!showPriorityFilter)}
                        style={{
                          padding: '8px 12px',
                          fontSize: '13px',
                          backgroundColor: filterPriorities.length > 0 ? '#0052CC' : 'white',
                          color: filterPriorities.length > 0 ? 'white' : '#172B4D',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: filterPriorities.length > 0 ? '600' : '400',
                          boxShadow: showPriorityFilter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        <span>Priorytet {filterPriorities.length > 0 && `(${filterPriorities.length})`}</span>
                        <span style={{ fontSize: '10px' }}>{showPriorityFilter ? '▲' : '▼'}</span>
                      </button>
                      {showPriorityFilter && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          marginTop: '4px',
                          backgroundColor: 'white',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                          zIndex: 1000,
                          minWidth: '200px',
                          maxHeight: '250px',
                          overflowY: 'auto',
                          padding: '8px'
                        }}>
                          {uniquePriorities.map(priority => (
                            <label 
                              key={priority}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                padding: '6px 8px',
                                borderRadius: '3px',
                                transition: 'background-color 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F4F5F7'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <input
                                type="checkbox"
                                checked={filterPriorities.includes(priority)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilterPriorities([...filterPriorities, priority]);
                                  } else {
                                    setFilterPriorities(filterPriorities.filter(p => p !== priority));
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                              <span>{priority}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Filtr Osoby Przypisanej */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowAssigneeFilter(!showAssigneeFilter)}
                        style={{
                          padding: '8px 12px',
                          fontSize: '13px',
                          backgroundColor: filterAssignees.length > 0 ? '#0052CC' : 'white',
                          color: filterAssignees.length > 0 ? 'white' : '#172B4D',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: filterAssignees.length > 0 ? '600' : '400',
                          boxShadow: showAssigneeFilter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        <span>Osoba przypisana {filterAssignees.length > 0 && `(${filterAssignees.length})`}</span>
                        <span style={{ fontSize: '10px' }}>{showAssigneeFilter ? '▲' : '▼'}</span>
                      </button>
                      {showAssigneeFilter && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          marginTop: '4px',
                          backgroundColor: 'white',
                          border: '1px solid #DFE1E6',
                          borderRadius: '3px',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                          zIndex: 1000,
                          minWidth: '200px',
                          maxHeight: '250px',
                          overflowY: 'auto',
                          padding: '8px'
                        }}>
                          {uniqueAssignees.map(assignee => (
                            <label 
                              key={assignee}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                padding: '6px 8px',
                                borderRadius: '3px',
                                transition: 'background-color 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F4F5F7'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <input
                                type="checkbox"
                                checked={filterAssignees.includes(assignee)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilterAssignees([...filterAssignees, assignee]);
                                  } else {
                                    setFilterAssignees(filterAssignees.filter(a => a !== assignee));
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                              <span>{assignee}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Przycisk wyczyszczenia filtrów */}
                    {(filterStatuses.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0) && (
                      <button
                        onClick={() => {
                          setFilterStatuses([]);
                          setFilterPriorities([]);
                          setFilterAssignees([]);
                        }}
                        style={{
                          padding: '8px 12px',
                          fontSize: '13px',
                          backgroundColor: '#DFE1E6',
                          color: '#172B4D',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Wyczyść filtry
                      </button>
                    )}
                  </div>
                  
                  {/* Zamykanie list rozwijanych po kliknięciu poza nimi */}
                  {showStatusFilter && (
                    <div
                      style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 999
                      }}
                      onClick={() => setShowStatusFilter(false)}
                    />
                  )}
                  {showPriorityFilter && (
                    <div
                      style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 999
                      }}
                      onClick={() => setShowPriorityFilter(false)}
                    />
                  )}
                  {showAssigneeFilter && (
                    <div
                      style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 999
                      }}
                      onClick={() => setShowAssigneeFilter(false)}
                    />
                  )}

                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '4px', padding: 0 }}></th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('key')}
                        >
                          Klucz {sortField === 'key' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('summary')}
                        >
                          Podsumowanie {sortField === 'summary' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('priority')}
                        >
                          Priorytet {sortField === 'priority' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('status')}
                        >
                          Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th>Osoba przypisana</th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('statusChanged')}
                        >
                          Czas w statusie {sortField === 'statusChanged' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => handleSort('created')}
                        >
                          Data utworzenia {sortField === 'created' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getPaginatedIncidents().map((incident, index) => {
                      // Buduj URL do zgłoszenia w Jira
                      // Użyj jiraInstanceUrl z konfiguracji projektu, jeśli jest dostępny
                      // W przeciwnym razie użyj domyślnego URL na podstawie hostname
                      let baseUrl;
                      if (jiraInstanceUrl) {
                        // Usuń końcowy slash jeśli istnieje
                        baseUrl = jiraInstanceUrl.replace(/\/$/, '');
                      } else {
                        // Fallback - użyj hostname z aktualnego okna
                        const hostname = window.location.hostname;
                        baseUrl = `https://${hostname}`;
                      }
                      const issueUrl = `${baseUrl}/browse/${incident.key}`;
                      
                      // Określ kolor linii statusu na podstawie statusCategory
                      const getStatusLineColor = (statusCategory) => {
                        if (statusCategory === 'new') {
                          return '#DE350B'; // Czerwony - nowe nie podjęte zgłoszenie
                        } else if (statusCategory === 'done') {
                          return '#00875A'; // Zielony - rozwiązane
                        } else {
                          return '#0052CC'; // Niebieski - pozostałe statusy (indeterminate, in_progress)
                        }
                      };
                      
                      // Sprawdź czy zgłoszenie przekroczyło SLA dla pierwszego podjęcia
                      // Pulsowanie powinno być tylko dla zgłoszeń niepodjętych (statusCategory === 'new')
                      const checkSLAExceeded = (incident) => {
                        // Sprawdź tylko jeśli zgłoszenie nie zostało podjęte (statusCategory === 'new')
                        // To jest kluczowe - pulsowanie tylko dla niepodjętych zgłoszeń
                        if (incident.statusCategory !== 'new') {
                          return false;
                        }
                        
                        // Sprawdź czy mamy dane SLA
                        if (!slaData || !slaData.responseTimeMinutes) {
                          return false;
                        }
                        
                        // Mapuj priorytet Jira na P1-P4
                        const priorityMap = {
                          'Highest': 'P1',
                          'Krytyczny': 'P1',
                          'High': 'P2',
                          'Wysoki': 'P2',
                          'Medium': 'P3',
                          'Średni': 'P3',
                          'Low': 'P4',
                          'Niski': 'P4'
                        };
                        
                        const priorityKey = priorityMap[incident.priority] || 'P3';
                        const responseTimeMinutes = slaData.responseTimeMinutes[priorityKey];
                        
                        if (!responseTimeMinutes || !incident.created) {
                          return false;
                        }
                        
                        // Oblicz czas od utworzenia w minutach
                        const createdTime = new Date(incident.created).getTime();
                        const now = new Date().getTime();
                        const minutesSinceCreation = Math.floor((now - createdTime) / (1000 * 60));
                        
                        // Sprawdź czy przekroczono czas SLA
                        return minutesSinceCreation > responseTimeMinutes;
                      };
                      
                      const statusLineColor = getStatusLineColor(incident.statusCategory);
                      const slaExceeded = checkSLAExceeded(incident);
                      
                      return (
                        <tr 
                          key={index}
                          className={slaExceeded ? 'row-sla-exceeded' : ''}
                          style={slaExceeded ? {
                            border: '2px solid rgba(222, 53, 11, 0.6)',
                            borderRadius: '3px',
                            boxShadow: '0 0 0 1px rgba(222, 53, 11, 0.2)'
                          } : {}}
                        >
                          {/* Komórka z pionową linią statusu */}
                          <td style={{ 
                            width: '4px', 
                            padding: 0,
                            position: 'relative'
                          }}>
                            <div
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: '4px',
                                backgroundColor: statusLineColor,
                                borderRadius: '2px'
                              }}
                            />
                          </td>
                          <td>
                            <a 
                              href={issueUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{ 
                                color: '#0052CC', 
                                textDecoration: 'none',
                                fontWeight: 'bold'
                              }}
                              onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                              onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                              {incident.key}
                            </a>
                          </td>
                          <td>
                            {incident.summary || '-'}
                          </td>
                          <td>
                            <span className={getPriorityClass(incident.priority)}>
                              {incident.priority || 'P3'}
                            </span>
                          </td>
                          <td>{incident.status || 'Otwarte'}</td>
                          <td>{incident.assignee || 'Nieprzypisane'}</td>
                          <td>{getTimeInStatus(incident.statusChanged)}</td>
                          <td>{incident.created ? new Date(incident.created).toLocaleString('pl-PL') : '-'}</td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                  
                  {/* Paginacja */}
                  {getTotalPages() > 1 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '20px',
                      padding: '16px'
                    }}>
                      <button
                        className="btn btn-default"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        style={{
                          padding: '8px 16px',
                          fontSize: '14px',
                          cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                          opacity: currentPage === 1 ? 0.5 : 1
                        }}
                      >
                        ← Poprzednia
                      </button>
                      
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'center'
                      }}>
                        <span style={{ fontSize: '14px', color: '#5E6C84', margin: '0 8px' }}>
                          Strona {currentPage} z {getTotalPages()}
                        </span>
                        <span style={{ fontSize: '14px', color: '#5E6C84' }}>
                          ({getFilteredAndSortedIncidents().length} zgłoszeń)
                        </span>
                      </div>
                      
                      <button
                        className="btn btn-default"
                        onClick={() => setCurrentPage(prev => Math.min(getTotalPages(), prev + 1))}
                        disabled={currentPage === getTotalPages()}
                        style={{
                          padding: '8px 16px',
                          fontSize: '14px',
                          cursor: currentPage === getTotalPages() ? 'not-allowed' : 'pointer',
                          opacity: currentPage === getTotalPages() ? 0.5 : 1
                        }}
                      >
                        Następna →
                      </button>
                    </div>
                  )}
                  
                  {getFilteredAndSortedIncidents().length === 0 && (filterStatuses.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0) && (
                    <div className="message-box message-info" style={{ marginTop: '16px' }}>
                      Brak zgłoszeń spełniających wybrane filtry.
                    </div>
                  )}
                </>
              )}
            </div>
          ) : activeTab === 'statistics' ? (
            <Statistics 
              showFlag={showFlag}
              projectKey={statisticsProjectKey}
              issueTypeId={statisticsIssueTypeId}
            />
          ) : activeTab === 'schedule' ? (
            <Schedule 
              showFlag={showFlag}
              projectKey={currentProjectKey}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// UserApp is exported as default above
