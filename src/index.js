import Resolver from '@forge/resolver';
import api, { route, storage, fetch } from '@forge/api';

const resolver = new Resolver();

// ============================================================================
// RESOLVER for Custom UI
// ============================================================================
resolver.define('resolver', async ({ payload, context }) => {
  return {
    success: true,
    context: context
  };
});

// ============================================================================
// CREATE ALERT
// ============================================================================
resolver.define('createIncident', async ({ payload, context }) => {
  try {
    const { formData, projectKey } = payload;
    const accountId = context.accountId;
    
    // Get configuration - najpierw sprawdź czy jest podany projekt, jeśli nie - użyj domyślnego
    let config;
    let fieldsConfig;
    let targetProjectKey = projectKey;
    
    // Jeśli nie podano projektu, sprawdź domyślny z global_config
    if (!targetProjectKey) {
      const globalConfig = await storage.get('global_config');
      if (globalConfig) {
        targetProjectKey = globalConfig.defaultProjectKey || globalConfig.targetProjectKey;
      }
    }
    
    // Jeśli nadal brak - użyj projektu z kontekstu
    if (!targetProjectKey && context.extension && context.extension.project) {
      targetProjectKey = context.extension.project.key;
      console.log('Używam projektu z kontekstu:', targetProjectKey);
    }
    
    // Pobierz konfigurację specyficzną dla projektu
    if (targetProjectKey) {
      const projectConfig = await storage.get(`project_config_${targetProjectKey}`);
      if (projectConfig) {
        config = projectConfig;
        fieldsConfig = projectConfig.fieldsConfig || getDefaultFieldsConfig();
      }
    }
    
    // Fallback na global_config i fields_config
    if (!config) {
      config = await storage.get('global_config');
      fieldsConfig = await storage.get('fields_config') || getDefaultFieldsConfig();
      
      // Ustaw projectKey z global_config
      if (config) {
        config.projectKey = config.defaultProjectKey || config.targetProjectKey;
      }
    }
    
    // Jeśli nadal brak config lub projectKey, użyj targetProjectKey z kontekstu
    if (!config) {
      config = {
        projectKey: targetProjectKey,
        defaultPriority: 'P3',
        enableAutoProcessing: true
      };
      fieldsConfig = getDefaultFieldsConfig();
      console.log('Używam domyślnej konfiguracji dla projektu:', targetProjectKey);
    }
    
    // Upewnij się że config ma projectKey
    if (!config.projectKey && targetProjectKey) {
      config.projectKey = targetProjectKey;
    }
    
    if (!config || !config.projectKey) {
      return {
        success: false,
        error: 'Nie można określić projektu docelowego. Skonfiguruj aplikację w panelu administratora.'
      };
    }
    
    if (!config.incidentIssueTypeId) {
      return {
        success: false,
        error: `Typ zgłoszenia nie jest skonfigurowany dla projektu ${config.projectKey}. Skonfiguruj w panelu administratora.`
      };
    }
    
    // Walidacja wymaganych pól na podstawie konfiguracji
    if (config.fieldsConfig && config.fieldsConfig.configuredFields) {
      const requiredFields = config.fieldsConfig.configuredFields.filter(f => f.enabled && f.required);
      
      for (const field of requiredFields) {
        if (!formData[field.id] || formData[field.id] === '' || formData[field.id] === null) {
          return {
            success: false,
            error: `Pole "${field.name}" jest wymagane`
          };
        }
      }
    }
    
    // Walidacja pól standardowych
    if (!formData.summary || formData.summary.trim() === '') {
      return {
        success: false,
        error: 'Pole "Podsumowanie" jest wymagane'
      };
    }
    
    if (!formData.description || formData.description.trim() === '') {
      return {
        success: false,
        error: 'Pole "Opis" jest wymagane'
      };
    }
    
    // Create issue payload
    const issuePayload = {
      fields: {
        project: {
          key: config.projectKey
        },
        summary: formData.summary.substring(0, 255), // Jira limit to 255 znaków
        description: buildDescription(formData, accountId, config.fieldsConfig),
        issuetype: {
          id: config.incidentIssueTypeId
        },
        reporter: {
          id: accountId
        }
      }
    };
    
    // Dodaj skonfigurowane pola z formularza
    if (config.fieldsConfig && config.fieldsConfig.configuredFields) {
      const configuredFields = config.fieldsConfig.configuredFields.filter(f => f.enabled);
      
      // Priorytet NIE jest ustawiany tutaj - będzie ustawiony automatycznie przez reguły priorytetyzacji
      // w funkcji updateIssueWithResults po wyliczeniu P1-P4
      // Pole priorytetu jest ukryte w formularzu użytkownika
      if (false) { // Wyłączone - priorytet ustawiany przez reguły
        // Dla standardowego pola priority musimy znaleźć dokładną nazwę w allowedValues
        let priorityName = formData.priority;
        let allowedValues = [];
        
        try {
          const priorityMetaResponse = await api.asUser().requestJira(
            route`/rest/api/3/issue/createmeta?projectKeys=${config.projectKey}&issuetypeIds=${config.incidentIssueTypeId}&expand=projects.issuetypes.fields`,
            {
              headers: {
                'Accept': 'application/json'
              }
            }
          );
          
          if (priorityMetaResponse.ok) {
            const metadata = await priorityMetaResponse.json();
            const projects = metadata.projects || [];
            if (projects.length > 0) {
              const issueType = projects[0].issuetypes.find(it => it.id === config.incidentIssueTypeId);
              if (issueType && issueType.fields && issueType.fields.priority) {
                const priorityField = issueType.fields.priority;
                allowedValues = priorityField.allowedValues || [];
                console.log(`Priority allowedValues fetched from API (standard field):`, allowedValues.map(av => av.name || av.value));
              }
            }
          }
        } catch (error) {
          console.warn('Failed to fetch priority metadata, using formData.priority as-is:', error);
        }
        
        // Mapowanie nazw priorytetów (Highest -> Critical/Krytyczny, itp.)
        // Obsługuje zarówno angielskie jak i polskie nazwy
        const priorityMapping = {
          'Highest': ['Critical', 'Highest', 'Blocker', 'Krytyczny', 'Najwyższy'],
          'High': ['High', 'Major', 'Wysoki'],
          'Medium': ['Medium', 'Normal', 'Średni'],
          'Low': ['Low', 'Minor', 'Niski'],
          'Lowest': ['Lowest', 'Trivial', 'Najniższy']
        };
        
        const searchTerms = priorityMapping[formData.priority] || [formData.priority];
        console.log(`Priority mapping (standard field) - searching for: "${formData.priority}" with terms:`, searchTerms);
        console.log(`Priority allowedValues available:`, allowedValues.map(av => ({ id: av.id, name: av.name, value: av.value })));
        
        let matchedOption = null;
        if (allowedValues.length > 0) {
          matchedOption = allowedValues.find(av => {
            const avName = (av.name || av.value || '').toString();
            const avId = String(av.id || '');
            const searchValue = String(formData.priority);
            
            // Sprawdź dokładne dopasowanie
            if (avName === searchValue || avId === searchValue || av.value === searchValue) {
              console.log(`Priority exact match found (standard field): "${avName}" (id: ${av.id})`);
              return true;
            }
            
            // Sprawdź mapowanie (np. Highest -> Critical/Krytyczny)
            const mappingMatch = searchTerms.some(term => {
              const termLower = term.toLowerCase();
              const avNameLower = avName.toLowerCase();
              const match = avNameLower === termLower || avId === term;
              if (match) {
                console.log(`Priority mapping match found (standard field): "${term}" -> "${avName}" (id: ${av.id})`);
              }
              return match;
            });
            
            if (mappingMatch) {
              return true;
            }
            
            // Sprawdź case-insensitive
            if (avName.toLowerCase() === searchValue.toLowerCase()) {
              console.log(`Priority case-insensitive match found (standard field): "${avName}" (id: ${av.id})`);
              return true;
            }
            
            return false;
          });
          
          if (matchedOption) {
            // Użyj id jeśli jest dostępne, w przeciwnym razie name
            if (matchedOption.id) {
              priorityName = String(matchedOption.id);
              console.log(`✓ Priority mapped during creation (standard field): "${formData.priority}" -> id: "${priorityName}"`);
            } else {
              priorityName = matchedOption.name || matchedOption.value || priorityName;
              console.log(`✓ Priority mapped during creation (standard field): "${formData.priority}" -> name: "${priorityName}"`);
            }
          } else {
            console.error(`✗ Priority "${formData.priority}" not found in allowedValues (standard field)! Available values:`, allowedValues.map(av => ({ id: av.id, name: av.name, value: av.value })));
            // Jeśli nie znaleziono, spróbuj użyć pierwszego z searchTerms, który istnieje w allowedValues
            for (const term of searchTerms) {
              const fallbackOption = allowedValues.find(av => {
                const avName = (av.name || av.value || '').toString();
                return avName.toLowerCase() === term.toLowerCase();
              });
              if (fallbackOption) {
                if (fallbackOption.id) {
                  priorityName = String(fallbackOption.id);
                  console.log(`✓ Priority fallback mapped (standard field): "${formData.priority}" -> id: "${priorityName}"`);
                } else {
                  priorityName = fallbackOption.name || fallbackOption.value || priorityName;
                  console.log(`✓ Priority fallback mapped (standard field): "${formData.priority}" -> name: "${priorityName}"`);
                }
                matchedOption = fallbackOption;
                break;
              }
            }
          }
        } else {
          console.error(`✗ Priority allowedValues are empty (standard field)! Cannot map "${formData.priority}"`);
        }
        
        // Dla standardowego pola priority używamy id jeśli dostępne, w przeciwnym razie name
        if (matchedOption && matchedOption.id) {
          issuePayload.fields.priority = {
            id: priorityName
          };
          console.log(`Priority final value set (standard field) - using ID: "${priorityName}"`);
        } else {
          issuePayload.fields.priority = {
            name: priorityName
          };
          console.log(`Priority final value set (standard field) - using name: "${priorityName}"`);
        }
      }
      
      // Pobierz metadane pól, aby wiedzieć dokładny typ każdego pola
      let fieldsMetadata = {};
      try {
        const fieldsMetaResponse = await api.asUser().requestJira(
          route`/rest/api/3/issue/createmeta?projectKeys=${config.projectKey}&issuetypeIds=${config.incidentIssueTypeId}&expand=projects.issuetypes.fields`,
          {
            headers: {
              'Accept': 'application/json'
            }
          }
        );
        
        if (fieldsMetaResponse.ok) {
          const metadata = await fieldsMetaResponse.json();
          if (metadata.projects && metadata.projects.length > 0) {
            const project = metadata.projects[0];
            if (project.issuetypes && project.issuetypes.length > 0) {
              const issueType = project.issuetypes.find(it => it.id === config.incidentIssueTypeId);
              if (issueType && issueType.fields) {
                fieldsMetadata = issueType.fields;
              }
            }
          }
        }
      } catch (metaError) {
        console.warn('Nie udało się pobrać metadanych pól:', metaError);
      }
      
      for (const field of configuredFields) {
        const fieldValue = formData[field.id];
        
        // Pomiń priority jeśli już zostało ustawione jako standardowe pole
        if (field.id === 'priority' && issuePayload.fields.priority) {
          continue;
        }
        
        // Dodaj pole tylko jeśli ma wartość
        if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
          const fieldMeta = fieldsMetadata[field.id];
          const schemaType = fieldMeta?.schema?.type || field.type;
          const schemaSystem = fieldMeta?.schema?.system || '';
          
          // Sprawdź czy pole wymaga tablicy (multi-select) - sprawdź zarówno schema.type jak i czy to array
          const isArrayField = schemaType === 'array';
          
          // Obsługa różnych typów pól na podstawie schema
          if (isArrayField) {
            // Pole typu array - ZAWSZE wymaga tablicy, nawet jeśli wybrano jedną wartość
            const values = Array.isArray(fieldValue) ? fieldValue : (fieldValue !== null && fieldValue !== '' ? [fieldValue] : []);
            
            if (schemaSystem === 'option' || schemaSystem === '') {
              // Tablica opcji (multi-select)
              const allowedValues = fieldMeta?.allowedValues || field.allowedValues || [];
              issuePayload.fields[field.id] = values.map(val => {
                if (typeof val === 'object' && val.id) {
                  return { id: String(val.id) };
                } else if (typeof val === 'object' && val.name) {
                  return { name: val.name };
                } else if (typeof val === 'object' && val.value) {
                  const option = allowedValues.find(av => av.value === val.value || av.id === val.value);
                  return option ? (option.id ? { id: String(option.id) } : { name: option.name || option.value }) : { name: val.value };
                } else {
                  const option = allowedValues.find(av => 
                    av.id === val || av.value === val || av.name === val || String(av.id) === String(val)
                  );
                  return option ? (option.id ? { id: String(option.id) } : { name: option.name || option.value }) : { name: String(val) };
                }
              });
            } else if (schemaSystem === 'version') {
              // Tablica wersji
              issuePayload.fields[field.id] = values.map(v => {
                if (typeof v === 'object' && v.id) {
                  return { id: String(v.id) };
                } else if (typeof v === 'object' && v.name) {
                  return { name: v.name };
                } else {
                  return { name: String(v) };
                }
              });
            } else if (schemaSystem === 'user') {
              // Tablica użytkowników
              issuePayload.fields[field.id] = values.map(u => {
                if (typeof u === 'object' && u.accountId) {
                  return { accountId: u.accountId };
                } else {
                  return { accountId: String(u) };
                }
              });
            } else {
              // Domyślnie dla array - tablica stringów
              issuePayload.fields[field.id] = values.map(v => String(v));
            }
          } else if (schemaType === 'option' || schemaSystem === 'option') {
            // Pole typu option (single-select) - wymaga obiektu z id lub name
            // UWAGA: Priority jest specjalnym przypadkiem - zawsze używamy obiektu z name
            if (field.id === 'priority') {
              // Dla priority zawsze pobierz allowedValues bezpośrednio z API
              let priorityName = String(fieldValue);
              let allowedValues = fieldMeta?.allowedValues || field.allowedValues || [];
              
              // Jeśli allowedValues są puste, pobierz je bezpośrednio z API
              if (allowedValues.length === 0) {
                try {
                  const priorityMetaResponse = await api.asUser().requestJira(
                    route`/rest/api/3/issue/createmeta?projectKeys=${config.projectKey}&issuetypeIds=${config.incidentIssueTypeId}&expand=projects.issuetypes.fields`,
                    {
                      headers: {
                        'Accept': 'application/json'
                      }
                    }
                  );
                  
                  if (priorityMetaResponse.ok) {
                    const metadata = await priorityMetaResponse.json();
                    const projects = metadata.projects || [];
                    if (projects.length > 0) {
                      const issueType = projects[0].issuetypes.find(it => it.id === config.incidentIssueTypeId);
                      if (issueType && issueType.fields && issueType.fields.priority) {
                        allowedValues = issueType.fields.priority.allowedValues || [];
                        console.log(`Priority allowedValues fetched from API:`, allowedValues.map(av => av.name || av.value));
                      }
                    }
                  }
                } catch (error) {
                  console.warn('Failed to fetch priority allowedValues from API:', error);
                }
              }
              
              // Mapowanie nazw priorytetów (Highest -> Critical, itp.)
                const priorityMapping = {
                  'Highest': ['Critical', 'Highest', 'Blocker', 'Krytyczny', 'Najwyższy'],
                  'High': ['High', 'Major', 'Wysoki'],
                  'Medium': ['Medium', 'Normal', 'Średni'],
                  'Low': ['Low', 'Minor', 'Niski'],
                  'Lowest': ['Lowest', 'Trivial', 'Najniższy']
                };
                
              const searchTerms = priorityMapping[fieldValue] || [fieldValue];
              console.log(`Priority mapping - searching for: "${fieldValue}" with terms:`, searchTerms);
              console.log(`Priority allowedValues available:`, allowedValues.map(av => ({ id: av.id, name: av.name, value: av.value })));
              
              let matchedOption = null;
              // Spróbuj znaleźć dokładną nazwę priorytetu w allowedValues
              if (allowedValues.length > 0) {
                matchedOption = allowedValues.find(av => {
                  const avName = (av.name || av.value || '').toString();
                  const avId = String(av.id || '');
                  const searchValue = String(fieldValue);
                  
                  // Sprawdź dokładne dopasowanie
                  if (avName === searchValue || avId === searchValue || av.value === searchValue) {
                    console.log(`Priority exact match found: "${avName}" (id: ${av.id})`);
                    return true;
                  }
                  
                  // Sprawdź mapowanie (np. Highest -> Critical/Krytyczny)
                  const mappingMatch = searchTerms.some(term => {
                    const termLower = term.toLowerCase();
                    const avNameLower = avName.toLowerCase();
                    const match = avNameLower === termLower || avId === term;
                    if (match) {
                      console.log(`Priority mapping match found: "${term}" -> "${avName}" (id: ${av.id})`);
                    }
                    return match;
                  });
                  
                  if (mappingMatch) {
                    return true;
                  }
                  
                  // Sprawdź case-insensitive
                  if (avName.toLowerCase() === searchValue.toLowerCase()) {
                    console.log(`Priority case-insensitive match found: "${avName}" (id: ${av.id})`);
                    return true;
                  }
                  
                  return false;
                });
                
                if (matchedOption) {
                  // Użyj id jeśli jest dostępne, w przeciwnym razie name
                  if (matchedOption.id) {
                    priorityName = String(matchedOption.id);
                    console.log(`✓ Priority mapped: "${fieldValue}" -> id: "${priorityName}"`);
                  } else {
                    priorityName = matchedOption.name || matchedOption.value || priorityName;
                    console.log(`✓ Priority mapped: "${fieldValue}" -> name: "${priorityName}"`);
                  }
                } else {
                  console.error(`✗ Priority "${fieldValue}" not found in allowedValues! Available values:`, allowedValues.map(av => ({ id: av.id, name: av.name, value: av.value })));
                  // Jeśli nie znaleziono, spróbuj użyć pierwszego z searchTerms, który istnieje w allowedValues
                  for (const term of searchTerms) {
                    const fallbackOption = allowedValues.find(av => {
                      const avName = (av.name || av.value || '').toString();
                      return avName.toLowerCase() === term.toLowerCase();
                    });
                    if (fallbackOption) {
                      if (fallbackOption.id) {
                        priorityName = String(fallbackOption.id);
                        console.log(`✓ Priority fallback mapped: "${fieldValue}" -> id: "${priorityName}"`);
                      } else {
                        priorityName = fallbackOption.name || fallbackOption.value || priorityName;
                        console.log(`✓ Priority fallback mapped: "${fieldValue}" -> name: "${priorityName}"`);
                      }
                      matchedOption = fallbackOption;
                      break;
                    }
                  }
                }
              } else {
                console.error(`✗ Priority allowedValues are empty! Cannot map "${fieldValue}"`);
              }
              
              // Dla priority używamy id jeśli dostępne, w przeciwnym razie name
              if (matchedOption && matchedOption.id) {
                issuePayload.fields[field.id] = {
                  id: priorityName
                };
                console.log(`Priority final value set - using ID: "${priorityName}"`);
              } else {
                issuePayload.fields[field.id] = {
                  name: priorityName
                };
                console.log(`Priority final value set - using name: "${priorityName}"`);
              }
            } else if (typeof fieldValue === 'string') {
              // Znajdź opcję w allowedValues
              const allowedValues = fieldMeta?.allowedValues || field.allowedValues || [];
              const option = allowedValues.find(av => 
                av.id === fieldValue || 
                av.value === fieldValue || 
                av.name === fieldValue ||
                String(av.id) === String(fieldValue)
              );
              
              if (option) {
                // Użyj obiektu z id lub name
                issuePayload.fields[field.id] = option.id ? { id: String(option.id) } : { name: option.name || option.value };
              } else {
                // Fallback - spróbuj użyć wartości jako name
                issuePayload.fields[field.id] = { name: fieldValue };
              }
            } else if (typeof fieldValue === 'object' && fieldValue.id) {
              issuePayload.fields[field.id] = { id: String(fieldValue.id) };
            } else if (typeof fieldValue === 'object' && fieldValue.name) {
              issuePayload.fields[field.id] = { name: fieldValue.name };
            } else if (typeof fieldValue === 'object' && fieldValue.value) {
              // Spróbuj znaleźć opcję po value
              const allowedValues = fieldMeta?.allowedValues || field.allowedValues || [];
              const option = allowedValues.find(av => av.value === fieldValue.value || av.id === fieldValue.value);
              if (option) {
                issuePayload.fields[field.id] = option.id ? { id: String(option.id) } : { name: option.name || option.value };
              } else {
                issuePayload.fields[field.id] = { name: fieldValue.value };
              }
            }
          } else if (schemaType === 'version' || schemaSystem === 'version') {
            // Pole wersji - wymaga tablicy obiektów z id lub name
            const versions = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
            issuePayload.fields[field.id] = versions.map(v => {
              if (typeof v === 'object' && v.id) {
                return { id: String(v.id) };
              } else if (typeof v === 'object' && v.name) {
                return { name: v.name };
              } else {
                return { name: String(v) };
              }
            });
          } else if (schemaType === 'number') {
            issuePayload.fields[field.id] = parseFloat(fieldValue) || 0;
          } else if (schemaType === 'date') {
            issuePayload.fields[field.id] = fieldValue;
          } else if (schemaType === 'user' || schemaSystem === 'user') {
            // Dla pól użytkownika (single)
            if (typeof fieldValue === 'object' && fieldValue.accountId) {
              issuePayload.fields[field.id] = { accountId: fieldValue.accountId };
            } else if (typeof fieldValue === 'string') {
              issuePayload.fields[field.id] = { accountId: fieldValue };
            }
          } else {
            // Domyślnie string
            issuePayload.fields[field.id] = String(fieldValue);
          }
        }
      }
    }
    
    console.log('Final issue payload:', JSON.stringify(issuePayload, null, 2));
    
    // Create issue
    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(issuePayload)
    });
    
    if (!response.ok) {
      let errorDetails = 'Nieznany błąd';
      try {
        const errorData = await response.json();
        console.error('Failed to create issue:', JSON.stringify(errorData));
        
        // Wyciągnij szczegóły błędu z odpowiedzi Jira
        if (errorData.errors) {
          const errorMessages = Object.entries(errorData.errors)
            .map(([field, message]) => `${field}: ${message}`)
            .join(', ');
          errorDetails = errorMessages;
        } else if (errorData.errorMessages && Array.isArray(errorData.errorMessages)) {
          errorDetails = errorData.errorMessages.join(', ');
        } else if (errorData.message) {
          errorDetails = errorData.message;
        }
      } catch (parseError) {
        const errorText = await response.text();
        console.error('Failed to create issue (text):', errorText);
        errorDetails = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
      }
      
      return {
        success: false,
        error: `Nie udało się utworzyć zgłoszenia: ${errorDetails}`
      };
    }
    
    const result = await response.json();
    
    // Log audit entry
    await logAuditEntry({
      eventType: 'incident_created',
      issueKey: result.key,
      userId: accountId,
      details: {
        system: formData.system,
        environment: formData.environment
      }
    });
    
    // Automatyczne przetwarzanie alertu (kalkulacja priorytetu, przypisanie zespołu)
    if (config.enableAutoProcessing !== false) {
      try {
        console.log('Uruchamiam automatyczne przetwarzanie dla:', result.key);
        // Przekaż formData do processIncidentLogic
        await processIncidentLogic(result.key, accountId, formData);
      } catch (processingError) {
        console.error('Błąd podczas automatycznego przetwarzania:', processingError);
        // Nie zwracamy błędu - alert został utworzony pomyślnie
      }
    }
    
    return {
      success: true,
      issueKey: result.key,
      issueId: result.id,
      message: 'Alert utworzony pomyślnie'
    };
    
  } catch (error) {
    console.error('Error in createIncident:', error);
    return {
      success: false,
      error: 'An unexpected error occurred. Please contact support.'
    };
  }
});

resolver.define('processIncident', async ({ payload, context }) => {
  try {
    const { issueKey } = payload;
    await processIncidentLogic(issueKey, context.accountId);
    
    return {
      success: true,
      message: 'Incident processed successfully'
    };
  } catch (error) {
    console.error('Error in processIncident:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

async function processIncidentLogic(issueKey, userId, formData = null) {
  // 1. Get issue data
  const issueResponse = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}`,
    {
      headers: {
        'Accept': 'application/json'
      }
    }
  );
  
  if (!issueResponse.ok) {
    throw new Error('Failed to fetch issue data');
  }
  
  const issue = await issueResponse.json();
  
  // Pobierz project-specific config
  const projectKey = issue.fields.project.key;
  console.log('Project key:', projectKey);
  
  const projectConfigKey = `project_config_${projectKey}`;
  const projectConfig = await storage.get(projectConfigKey);
  const fieldsConfig = projectConfig?.fieldsConfig || {};
  
  console.log('Fields config:', JSON.stringify(fieldsConfig));
  
  // Extract alert data - użyj formData jeśli jest dostępne, w przeciwnym razie wyciągnij z custom fields
  let alertData;
  if (formData) {
    console.log('Używam danych z formularza:', JSON.stringify(formData));
    // Użyj wszystkich danych z formularza (bez priority - jest ukryte i będzie ustawiane przez reguły)
    alertData = {
      summary: formData.summary,
      description: formData.description,
      system: formData.system,
      environment: formData.environment,
      impact: formData.impact,
      urgency: formData.urgency
    };
    
    // Dodaj również wszystkie skonfigurowane pola z formularza
    if (fieldsConfig && fieldsConfig.configuredFields) {
      const configuredFields = fieldsConfig.configuredFields.filter(f => f.enabled);
      for (const field of configuredFields) {
        if (formData[field.id] !== undefined && formData[field.id] !== null && formData[field.id] !== '') {
          // Obsługa różnych typów pól
          if (field.type === 'option' && typeof formData[field.id] === 'object' && formData[field.id].name) {
            alertData[field.id] = formData[field.id].name;
          } else if (Array.isArray(formData[field.id])) {
            alertData[field.id] = formData[field.id].map(v => v.name || v.value || v);
          } else {
            alertData[field.id] = formData[field.id];
          }
        }
      }
    }
  } else {
    console.log('Wyciągam dane z custom fields');
    alertData = extractAlertData(issue, fieldsConfig);
  }
  
  console.log('Alert data dla reguł:', JSON.stringify(alertData));
  
  // 2. Calculate Priority using Rule Engine
  const priorityResult = await calculatePriority(alertData, projectKey);
  console.log('Wynik kalkulacji priorytetu:', JSON.stringify(priorityResult));
  
  // 3. Assign Team using Escalation Engine
  const assignmentResult = await assignTeam(alertData, priorityResult.priority, projectKey);
  
  // 4. Update Issue with priority, assignee, watchers
  await updateIssueWithResults(issueKey, priorityResult, assignmentResult, fieldsConfig, projectKey);
  
  // 4b. Zapisz priorytet w storage jako backup (dla SLA check)
  const issuePriorityKey = `issue_priority_${issueKey}`;
  await storage.set(issuePriorityKey, priorityResult.priority);
  console.log(`Zapisano priorytet ${priorityResult.priority} dla ${issueKey} w storage`);
  
  // 5. Log audit entry
  await logAuditEntry({
    eventType: 'priority_calculated',
    issueKey: issueKey,
    userId: userId || 'system',
    details: {
      appliedRuleId: priorityResult.ruleId,
      appliedRuleName: priorityResult.ruleName,
      calculatedPriority: priorityResult.priority,
      assignedTeamId: assignmentResult.teamId,
      assignedTeamName: assignmentResult.teamName,
      assignedTo: assignmentResult.assignee
    }
  });
  
  // 6. Send Teams notification
  console.log('Sprawdzam powiadomienie Teams...');
  console.log('Team:', assignmentResult.team?.name);
  console.log('Webhook URL:', assignmentResult.team?.teamsWebhookUrl ? 'CONFIGURED' : 'NOT CONFIGURED');
  
  if (assignmentResult.team && assignmentResult.team.teamsWebhookUrl) {
    console.log('Wysyłam powiadomienie na Teams...');
    const teamsResult = await notifyTeams(
      issueKey,
      issue,
      priorityResult.priority,
      assignmentResult.team,
      assignmentResult.assignee,
      projectKey
    );
    console.log('Wynik powiadomienia Teams:', JSON.stringify(teamsResult));
    
    await logAuditEntry({
      eventType: 'teams_notification_sent',
      issueKey: issueKey,
      userId: 'system',
      details: {
        teamsWebhookStatus: teamsResult.success ? 'success' : 'failed',
        teamsWebhookError: teamsResult.error
      }
    });
  }
}

// ============================================================================
// RULE ENGINE - Calculate Priority
// ============================================================================
async function calculatePriority(alertData, projectKey = null) {
  let rules = [];
  
  // Najpierw spróbuj pobrać z konfiguracji projektu
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig && projectConfig.priorityRules) {
      rules = Array.isArray(projectConfig.priorityRules) ? projectConfig.priorityRules : [];
      console.log('calculatePriority - używam reguł z konfiguracji projektu:', projectKey);
    }
  }
  
  // Fallback do globalnych reguł
  if (rules.length === 0) {
    const rulesJson = await storage.get('priority_rules') || '[]';
    rules = JSON.parse(rulesJson);
    console.log('calculatePriority - używam globalnych reguł');
  }
  
  console.log('calculatePriority - liczba reguł:', rules.length);
  console.log('calculatePriority - alert data:', JSON.stringify(alertData));
  
  // Pobierz defaultPriority z konfiguracji projektu lub globalnej
  let defaultPriority = 'P3';
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig && projectConfig.defaultPriority) {
      defaultPriority = projectConfig.defaultPriority;
    }
  } else {
    const config = await storage.get('global_config') || {};
    defaultPriority = config.defaultPriority || 'P3';
  }
  
  // Sort by order and filter enabled rules
  const sortedRules = rules
    .filter(r => r.enabled)
    .sort((a, b) => a.order - b.order);
  
  console.log('calculatePriority - aktywne reguły:', sortedRules.length);
  
  // First match wins
  for (const rule of sortedRules) {
    console.log('Sprawdzam regułę:', rule.name, 'warunki:', JSON.stringify(rule.conditions));
    const matches = evaluateConditions(rule.conditions, alertData);
    console.log('Reguła', rule.name, 'pasuje:', matches);
    
    if (matches) {
      console.log('✓ Znaleziono pasującą regułę:', rule.name, '- priorytet:', rule.actions.setPriority);
      
      // Pobierz obserwatorów z reguły (jeśli są zdefiniowani)
      // addWatchers jest teraz tablicą accountId, nie stringiem z emailami
      let watchers = [];
      if (rule.actions.addWatchers) {
        if (Array.isArray(rule.actions.addWatchers)) {
          // Jeśli to tablica accountId - filtruj tylko prawidłowe accountId
          watchers = rule.actions.addWatchers.filter(w => {
            if (!w || typeof w !== 'string') return false;
            // Sprawdź czy to accountId (zawiera ":" lub ma więcej niż 20 znaków) czy email
            const isAccountId = w.includes(':') || w.length > 20;
            if (!isAccountId) {
              console.warn(`⚠ Pomijam "${w}" z reguły - to nie jest accountId. Zaktualizuj regułę w interfejsie.`);
              return false;
            }
            return true;
          });
          console.log('Obserwatorzy z reguły priorytetyzacji (tablica accountId):', watchers);
        } else if (typeof rule.actions.addWatchers === 'string' && rule.actions.addWatchers.trim()) {
          // Fallback dla starych danych (string z emailami) - ignorujemy
          console.warn('Stare dane w addWatchers (string z emailami) - ignoruję. Zaktualizuj regułę w interfejsie.');
          watchers = [];
        }
      }
      
      return {
        priority: rule.actions.setPriority,
        ruleId: rule.id,
        ruleName: rule.name,
        watchers: watchers
      };
    }
  }
  
  console.log('Żadna reguła nie pasuje - używam domyślnego priorytetu:', defaultPriority);
  // Fallback to default
  return {
    priority: defaultPriority,
    ruleId: null,
    ruleName: 'Default Priority',
    watchers: []
  };
}

function evaluateConditions(conditions, data) {
  // Obsługa zarówno starej (conditions.rules) jak i nowej struktury (bezpośrednio array)
  const conditionsArray = Array.isArray(conditions) ? conditions : (conditions?.rules || []);
  
  if (!conditionsArray || conditionsArray.length === 0) {
    return false;
  }
  
  // ALL conditions must match (AND logic)
  const results = conditionsArray.map(condition => {
    const fieldValue = data[condition.field];
    const conditionValue = condition.value;
    
    console.log(`  Warunek: ${condition.field} ${condition.operator} "${conditionValue}"`);
    console.log(`  Wartość w danych: ${fieldValue} (typ: ${typeof fieldValue})`);
    
    // Jeśli wartość pola jest null/undefined, warunek nie może być spełniony (chyba że operator to notEquals)
    if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
      if (condition.operator === 'notEquals' || condition.operator === 'notContains' || condition.operator === 'notIn') {
        console.log(`  ✓ Warunek spełniony (wartość pusta dla operatora ${condition.operator})`);
        return true;
      }
      console.log(`  ✗ Warunek nie spełniony (wartość pusta)`);
      return false;
    }
    
    switch (condition.operator) {
      case 'equals':
        // Dla pola priority, obsłuż mapowanie wartości
        let normalizedFieldValue = String(fieldValue);
        let normalizedConditionValue = String(conditionValue);
        
        if (condition.field === 'priority') {
          // Mapowanie wartości priorytetów (np. "Highest" <-> "Critical"/"Krytyczny")
          // Obsługuje zarówno angielskie jak i polskie nazwy
          const priorityMapping = {
            'Highest': ['Critical', 'Highest', 'Blocker', 'Krytyczny', 'Najwyższy'],
            'High': ['High', 'Major', 'Wysoki'],
            'Medium': ['Medium', 'Normal', 'Średni'],
            'Low': ['Low', 'Minor', 'Niski'],
            'Lowest': ['Lowest', 'Trivial', 'Najniższy']
          };
          
          // Sprawdź czy fieldValue jest w mapowaniu
          for (const [formValue, jiraValues] of Object.entries(priorityMapping)) {
            if (jiraValues.some(jv => jv.toLowerCase() === normalizedFieldValue.toLowerCase())) {
              normalizedFieldValue = formValue;
              break;
            }
          }
          
          // Sprawdź czy conditionValue jest w mapowaniu
          for (const [formValue, jiraValues] of Object.entries(priorityMapping)) {
            if (jiraValues.some(jv => jv.toLowerCase() === normalizedConditionValue.toLowerCase())) {
              normalizedConditionValue = formValue;
              break;
            }
          }
        }
        
        const equalsMatch = normalizedFieldValue === normalizedConditionValue || 
                           normalizedFieldValue.toLowerCase() === normalizedConditionValue.toLowerCase();
        console.log(`  ${equalsMatch ? '✓' : '✗'} equals: "${fieldValue}" (normalized: "${normalizedFieldValue}") === "${conditionValue}" (normalized: "${normalizedConditionValue}")`);
        return equalsMatch;
        
      case 'notEquals':
        const notEqualsMatch = String(fieldValue) !== String(conditionValue) && 
                               String(fieldValue).toLowerCase() !== String(conditionValue).toLowerCase();
        console.log(`  ${notEqualsMatch ? '✓' : '✗'} notEquals: "${fieldValue}" !== "${conditionValue}"`);
        return notEqualsMatch;
        
      case 'contains':
        const containsMatch = fieldValue && String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
        console.log(`  ${containsMatch ? '✓' : '✗'} contains: "${fieldValue}" contains "${conditionValue}"`);
        return containsMatch;
        
      case 'notContains':
        const notContainsMatch = !fieldValue || !String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
        console.log(`  ${notContainsMatch ? '✓' : '✗'} notContains: "${fieldValue}" not contains "${conditionValue}"`);
        return notContainsMatch;
        
      case 'in':
        const inValues = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(v => v.trim());
        const inMatch = inValues.some(v => 
          String(fieldValue) === String(v) || 
          String(fieldValue).toLowerCase() === String(v).toLowerCase()
        );
        console.log(`  ${inMatch ? '✓' : '✗'} in: "${fieldValue}" in [${inValues.join(', ')}]`);
        return inMatch;
        
      case 'notIn':
        const notInValues = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(v => v.trim());
        const notInMatch = !notInValues.some(v => 
          String(fieldValue) === String(v) || 
          String(fieldValue).toLowerCase() === String(v).toLowerCase()
        );
        console.log(`  ${notInMatch ? '✓' : '✗'} notIn: "${fieldValue}" not in [${notInValues.join(', ')}]`);
        return notInMatch;
        
      default:
        console.log(`  ✗ Nieznany operator: ${condition.operator}`);
        return false;
    }
  });
  
  // ALL conditions must be true (AND logic)
  return results.every(r => r === true);
}

// ============================================================================
// ESCALATION ENGINE - Assign Team
// ============================================================================
async function assignTeam(alertData, priority, projectKey = null) {
  console.log('assignTeam wywołane z priority:', priority, 'projectKey:', projectKey);
  
  let teams = [];
  let schedule = [];
  
  // Najpierw spróbuj pobrać z konfiguracji projektu
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig) {
      if (projectConfig.escalationTeams) {
        teams = Array.isArray(projectConfig.escalationTeams) ? projectConfig.escalationTeams : [];
        console.log('assignTeam - używam zespołów z konfiguracji projektu:', projectKey);
      }
      if (projectConfig.teamSchedule) {
        schedule = Array.isArray(projectConfig.teamSchedule) ? projectConfig.teamSchedule : [];
        console.log('assignTeam - używam harmonogramu z konfiguracji projektu:', projectKey);
      }
    }
  }
  
  // Fallback do globalnych danych
  if (teams.length === 0) {
    const teamsJson = await storage.get('escalation_teams') || '[]';
    teams = JSON.parse(teamsJson);
    console.log('assignTeam - używam globalnych zespołów');
  }
  
  if (schedule.length === 0) {
    const scheduleJson = await storage.get('team_schedule') || '[]';
    schedule = JSON.parse(scheduleJson);
    console.log('assignTeam - używam globalnego harmonogramu');
  }
  
  console.log('Liczba zespołów:', teams.length);
  console.log('Liczba wpisów w harmonogramie:', schedule.length);
  
  console.log('Liczba wpisów w harmonogramie:', schedule.length);
  
  if (schedule.length > 0) {
    const today = new Date();
    const currentWeek = schedule.find(week => {
      if (!week.startDate || !week.endDate) return false;
      const start = new Date(week.startDate);
      const end = new Date(week.endDate);
      return today >= start && today <= end;
    });
    
    if (currentWeek && currentWeek.teamId) {
      const team = teams.find(t => t.id === currentWeek.teamId);
      if (team) {
        console.log('✓ Znaleziono zespół z harmonogramu:', team.name);
        console.log('Webhook URL zespołu:', team.teamsWebhookUrl ? 'SKONFIGUROWANY' : 'BRAK');
        
        // Sprawdź czy jest przypisana osoba w harmonogramie
        const assignedPerson = currentWeek.assignedPerson || null;
        if (assignedPerson) {
          console.log('✓ Znaleziono osobę przypisaną w harmonogramie:', assignedPerson);
        } else {
          console.log('Brak przypisanej osoby w harmonogramie dla tego tygodnia');
        }
        
        return {
          teamId: team.id,
          teamName: team.name,
          team: team,
          assignee: assignedPerson, // Użyj assignedPerson z harmonogramu
          watchers: team.members ? team.members.split(',').map(e => e.trim()) : []
        };
      }
    } else {
      console.log('Brak aktywnego tygodnia w harmonogramie dla dzisiejszej daty');
    }
  } else {
    console.log('Harmonogram jest pusty');
  }
  
  console.log('Nie znaleziono zespołu - brak harmonogramu lub brak aktywnego tygodnia');
  // No team found
  return {
    teamId: null,
    teamName: null,
    team: null,
    assignee: null,
    watchers: []
  };
}

function evaluateEscalationConditions(conditions, data) {
  if (!conditions) return true;
  
  // Sprawdź environment
  if (conditions.environments && conditions.environments.length > 0) {
    if (!conditions.environments.includes(data.environment)) {
      return false;
    }
  }
  
  // Inne warunki mogą być dodane tutaj
  
  return true;
}

async function determineAssignee(team) {
  if (team.assignmentStrategy === 'fixed' && team.defaultAssignee) {
    return team.defaultAssignee;
  }
  
  if (team.assignmentStrategy === 'roundRobin' && team.roundRobinMembers && team.roundRobinMembers.length > 0) {
    // Get current round-robin state
    const stateKey = `rr-${team.id}`;
    const state = await storage.get(stateKey) || { lastAssignedIndex: -1 };
    
    // Calculate next index
    const nextIndex = (state.lastAssignedIndex + 1) % team.roundRobinMembers.length;
    const assignee = team.roundRobinMembers[nextIndex];
    
    // Update state
    await storage.set(stateKey, {
      teamId: team.id,
      lastAssignedIndex: nextIndex,
      lastAssignedAt: new Date().toISOString()
    });
    
    return assignee;
  }
  
  // No assignment
  return null;
}

// ============================================================================
// UPDATE ISSUE
// ============================================================================
async function updateIssueWithResults(issueKey, priorityResult, assignmentResult, fieldsConfig, projectKey) {
  const updatePayload = {
    fields: {}
  };
  
  console.log(`updateIssueWithResults dla ${issueKey}:`);
  console.log(`  - Priority: ${priorityResult.priority}`);
  console.log(`  - Team: ${assignmentResult.teamName}`);
  console.log(`  - fieldsConfig.customFieldMappings:`, JSON.stringify(fieldsConfig?.customFieldMappings));
  
  // Mapowanie P1-P4 na priorytety Jira (standardowe pole priority)
  // P1 -> Highest/Krytyczny
  // P2 -> High/Wysoki
  // P3 -> Medium/Średni
  // P4 -> Low/Niski
  const priorityMapping = {
    'P1': ['Critical', 'Highest', 'Blocker', 'Krytyczny', 'Najwyższy'],
    'P2': ['High', 'Major', 'Wysoki'],
    'P3': ['Medium', 'Normal', 'Średni'],
    'P4': ['Low', 'Minor', 'Niski']
  };
  
  const calculatedPriority = priorityResult.priority; // P1, P2, P3, P4
  const searchTerms = priorityMapping[calculatedPriority] || [];
  
  if (searchTerms.length > 0 && projectKey) {
    try {
      // Pobierz konfigurację projektu, aby uzyskać incidentIssueTypeId
      const projectConfig = await storage.get(`project_config_${projectKey}`);
      if (projectConfig && projectConfig.incidentIssueTypeId) {
        // Pobierz allowedValues dla priorytetu z Jira API
        const priorityMetaResponse = await api.asApp().requestJira(
          route`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${projectConfig.incidentIssueTypeId}&expand=projects.issuetypes.fields`,
          {
            headers: {
              'Accept': 'application/json'
            }
          }
        );
        
        if (priorityMetaResponse.ok) {
          const metadata = await priorityMetaResponse.json();
          const projects = metadata.projects || [];
          if (projects.length > 0) {
            const issueType = projects[0].issuetypes.find(it => it.id === projectConfig.incidentIssueTypeId);
            if (issueType && issueType.fields && issueType.fields.priority) {
              const allowedValues = issueType.fields.priority.allowedValues || [];
              console.log(`Priority allowedValues dla mapowania P1-P4:`, allowedValues.map(av => ({ id: av.id, name: av.name })));
              
              // Znajdź dopasowanie w allowedValues
              let matchedPriority = null;
              for (const term of searchTerms) {
                matchedPriority = allowedValues.find(av => {
                  const avName = (av.name || av.value || '').toString();
                  return avName.toLowerCase() === term.toLowerCase();
                });
                if (matchedPriority) {
                  console.log(`✓ Znaleziono priorytet Jira dla ${calculatedPriority}: "${matchedPriority.name}" (id: ${matchedPriority.id})`);
                  break;
                }
              }
              
              if (matchedPriority) {
                // Ustaw standardowe pole priority w Jira
                if (matchedPriority.id) {
                  updatePayload.fields.priority = { id: String(matchedPriority.id) };
                  console.log(`  - Ustawiam standardowe pole priority = { id: "${matchedPriority.id}" }`);
                } else {
                  updatePayload.fields.priority = { name: matchedPriority.name || matchedPriority.value };
                  console.log(`  - Ustawiam standardowe pole priority = { name: "${matchedPriority.name || matchedPriority.value}" }`);
                }
              } else {
                console.warn(`⚠ Nie znaleziono dopasowania priorytetu dla ${calculatedPriority} w allowedValues. Dostępne wartości:`, allowedValues.map(av => av.name));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Błąd podczas mapowania priorytetu ${calculatedPriority} na priorytet Jira:`, error);
    }
  }
  
  // Set Priority custom field
  if (fieldsConfig && fieldsConfig.customFieldMappings && fieldsConfig.customFieldMappings.calculatedPriority) {
    updatePayload.fields[fieldsConfig.customFieldMappings.calculatedPriority] = priorityResult.priority;
    console.log(`  - Ustawiam ${fieldsConfig.customFieldMappings.calculatedPriority} = ${priorityResult.priority}`);
  } else {
    console.log(`  - BRAK mapowania dla calculatedPriority! Priorytet nie zostanie zapisany w custom field.`);
  }
  
  // Set Assigned Team custom field
  if (fieldsConfig && fieldsConfig.customFieldMappings && fieldsConfig.customFieldMappings.assignedTeam && assignmentResult.teamName) {
    updatePayload.fields[fieldsConfig.customFieldMappings.assignedTeam] = assignmentResult.teamName;
    console.log(`  - Ustawiam ${fieldsConfig.customFieldMappings.assignedTeam} = ${assignmentResult.teamName}`);
  } else {
    console.log(`  - BRAK mapowania dla assignedTeam! Zespół nie zostanie zapisany w custom field.`);
  }
  
  // Set assignee - użyj accountId zamiast id
  if (assignmentResult.assignee) {
    updatePayload.fields.assignee = {
      accountId: assignmentResult.assignee
    };
    console.log(`  - Przypisuję do użytkownika: ${assignmentResult.assignee}`);
  } else {
    console.log(`  - Brak przypisanej osoby (assignee jest null/undefined)`);
  }
  
  console.log(`  - Payload do aktualizacji:`, JSON.stringify(updatePayload));
  
  // Update issue
  const updateResponse = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}`,
    {
      method: 'PUT',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    }
  );
  
  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    console.error(`Failed to update issue ${issueKey}:`, errorText);
  } else {
    console.log(`✓ Issue ${issueKey} zaktualizowany pomyślnie`);
  }
  
  // Add watchers from priority rules (separate API call)
  // Priorytet: watchers z reguł priorytetyzacji (już jako accountId)
  let watchersToAdd = [];
  
  if (priorityResult.watchers && priorityResult.watchers.length > 0) {
    console.log('Dodaję obserwatorów z reguły priorytetyzacji:', priorityResult.watchers);
    // Watchers są już jako accountId (nie emaile)
    watchersToAdd = [...watchersToAdd, ...priorityResult.watchers];
  }
  
  // Dodaj również watchers z assignmentResult (dla kompatybilności wstecznej)
  if (assignmentResult.watchers && assignmentResult.watchers.length > 0) {
    watchersToAdd = [...watchersToAdd, ...assignmentResult.watchers];
  }
  
  // Dodaj unikalnych obserwatorów
  const uniqueWatchers = [...new Set(watchersToAdd)];
  
  if (uniqueWatchers.length > 0) {
    console.log('Dodaję obserwatorów do issue:', uniqueWatchers);
    for (const watcherAccountId of uniqueWatchers) {
      try {
        // Sprawdź czy to accountId (format: "557058:abc123def456") czy email
        const isAccountId = watcherAccountId.includes(':') || watcherAccountId.length > 20;
        
        if (!isAccountId) {
          console.warn(`⚠ Pomijam "${watcherAccountId}" - to nie jest accountId. Użyj interfejsu, aby wybrać użytkownika z listy.`);
          continue;
        }
        
        // Jira API dla watchers wymaga accountId jako stringa w body (nie obiektu!)
        // Format: "60dc75448a72bd006c70b095" (tylko string)
        const response = await api.asApp().requestJira(
          route`/rest/api/3/issue/${issueKey}/watchers`,
          {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(watcherAccountId) // Tylko string accountId, nie obiekt
          }
        );
        
        if (response.ok) {
          console.log(`✓ Dodano obserwatora (accountId): ${watcherAccountId}`);
        } else {
          const errorText = await response.text();
          console.error(`Błąd podczas dodawania obserwatora ${watcherAccountId}:`, errorText);
        }
      } catch (error) {
        console.error(`Błąd podczas dodawania obserwatora ${watcherAccountId}:`, error);
      }
    }
  }
  
  // Add comment with rule information
  const commentText = `✅ Alert automatically processed:\n• Priority: ${priorityResult.priority}\n• Rule: ${priorityResult.ruleName}\n• Team: ${assignmentResult.teamName || 'None'}`;
  
  await addCommentToIssue(issueKey, commentText);
}

// Helper function to add comment to Jira issue
async function addCommentToIssue(issueKey, text) {
  const comment = {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: text,
              marks: [{ type: 'strong' }]
            }
          ]
        }
      ]
    }
  };
  
  try {
    const response = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(comment)
      }
    );
    
    if (!response.ok) {
      console.error('Failed to add comment:', await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error adding comment:', error);
    return false;
  }
}

// ============================================================================
// MICROSOFT TEAMS INTEGRATION
// ============================================================================
async function notifyTeams(issueKey, issue, priority, team, assignee, projectKey = null) {
  if (!team.teamsWebhookUrl) {
    return { success: false, error: 'No webhook URL configured' };
  }
  
  // Pobierz jiraInstanceUrl z konfiguracji projektu lub globalnej
  let jiraInstanceUrl = null;
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig && projectConfig.jiraInstanceUrl) {
      jiraInstanceUrl = projectConfig.jiraInstanceUrl;
    }
  }
  
  if (!jiraInstanceUrl) {
    const globalConfig = await storage.get('global_config');
    jiraInstanceUrl = globalConfig?.jiraInstanceUrl;
  }
  
  const jiraBaseUrl = jiraInstanceUrl ? `https://${jiraInstanceUrl.replace(/^https?:\/\//, '')}` : 'https://your-instance.atlassian.net';
  
  // Color based on priority
  const colors = {
    'P1': 'd63031',
    'P2': 'fd79a8',
    'P3': 'fdcb6e',
    'P4': '74b9ff'
  };
  
  const emoji = priority === 'P1' ? '🚨' : priority === 'P2' ? '⚠️' : 'ℹ️';
  
  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: colors[priority] || '0078d4',
    summary: `[${priority}] Alert: ${issue.fields.summary}`,
    sections: [
      {
        activityTitle: `${emoji} [${priority}] ALERT`,
        activitySubtitle: issue.fields.summary,
        facts: [
          { name: 'Issue Key:', value: issueKey },
          { name: 'Priority:', value: priority },
          { name: 'Team:', value: team.name },
          { name: 'Assigned To:', value: assignee || 'Unassigned' },
          { name: 'Reporter:', value: issue.fields.reporter.displayName },
          { name: 'Created:', value: new Date(issue.fields.created).toLocaleString() }
        ],
        markdown: true
      }
    ],
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: 'View in Jira',
        targets: [
          { os: 'default', uri: `${jiraBaseUrl}/browse/${issueKey}` }
        ]
      }
    ]
  };
  
  // Send with retry
  return await sendToTeamsWithRetry(team.teamsWebhookUrl, payload);
}

async function sendToTeamsWithRetry(webhookUrl, payload, maxRetries = 3) {
  console.log('sendToTeamsWithRetry - webhookUrl:', webhookUrl);
  console.log('sendToTeamsWithRetry - payload:', JSON.stringify(payload));
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Próba ${attempt}/${maxRetries} wysłania do Teams...`);
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      console.log(`Odpowiedź z Teams (próba ${attempt}):`, response.status, response.statusText);
      
      if (response.ok) {
        const responseText = await response.text();
        console.log('Sukces - odpowiedź z Teams:', responseText);
        return { success: true };
      }
      
      // Client error - no retry
      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text();
        console.error(`Błąd klienta (${response.status}):`, errorText);
        return { success: false, error: `Webhook error ${response.status}: ${errorText}` };
      }
      
      // Server error - retry with backoff
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Błąd serwera, ponawianie za ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      
      const errorText = await response.text();
      console.error(`Niepowodzenie po ${maxRetries} próbach:`, errorText);
      return { success: false, error: `Failed after ${maxRetries} attempts: ${errorText}` };
      
    } catch (error) {
      console.error(`Błąd podczas próby ${attempt}:`, error);
      if (attempt === maxRetries) {
        return { success: false, error: error.message };
      }
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Błąd połączenia, ponawianie za ${delay}ms...`);
      await sleep(delay);
    }
  }
}

// ============================================================================
// SLA & REMINDERS - Check and Process
// ============================================================================
async function checkSLAAndReminders(projectKey = null, timeRange = 'all') {
  console.log(`Sprawdzanie SLA i przypomnień dla projektu: ${projectKey || 'wszystkie'}, przedział: ${timeRange}`);
  
  try {
    // Buduj JQL query z filtrem projektu i czasu
    let jqlQuery = 'status NOT IN (Done, Closed, Resolved, Cancelled, Rejected)';
    
    // Dodaj filtr projektu jeśli podano
    if (projectKey) {
      jqlQuery += ` AND project = ${projectKey}`;
      
      // Pobierz typ zgłoszenia z konfiguracji projektu i dodaj filtr
      const projectConfig = await storage.get(`project_config_${projectKey}`);
      if (projectConfig && projectConfig.incidentIssueTypeId) {
        jqlQuery += ` AND issuetype = ${projectConfig.incidentIssueTypeId}`;
        console.log(`Dodano filtr po typie zgłoszenia: ${projectConfig.incidentIssueTypeId}`);
      } else {
        console.warn(`⚠ Ostrzeżenie: Projekt ${projectKey} nie ma skonfigurowanego typu zgłoszenia (incidentIssueTypeId). Przetwarzanie wszystkich typów zgłoszeń w projekcie.`);
      }
    }
    
    // Dodaj filtr czasu jeśli nie "all"
    if (timeRange !== 'all') {
      const now = new Date();
      let dateFrom;
      
      switch (timeRange) {
        case '24h':
          dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFrom = null;
      }
      
      if (dateFrom) {
        const dateStr = dateFrom.toISOString().split('T')[0];
        jqlQuery += ` AND created >= "${dateStr}"`;
      }
    }
    
    jqlQuery += ' ORDER BY created DESC';
    
    console.log(`JQL Query: ${jqlQuery}`);
    
    const searchResponse = await api.asApp().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jql: jqlQuery,
          maxResults: 100,
          fields: ['summary', 'status', 'priority', 'created', 'assignee', 'reporter', 'project']
        })
      }
    );
    
    if (!searchResponse.ok) {
      console.error('Błąd pobierania alertów:', await searchResponse.text());
      return;
    }
    
    const searchResult = await searchResponse.json();
    const issues = searchResult.issues || [];
    
    console.log(`Znaleziono ${issues.length} otwartych alertów`);
    console.log(`Lista zgłoszeń: ${issues.map(i => i.key).join(', ')}`);
    
    // Przetwarzaj każdy alert i zbieraj te z przekroczonym SLA
    let processed = 0;
    let errors = 0;
    const breachedIssues = []; // Zgłoszenia z przekroczonym SLA do zbiorczego powiadomienia
    
    for (const issue of issues) {
      try {
        const breachInfo = await processIssueForSLA(issue);
        if (breachInfo && breachInfo.slaBreached) {
          breachedIssues.push(breachInfo);
        }
        processed++;
      } catch (error) {
        console.error(`Błąd przetwarzania ${issue.key}:`, error);
        errors++;
      }
    }
    
    console.log(`Przetworzono: ${processed}/${issues.length}, Błędy: ${errors}`);
    console.log(`Zgłoszenia z przekroczonym SLA: ${breachedIssues.length}`);
    
    // Wyślij zbiorczą wiadomość Teams jeśli są zgłoszenia z przekroczonym SLA
    if (breachedIssues.length > 0) {
      // Grupuj zgłoszenia po projekcie i zespole
      const groupedByProject = breachedIssues.reduce((acc, item) => {
        const key = item.projectKey;
        if (!acc[key]) {
          acc[key] = {
            projectKey: item.projectKey,
            team: item.team,
            issues: []
          };
        }
        acc[key].issues.push(item);
        return acc;
      }, {});
      
      // Wyślij zbiorczą wiadomość dla każdego projektu/zespołu
      for (const projectKey in groupedByProject) {
        const group = groupedByProject[projectKey];
        if (group.team && group.team.teamsWebhookUrl) {
          await sendBatchSLANotification(group.issues, group.team, projectKey);
        }
      }
    }
    
    return {
      processed,
      total: issues.length,
      errors,
      breached: breachedIssues.length
    };
    
  } catch (error) {
    console.error('Błąd w checkSLAAndReminders:', error);
    throw error;
  }
}

async function processIssueForSLA(issue) {
  const issueKey = issue.key;
  const created = new Date(issue.fields.created);
  const now = new Date();
  const ageInMinutes = Math.floor((now - created) / 1000 / 60);
  
  console.log(`Sprawdzam ${issueKey}, wiek: ${ageInMinutes} min`);
  
  // Pobierz per-project config
  const projectKey = issue.fields.project.key;
  const projectConfigKey = `project_config_${projectKey}`;
  const projectConfig = await storage.get(projectConfigKey) || {};
  
  // Informacje o przekroczeniu SLA (zwracane do zbiorczej wiadomości)
  let breachInfo = null;
  
  // Pobierz reguły eskalacji z konfiguracji projektu lub globalne
  let escalationRules = [];
  if (projectConfig.escalationRules && Array.isArray(projectConfig.escalationRules)) {
    escalationRules = projectConfig.escalationRules;
    console.log(`Używam reguł eskalacji z konfiguracji projektu: ${projectKey}`);
  } else {
    // Fallback do globalnych reguł
    const escalationRulesJson = await storage.get('escalation_rules') || '[]';
    escalationRules = JSON.parse(escalationRulesJson);
    console.log(`Używam globalnych reguł eskalacji`);
  }
  
  // Pobierz zespoły z konfiguracji projektu lub globalne
  let teams = [];
  if (projectConfig.escalationTeams && Array.isArray(projectConfig.escalationTeams)) {
    teams = projectConfig.escalationTeams;
    console.log(`Używam zespołów z konfiguracji projektu: ${projectKey}`);
  } else {
    // Fallback do globalnych zespołów
    const teamsJson = await storage.get('escalation_teams') || '[]';
    teams = JSON.parse(teamsJson);
    console.log(`Używam globalnych zespołów`);
  }
  
  // Znajdź aktywne reguły z SLA lub przypomnieniami
  const activeRules = escalationRules.filter(r => 
    r.enabled && (r.sla?.enabled || r.reminders?.enabled)
  );
  
  if (activeRules.length === 0) {
    console.log(`Brak aktywnych reguł z SLA lub przypomnieniami dla projektu ${projectKey}`);
    return;
  }
  const fieldsConfig = projectConfig.fieldsConfig || {};
  
  const priorityFieldId = fieldsConfig.customFieldMappings?.calculatedPriority;
  let priority = null;
  
  // Spróbuj pobrać z custom field
  if (priorityFieldId && issue.fields[priorityFieldId]) {
    priority = issue.fields[priorityFieldId];
    console.log(`${issueKey} - priorytet z custom field ${priorityFieldId}: ${priority}`);
  } 
  // Fallback: spróbuj pobrać ze storage (zapisany podczas procesowania)
  else {
    const issuePriorityKey = `issue_priority_${issueKey}`;
    priority = await storage.get(issuePriorityKey);
    if (priority) {
      console.log(`${issueKey} - priorytet ze storage: ${priority}`);
    } else {
      priority = 'P3'; // ostateczny fallback
      console.log(`${issueKey} - brak priorytetu, używam domyślnego: ${priority}`);
    }
  }
  
  console.log(`${issueKey} - priorytet: ${priority}, wiek: ${ageInMinutes} min`);
  
  // Pobierz historię przypomnień dla tego alertu
  const reminderHistoryKey = `reminder_history_${issueKey}`;
  const reminderHistoryJson = await storage.get(reminderHistoryKey) || '[]';
  const reminderHistory = JSON.parse(reminderHistoryJson);
  
  // DEBUG: Pokaż wszystkie reguły i ich warunki
  console.log(`${issueKey} - liczba reguł do sprawdzenia: ${activeRules.length}`);
  activeRules.forEach((r, idx) => {
    console.log(`${issueKey} - Reguła ${idx}: "${r.name}", enabled: ${r.enabled}, priorities: ${JSON.stringify(r.conditions?.priorities)}`);
  });
  
  // Znajdź pasującą regułę dla tego priorytetu
  const matchingRule = activeRules.find(r => 
    !r.conditions.priorities || 
    r.conditions.priorities.length === 0 || 
    r.conditions.priorities.includes(priority)
  );
  
  if (!matchingRule) {
    console.log(`${issueKey} - brak pasującej reguły dla priorytetu ${priority}`);
    console.log(`${issueKey} - Potrzebujesz reguły która ma w warunkach priorytet "${priority}" lub pustą listę priorytetów`);
    return;
  }
  
  console.log(`${issueKey} - znaleziono regułę: ${matchingRule.name}`);
  console.log(`${issueKey} - SLA enabled: ${matchingRule.sla?.enabled}, Reminders enabled: ${matchingRule.reminders?.enabled}`);
  
  // Sprawdź SLA
  if (matchingRule.sla?.enabled || matchingRule.sla?.responseTimeMinutes || matchingRule.sla?.resolutionTimeHours) {
    // Pobierz czas SLA - sprawdź obie możliwe struktury
    let slaTimeMinutes = null;
    
    // Nowa struktura: responseTimeMinutes (w minutach) i resolutionTimeHours (w godzinach)
    if (matchingRule.sla.responseTimeMinutes?.[priority]) {
      slaTimeMinutes = matchingRule.sla.responseTimeMinutes[priority];
    } else if (matchingRule.sla.resolutionTimeHours?.[priority]) {
      slaTimeMinutes = matchingRule.sla.resolutionTimeHours[priority] * 60;
    }
    // Stara struktura: responseTime i resolutionTime (w godzinach)
    else if (matchingRule.sla.responseTime?.[priority]) {
      slaTimeMinutes = matchingRule.sla.responseTime[priority] * 60;
    } else if (matchingRule.sla.resolutionTime?.[priority]) {
      slaTimeMinutes = matchingRule.sla.resolutionTime[priority] * 60;
    }
    
    if (slaTimeMinutes) {
      
      // Sprawdź czy SLA zostało przekroczone
      if (ageInMinutes > slaTimeMinutes) {
        const alreadyEscalated = reminderHistory.some(h => h.type === 'sla_breach');
        
        console.log(`⚠️ SLA przekroczone dla ${issueKey} (${ageInMinutes}/${slaTimeMinutes} min), already escalated: ${alreadyEscalated}`);
        
        // Pobierz aktualny zespół
        const team = await getCurrentTeamFromSchedule(teams);
        
        // Zbierz informacje o przekroczeniu (do zbiorczej wiadomości) - zawsze gdy SLA przekroczone
        breachInfo = {
          slaBreached: true,
          issueKey: issueKey,
          summary: issue.fields.summary,
          priority: priority,
          status: issue.fields.status.name,
          assignee: issue.fields.assignee?.displayName || 'Nieprzypisane',
          ageInMinutes: ageInMinutes,
          slaTimeMinutes: slaTimeMinutes,
          projectKey: projectKey,
          team: team,
          alreadyEscalated: alreadyEscalated
        };
        
        // Dodaj komentarze i zapisz historię tylko jeśli jeszcze nie eskalowano
        if (!alreadyEscalated) {
          // Eskaluj według ścieżek eskalacji
          if (matchingRule.escalationPath && matchingRule.escalationPath.length > 0) {
            for (const level of matchingRule.escalationPath) {
              if (ageInMinutes >= level.afterMinutes) {
                // Dodaj komentarz o eskalacji
                const commentText = `🚨 ESKALACJA SLA\n` +
                  `• Przekroczono SLA: ${Math.floor(slaTimeMinutes / 60)}h ${slaTimeMinutes % 60}min dla priorytetu ${priority}\n` +
                  `• Wiek zgłoszenia: ${Math.floor(ageInMinutes / 60)}h ${ageInMinutes % 60}min\n` +
                  `• Poziom eskalacji: ${level.afterMinutes} min\n` +
                  `• Eskalacja do: ${level.assignToUser || 'zespołu dyżurnego'}`;
                
                await addCommentToIssue(issueKey, commentText);
                
                // Zapisz w historii
                reminderHistory.push({
                  type: 'sla_breach',
                  timestamp: now.toISOString(),
                  level: level.afterMinutes,
                  notifiedTo: level.assignToUser || 'team'
                });
                
                // Nie wysyłamy już osobnej wiadomości - będzie zbiorcza
              }
            }
          }
          
          // Zapisz historię
          await storage.set(reminderHistoryKey, JSON.stringify(reminderHistory));
        }
      }
    }
  }
  
  // Sprawdź przypomnienia
  if (matchingRule.reminders?.enabled) {
    const intervalMinutes = matchingRule.reminders.intervalMinutes || 30;
    const maxReminders = matchingRule.reminders.maxReminders || 5;
    
    console.log(`${issueKey} - sprawdzam przypomnienia (interwał: ${intervalMinutes} min, max: ${maxReminders})`);
    
    // Policz wysłane przypomnienia
    const sentReminders = reminderHistory.filter(h => h.type === 'reminder').length;
    
    console.log(`${issueKey} - wysłane przypomnienia: ${sentReminders}/${maxReminders}`);
    
    if (sentReminders < maxReminders) {
      // Sprawdź czy minął interwał od ostatniego przypomnienia
      const lastReminder = reminderHistory
        .filter(h => h.type === 'reminder')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      
      const shouldSendReminder = !lastReminder || 
        (now - new Date(lastReminder.timestamp)) / 1000 / 60 >= intervalMinutes;
      
      if (shouldSendReminder && ageInMinutes >= intervalMinutes) {
        console.log(`🔔 Wysyłam przypomnienie dla ${issueKey} (${sentReminders + 1}/${maxReminders})`);
        
        const team = await getCurrentTeamFromSchedule(teams);
        const commentText = `🔔 PRZYPOMNIENIE #${sentReminders + 1}\n` +
          `• Zgłoszenie nadal otwarte\n` +
          `• Wiek: ${Math.floor(ageInMinutes / 60)}h ${ageInMinutes % 60}min\n` +
          `• Priorytet: ${priority}\n` +
          `• Powiadomiono: ${team ? team.name : 'zespół dyżurny'}`;
        
        await addCommentToIssue(issueKey, commentText);
        
        // Zapisz w historii
        reminderHistory.push({
          type: 'reminder',
          timestamp: now.toISOString(),
          count: sentReminders + 1,
          notifiedTo: team ? team.name : 'team'
        });
        
        await storage.set(reminderHistoryKey, JSON.stringify(reminderHistory));
        
        // Wyślij powiadomienie na Teams
        if (team && team.teamsWebhookUrl && matchingRule.reminders.notifyChannels?.includes('teams')) {
          await notifyTeamsReminder(issueKey, issue, priority, team, sentReminders + 1, maxReminders);
        }
      }
    }
  }
  
  // Zwróć informacje o przekroczeniu SLA (jeśli jest)
  return breachInfo;
}

// Nowa funkcja - przyjmuje harmonogram jako parametr
async function getCurrentTeamFromScheduleData(teams, schedule) {
  if (!schedule || schedule.length === 0) {
    console.log('getCurrentTeamFromScheduleData: brak wpisów w harmonogramie');
    return null;
  }
  
  const today = new Date();
  console.log(`getCurrentTeamFromScheduleData: sprawdzam ${schedule.length} wpisów, data: ${today.toISOString()}`);
  
  const currentWeek = schedule.find(week => {
    if (!week.startDate || !week.endDate) {
      console.log(`getCurrentTeamFromScheduleData: wpis bez dat`);
      return false;
    }
    const start = new Date(week.startDate);
    const end = new Date(week.endDate);
    const isInRange = today >= start && today <= end;
    console.log(`getCurrentTeamFromScheduleData: wpis ${week.teamId}, ${start.toISOString()} - ${end.toISOString()}, pasuje: ${isInRange}`);
    return isInRange;
  });
  
  if (currentWeek && currentWeek.teamId) {
    const team = teams.find(t => t.id === currentWeek.teamId);
    console.log(`getCurrentTeamFromScheduleData: znaleziono zespół ${team?.name || 'brak'} dla ID ${currentWeek.teamId}`);
    return team;
  }
  
  console.log('getCurrentTeamFromScheduleData: nie znaleziono aktualnego zespołu');
  return null;
}

// Stara funkcja - pobiera globalny harmonogram (dla kompatybilności)
async function getCurrentTeamFromSchedule(teams) {
  const scheduleJson = await storage.get('team_schedule') || '[]';
  const schedule = JSON.parse(scheduleJson);
  
  if (schedule.length > 0) {
    const today = new Date();
    const currentWeek = schedule.find(week => {
      if (!week.startDate || !week.endDate) return false;
      const start = new Date(week.startDate);
      const end = new Date(week.endDate);
      return today >= start && today <= end;
    });
    
    if (currentWeek && currentWeek.teamId) {
      return teams.find(t => t.id === currentWeek.teamId);
    }
  }
  
  return null;
}

async function notifyTeamsEscalation(issueKey, issue, priority, team, level, type) {
  const jiraBaseUrl = 'https://piotrkrupak-1765730014262.atlassian.net';
  
  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: 'FF0000',
    summary: `🚨 ${type} - ${issueKey}`,
    sections: [
      {
        activityTitle: `🚨 ${type}`,
        activitySubtitle: issue.fields.summary,
        facts: [
          { name: 'Issue Key:', value: issueKey },
          { name: 'Priority:', value: priority },
          { name: 'Team:', value: team.name },
          { name: 'Eskalacja do:', value: level.assignToUser || 'zespół dyżurny' },
          { name: 'Po minutach:', value: level.afterMinutes.toString() }
        ],
        markdown: true
      }
    ],
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: 'View in Jira',
        targets: [
          { os: 'default', uri: `${jiraBaseUrl}/browse/${issueKey}` }
        ]
      }
    ]
  };
  
  await sendToTeamsWithRetry(team.teamsWebhookUrl, payload);
}

async function notifyTeamsReminder(issueKey, issue, priority, team, reminderCount, maxReminders) {
  const jiraBaseUrl = 'https://piotrkrupak-1765730014262.atlassian.net';
  
  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: 'FFA500',
    summary: `🔔 Przypomnienie #${reminderCount} - ${issueKey}`,
    sections: [
      {
        activityTitle: `🔔 Przypomnienie #${reminderCount}/${maxReminders}`,
        activitySubtitle: issue.fields.summary,
        facts: [
          { name: 'Issue Key:', value: issueKey },
          { name: 'Priority:', value: priority },
          { name: 'Team:', value: team.name },
          { name: 'Wiek zgłoszenia:', value: `${Math.floor((new Date() - new Date(issue.fields.created)) / 1000 / 60 / 60)}h` }
        ],
        markdown: true
      }
    ],
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: 'View in Jira',
        targets: [
          { os: 'default', uri: `${jiraBaseUrl}/browse/${issueKey}` }
        ]
      }
    ]
  };
  
  await sendToTeamsWithRetry(team.teamsWebhookUrl, payload);
}

// Zbiorcze powiadomienie Teams o zgłoszeniach z przekroczonym SLA
async function sendBatchSLANotification(breachedIssues, team, projectKey) {
  if (!team.teamsWebhookUrl || breachedIssues.length === 0) {
    return;
  }
  
  // Pobierz jiraInstanceUrl z konfiguracji projektu
  let jiraBaseUrl = 'https://dreryk.atlassian.net';
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig && projectConfig.jiraInstanceUrl) {
      jiraBaseUrl = projectConfig.jiraInstanceUrl.replace(/^https?:\/\//, '');
      jiraBaseUrl = `https://${jiraBaseUrl}`;
    }
  }
  
  // Sortuj zgłoszenia według priorytetu (P1 najpierw)
  const priorityOrder = { 'P1': 1, 'P2': 2, 'P3': 3, 'P4': 4 };
  const sortedIssues = [...breachedIssues].sort((a, b) => 
    (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99)
  );
  
  // Oblicz czas w statusie
  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    
    if (days > 0) {
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      return `${hours}h ${mins}min`;
    } else {
      return `${mins}min`;
    }
  };
  
  // Emoji dla priorytetów
  const getPriorityEmoji = (priority) => {
    switch(priority) {
      case 'P1': return '🔴';
      case 'P2': return '🟠';
      case 'P3': return '🟡';
      case 'P4': return '🔵';
      default: return '⚪';
    }
  };
  
  // Buduj listę zgłoszeń jako facts
  const facts = [];
  sortedIssues.forEach((item, index) => {
    const emoji = getPriorityEmoji(item.priority);
    const timeInStatus = formatTime(item.ageInMinutes);
    const issueUrl = `${jiraBaseUrl}/browse/${item.issueKey}`;
    
    facts.push({
      name: `${index + 1}. ${emoji} ${item.issueKey} [${item.priority}]`,
      value: `**${item.summary}**\n` +
             `Status: ${item.status} | Czas: ${timeInStatus} | Przypisane: ${item.assignee}\n` +
             `[Otwórz w Jira](${issueUrl})`
    });
  });
  
  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: 'FF0000',
    summary: `⚠️ Przekroczenie SLA - ${breachedIssues.length} alertów czeka`,
    sections: [
      {
        activityTitle: `⚠️ Przekroczenie SLA`,
        activitySubtitle: `Cześć!\n\nOto lista alertów które czekają na Ciebie:`,
        facts: facts,
        markdown: true
      },
      {
        text: `**Zespół dyżurny:** ${team.name}\n` +
              `**Liczba alertów:** ${breachedIssues.length}\n` +
              `**Projekt:** ${projectKey}`,
        markdown: true
      }
    ],
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: 'Otwórz Jira',
        targets: [
          { os: 'default', uri: `${jiraBaseUrl}/projects/${projectKey}/issues` }
        ]
      }
    ]
  };
  
  console.log(`Wysyłam zbiorczą wiadomość Teams dla ${breachedIssues.length} zgłoszeń z projektu ${projectKey}`);
  await sendToTeamsWithRetry(team.teamsWebhookUrl, payload);
}

// Funkcja exportowana dla scheduled trigger / webtrigger
export async function scheduledSLACheck() {
  console.log('🔄 Uruchomiono scheduledSLACheck');
  await checkSLAAndReminders(null, 'all'); // Dla cron job - wszystkie projekty, wszystkie zgłoszenia
  return { success: true, message: 'SLA check completed' };
}

// Resolver do manualnego wywołania
resolver.define('runSLACheck', async ({ payload }) => {
  try {
    const { projectKey, timeRange = 'all' } = payload || {};
    console.log(`Manual SLA check requested for project: ${projectKey || 'all'}, timeRange: ${timeRange}`);
    
    // Jeśli podano projekt, sprawdź czy ma skonfigurowany typ zgłoszenia
    if (projectKey) {
      const projectConfig = await storage.get(`project_config_${projectKey}`);
      if (!projectConfig || !projectConfig.incidentIssueTypeId) {
        return { 
          success: false, 
          error: `Projekt ${projectKey} nie ma skonfigurowanego typu zgłoszenia. Skonfiguruj typ zgłoszenia w "Ustawienia Ogólne" przed sprawdzaniem SLA.` 
        };
      }
    }
    
    const result = await checkSLAAndReminders(projectKey, timeRange);
    
    const timeRangeText = {
      '24h': 'ostatnie 24 godziny',
      'week': 'ostatni tydzień',
      'month': 'ostatni miesiąc',
      'all': 'wszystkie'
    }[timeRange] || 'wszystkie';
    
    const projectText = projectKey ? `projektu ${projectKey}` : 'wszystkich projektów';
    const message = `Sprawdzenie SLA/przypomnień zakończone. Przetworzono: ${result.processed}/${result.total} zgłoszeń (${projectText}, ${timeRangeText})`;
    
    return { 
      success: true, 
      message,
      ...result
    };
  } catch (error) {
    console.error('Error in manual SLA check:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// GET ISSUES FOR SLA CHECK - Pobierz zgłoszenia z przekroczonym SLA (bez wysyłania)
// ============================================================================
resolver.define('getIssuesForSLACheck', async ({ payload }) => {
  try {
    const { projectKey, timeRange = 'all' } = payload || {};
    
    if (!projectKey) {
      return { success: false, error: 'Nie podano klucza projektu' };
    }
    
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (!projectConfig || !projectConfig.incidentIssueTypeId) {
      return { 
        success: false, 
        error: `Projekt ${projectKey} nie ma skonfigurowanego typu zgłoszenia` 
      };
    }
    
    // Przygotuj JQL dla zakresu czasowego
    let timeFilter = '';
    if (timeRange === '24h') {
      timeFilter = ' AND created >= -24h';
    } else if (timeRange === 'week') {
      timeFilter = ' AND created >= -7d';
    } else if (timeRange === 'month') {
      timeFilter = ' AND created >= -30d';
    }
    
    const jqlQuery = `project = ${projectKey} AND issuetype = ${projectConfig.incidentIssueTypeId} AND statusCategory != Done${timeFilter} ORDER BY created DESC`;
    
    console.log(`Pobieranie zgłoszeń dla SLA check z JQL: ${jqlQuery}`);
    
    const searchResponse = await api.asUser().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jql: jqlQuery,
          maxResults: 100,
          fields: ['summary', 'status', 'priority', 'created', 'assignee', 'reporter', 'project']
        })
      }
    );
    
    if (!searchResponse.ok) {
      console.error('Błąd pobierania alertów:', await searchResponse.text());
      return { success: false, error: 'Błąd pobierania zgłoszeń z Jira' };
    }
    
    const searchResult = await searchResponse.json();
    const issues = searchResult.issues || [];
    
    console.log(`Znaleziono ${issues.length} otwartych alertów`);
    
    // Pobierz reguły eskalacji i zespoły
    let escalationRules = [];
    if (projectConfig.escalationRules && Array.isArray(projectConfig.escalationRules)) {
      escalationRules = projectConfig.escalationRules;
    } else {
      const escalationRulesJson = await storage.get('escalation_rules') || '[]';
      escalationRules = JSON.parse(escalationRulesJson);
    }
    
    let teams = [];
    if (projectConfig.escalationTeams && Array.isArray(projectConfig.escalationTeams)) {
      teams = projectConfig.escalationTeams;
    } else {
      const teamsJson = await storage.get('escalation_teams') || '[]';
      teams = JSON.parse(teamsJson);
    }
    
    // Filtruj zgłoszenia z przekroczonym SLA
    const issuesWithSLA = [];
    const now = new Date();
    
    console.log(`[SLA CHECK] Sprawdzam ${issues.length} zgłoszeń`);
    console.log(`[SLA CHECK] Liczba reguł eskalacji: ${escalationRules.length}`);
    
    // DEBUG: Pokaż wszystkie reguły
    escalationRules.forEach((rule, idx) => {
      const hasSLA = !!(rule.sla?.enabled || rule.sla?.responseTimeMinutes || rule.sla?.resolutionTimeHours);
      console.log(`[SLA CHECK] Reguła ${idx}: name="${rule.name}", enabled=${rule.enabled}, sla.enabled=${rule.sla?.enabled}, hasSLA=${hasSLA}, responseTimeMinutes=${JSON.stringify(rule.sla?.responseTimeMinutes)}`);
    });
    
    for (const issue of issues) {
      const issueKey = issue.key;
      const created = new Date(issue.fields.created);
      const ageInMinutes = Math.floor((now - created) / 1000 / 60);
      
      console.log(`\n[SLA CHECK] Sprawdzam ${issueKey}, wiek: ${ageInMinutes} min (${Math.floor(ageInMinutes/60)}h ${ageInMinutes%60}min)`);
      
      const fieldsConfig = projectConfig.fieldsConfig || {};
      const priorityFieldId = fieldsConfig.customFieldMappings?.calculatedPriority;
      let priority = null;
      
      if (priorityFieldId && issue.fields[priorityFieldId]) {
        priority = issue.fields[priorityFieldId];
        console.log(`[SLA CHECK] ${issueKey} - priorytet z custom field ${priorityFieldId}: ${priority}`);
      } else {
        const issuePriorityKey = `issue_priority_${issueKey}`;
        priority = await storage.get(issuePriorityKey);
        if (priority) {
          console.log(`[SLA CHECK] ${issueKey} - priorytet ze storage: ${priority}`);
        } else {
          priority = 'P3';
          console.log(`[SLA CHECK] ${issueKey} - brak priorytetu, używam domyślnego: ${priority}`);
        }
      }
      
      // Znajdź pasującą regułę - sprawdź czy ma skonfigurowane SLA (stara lub nowa struktura)
      const activeRules = escalationRules.filter(r => 
        r.enabled && (r.sla?.enabled || r.sla?.responseTimeMinutes || r.sla?.resolutionTimeHours)
      );
      console.log(`[SLA CHECK] ${issueKey} - aktywne reguły z SLA: ${activeRules.length}`);
      
      activeRules.forEach((r, idx) => {
        console.log(`[SLA CHECK] ${issueKey} - Reguła ${idx}: "${r.name}", priorities: ${JSON.stringify(r.conditions?.priorities)}, responseTime: ${JSON.stringify(r.sla?.responseTime)}`);
      });
      
      const matchingRule = activeRules.find(r => 
        !r.conditions.priorities || 
        r.conditions.priorities.length === 0 || 
        r.conditions.priorities.includes(priority)
      );
      
      if (matchingRule) {
        console.log(`[SLA CHECK] ${issueKey} - znaleziono pasującą regułę: ${matchingRule.name}`);
        
        // Pobierz czas SLA - sprawdź obie możliwe struktury
        let slaTimeMinutes = null;
        
        // Nowa struktura: responseTimeMinutes (w minutach) i resolutionTimeHours (w godzinach)
        if (matchingRule.sla.responseTimeMinutes?.[priority]) {
          slaTimeMinutes = matchingRule.sla.responseTimeMinutes[priority];
          console.log(`[SLA CHECK] ${issueKey} - SLA z responseTimeMinutes: ${slaTimeMinutes} min`);
        } else if (matchingRule.sla.resolutionTimeHours?.[priority]) {
          slaTimeMinutes = matchingRule.sla.resolutionTimeHours[priority] * 60;
          console.log(`[SLA CHECK] ${issueKey} - SLA z resolutionTimeHours: ${matchingRule.sla.resolutionTimeHours[priority]}h = ${slaTimeMinutes} min`);
        }
        // Stara struktura: responseTime i resolutionTime (w godzinach)
        else if (matchingRule.sla.responseTime?.[priority]) {
          slaTimeMinutes = matchingRule.sla.responseTime[priority] * 60;
          console.log(`[SLA CHECK] ${issueKey} - SLA z responseTime (stara): ${matchingRule.sla.responseTime[priority]}h = ${slaTimeMinutes} min`);
        } else if (matchingRule.sla.resolutionTime?.[priority]) {
          slaTimeMinutes = matchingRule.sla.resolutionTime[priority] * 60;
          console.log(`[SLA CHECK] ${issueKey} - SLA z resolutionTime (stara): ${matchingRule.sla.resolutionTime[priority]}h = ${slaTimeMinutes} min`);
        }
        
        if (slaTimeMinutes) {
          console.log(`[SLA CHECK] ${issueKey} - SLA time: ${slaTimeMinutes} min, age: ${ageInMinutes} min, przekroczone: ${ageInMinutes > slaTimeMinutes}`);
          
          if (ageInMinutes > slaTimeMinutes) {
            console.log(`[SLA CHECK] ✓ ${issueKey} - PRZEKROCZONO SLA`);
            issuesWithSLA.push({
              key: issueKey,
              summary: issue.fields.summary,
              priority: priority,
              status: issue.fields.status.name,
              assignee: issue.fields.assignee?.displayName || 'Nieprzypisane',
              ageInMinutes: ageInMinutes,
              slaTimeMinutes: slaTimeMinutes,
              created: issue.fields.created
            });
          } else {
            console.log(`[SLA CHECK] ✗ ${issueKey} - SLA nie przekroczone`);
          }
        } else {
          console.log(`[SLA CHECK] ${issueKey} - brak czasu SLA dla priorytetu ${priority}`);
        }
      } else {
        console.log(`[SLA CHECK] ${issueKey} - brak pasującej reguły dla priorytetu ${priority}`);
      }
    }
    
    console.log(`Znaleziono ${issuesWithSLA.length} zgłoszeń z przekroczonym SLA`);
    
    return {
      success: true,
      issues: issuesWithSLA
    };
  } catch (error) {
    console.error('Error getting issues for SLA check:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// SEND BATCH SLA REMINDER - Wyślij zbiorczą wiadomość dla wybranych zgłoszeń
// ============================================================================
resolver.define('sendBatchSLAReminder', async ({ payload }) => {
  try {
    const { projectKey, issueKeys } = payload || {};
    
    if (!projectKey || !issueKeys || issueKeys.length === 0) {
      return { success: false, error: 'Brak zgłoszeń do przetworzenia' };
    }
    
    console.log(`Wysyłanie zbiorczego przypomnienia dla ${issueKeys.length} zgłoszeń z projektu ${projectKey}`);
    
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    console.log(`[BATCH SLA] projectConfig:`, projectConfig ? 'znaleziono' : 'brak');
    
    // Pobierz zespoły
    let teams = [];
    if (projectConfig && projectConfig.escalationTeams && Array.isArray(projectConfig.escalationTeams)) {
      teams = projectConfig.escalationTeams;
      console.log(`[BATCH SLA] Pobrano ${teams.length} zespołów z konfiguracji projektu`);
    } else {
      const teamsJson = await storage.get('escalation_teams') || '[]';
      teams = JSON.parse(teamsJson);
      console.log(`[BATCH SLA] Pobrano ${teams.length} zespołów z globalnej konfiguracji`);
    }
    
    teams.forEach((t, idx) => {
      console.log(`[BATCH SLA] Zespół ${idx}: name="${t.name}", hasWebhook=${!!t.teamsWebhookUrl}`);
    });
    
    // Pobierz harmonogram z konfiguracji projektu
    const schedule = projectConfig?.teamSchedule || [];
    console.log(`[BATCH SLA] Harmonogram dyżurów: ${schedule.length} wpisów`);
    
    // Znajdź aktualny zespół dyżurny z harmonogramu projektu
    const team = await getCurrentTeamFromScheduleData(teams, schedule);
    console.log(`[BATCH SLA] Aktualny zespół dyżurny:`, team ? `${team.name} (webhook: ${!!team.teamsWebhookUrl})` : 'brak');
    
    if (!team || !team.teamsWebhookUrl) {
      console.error(`[BATCH SLA] Błąd: team=${!!team}, webhook=${team?.teamsWebhookUrl}`);
      return { success: false, error: 'Brak skonfigurowanego zespołu dyżurnego lub webhook URL. Sprawdź harmonogram dyżurów i czy aktualny zespół ma ustawiony webhook Teams.' };
    }
    
    // Pobierz szczegóły zgłoszeń
    const breachedIssues = [];
    
    for (const issueKey of issueKeys) {
      const issueResponse = await api.asUser().requestJira(
        route`/rest/api/3/issue/${issueKey}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (issueResponse.ok) {
        const issue = await issueResponse.json();
        const created = new Date(issue.fields.created);
        const now = new Date();
        const ageInMinutes = Math.floor((now - created) / 1000 / 60);
        
        const fieldsConfig = projectConfig.fieldsConfig || {};
        const priorityFieldId = fieldsConfig.customFieldMappings?.calculatedPriority;
        let priority = null;
        
        if (priorityFieldId && issue.fields[priorityFieldId]) {
          priority = issue.fields[priorityFieldId];
        } else {
          const issuePriorityKey = `issue_priority_${issueKey}`;
          priority = await storage.get(issuePriorityKey) || 'P3';
        }
        
        breachedIssues.push({
          issueKey: issueKey,
          summary: issue.fields.summary,
          priority: priority,
          status: issue.fields.status.name,
          assignee: issue.fields.assignee?.displayName || 'Nieprzypisane',
          ageInMinutes: ageInMinutes,
          projectKey: projectKey,
          team: team
        });
      }
    }
    
    if (breachedIssues.length > 0) {
      // Wyślij zbiorczą wiadomość Teams
      await sendBatchSLANotification(breachedIssues, team, projectKey);
      
      // Dodaj komentarze do każdego zgłoszenia
      let commentsAdded = 0;
      for (const issueData of breachedIssues) {
        try {
          // Sprawdź czy już było wysłane przypomnienie SLA
          const reminderHistoryKey = `reminder_history_${issueData.issueKey}`;
          const reminderHistoryJson = await storage.get(reminderHistoryKey) || '[]';
          const reminderHistory = JSON.parse(reminderHistoryJson);
          
          const alreadyEscalated = reminderHistory.some(h => h.type === 'sla_breach');
          
          if (!alreadyEscalated) {
            // Dodaj komentarz o eskalacji SLA
            const commentText = `🚨 ESKALACJA SLA (Manualne przypomnienie)\n` +
              `• Przekroczono SLA dla priorytetu ${issueData.priority}\n` +
              `• Wiek zgłoszenia: ${Math.floor(issueData.ageInMinutes / 60)}h ${issueData.ageInMinutes % 60}min\n` +
              `• Powiadomiono: ${team.name}\n` +
              `• Wysłano zbiorczą wiadomość Teams`;
            
            await addCommentToIssue(issueData.issueKey, commentText);
            
            // Zapisz w historii
            reminderHistory.push({
              type: 'sla_breach',
              timestamp: new Date().toISOString(),
              notifiedTo: team.name,
              manual: true
            });
            
            await storage.set(reminderHistoryKey, JSON.stringify(reminderHistory));
            commentsAdded++;
            console.log(`[BATCH SLA] Dodano komentarz do ${issueData.issueKey}`);
          } else {
            console.log(`[BATCH SLA] ${issueData.issueKey} już ma eskalację w historii, pomijam komentarz`);
          }
        } catch (error) {
          console.error(`[BATCH SLA] Błąd dodawania komentarza do ${issueData.issueKey}:`, error);
        }
      }
      
      return {
        success: true,
        message: `Wysłano zbiorczą wiadomość dla ${breachedIssues.length} zgłoszeń. Dodano ${commentsAdded} komentarzy.`
      };
    } else {
      return { success: false, error: 'Nie udało się pobrać szczegółów zgłoszeń' };
    }
  } catch (error) {
    console.error('Error sending batch SLA reminder:', error);
    return { success: false, error: error.message };
  }
});

// Resolver do retroaktywnego przetwarzania wszystkich zgłoszeń
// ============================================================================
// GET ISSUES FOR RECALCULATION - Pobierz zgłoszenia do przeliczenia (bez przeliczania)
// ============================================================================
resolver.define('getIssuesForRecalc', async ({ payload }) => {
  try {
    const { projectKey, timeRange = 'all' } = payload || {};
    
    if (!projectKey) {
      return { success: false, error: 'Nie podano klucza projektu' };
    }
    
    console.log(`🔍 Pobieranie zgłoszeń dla projektu: ${projectKey}, przedział: ${timeRange}`);
    
    // Pobierz typ zgłoszenia z konfiguracji projektu
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (!projectConfig || !projectConfig.incidentIssueTypeId) {
      return { 
        success: false, 
        error: `Projekt ${projectKey} nie ma skonfigurowanego typu zgłoszenia. Skonfiguruj typ zgłoszenia w "Ustawienia Ogólne" przed przeliczaniem.` 
      };
    }
    
    // Buduj JQL query z filtrem projektu, typu zgłoszenia i czasu
    let jqlQuery = `project = ${projectKey} AND issuetype = ${projectConfig.incidentIssueTypeId}`;
    
    console.log(`Dodano filtr po typie zgłoszenia: ${projectConfig.incidentIssueTypeId}`);
    
    // Dodaj filtr czasu jeśli nie "all"
    if (timeRange !== 'all') {
      const now = new Date();
      let dateFrom;
      
      switch (timeRange) {
        case '24h':
          dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFrom = null;
      }
      
      if (dateFrom) {
        const dateStr = dateFrom.toISOString().split('T')[0];
        jqlQuery += ` AND created >= "${dateStr}"`;
      }
    }
    
    jqlQuery += ' ORDER BY created DESC';
    
    console.log(`JQL Query: ${jqlQuery}`);
    
    const searchResponse = await api.asApp().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jql: jqlQuery,
          maxResults: 1000, // Zwiększone dla większej liczby zgłoszeń
          fields: ['summary', 'status', 'priority', 'created', 'assignee', 'reporter', 'project']
        })
      }
    );
    
    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Failed to fetch issues:', errorText);
      throw new Error(`Failed to fetch issues: ${errorText}`);
    }
    
    const searchResult = await searchResponse.json();
    const issues = searchResult.issues || [];
    
    // Formatuj zgłoszenia dla frontendu
    const formattedIssues = issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary || 'Brak tytułu',
      status: issue.fields.status?.name || 'Nieznany',
      priority: issue.fields.priority?.name || 'Nieznany',
      created: issue.fields.created,
      assignee: issue.fields.assignee?.displayName || 'Nieprzypisane',
      reporter: issue.fields.reporter?.displayName || 'Nieznany'
    }));
    
    console.log(`Znaleziono ${formattedIssues.length} zgłoszeń`);
    
    return { 
      success: true, 
      issues: formattedIssues,
      total: formattedIssues.length
    };
  } catch (error) {
    console.error('Error in getIssuesForRecalculation:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// REPROCESS SELECTED ISSUES - Przelicz wybrane zgłoszenia
// ============================================================================
resolver.define('reprocessSelectedIssues', async ({ payload }) => {
  try {
    const { projectKey, issueKeys = [] } = payload || {};
    
    if (!projectKey) {
      return { success: false, error: 'Nie podano klucza projektu' };
    }
    
    if (!issueKeys || issueKeys.length === 0) {
      return { success: false, error: 'Nie wybrano żadnych zgłoszeń do przeliczenia' };
    }
    
    console.log(`🔄 Przetwarzanie ${issueKeys.length} wybranych zgłoszeń z projektu: ${projectKey}`);
    
    let processed = 0;
    let errors = 0;
    const errorDetails = [];
    
    for (const issueKey of issueKeys) {
      try {
        console.log(`Przetwarzam ${issueKey}...`);
        await processIncidentLogic(issueKey, 'system');
        processed++;
        console.log(`✓ ${issueKey} przetworzony`);
      } catch (error) {
        console.error(`✗ Błąd dla ${issueKey}:`, error.message);
        errors++;
        errorDetails.push({ issueKey, error: error.message });
      }
    }
    
    const message = `Przetworzono: ${processed}/${issueKeys.length} zgłoszeń, Błędy: ${errors}`;
    console.log(message);
    
    return { 
      success: true, 
      message,
      processed,
      total: issueKeys.length,
      errors,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined
    };
  } catch (error) {
    console.error('Error in reprocessSelectedIssues:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// REPROCESS ALL ISSUES - Zachowana dla kompatybilności (deprecated)
// ============================================================================
resolver.define('reprocessAllIssues', async ({ payload }) => {
  try {
    const { projectKey, timeRange = 'all' } = payload || {};
    
    if (!projectKey) {
      return { success: false, error: 'Nie podano klucza projektu' };
    }
    
    console.log(`🔄 Retroaktywne przetwarzanie zgłoszeń dla projektu: ${projectKey}, przedział: ${timeRange}`);
    
    // Pobierz typ zgłoszenia z konfiguracji projektu
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (!projectConfig || !projectConfig.incidentIssueTypeId) {
      return { 
        success: false, 
        error: `Projekt ${projectKey} nie ma skonfigurowanego typu zgłoszenia. Skonfiguruj typ zgłoszenia w "Ustawienia Ogólne" przed przeliczaniem.` 
      };
    }
    
    // Buduj JQL query z filtrem projektu, typu zgłoszenia i czasu
    let jqlQuery = `project = ${projectKey} AND status NOT IN (Done, Closed, Resolved, Cancelled, Rejected) AND issuetype = ${projectConfig.incidentIssueTypeId}`;
    
    console.log(`Dodano filtr po typie zgłoszenia: ${projectConfig.incidentIssueTypeId}`);
    
    // Dodaj filtr czasu jeśli nie "all"
    if (timeRange !== 'all') {
      const now = new Date();
      let dateFrom;
      
      switch (timeRange) {
        case '24h':
          dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFrom = null;
      }
      
      if (dateFrom) {
        const dateStr = dateFrom.toISOString().split('T')[0];
        jqlQuery += ` AND created >= "${dateStr}"`;
      }
    }
    
    jqlQuery += ' ORDER BY created DESC';
    
    console.log(`JQL Query: ${jqlQuery}`);
    
    const searchResponse = await api.asApp().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jql: jqlQuery,
          maxResults: 100,
          fields: ['summary', 'status', 'priority', 'created', 'assignee', 'reporter', 'project']
        })
      }
    );
    
    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Failed to fetch issues:', errorText);
      throw new Error(`Failed to fetch issues: ${errorText}`);
    }
    
    const searchResult = await searchResponse.json();
    const issues = searchResult.issues || [];
    
    console.log(`Znaleziono ${issues.length} zgłoszeń do przetworzenia`);
    
    let processed = 0;
    let errors = 0;
    
    for (const issue of issues) {
      try {
        console.log(`Przetwarzam ${issue.key}...`);
        await processIncidentLogic(issue.key, 'system');
        processed++;
        console.log(`✓ ${issue.key} przetworzony`);
      } catch (error) {
        console.error(`✗ Błąd dla ${issue.key}:`, error.message);
        errors++;
      }
    }
    
    const timeRangeText = {
      '24h': 'ostatnie 24 godziny',
      'week': 'ostatni tydzień',
      'month': 'ostatni miesiąc',
      'all': 'wszystkie'
    }[timeRange] || 'wszystkie';
    
    const message = `Przetworzono: ${processed}/${issues.length} zgłoszeń (projekt ${projectKey}, ${timeRangeText}), Błędy: ${errors}`;
    console.log(message);
    
    return { 
      success: true, 
      message,
      processed,
      total: issues.length,
      errors
    };
  } catch (error) {
    console.error('Error in reprocessAllIssues:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// GET CONTEXT - Pobierz kontekst projektu z Jira
// ============================================================================
resolver.define('getContext', async ({ context }) => {
  try {
    // Zwróć kontekst, który zawiera informacje o projekcie
    return {
      success: true,
      context: context || {}
    };
  } catch (error) {
    console.error('Error in getContext:', error);
    return {
      success: false,
      error: error.message,
      context: null
    };
  }
});

// ============================================================================
// GET CONFIGURATION
// ============================================================================
resolver.define('getConfig', async ({ payload }) => {
  try {
    const { configType } = payload;
    
    let data;
    switch (configType) {
      case 'global':
        data = await storage.get('global_config') || getDefaultGlobalConfig();
        break;
      case 'fields':
        data = await storage.get('fields_config') || getDefaultFieldsConfig();
        break;
      case 'rules':
        data = JSON.parse(await storage.get('priority_rules') || '[]');
        break;
      case 'teams':
        data = JSON.parse(await storage.get('escalation_teams') || '[]');
        break;
      case 'mappings':
        data = JSON.parse(await storage.get('team_mappings') || '[]');
        break;
      case 'schedule':
        data = JSON.parse(await storage.get('team_schedule') || '[]');
        break;
      case 'webhooks':
        data = await storage.get('teams_webhooks') || {};
        break;
      case 'escalation_rules':
        data = JSON.parse(await storage.get('escalation_rules') || '[]');
        break;
      default:
        return { success: false, error: 'Invalid config type' };
    }
    
    return {
      success: true,
      data: data
    };
    
  } catch (error) {
    console.error('Error in getConfig:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// SAVE CONFIGURATION
// ============================================================================
resolver.define('saveConfig', async ({ payload, context }) => {
  try {
    const { configType, data } = payload;
    const userId = context.accountId;
    
    switch (configType) {
      case 'global':
        await storage.set('global_config', data);
        break;
      case 'fields':
        await storage.set('fields_config', data);
        break;
      case 'rules':
        await storage.set('priority_rules', JSON.stringify(data));
        break;
      case 'teams':
        await storage.set('escalation_teams', JSON.stringify(data));
        break;
      case 'mappings':
        await storage.set('team_mappings', JSON.stringify(data));
        break;
      case 'schedule':
        await storage.set('team_schedule', JSON.stringify(data));
        break;
      case 'webhooks':
        await storage.set('teams_webhooks', data);
        break;
      case 'escalation_rules':
        await storage.set('escalation_rules', JSON.stringify(data));
        break;
      default:
        return { success: false, error: 'Invalid config type' };
    }
    
    // Log audit entry
    await logAuditEntry({
      eventType: 'config_changed',
      userId: userId,
      details: {
        configType: configType,
        configChanges: data
      }
    });
    
    return {
      success: true,
      message: 'Configuration saved successfully'
    };
    
  } catch (error) {
    console.error('Error in saveConfig:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// TEST RULE
// ============================================================================
resolver.define('testRule', async ({ payload }) => {
  try {
    const { rule, testData } = payload;
    
    const matches = evaluateConditions(rule.conditions, testData);
    
    return {
      success: true,
      matches: matches,
      priority: matches ? rule.actions.setPriority : null
    };
    
  } catch (error) {
    console.error('Error in testRule:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET MY ALERTS
// ============================================================================
resolver.define('getMyIncidents', async ({ payload, context }) => {
  try {
    const accountId = context.accountId;
    const { projectKey, issueTypeId, showAll = false } = payload || {};
    
    console.log('getMyIncidents wywołane dla użytkownika:', accountId);
    console.log('getMyIncidents - projectKey:', projectKey, 'issueTypeId:', issueTypeId, 'showAll:', showAll);
    
    // Buduj JQL query z filtrowaniem po projekcie i typie zgłoszenia
    // Jeśli showAll jest true, nie filtruj po reporter
    let jql = showAll ? '' : `reporter = currentUser()`;
    
    if (projectKey) {
      jql += (jql ? ' AND ' : '') + `project = ${projectKey}`;
    }
    
    if (issueTypeId) {
      // Użyj ID typu zgłoszenia w JQL - issueTypeId to zawsze ID (liczba)
      // W JQL można użyć zarówno ID jak i nazwy, ale ID jest bardziej niezawodne
      jql += (jql ? ' AND ' : '') + `issuetype = ${issueTypeId}`;
    }
    
    // Pokaż wszystkie zgłoszenia (bez filtrowania po statusie)
    jql += (jql ? ' ' : '') + `ORDER BY created DESC`;
    
    console.log('getMyIncidents - JQL:', jql);
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql: jql,
        maxResults: 1000, // Zwiększone aby pobrać wszystkie zgłoszenia (paginacja po stronie frontendu)
        fields: ['summary', 'status', 'priority', 'created', 'assignee', 'project', 'issuetype', 'statuscategorychangedate', 'updated', 'statuscategory']
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('getMyIncidents - błąd API:', errorText);
      throw new Error(`Failed to fetch alerts: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('getMyIncidents - znaleziono zgłoszeń:', result.issues?.length || 0);
    
    if (!result.issues || result.issues.length === 0) {
      console.log('getMyIncidents - brak zgłoszeń dla użytkownika');
      return {
        success: true,
        incidents: []
      };
    }
    
    // Pobierz jiraInstanceUrl z konfiguracji projektu
    let jiraInstanceUrl = null;
    if (projectKey) {
      const projectConfig = await storage.get(`project_config_${projectKey}`);
      if (projectConfig && projectConfig.jiraInstanceUrl) {
        jiraInstanceUrl = projectConfig.jiraInstanceUrl;
        console.log('getMyIncidents - używam jiraInstanceUrl z konfiguracji:', jiraInstanceUrl);
      }
    }
    
    const incidents = result.issues.map(issue => {
      // Pobierz datę ostatniej zmiany statusu (statuscategorychangedate lub updated jako fallback)
      const statusChangedDate = issue.fields.statuscategorychangedate || issue.fields.updated || issue.fields.created;
      
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        statusId: issue.fields.status.id,
        statusCategory: issue.fields.status.statusCategory?.key || 'indeterminate', // Kategoria statusu: 'new', 'indeterminate', 'done'
        priority: issue.fields.priority?.name || 'None',
        created: issue.fields.created,
        assignee: issue.fields.assignee?.displayName || 'Nieprzypisane',
        assigneeAccountId: issue.fields.assignee?.accountId || null,
        assigneeEmail: issue.fields.assignee?.emailAddress || null,
        project: issue.fields.project?.key || '',
        statusChanged: statusChangedDate, // Data ostatniej zmiany statusu
        system: issue.fields.customfield_10100 || '-', // Fallback dla systemu jeśli istnieje
        environment: issue.fields.customfield_10101 || '-' // Fallback dla środowiska jeśli istnieje
      };
    });
    
    console.log('getMyIncidents - zwracam zgłoszenia:', incidents.map(i => i.key).join(', '));
    
    return {
      success: true,
      incidents,
      jiraInstanceUrl: jiraInstanceUrl, // Zwróć URL z konfiguracji
      currentUserAccountId: accountId // Zwróć account ID aktualnego użytkownika
    };
    
  } catch (error) {
    console.error('Error in getMyIncidents:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET AUDIT LOG
// ============================================================================
resolver.define('getAuditLog', async ({ payload }) => {
  try {
    const { limit = 100 } = payload;
    
    // Get all audit entries (in real implementation, paginate)
    const auditEntriesJson = await storage.get('audit_log') || '[]';
    const auditEntries = JSON.parse(auditEntriesJson);
    
    // Sort by timestamp descending
    const sorted = auditEntries.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    ).slice(0, limit);
    
    return {
      success: true,
      entries: sorted
    };
    
  } catch (error) {
    console.error('Error in getAuditLog:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET PROJECTS - Pobierz listę projektów dostępnych dla użytkownika
// ============================================================================
resolver.define('getProjects', async ({ context }) => {
  try {
    const response = await api.asUser().requestJira(
      route`/rest/api/3/project/search?maxResults=100`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch projects');
    }
    
    const data = await response.json();
    
    return {
      success: true,
      projects: data.values.map(p => ({
        id: p.id,
        key: p.key,
        name: p.name,
        projectTypeKey: p.projectTypeKey
      }))
    };
    
  } catch (error) {
    console.error('Error in getProjects:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET PROJECT ISSUE TYPES - Pobierz typy zgłoszeń dla projektu
// ============================================================================
resolver.define('getCurrentTeam', async ({ payload }) => {
  try {
    const { projectKey } = payload;
    
    if (!projectKey) {
      return { success: false, error: 'Project key is required' };
    }
    
    let teams = [];
    let schedule = [];
    
    // Pobierz z konfiguracji projektu
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (projectConfig) {
      if (projectConfig.escalationTeams) {
        teams = Array.isArray(projectConfig.escalationTeams) ? projectConfig.escalationTeams : [];
      }
      if (projectConfig.teamSchedule) {
        schedule = Array.isArray(projectConfig.teamSchedule) ? projectConfig.teamSchedule : [];
      }
    }
    
    // Fallback do globalnych danych
    if (teams.length === 0) {
      const teamsJson = await storage.get('escalation_teams') || '[]';
      teams = JSON.parse(teamsJson);
    }
    
    if (schedule.length === 0) {
      const scheduleJson = await storage.get('team_schedule') || '[]';
      schedule = JSON.parse(scheduleJson);
    }
    
    // Znajdź aktualny tydzień w harmonogramie
    if (schedule.length > 0) {
      const today = new Date();
      const currentWeek = schedule.find(week => {
        if (!week.startDate || !week.endDate) return false;
        const start = new Date(week.startDate);
        const end = new Date(week.endDate);
        return today >= start && today <= end;
      });
      
      if (currentWeek && currentWeek.teamId) {
        const team = teams.find(t => t.id === currentWeek.teamId);
        if (team) {
          // Pobierz informacje o osobie przypisanej jeśli jest Account ID
          let assignedPersonInfo = null;
          if (currentWeek.assignedPerson) {
            try {
              // Spróbuj pobrać informacje o użytkowniku z Jira
              const userResponse = await api.asUser().requestJira(
                route`/rest/api/3/user?accountId=${currentWeek.assignedPerson}`,
                {
                  method: 'GET',
                  headers: {
                    'Accept': 'application/json'
                  }
                }
              );
              
              if (userResponse.ok) {
                const user = await userResponse.json();
                assignedPersonInfo = {
                  accountId: user.accountId,
                  displayName: user.displayName,
                  emailAddress: user.emailAddress
                };
              }
            } catch (error) {
              console.error('Błąd pobierania informacji o użytkowniku:', error);
              // Jeśli nie można pobrać, użyj Account ID jako fallback
              assignedPersonInfo = {
                accountId: currentWeek.assignedPerson,
                displayName: currentWeek.assignedPerson,
                emailAddress: null
              };
            }
          }
          
          return {
            success: true,
            team: {
              id: team.id,
              name: team.name,
              description: team.description
            },
            assignedPerson: assignedPersonInfo
          };
        }
      }
    }
    
    return {
      success: true,
      team: null,
      assignedPerson: null
    };
    
  } catch (error) {
    console.error('Error in getCurrentTeam:', error);
    return { success: false, error: error.message };
  }
});

resolver.define('getProjectUsers', async ({ payload }) => {
  try {
    const { projectKey } = payload;
    
    if (!projectKey) {
      return { success: false, error: 'Project key is required' };
    }
    
    // Pobierz wszystkich użytkowników Jira (nie tylko przypisywalnych w projekcie)
    // Używamy /rest/api/3/user/search zamiast /rest/api/3/user/assignable/search
    // aby uzyskać wszystkich użytkowników, nie tylko tych z uprawnieniami w projekcie
    let allUsers = [];
    let startAt = 0;
    const maxResults = 1000; // Maksymalna liczba użytkowników na stronę
    
    while (true) {
      const response = await api.asUser().requestJira(
        route`/rest/api/3/user/search?startAt=${startAt}&maxResults=${maxResults}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Błąd pobierania użytkowników:', errorText);
        // Fallback: spróbuj pobrać tylko użytkowników z projektu
        console.log('Próba fallback do assignable/search dla projektu:', projectKey);
        const fallbackResponse = await api.asUser().requestJira(
          route`/rest/api/3/user/assignable/search?project=${projectKey}&maxResults=1000`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          }
        );
        
        if (fallbackResponse.ok) {
          const fallbackUsers = await fallbackResponse.json();
          const formattedUsers = fallbackUsers.map(user => ({
            accountId: user.accountId,
            displayName: user.displayName,
            emailAddress: user.emailAddress
          }));
          console.log(`getProjectUsers (fallback) - znaleziono ${formattedUsers.length} użytkowników`);
          return {
            success: true,
            users: formattedUsers
          };
        }
        
        return { success: false, error: `Failed to fetch users: ${errorText}` };
      }
      
      const users = await response.json();
      
      if (!users || users.length === 0) {
        break; // Brak więcej użytkowników
      }
      
      allUsers = allUsers.concat(users);
      
      // Jeśli zwrócono mniej niż maxResults, to są to ostatnie wyniki
      if (users.length < maxResults) {
        break;
      }
      
      startAt += maxResults;
      
      // Ograniczenie bezpieczeństwa - maksymalnie 5000 użytkowników
      if (allUsers.length >= 5000) {
        console.warn('Osiągnięto limit 5000 użytkowników');
        break;
      }
    }
    
    // Zwróć użytkowników z accountId, displayName i emailAddress
    // Filtruj tylko aktywnych użytkowników (bez deactivated)
    const formattedUsers = allUsers
      .filter(user => user.active !== false) // Tylko aktywni użytkownicy
      .map(user => ({
        accountId: user.accountId,
        displayName: user.displayName || user.displayName || 'Unknown',
        emailAddress: user.emailAddress
      }))
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')); // Sortuj alfabetycznie
    
    console.log(`getProjectUsers - znaleziono ${formattedUsers.length} użytkowników`);
    
    return {
      success: true,
      users: formattedUsers
    };
    
  } catch (error) {
    console.error('Error in getProjectUsers:', error);
    // W przypadku błędu, spróbuj fallback do assignable/search
    try {
      const { projectKey } = payload;
      if (projectKey) {
        console.log('Próba fallback do assignable/search po błędzie');
        const fallbackResponse = await api.asUser().requestJira(
          route`/rest/api/3/user/assignable/search?project=${projectKey}&maxResults=1000`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          }
        );
        
        if (fallbackResponse.ok) {
          const fallbackUsers = await fallbackResponse.json();
          const formattedUsers = fallbackUsers.map(user => ({
            accountId: user.accountId,
            displayName: user.displayName,
            emailAddress: user.emailAddress
          }));
          console.log(`getProjectUsers (fallback po błędzie) - znaleziono ${formattedUsers.length} użytkowników`);
          return {
            success: true,
            users: formattedUsers
          };
        }
      }
    } catch (fallbackError) {
      console.error('Error in fallback:', fallbackError);
    }
    
    return { success: false, error: error.message };
  }
});

resolver.define('getProjectIssueTypes', async ({ payload }) => {
  try {
    const { projectKey } = payload;
    
    const response = await api.asUser().requestJira(
      route`/rest/api/3/project/${projectKey}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch project details');
    }
    
    const project = await response.json();
    
    return {
      success: true,
      issueTypes: project.issueTypes.map(it => ({
        id: it.id,
        name: it.name,
        description: it.description,
        iconUrl: it.iconUrl
      })),
      projectName: project.name // Zwróć też nazwę projektu
    };
    
  } catch (error) {
    console.error('Error in getProjectIssueTypes:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET PROJECT NAME - Pobierz nazwę projektu po kluczu
// ============================================================================
resolver.define('getProjectName', async ({ payload }) => {
  try {
    const { projectKey } = payload;
    
    if (!projectKey) {
      return {
        success: false,
        error: 'Project key is required'
      };
    }
    
    // Sprawdź najpierw czy w konfiguracji projektu jest ustawiona ikona
    let projectIcon = null;
    try {
      const configKey = `project_config_${projectKey}`;
      const configData = await storage.get(configKey);
      if (configData && configData.projectIconUrl) {
        projectIcon = configData.projectIconUrl;
        console.log('Używam ikony z konfiguracji:', projectIcon);
      }
    } catch (configError) {
      console.warn('Nie udało się pobrać ikony z konfiguracji:', configError);
    }
    
    // Spróbuj najpierw asApp() dla lepszych uprawnień, jeśli nie zadziała, użyj asUser()
    let response;
    let project;
    
    try {
      response = await api.asApp().requestJira(
        route`/rest/api/3/project/${projectKey}`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch project details with asApp()');
      }
      
      project = await response.json();
    } catch (appError) {
      // Fallback do asUser() jeśli asApp() nie działa
      console.log('asApp() nie zadziałało, używam asUser() jako fallback:', appError);
      response = await api.asUser().requestJira(
        route`/rest/api/3/project/${projectKey}`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch project details');
      }
      
      project = await response.json();
    }
    
    // Jeśli nie mamy ikony z konfiguracji, pobierz z avatarUrls
    if (!projectIcon) {
      try {
        console.log('Project avatarUrls:', project.avatarUrls);
        // Spróbuj pobrać ikonę w kolejności: 48x48, 32x32, 24x24
        if (project.avatarUrls && project.avatarUrls['48x48']) {
          projectIcon = project.avatarUrls['48x48'];
          console.log('Używam ikony 48x48 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['32x32']) {
          projectIcon = project.avatarUrls['32x32'];
          console.log('Używam ikony 32x32 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['24x24']) {
          projectIcon = project.avatarUrls['24x24'];
          console.log('Używam ikony 24x24 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['16x16']) {
          projectIcon = project.avatarUrls['16x16'];
          console.log('Używam ikony 16x16 z API:', projectIcon);
        } else {
          console.warn('Brak dostępnych ikon w avatarUrls');
        }
      } catch (iconError) {
        console.warn('Nie udało się pobrać ikony projektu z API:', iconError);
        projectIcon = null;
      }
    }
    
    return {
      success: true,
      projectName: project.name,
      projectKey: project.key,
      projectIcon: projectIcon
    };
    
  } catch (error) {
    console.error('Error in getProjectName:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET CONFIGURED PROJECTS - Pobierz listę skonfigurowanych projektów
// ============================================================================
resolver.define('getConfiguredProjects', async ({ payload }) => {
  try {
    // Pobierz wszystkie klucze z storage które zaczynają się od "project_config_"
    // W Forge Storage nie ma bezpośredniego sposobu na listowanie kluczy,
    // więc musimy pobrać wszystkie projekty i sprawdzić które mają konfigurację
    
    // Pobierz wszystkie projekty dostępne dla użytkownika
    const projectsResponse = await api.asUser().requestJira(
      route`/rest/api/3/project/search?maxResults=100`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!projectsResponse.ok) {
      throw new Error('Failed to fetch projects');
    }
    
    const projectsData = await projectsResponse.json();
    const allProjects = projectsData.values || [];
    
    // Sprawdź które projekty mają konfigurację
    const configuredProjects = [];
    
    for (const project of allProjects) {
      try {
        const projectConfig = await storage.get(`project_config_${project.key}`);
        if (projectConfig && projectConfig.incidentIssueTypeId) {
          // Projekt ma konfigurację - dodaj do listy
          configuredProjects.push({
            key: project.key,
            name: project.name,
            icon: project.avatarUrls?.['48x48'] || project.avatarUrls?.['32x32'] || project.avatarUrls?.['24x24'] || null
          });
        }
      } catch (error) {
        // Ignoruj błędy dla pojedynczych projektów
        console.warn(`Nie udało się sprawdzić konfiguracji dla projektu ${project.key}:`, error);
      }
    }
    
    return {
      success: true,
      projects: configuredProjects
    };
    
  } catch (error) {
    console.error('Error in getConfiguredProjects:', error);
    return {
      success: false,
      error: error.message,
      projects: []
    };
  }
});

// ============================================================================
// GET ISSUE TYPE FIELDS - Pobierz dostępne pola dla typu zgłoszenia
// ============================================================================
resolver.define('getIssueTypeFields', async ({ payload }) => {
  try {
    const { projectKey, issueTypeId } = payload;
    
    if (!projectKey || !issueTypeId) {
      return {
        success: false,
        error: 'Project key and issue type ID are required'
      };
    }
    
    // Pobierz metadane tworzenia issue dla projektu i typu zgłoszenia
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch issue type fields');
    }
    
    const metadata = await response.json();
    
    // Wyciągnij pola dla danego typu zgłoszenia
    let fields = {};
    if (metadata.projects && metadata.projects.length > 0) {
      const project = metadata.projects[0];
      if (project.issuetypes && project.issuetypes.length > 0) {
        const issueType = project.issuetypes.find(it => it.id === issueTypeId);
        if (issueType && issueType.fields) {
          fields = issueType.fields;
        }
      }
    }
    
    // Przekształć pola na listę z informacjami
    const fieldsList = Object.entries(fields)
      .filter(([fieldId, fieldData]) => {
        // Wyklucz pola systemowe które nie powinny być edytowane przez użytkownika
        const excludedFields = ['summary', 'description', 'reporter', 'assignee', 'priority', 'status', 'created', 'updated', 'resolution', 'project', 'issuetype'];
        return !excludedFields.includes(fieldId);
      })
      .map(([fieldId, fieldData]) => {
        // Wyciągnij allowedValues jeśli istnieją
        let allowedValues = null;
        if (fieldData.allowedValues && Array.isArray(fieldData.allowedValues)) {
          allowedValues = fieldData.allowedValues.map(av => {
            if (typeof av === 'object') {
              return {
                id: av.id || av.value,
                name: av.name || av.value || av.displayName,
                value: av.value || av.id
              };
            }
            return { id: av, name: av, value: av };
          });
        }
        
        return {
          id: fieldId,
          name: fieldData.name,
          type: fieldData.schema?.type || 'unknown',
          required: fieldData.required || false,
          allowedValues: allowedValues,
          hasDefaultValue: fieldData.hasDefaultValue || false
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      success: true,
      fields: fieldsList
    };
    
  } catch (error) {
    console.error('Error in getIssueTypeFields:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET PROJECT CONFIG - Pobierz konfigurację dla konkretnego projektu
// ============================================================================
resolver.define('getProjectConfig', async ({ payload }) => {
  try {
    const { projectKey } = payload;
    
    const configKey = `project_config_${projectKey}`;
    let config = await storage.get(configKey);
    
    if (!config) {
      // Zwróć domyślną konfigurację
      config = {
        projectKey: projectKey,
        incidentIssueTypeId: null,
        defaultPriority: 'P3',
        enableAutoProcessing: true,
        fieldsConfig: getDefaultFieldsConfig(),
        priorityRules: [],
        escalationRules: [],
        escalationTeams: [],
        teamSchedule: [],
        teamsWebhooks: {}
      };
    } else {
      // Upewnij się, że wszystkie pola istnieją (dla kompatybilności wstecznej)
      if (!config.priorityRules) config.priorityRules = [];
      if (!config.escalationRules) config.escalationRules = [];
      if (!config.escalationTeams) config.escalationTeams = [];
      if (!config.teamSchedule) config.teamSchedule = [];
      if (!config.teamsWebhooks) config.teamsWebhooks = {};
    }
    
    return {
      success: true,
      config: config
    };
    
  } catch (error) {
    console.error('Error in getProjectConfig:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// SAVE PROJECT CONFIG - Zapisz konfigurację dla projektu
// ============================================================================
resolver.define('saveProjectConfig', async ({ payload, context }) => {
  try {
    const { projectKey, config } = payload;
    const userId = context.accountId;
    
    const configKey = `project_config_${projectKey}`;
    await storage.set(configKey, config);
    
    await logAuditEntry({
      eventType: 'project_config_updated',
      issueKey: null,
      userId: userId,
      details: {
        projectKey: projectKey,
        timestamp: new Date().toISOString()
      }
    });
    
    return {
      success: true,
      message: 'Konfiguracja projektu zapisana'
    };
    
  } catch (error) {
    console.error('Error in saveProjectConfig:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function validateAlertData(formData, fieldsConfig) {
  const fields = fieldsConfig?.fields || getDefaultFieldsConfig().fields;
  
  if (fields.system && fields.system.required && !formData.system) {
    return { valid: false, error: 'System/Service is required' };
  }
  if (fields.environment && fields.environment.required && !formData.environment) {
    return { valid: false, error: 'Environment is required' };
  }
  if (!formData.description || formData.description.length < 10) {
    return { valid: false, error: 'Description must be at least 10 characters' };
  }
  
  return { valid: true };
}

function buildDescription(formData, accountId, fieldsConfig) {
  const content = [];
  
  // Dodaj główny opis jeśli istnieje
  if (formData.description) {
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Opis Alertu' }]
    });
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: formData.description }]
    });
  }
  
  // Dodaj szczegóły z pól formularza (oprócz description)
  const details = [];
  if (fieldsConfig && fieldsConfig.configuredFields) {
    const configuredFields = fieldsConfig.configuredFields.filter(f => f.enabled && f.id !== 'description');
    
    for (const field of configuredFields) {
      const value = formData[field.id];
      if (value !== undefined && value !== null && value !== '') {
        let displayValue = String(value);
        if (typeof value === 'object' && value.name) {
          displayValue = value.name;
        } else if (typeof value === 'object' && value.value) {
          displayValue = value.value;
        }
        
        details.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `${field.name}: `, marks: [{ type: 'strong' }] },
                { type: 'text', text: displayValue }
              ]
            }
          ]
        });
      }
    }
  } else {
    // Fallback dla starych danych
    if (formData.system) {
      details.push({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'System: ', marks: [{ type: 'strong' }] },
              { type: 'text', text: formData.system }
            ]
          }
        ]
      });
    }
    if (formData.environment) {
      details.push({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Środowisko: ', marks: [{ type: 'strong' }] },
              { type: 'text', text: formData.environment }
            ]
          }
        ]
      });
    }
  }
  
  if (details.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Szczegóły' }]
    });
    content.push({
      type: 'bulletList',
      content: details
    });
  }
  
  // Jeśli brak treści, dodaj podstawowy opis
  if (content.length === 0) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Alert utworzony przez użytkownika' }]
    });
  }
  
  return {
    type: 'doc',
    version: 1,
    content: content
  };
}

function extractAlertData(issue, fieldsConfig) {
  const data = {
    system: null,
    environment: null,
    impact: null,
    urgency: null,
    priority: null,
    summary: null,
    description: null
  };
  
  // Ekstrahuj standardowe pola Jira
  if (issue.fields.priority) {
    // Priority może być obiektem z name lub stringiem
    let priorityValue = issue.fields.priority.name || issue.fields.priority;
    
    // Mapowanie wartości priorytetów z Jira na wartości używane w formularzu
    // (np. "Critical"/"Krytyczny" -> "Highest", "Major" -> "High")
    const jiraToFormMapping = {
      'Critical': 'Highest',
      'Highest': 'Highest',
      'Blocker': 'Highest',
      'Krytyczny': 'Highest',
      'Najwyższy': 'Highest',
      'Major': 'High',
      'High': 'High',
      'Wysoki': 'High',
      'Normal': 'Medium',
      'Medium': 'Medium',
      'Średni': 'Medium',
      'Minor': 'Low',
      'Low': 'Low',
      'Niski': 'Low',
      'Trivial': 'Lowest',
      'Lowest': 'Lowest',
      'Najniższy': 'Lowest'
    };
    
    // Jeśli wartość z Jira jest w mapowaniu, użyj wartości z formularza
    if (jiraToFormMapping[priorityValue]) {
      priorityValue = jiraToFormMapping[priorityValue];
    }
    
    data.priority = priorityValue;
    console.log(`extractAlertData - priority extracted: "${issue.fields.priority.name || issue.fields.priority}" -> "${data.priority}"`);
  }
  if (issue.fields.summary) {
    data.summary = issue.fields.summary;
  }
  if (issue.fields.description) {
    // Opis może być w formacie ADF (Atlassian Document Format) lub string
    if (typeof issue.fields.description === 'string') {
      data.description = issue.fields.description;
    } else if (issue.fields.description.content) {
      // Ekstrahuj tekst z ADF
      const extractText = (content) => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content.map(c => extractText(c)).join(' ');
        }
        if (content.text) return content.text;
        if (content.content) return extractText(content.content);
        return '';
      };
      data.description = extractText(issue.fields.description.content);
    }
  }
  
  // Ekstrahuj skonfigurowane pola niestandardowe
  if (fieldsConfig && fieldsConfig.configuredFields) {
    const configuredFields = fieldsConfig.configuredFields.filter(f => f.enabled);
    
    for (const field of configuredFields) {
      const fieldValue = issue.fields[field.id];
      
      if (fieldValue !== undefined && fieldValue !== null) {
        // Obsługa różnych typów pól
        if (field.type === 'option' || (fieldValue && typeof fieldValue === 'object' && fieldValue.name)) {
          // Pole opcji - użyj name
          data[field.id] = fieldValue.name || fieldValue.value || fieldValue;
        } else if (Array.isArray(fieldValue)) {
          // Tablica wartości
          data[field.id] = fieldValue.map(v => v.name || v.value || v);
        } else {
          // Zwykła wartość
          data[field.id] = fieldValue;
        }
      }
    }
  }
  
  // Stare mapowania (dla kompatybilności wstecznej)
  if (fieldsConfig && fieldsConfig.customFieldMappings) {
    const mappings = fieldsConfig.customFieldMappings;
    
    if (mappings.system) {
      data.system = issue.fields[mappings.system];
    }
    if (mappings.environment) {
      data.environment = issue.fields[mappings.environment];
    }
    if (mappings.impact) {
      data.impact = issue.fields[mappings.impact];
    }
    if (mappings.urgency) {
      data.urgency = issue.fields[mappings.urgency];
    }
  }
  
  return data;
}

async function logAuditEntry(entry) {
  try {
    const auditEntriesJson = await storage.get('audit_log') || '[]';
    const auditEntries = JSON.parse(auditEntriesJson);
    
    const newEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      ...entry
    };
    
    auditEntries.push(newEntry);
    
    // Keep only last 1000 entries
    if (auditEntries.length > 1000) {
      auditEntries.splice(0, auditEntries.length - 1000);
    }
    
    await storage.set('audit_log', JSON.stringify(auditEntries));
  } catch (error) {
    console.error('Failed to log audit entry:', error);
  }
}

function getDefaultGlobalConfig() {
  return {
    targetProjectKey: '',
    incidentIssueTypeId: '',
    defaultPriority: 'P3',
    enableAuditLog: true,
    enableTeamsIntegration: true,
    jiraInstanceUrl: ''
  };
}

function getDefaultFieldsConfig() {
  return {
    fields: {
      system: {
        required: true,
        label: 'System/Service',
        options: ['Payment Gateway', 'API', 'Database', 'Web Application', 'Mobile App', 'Other']
      },
      environment: {
        required: true,
        options: ['Production', 'UAT', 'Development', 'Staging', 'Other']
      },
      impact: {
        required: true,
        options: ['Critical', 'High', 'Medium', 'Low']
      },
      urgency: {
        required: true,
        options: ['Immediate', 'High', 'Medium', 'Low']
      }
    },
    customFieldMappings: {
      system: '',
      environment: '',
      impact: '',
      urgency: '',
      calculatedPriority: '',
      assignedTeam: ''
    }
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TRIGGER HANDLER - Process Alert on Creation
// ============================================================================
resolver.define('processIncidentTrigger', async ({ payload, context }) => {
  try {
    const { issue } = payload;
    
    // Check if this is an Alert issue type
    const config = await storage.get('global_config');
    if (!config || !config.incidentIssueTypeId) {
      return { success: false, error: 'Config not found' };
    }
    
    if (issue.fields.issuetype.id !== config.incidentIssueTypeId) {
      return { success: true, message: 'Not an alert, skipping' };
    }
    
    // Process the alert (calculate priority, assign team, send notifications)
    await processIncidentLogic(issue.key, context.accountId || 'system');
    
    return { success: true, message: 'Alert processed' };
  } catch (error) {
    console.error('Trigger error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// GET STATISTICS
// ============================================================================
resolver.define('getStatistics', async ({ payload, context }) => {
  try {
    const { projectKey, issueTypeId, timeRange, priorities } = payload || {};
    
    if (!projectKey || !issueTypeId) {
      return {
        success: false,
        error: 'Brak wymaganych parametrów: projectKey, issueTypeId'
      };
    }
    
    // Oblicz datę początkową na podstawie timeRange
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '180days':
        startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Domyślnie 30 dni
    }
    
    const dateStr = startDate.toISOString().split('T')[0];
    
    // Pobierz wszystkie zgłoszenia w przedziale czasowym
    let jql = `project = ${projectKey} AND issuetype = ${issueTypeId} AND created >= "${dateStr}"`;
    // Filtrowanie po priorytecie
    if (priorities && Array.isArray(priorities) && priorities.length > 0) {
      const priorityNames = priorities.map(p => `"${p}"`).join(', ');
      jql += ` AND priority IN (${priorityNames})`;
    }
    jql += ` ORDER BY created DESC`;
    
    console.log('getStatistics - JQL:', jql);
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql: jql,
        maxResults: 5000, // Zwiększone dla dłuższych okresów
        fields: ['summary', 'status', 'priority', 'created', 'updated', 'assignee', 'resolutiondate', 'issuetype']
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('getStatistics - błąd API:', errorText);
      throw new Error(`Failed to fetch issues: ${errorText}`);
    }
    
    const result = await response.json();
    const issues = result.issues || [];
    
    console.log(`getStatistics - znaleziono ${issues.length} zgłoszeń`);
    
    // Pobierz konfigurację projektu dla mapowania modułu aplikacji
    const projectConfig = await storage.get(`project_config_${projectKey}`) || {};
    const moduleFieldId = projectConfig.moduleFieldMapping || null;
    
    // Pobierz historię zmian dla każdego zgłoszenia (dla SLA i czasu w statusie)
    const statistics = {
      sla: {
        avgTimeToFirstAction: 0,
        avgTimeToResolution: 0,
        totalResolved: 0,
        totalWithFirstAction: 0
      },
      timeInStatus: {},
      trend: {},
      modules: {}
    };
    
    let totalTimeToFirstAction = 0;
    let totalTimeToResolution = 0;
    let resolvedCount = 0;
    let firstActionCount = 0;
    const statusTimes = {};
    const trendData = {};
    const moduleData = {};
    
    // NAJPIERW: Zbierz dane trendu i modułów dla WSZYSTKICH zgłoszeń (nie wymagają changelog)
    issues.forEach(issue => {
      // Trend zgłoszeń (grupowanie po datach i priorytetach)
      const createdDate = new Date(issue.fields.created);
      const dateKey = createdDate.toISOString().split('T')[0];
      const priority = issue.fields.priority?.name || 'None';
      
      if (!trendData[dateKey]) {
        trendData[dateKey] = {};
      }
      if (!trendData[dateKey][priority]) {
        trendData[dateKey][priority] = 0;
      }
      trendData[dateKey][priority]++;
      
      // Moduł aplikacji
      if (moduleFieldId) {
        const moduleValue = issue.fields[moduleFieldId] || issue.fields[`customfield_${moduleFieldId}`];
        if (moduleValue) {
          const moduleName = typeof moduleValue === 'string' ? moduleValue : (moduleValue.value || moduleValue.name || 'Unknown');
          if (!moduleData[moduleName]) {
            moduleData[moduleName] = 0;
          }
          moduleData[moduleName]++;
        }
      }
    });
    
    // TERAZ: Pobierz changelog tylko dla ograniczonej liczby zgłoszeń (dla SLA i czasu w statusie)
    // Ograniczenie liczby przetwarzanych zgłoszeń dla wydajności
    // Dla dłuższych okresów przetwarzamy mniej zgłoszeń
    let maxIssuesToProcess = 100;
    if (timeRange === '180days') {
      maxIssuesToProcess = 50; // Mniej dla długich okresów
    }
    
    // Pobierz changelog dla każdego zgłoszenia (w pętli, ale z ograniczeniem)
    for (let i = 0; i < Math.min(issues.length, maxIssuesToProcess); i++) {
      const issue = issues[i];
      
      try {
        // Pobierz changelog
        const changelogResponse = await api.asUser().requestJira(
          route`/rest/api/3/issue/${issue.key}/changelog`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          }
        );
        
        if (changelogResponse.ok) {
          const changelog = await changelogResponse.json();
          const histories = changelog.values || [];
          
          // Znajdź pierwsze podjęcie (przypisanie lub zmiana statusu z "New"/"To Do")
          let firstActionDate = null;
          let resolutionDate = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
          let createdDate = new Date(issue.fields.created);
          
          // Przejdź przez historię zmian
          for (const history of histories) {
            const historyDate = new Date(history.created);
            
            // Sprawdź czy to pierwsze podjęcie (przypisanie lub zmiana statusu)
            if (!firstActionDate) {
              for (const item of history.items || []) {
                if (item.field === 'assignee' && item.toString) {
                  firstActionDate = historyDate;
                  break;
                }
                if (item.field === 'status' && item.fromString && 
                    (item.fromString === 'New' || item.fromString === 'To Do' || item.fromString === 'Nowe' || item.fromString === 'Do zrobienia')) {
                  firstActionDate = historyDate;
                  break;
                }
              }
            }
            
            // Oblicz czas w każdym statusie
            for (const item of history.items || []) {
              if (item.field === 'status') {
                const fromStatus = item.fromString;
                const toStatus = item.toString;
                const statusChangeDate = historyDate;
                
                if (fromStatus && !statusTimes[fromStatus]) {
                  statusTimes[fromStatus] = { total: 0, count: 0 };
                }
                
                // Znajdź poprzednią zmianę statusu dla tego zgłoszenia
                let previousStatusChange = createdDate;
                for (const prevHistory of histories) {
                  if (new Date(prevHistory.created) < statusChangeDate) {
                    for (const prevItem of prevHistory.items || []) {
                      if (prevItem.field === 'status' && prevItem.toString === fromStatus) {
                        previousStatusChange = new Date(prevHistory.created);
                        break;
                      }
                    }
                  }
                }
                
                if (fromStatus) {
                  const timeInStatus = statusChangeDate - previousStatusChange;
                  statusTimes[fromStatus].total += timeInStatus;
                  statusTimes[fromStatus].count += 1;
                }
              }
            }
          }
          
          // Oblicz SLA
          if (firstActionDate) {
            const timeToFirstAction = firstActionDate - createdDate;
            totalTimeToFirstAction += timeToFirstAction;
            firstActionCount++;
          }
          
          if (resolutionDate) {
            const timeToResolution = resolutionDate - (firstActionDate || createdDate);
            if (timeToResolution > 0) {
              totalTimeToResolution += timeToResolution;
              resolvedCount++;
            }
          }
        }
      } catch (error) {
        console.warn(`Błąd pobierania changelog dla ${issue.key}:`, error.message);
      }
    }
    
    // Oblicz średnie SLA
    if (firstActionCount > 0) {
      statistics.sla.avgTimeToFirstAction = totalTimeToFirstAction / firstActionCount;
      statistics.sla.totalWithFirstAction = firstActionCount;
    }
    if (resolvedCount > 0) {
      statistics.sla.avgTimeToResolution = totalTimeToResolution / resolvedCount;
      statistics.sla.totalResolved = resolvedCount;
    }
    
    // Oblicz średni czas w statusie
    for (const [status, data] of Object.entries(statusTimes)) {
      if (data.count > 0) {
        statistics.timeInStatus[status] = data.total / data.count;
      }
    }
    
    // Przygotuj dane trendu
    statistics.trend = trendData;
    
    // Przygotuj dane modułów
    statistics.modules = moduleData;
    
    console.log('getStatistics - trendData entries:', Object.keys(trendData).length);
    console.log('getStatistics - sample trendData:', Object.entries(trendData).slice(0, 5));
    console.log('getStatistics - totalIssues:', issues.length);
    
    return {
      success: true,
      statistics: statistics,
      totalIssues: issues.length
    };
    
  } catch (error) {
    console.error('Error in getStatistics:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// TEST TEAMS WEBHOOK
// ============================================================================
resolver.define('testTeamsWebhook', async ({ payload }) => {
  try {
    const { webhookUrl, projectKey } = payload;
    
    if (!webhookUrl) {
      return { success: false, error: 'Webhook URL is required' };
    }
    
    console.log('Testowanie webhooka Teams:', webhookUrl);
    console.log('Project key:', projectKey);
    
    // Pobierz jiraInstanceUrl z konfiguracji projektu lub globalnej
    let jiraInstanceUrl = null;
    if (projectKey) {
      const projectConfig = await storage.get(`project_config_${projectKey}`);
      if (projectConfig && projectConfig.jiraInstanceUrl) {
        jiraInstanceUrl = projectConfig.jiraInstanceUrl;
      }
    }
    
    if (!jiraInstanceUrl) {
      const globalConfig = await storage.get('global_config');
      jiraInstanceUrl = globalConfig?.jiraInstanceUrl;
    }
    
    const jiraBaseUrl = jiraInstanceUrl ? `https://${jiraInstanceUrl.replace(/^https?:\/\//, '')}` : 'https://your-instance.atlassian.net';
    
    // Utwórz testową wiadomość
    const testPayload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '0078d4',
      summary: '🧪 Test webhooka Teams',
      sections: [
        {
          activityTitle: '🧪 Test webhooka Teams',
          activitySubtitle: 'To jest testowa wiadomość z systemu zarządzania alertami',
          facts: [
            { name: 'Status:', value: 'Test połączenia' },
            { name: 'Czas:', value: new Date().toLocaleString('pl-PL') },
            { name: 'Projekt:', value: projectKey || 'Globalny' }
          ],
          markdown: true
        }
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'Otwórz Jira',
          targets: [
            { os: 'default', uri: jiraBaseUrl }
          ]
        }
      ]
    };
    
    console.log('Wysyłam testową wiadomość do Teams...');
    console.log('Payload:', JSON.stringify(testPayload));
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    
    console.log('Odpowiedź z Teams webhook:', response.status, response.statusText);
    
    if (response.ok) {
      const responseText = await response.text();
      console.log('Odpowiedź z Teams (sukces):', responseText);
      return { 
        success: true, 
        message: 'Testowa wiadomość wysłana pomyślnie. Sprawdź kanał Teams.' 
      };
    } else {
      const errorText = await response.text();
      console.error('Błąd odpowiedzi z Teams webhook:', response.status, errorText);
      return { 
        success: false, 
        error: `Webhook zwrócił błąd ${response.status}: ${errorText || response.statusText}` 
      };
    }
    
  } catch (error) {
    console.error('Błąd podczas testowania webhooka Teams:', error);
    return { 
      success: false, 
      error: `Błąd połączenia: ${error.message}` 
    };
  }
});

// Export handler for resolver functions
export const handler = resolver.getDefinitions();

