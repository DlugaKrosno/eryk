import Resolver from '@forge/resolver';
import api, { route, fetch } from '@forge/api';
// kvs zastępuje przestarzały storage z @forge/api; alias zachowuje dotychczasowe wywołania
import { kvs as storage } from '@forge/kvs';
import {
  asArray, findDutyEntry, resolveDomainTeam, domainIdFromLabels, pickDomainId,
  collectWatchers, redactTeamSecrets, extractMetricValues,
  editableTeamIds, validateSchedule, mergeSchedule, domainFieldPayload
} from './routing.js';
import { extractTerms, rankCandidates, suggestDomain, toCandidate, adfToText } from './similarity.js';
import {
  PRIORITIES, businessMinutesBetween, planActions, freshState, isTaken, validatePolicy, withDefaults
} from './escalation.js';

const resolver = new Resolver();

// Szczegółowe logi (zawierają dane alertów i konfiguracji) włącza się zmienną DEBUG_LOGS=true:
// forge variables set DEBUG_LOGS true -e <środowisko>. Błędy i ostrzeżenia logujemy zawsze.
const DEBUG = process.env.DEBUG_LOGS === 'true';
const debug = (...args) => { if (DEBUG) console.log(...args); };

// ============================================================================
// AUTORYZACJA - konfigurację zmienia tylko administrator Jiry lub projektu
// ============================================================================
async function isConfigAdmin(projectKey = null) {
  try {
    // route` koduje każdą wstawioną wartość, więc parametry muszą być osobnymi interpolacjami
    const response = projectKey
      ? await api.asUser().requestJira(
          route`/rest/api/3/mypermissions?permissions=ADMINISTER,ADMINISTER_PROJECTS&projectKey=${projectKey}`,
          { headers: { 'Accept': 'application/json' } })
      : await api.asUser().requestJira(
          route`/rest/api/3/mypermissions?permissions=ADMINISTER`,
          { headers: { 'Accept': 'application/json' } });
    if (!response.ok) return false;
    const { permissions = {} } = await response.json();
    return Object.values(permissions).some(p => p.havePermission);
  } catch (error) {
    console.error('Błąd sprawdzania uprawnień:', error);
    return false;
  }
}

const NO_ADMIN_RESPONSE = { success: false, error: 'Brak uprawnień: ta operacja wymaga administratora Jiry lub projektu' };

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
      debug('Używam projektu z kontekstu:', targetProjectKey);
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
      debug('Używam domyślnej konfiguracji dla projektu:', targetProjectKey);
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
        error: `Typ alertu nie jest skonfigurowany dla projektu ${config.projectKey}. Skonfiguruj w panelu administratora.`
      };
    }
    
    // Walidacja wymaganych pól na podstawie konfiguracji
    if (config.fieldsConfig && config.fieldsConfig.configuredFields) {
      // Pole domeny wypełnia wybór kategorii (osobno walidowany), więc nie sprawdzamy go jak zwykłego pola formularza
      const requiredFields = config.fieldsConfig.configuredFields.filter(f => f.enabled && f.required && f.id !== config.domainFieldId);
      
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
    
    // Domena (kategoria) zgłoszenia -> zespół. Wymagana, jeśli projekt ma zdefiniowane domeny.
    const projectDomains = asArray((await storage.get(`project_config_${config.projectKey}`))?.domains)
      .filter(d => d.enabled !== false);
    if (projectDomains.length > 0) {
      if (!formData.domain || !projectDomains.some(d => d.id === formData.domain)) {
        return { success: false, error: 'Wybierz kategorię (domenę) alertu' };
      }
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
    
    // Domena jako label - dzięki temu zgłoszenie "pamięta" domenę także przy przetwarzaniu z triggera
    if (formData.domain) {
      issuePayload.fields.labels = [formData.domain];
    }
    
    // Dodaj skonfigurowane pola z formularza
    if (config.fieldsConfig && config.fieldsConfig.configuredFields) {
      const configuredFields = config.fieldsConfig.configuredFields.filter(f => f.enabled);
      
      // Priorytet nie jest ustawiany przy tworzeniu - wylicza go silnik reguł (updateIssueWithResults)
      
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
                        debug(`Priority allowedValues fetched from API:`, allowedValues.map(av => av.name || av.value));
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
              debug(`Priority mapping - searching for: "${fieldValue}" with terms:`, searchTerms);
              debug(`Priority allowedValues available:`, allowedValues.map(av => ({ id: av.id, name: av.name, value: av.value })));
              
              let matchedOption = null;
              // Spróbuj znaleźć dokładną nazwę priorytetu w allowedValues
              if (allowedValues.length > 0) {
                matchedOption = allowedValues.find(av => {
                  const avName = (av.name || av.value || '').toString();
                  const avId = String(av.id || '');
                  const searchValue = String(fieldValue);
                  
                  // Sprawdź dokładne dopasowanie
                  if (avName === searchValue || avId === searchValue || av.value === searchValue) {
                    debug(`Priority exact match found: "${avName}" (id: ${av.id})`);
                    return true;
                  }
                  
                  // Sprawdź mapowanie (np. Highest -> Critical/Krytyczny)
                  const mappingMatch = searchTerms.some(term => {
                    const termLower = term.toLowerCase();
                    const avNameLower = avName.toLowerCase();
                    const match = avNameLower === termLower || avId === term;
                    if (match) {
                      debug(`Priority mapping match found: "${term}" -> "${avName}" (id: ${av.id})`);
                    }
                    return match;
                  });
                  
                  if (mappingMatch) {
                    return true;
                  }
                  
                  // Sprawdź case-insensitive
                  if (avName.toLowerCase() === searchValue.toLowerCase()) {
                    debug(`Priority case-insensitive match found: "${avName}" (id: ${av.id})`);
                    return true;
                  }
                  
                  return false;
                });
                
                if (matchedOption) {
                  // Użyj id jeśli jest dostępne, w przeciwnym razie name
                  if (matchedOption.id) {
                    priorityName = String(matchedOption.id);
                    debug(`✓ Priority mapped: "${fieldValue}" -> id: "${priorityName}"`);
                  } else {
                    priorityName = matchedOption.name || matchedOption.value || priorityName;
                    debug(`✓ Priority mapped: "${fieldValue}" -> name: "${priorityName}"`);
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
                        debug(`✓ Priority fallback mapped: "${fieldValue}" -> id: "${priorityName}"`);
                      } else {
                        priorityName = fallbackOption.name || fallbackOption.value || priorityName;
                        debug(`✓ Priority fallback mapped: "${fieldValue}" -> name: "${priorityName}"`);
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
                debug(`Priority final value set - using ID: "${priorityName}"`);
              } else {
                issuePayload.fields[field.id] = {
                  name: priorityName
                };
                debug(`Priority final value set - using name: "${priorityName}"`);
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
    
    // Pole domeny w Jirze: ustawiamy je przy tworzeniu, jeśli jest na ekranie tworzenia (może być tam wymagane).
    // W przeciwnym razie zostaje ustawienie po utworzeniu (poniżej).
    const selectedDomain = projectDomains.find(d => d.id === formData.domain);
    const domainOptionId = selectedDomain ? selectedDomain.optionId : undefined;
    const hasDomainOption = !!config.domainFieldId && domainOptionId !== undefined && domainOptionId !== null;
    let domainFieldInPayload = false;
    if (hasDomainOption && await isFieldOnCreateScreen(config.projectKey, config.incidentIssueTypeId, config.domainFieldId)) {
      issuePayload.fields[config.domainFieldId] = domainFieldPayload(domainOptionId, config.domainFieldMulti);
      domainFieldInPayload = true;
    }

    debug('Final issue payload:', JSON.stringify(issuePayload, null, 2));
    
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
        error: `Nie udało się utworzyć alertu: ${errorDetails}`
      };
    }
    
    const result = await response.json();
    
    if (formData.domain) {
      await storage.set(`issue_domain_${result.key}`, formData.domain);
    }

    // Wartość pola domeny w Jirze (jeśli skonfigurowano). Najlepsza próba: pole musi być na ekranie edycji
    const chosenDomain = projectDomains.find(d => d.id === formData.domain);
    if (!domainFieldInPayload && config.domainFieldId && chosenDomain && chosenDomain.optionId !== undefined && chosenDomain.optionId !== null) {
      try {
        const update = await api.asApp().requestJira(route`/rest/api/3/issue/${result.key}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: { [config.domainFieldId]: domainFieldPayload(chosenDomain.optionId, config.domainFieldMulti) }
          })
        });
        if (!update.ok) console.warn(`Nie udało się ustawić pola domeny w ${result.key}:`, await update.text());
      } catch (error) {
        console.warn(`Nie udało się ustawić pola domeny w ${result.key}:`, error.message);
      }
    }
    
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
    let processed = null;
    if (config.enableAutoProcessing !== false) {
      try {
        debug('Uruchamiam automatyczne przetwarzanie dla:', result.key);
        // Przekaż formData do processIncidentLogic
        processed = await processIncidentLogic(result.key, accountId, formData);
      } catch (processingError) {
        console.error('Błąd podczas automatycznego przetwarzania:', processingError);
        // Nie zwracamy błędu - alert został utworzony pomyślnie
      }
    }
    
    return {
      success: true,
      issueKey: result.key,
      issueId: result.id,
      message: 'Alert utworzony pomyślnie',
      assignedTeam: processed?.teamName || null,
      assigneeName: processed?.assignee ? await getUserDisplayName(processed.assignee) : null
    };
    
  } catch (error) {
    console.error('Error in createIncident:', error);
    return {
      success: false,
      error: 'An unexpected error occurred. Please contact support.'
    };
  }
});


// Zgłoszenie z formularza przetwarzają dwie ścieżki (createIncident i trigger utworzenia).
// Znacznik czasu zapobiega dublowaniu komentarzy i powiadomień.
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

async function processIncidentLogic(issueKey, userId, formData = null, { dedupe = false } = {}) {
  const markerKey = `processing_${issueKey}`;
  if (dedupe) {
    const last = await storage.get(markerKey);
    if (last && Date.now() - last < DEDUPE_WINDOW_MS) {
      debug(`processIncidentLogic - ${issueKey} przetworzone przed chwilą, pomijam`);
      return;
    }
  }
  await storage.set(markerKey, Date.now());

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
  debug('Project key:', projectKey);
  
  const projectConfigKey = `project_config_${projectKey}`;
  const projectConfig = await storage.get(projectConfigKey);
  const fieldsConfig = projectConfig?.fieldsConfig || {};
  
  debug('Fields config:', JSON.stringify(fieldsConfig));
  
  // Extract alert data - użyj formData jeśli jest dostępne, w przeciwnym razie wyciągnij z custom fields
  let alertData;
  if (formData) {
    debug('Używam danych z formularza:', JSON.stringify(formData));
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
    debug('Wyciągam dane z custom fields');
    alertData = extractAlertData(issue, fieldsConfig);
  }
  
  debug('Alert data dla reguł:', JSON.stringify(alertData));
  
  // 2. Calculate Priority using Rule Engine
  const priorityResult = await calculatePriority(alertData, projectKey);
  debug('Wynik kalkulacji priorytetu:', JSON.stringify(priorityResult));
  
  // 3. Assign Team using Escalation Engine
  const domainId = (formData && formData.domain) || await getIssueDomainId(issue, projectConfig || {});
  const assignmentResult = await assignTeam(alertData, priorityResult.priority, projectKey, domainId);
  if (!domainIdFromLabels(issue.fields.labels)) {
    await tagIssueWithDomain(issueKey, assignmentResult.domain);
  }
  
  // 4. Update Issue with priority, assignee, watchers
  await updateIssueWithResults(issueKey, priorityResult, assignmentResult, fieldsConfig, projectKey);
  
  // 4b. Zapisz priorytet w storage jako backup (dla SLA check)
  const issuePriorityKey = `issue_priority_${issueKey}`;
  await storage.set(issuePriorityKey, priorityResult.priority);
  debug(`Zapisano priorytet ${priorityResult.priority} dla ${issueKey} w storage`);
  
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
  debug('Sprawdzam powiadomienie Teams...');
  debug('Team:', assignmentResult.team?.name);
  debug('Webhook:', assignmentResult.team?.teamsWebhookUrl ? 'CONFIGURED' : 'NOT CONFIGURED');
  
  if (assignmentResult.team && assignmentResult.team.teamsWebhookUrl) {
    debug('Wysyłam powiadomienie na Teams...');
    const teamsResult = await notifyTeams(
      issueKey,
      issue,
      priorityResult.priority,
      assignmentResult.team,
      assignmentResult.assignee,
      projectKey
    );
    debug('Wynik powiadomienia Teams:', JSON.stringify(teamsResult));
    
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

  // 7. Wiadomość prywatna do dyżurnego (opcjonalny workflow DM zespołu)
  if (assignmentResult.team?.dutyDmWorkflowUrl && assignmentResult.assignee) {
    const dmResult = await notifyDutyPerson(
      issueKey, issue, priorityResult.priority,
      assignmentResult.team, assignmentResult.assignee, projectKey
    );
    await logAuditEntry({
      eventType: 'teams_duty_dm_sent',
      issueKey: issueKey,
      userId: 'system',
      details: { status: dmResult.success ? 'success' : 'failed', error: dmResult.error }
    });
  }

  return { teamName: assignmentResult.teamName, assignee: assignmentResult.assignee };
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
      debug('calculatePriority - używam reguł z konfiguracji projektu:', projectKey);
    }
  }
  
  // Fallback do globalnych reguł
  if (rules.length === 0) {
    const rulesJson = await storage.get('priority_rules') || '[]';
    rules = JSON.parse(rulesJson);
    debug('calculatePriority - używam globalnych reguł');
  }
  
  debug('calculatePriority - liczba reguł:', rules.length);
  debug('calculatePriority - alert data:', JSON.stringify(alertData));
  
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
  
  debug('calculatePriority - aktywne reguły:', sortedRules.length);
  
  // First match wins
  for (const rule of sortedRules) {
    debug('Sprawdzam regułę:', rule.name, 'warunki:', JSON.stringify(rule.conditions));
    const matches = evaluateConditions(rule.conditions, alertData);
    debug('Reguła', rule.name, 'pasuje:', matches);
    
    if (matches) {
      debug('✓ Znaleziono pasującą regułę:', rule.name, '- priorytet:', rule.actions.setPriority);
      
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
          debug('Obserwatorzy z reguły priorytetyzacji (tablica accountId):', watchers);
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
  
  debug('Żadna reguła nie pasuje - używam domyślnego priorytetu:', defaultPriority);
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
    
    debug(`  Warunek: ${condition.field} ${condition.operator} "${conditionValue}"`);
    debug(`  Wartość w danych: ${fieldValue} (typ: ${typeof fieldValue})`);
    
    // Jeśli wartość pola jest null/undefined, warunek nie może być spełniony (chyba że operator to notEquals)
    if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
      if (condition.operator === 'notEquals' || condition.operator === 'notContains' || condition.operator === 'notIn') {
        debug(`  ✓ Warunek spełniony (wartość pusta dla operatora ${condition.operator})`);
        return true;
      }
      debug(`  ✗ Warunek nie spełniony (wartość pusta)`);
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
        debug(`  ${equalsMatch ? '✓' : '✗'} equals: "${fieldValue}" (normalized: "${normalizedFieldValue}") === "${conditionValue}" (normalized: "${normalizedConditionValue}")`);
        return equalsMatch;
        
      case 'notEquals':
        const notEqualsMatch = String(fieldValue) !== String(conditionValue) && 
                               String(fieldValue).toLowerCase() !== String(conditionValue).toLowerCase();
        debug(`  ${notEqualsMatch ? '✓' : '✗'} notEquals: "${fieldValue}" !== "${conditionValue}"`);
        return notEqualsMatch;
        
      case 'contains':
        const containsMatch = fieldValue && String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
        debug(`  ${containsMatch ? '✓' : '✗'} contains: "${fieldValue}" contains "${conditionValue}"`);
        return containsMatch;
        
      case 'notContains':
        const notContainsMatch = !fieldValue || !String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
        debug(`  ${notContainsMatch ? '✓' : '✗'} notContains: "${fieldValue}" not contains "${conditionValue}"`);
        return notContainsMatch;
        
      case 'in':
        const inValues = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(v => v.trim());
        const inMatch = inValues.some(v => 
          String(fieldValue) === String(v) || 
          String(fieldValue).toLowerCase() === String(v).toLowerCase()
        );
        debug(`  ${inMatch ? '✓' : '✗'} in: "${fieldValue}" in [${inValues.join(', ')}]`);
        return inMatch;
        
      case 'notIn':
        const notInValues = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(v => v.trim());
        const notInMatch = !notInValues.some(v => 
          String(fieldValue) === String(v) || 
          String(fieldValue).toLowerCase() === String(v).toLowerCase()
        );
        debug(`  ${notInMatch ? '✓' : '✗'} notIn: "${fieldValue}" not in [${notInValues.join(', ')}]`);
        return notInMatch;
        
      default:
        debug(`  ✗ Nieznany operator: ${condition.operator}`);
        return false;
    }
  });
  
  // ALL conditions must be true (AND logic)
  return results.every(r => r === true);
}

// ============================================================================
// ESCALATION ENGINE - Assign Team
// ============================================================================
// ============================================================================
// DOMAINS -> TEAMS -> DUTY
// Każda domena (kategoria alertu) należy do jednego zespołu. Zespół ma własny
// harmonogram dyżurów (teamSchedule filtrowany po teamId) i delegata na dyżurze.
// Czysta logika routingu jest w routing.js (z testami).
// ============================================================================
async function loadProjectTeamsConfig(projectKey) {
  const projectConfig = (projectKey && await storage.get(`project_config_${projectKey}`)) || {};
  return {
    projectConfig,
    domains: asArray(projectConfig.domains),
    teams: asArray(projectConfig.escalationTeams),
    schedule: asArray(projectConfig.teamSchedule)
  };
}

// Czy pole jest na ekranie tworzenia alertu (createmeta). Przy błędzie zakładamy, że nie jest: wtedy wartość idzie po utworzeniu.
async function isFieldOnCreateScreen(projectKey, issueTypeId, fieldId) {
  try {
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return false;
    const metadata = await response.json();
    const issueType = (metadata.projects?.[0]?.issuetypes || []).find(it => it.id === String(issueTypeId));
    return !!(issueType && issueType.fields && issueType.fields[fieldId]);
  } catch (error) {
    console.warn('Nie udało się sprawdzić ekranu tworzenia:', error.message);
    return false;
  }
}

// Domena alertu: pole Jira (jeśli skonfigurowane), label, zapis przy tworzeniu, na końcu domena domyślna projektu
async function getIssueDomainId(issue, projectConfig = {}) {
  const fieldId = projectConfig.domainFieldId;
  return pickDomainId({
    fieldValue: fieldId ? issue?.fields?.[fieldId] : null,
    labels: issue?.fields?.labels,
    stored: await storage.get(`issue_domain_${issue.key}`),
    fallback: projectConfig.defaultDomainId,
    domains: asArray(projectConfig.domains)
  });
}

// Alert bez domeny (np. utworzony bezpośrednio w Jirze) dostaje label domeny domyślnej,
// żeby statystyki i kolejne przetwarzanie widziały tę samą domenę
async function tagIssueWithDomain(issueKey, domain) {
  if (!domain) return;
  await storage.set(`issue_domain_${issueKey}`, domain.id);
  try {
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: { labels: [{ add: domain.id }] } })
    });
  } catch (error) {
    console.warn(`Nie udało się dodać labelu domeny do ${issueKey}:`, error.message);
  }
}

// Zespół (i dyżurny) odpowiedzialny za konkretny alert - używane przez SLA i przypomnienia
async function resolveIssueTeam(issue, cfg) {
  const domainId = await getIssueDomainId(issue, cfg.projectConfig || {});
  const { domain, team } = resolveDomainTeam(cfg, domainId);
  if (!team) return { domain, team: null, duty: null };
  return { domain, team, duty: findDutyEntry(cfg.schedule, team.id) };
}

async function assignTeam(alertData, priority, projectKey = null, domainId = null) {
  debug('assignTeam - projekt:', projectKey, 'domena:', domainId, 'priorytet:', priority);

  const cfg = await loadProjectTeamsConfig(projectKey);
  const { domain, team } = resolveDomainTeam(cfg, domainId);

  if (!team) {
    console.warn('assignTeam - brak domeny lub zespołu dla domeny:', domainId);
    return { teamId: null, teamName: null, team: null, domain, assignee: null, watchers: [] };
  }

  // Dyżurny z grafiku zespołu; bez wpisu na dziś - strategia zespołu (fixed / round-robin)
  const duty = findDutyEntry(cfg.schedule, team.id);
  const assignee = duty?.assignedPerson || await determineAssignee(team);
  debug(`assignTeam - zespół ${team.name}, dyżurny: ${assignee || 'brak'}`);

  // Obserwatorzy: team leaderzy zespołu + domenowi product ownerzy
  const watchers = collectWatchers(team, domain);

  return {
    teamId: team.id,
    teamName: team.name,
    team,
    domain,
    assignee,
    watchers
  };
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
  
  debug(`updateIssueWithResults dla ${issueKey}:`);
  debug(`  - Priority: ${priorityResult.priority}`);
  debug(`  - Team: ${assignmentResult.teamName}`);
  debug(`  - fieldsConfig.customFieldMappings:`, JSON.stringify(fieldsConfig?.customFieldMappings));
  
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
              debug(`Priority allowedValues dla mapowania P1-P4:`, allowedValues.map(av => ({ id: av.id, name: av.name })));
              
              // Znajdź dopasowanie w allowedValues
              let matchedPriority = null;
              for (const term of searchTerms) {
                matchedPriority = allowedValues.find(av => {
                  const avName = (av.name || av.value || '').toString();
                  return avName.toLowerCase() === term.toLowerCase();
                });
                if (matchedPriority) {
                  debug(`✓ Znaleziono priorytet Jira dla ${calculatedPriority}: "${matchedPriority.name}" (id: ${matchedPriority.id})`);
                  break;
                }
              }
              
              if (matchedPriority) {
                // Ustaw standardowe pole priority w Jira
                if (matchedPriority.id) {
                  updatePayload.fields.priority = { id: String(matchedPriority.id) };
                  debug(`  - Ustawiam standardowe pole priority = { id: "${matchedPriority.id}" }`);
                } else {
                  updatePayload.fields.priority = { name: matchedPriority.name || matchedPriority.value };
                  debug(`  - Ustawiam standardowe pole priority = { name: "${matchedPriority.name || matchedPriority.value}" }`);
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
    debug(`  - Ustawiam ${fieldsConfig.customFieldMappings.calculatedPriority} = ${priorityResult.priority}`);
  } else {
    debug(`  - BRAK mapowania dla calculatedPriority! Priorytet nie zostanie zapisany w custom field.`);
  }
  
  // Set Assigned Team custom field
  if (fieldsConfig && fieldsConfig.customFieldMappings && fieldsConfig.customFieldMappings.assignedTeam && assignmentResult.teamName) {
    updatePayload.fields[fieldsConfig.customFieldMappings.assignedTeam] = assignmentResult.teamName;
    debug(`  - Ustawiam ${fieldsConfig.customFieldMappings.assignedTeam} = ${assignmentResult.teamName}`);
  } else {
    debug(`  - BRAK mapowania dla assignedTeam! Zespół nie zostanie zapisany w custom field.`);
  }
  
  // Set assignee - użyj accountId zamiast id
  if (assignmentResult.assignee) {
    updatePayload.fields.assignee = {
      accountId: assignmentResult.assignee
    };
    debug(`  - Przypisuję do użytkownika: ${assignmentResult.assignee}`);
  } else {
    debug(`  - Brak przypisanej osoby (assignee jest null/undefined)`);
  }
  
  debug(`  - Payload do aktualizacji:`, JSON.stringify(updatePayload));
  
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
    debug(`✓ Issue ${issueKey} zaktualizowany pomyślnie`);
  }
  
  // Add watchers from priority rules (separate API call)
  // Priorytet: watchers z reguł priorytetyzacji (już jako accountId)
  let watchersToAdd = [];
  
  if (priorityResult.watchers && priorityResult.watchers.length > 0) {
    debug('Dodaję obserwatorów z reguły priorytetyzacji:', priorityResult.watchers);
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
    debug('Dodaję obserwatorów do issue:', uniqueWatchers);
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
          debug(`✓ Dodano obserwatora (accountId): ${watcherAccountId}`);
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
// ============================================================================
// TEAMS NOTIFICATIONS
// Webhooki Office 365 (MessageCard) zostały wycofane. Używamy Teams Workflows
// (Power Automate, wyzwalacz "When a Teams webhook request is received"),
// który przyjmuje Adaptive Card w obwolucie { type: 'message', attachments: [...] }.
// ============================================================================
const TEAMS_COLORS = { P1: 'Attention', P2: 'Warning', P3: 'Accent', P4: 'Default' };

function buildTeamsMessage({ title, subtitle, color = 'Accent', facts = [], text, actions = [] }) {
  const body = [
    { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', color, wrap: true }
  ];
  if (subtitle) {
    body.push({ type: 'TextBlock', text: subtitle, wrap: true, isSubtle: true, spacing: 'None' });
  }
  if (facts.length > 0) {
    body.push({
      type: 'FactSet',
      facts: facts.map(f => ({ title: String(f.name).replace(/:?$/, ':'), value: String(f.value) }))
    });
  }
  if (text) {
    body.push({ type: 'TextBlock', text, wrap: true });
  }
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body,
        actions: actions.map(a => ({ type: 'Action.OpenUrl', title: a.title, url: a.url }))
      }
    }]
  };
}

async function getJiraBaseUrl(projectKey) {
  let jiraInstanceUrl = null;
  if (projectKey) {
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    jiraInstanceUrl = projectConfig?.jiraInstanceUrl;
  }
  if (!jiraInstanceUrl) {
    const globalConfig = await storage.get('global_config');
    jiraInstanceUrl = globalConfig?.jiraInstanceUrl;
  }
  return jiraInstanceUrl
    ? `https://${jiraInstanceUrl.replace(/^https?:\/\//, '')}`
    : 'https://your-instance.atlassian.net';
}

async function notifyTeams(issueKey, issue, priority, team, assignee, projectKey = null) {
  if (!team.teamsWebhookUrl) {
    return { success: false, error: 'No webhook URL configured' };
  }

  const jiraBaseUrl = await getJiraBaseUrl(projectKey);
  const emoji = priority === 'P1' ? '🚨' : priority === 'P2' ? '⚠️' : 'ℹ️';
  const assigneeName = assignee ? await getUserDisplayName(assignee) : null;

  const payload = buildTeamsMessage({
    title: `${emoji} [${priority}] ALERT`,
    subtitle: issue.fields.summary,
    color: TEAMS_COLORS[priority] || 'Accent',
    facts: [
      { name: 'Issue Key', value: issueKey },
      { name: 'Priority', value: priority },
      { name: 'Team', value: team.name },
      { name: 'Dyżurny', value: assigneeName || 'Unassigned' },
      { name: 'Reporter', value: issue.fields.reporter?.displayName || '-' },
      { name: 'Created', value: new Date(issue.fields.created).toLocaleString('pl-PL') }
    ],
    actions: [{ title: 'View in Jira', url: `${jiraBaseUrl}/browse/${issueKey}` }]
  });

  return await sendToTeamsWithRetry(team.teamsWebhookUrl, payload);
}

async function getUserInfo(accountId) {
  try {
    const response = await api.asApp().requestJira(
      route`/rest/api/3/user?accountId=${accountId}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (response.ok) return await response.json();
  } catch (error) {
    console.error('Błąd pobierania użytkownika:', error);
  }
  return null;
}

async function getUserDisplayName(accountId) {
  const user = await getUserInfo(accountId);
  return user?.displayName || null;
}

// Wiadomość prywatna do dyżurnego: osobny workflow Power Automate ("Post card in a chat")
// dostaje ten sam Adaptive Card plus pola recipientEmail / recipientName.
// Wiadomość prywatna w Teams (osobny workflow Power Automate z polami recipientEmail / recipientName)
async function sendDirectMessage(team, accountId, { title, subtitle, color, facts, actions }) {
  if (!team?.dutyDmWorkflowUrl || !accountId) {
    return { success: false, error: 'Brak workflow DM lub odbiorcy' };
  }
  const user = await getUserInfo(accountId);
  if (!user?.emailAddress) {
    return { success: false, error: 'Brak adresu e-mail odbiorcy (ustawienia prywatności konta Atlassian)' };
  }
  const message = buildTeamsMessage({ title, subtitle, color, facts, actions });
  return await sendToTeamsWithRetry(team.dutyDmWorkflowUrl, {
    ...message,
    recipientEmail: user.emailAddress,
    recipientName: user.displayName
  });
}

async function notifyDutyPerson(issueKey, issue, priority, team, assigneeAccountId, projectKey = null) {
  const jiraBaseUrl = await getJiraBaseUrl(projectKey);
  return await sendDirectMessage(team, assigneeAccountId, {
    title: `📟 Masz dyżur: [${priority}] ${issueKey}`,
    subtitle: issue.fields.summary,
    color: TEAMS_COLORS[priority] || 'Accent',
    facts: [
      { name: 'Zespół', value: team.name },
      { name: 'Priorytet', value: priority }
    ],
    actions: [{ title: 'Otwórz w Jira', url: `${jiraBaseUrl}/browse/${issueKey}` }]
  });
}

function maskWebhookUrl(url) {
  try {
    return `${new URL(url).host}/...`;
  } catch (e) {
    return '[invalid url]';
  }
}

async function sendToTeamsWithRetry(webhookUrl, payload, maxRetries = 3) {
  debug('sendToTeamsWithRetry - webhook:', maskWebhookUrl(webhookUrl));
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debug(`Próba ${attempt}/${maxRetries} wysłania do Teams...`);
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      debug(`Odpowiedź z Teams (próba ${attempt}):`, response.status, response.statusText);
      
      if (response.ok) {
        const responseText = await response.text();
        debug('Sukces - odpowiedź z Teams:', responseText);
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
        debug(`Błąd serwera, ponawianie za ${delay}ms...`);
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
      debug(`Błąd połączenia, ponawianie za ${delay}ms...`);
      await sleep(delay);
    }
  }
}

// ============================================================================
// SLA & REMINDERS - Check and Process
// ============================================================================
// ============================================================================
// ESKALACJA ALERTÓW
// Przypomnienia dla dyżurnego, potem eskalacja do team leaderów i product ownerów, na końcu do wskazanych osób.
// Czas liczony w godzinach pracy; alert jest "podjęty" po zmianie statusu albo komentarzu człowieka.
// Logika czasu i etapów: escalation.js (z testami). Uruchamiane co godzinę przez scheduledTrigger.
// ============================================================================
const ESCALATION_LOOKBACK_DAYS = 14;
const ESCALATION_MAX_ALERTS = 100;
// Funkcja Forge ma limit czasu; po jego przekroczeniu reszta alertów zostaje na kolejne uruchomienie (stan jest zapisany)
const ESCALATION_TIME_BUDGET_MS = 40000;

// Priorytet P1-P4: pole niestandardowe z silnika reguł albo wartość zapisana przy przetwarzaniu
async function getAlertPriority(issue, fieldsConfig) {
  const fieldId = fieldsConfig?.customFieldMappings?.calculatedPriority;
  let value = fieldId ? issue.fields[fieldId] : null;
  if (value && typeof value === 'object') value = value.value || value.name;
  if (PRIORITIES.includes(value)) return value;
  const stored = await storage.get(`issue_priority_${issue.key}`);
  return PRIORITIES.includes(stored) ? stored : 'P3';
}

async function fetchAlertComments(issueKey) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/comment?maxResults=50&orderBy=-created`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!response.ok) return [];
  return (await response.json()).comments || [];
}

const personName = async (accountId) => (await getUserDisplayName(accountId)) || accountId;

async function executeEscalationAction(action, ctx) {
  const { issue, priority, team, policy, ageMin, jiraBaseUrl } = ctx;
  const key = issue.key;
  const link = [{ title: 'Otwórz w Jira', url: `${jiraBaseUrl}/browse/${key}` }];
  const age = `${Math.floor(ageMin / 60)}h ${ageMin % 60}min czasu pracy`;
  const dutyId = ctx.duty?.assignedPerson || issue.fields.assignee?.accountId || null;
  const color = TEAMS_COLORS[priority] || 'Warning';

  let title;
  let comment;
  let recipients;
  if (action.type === 'reminder') {
    const dutyName = dutyId ? await personName(dutyId) : 'brak dyżurnego';
    title = `🔔 Przypomnienie #${action.number} [${priority}] ${key}`;
    comment = `🔔 PRZYPOMNIENIE #${action.number}: alert nie został podjęty (${age}). Dyżurny: ${dutyName}`;
    recipients = dutyId ? [dutyId] : [];
  } else if (action.type === 'escalate_leaders') {
    recipients = [...new Set([...asArray(team?.teamLeaders), ...asArray(team?.productOwners)])];
    const names = await Promise.all(recipients.map(personName));
    title = `⬆️ Eskalacja [${priority}] ${key}`;
    comment = `⬆️ ESKALACJA: alert nie został podjęty (${age}). Powiadomiono team leaderów i product ownerów: ${names.join(', ') || 'brak wskazanych osób'}`;
  } else {
    recipients = asArray(policy.finalEscalationPeople);
    const names = await Promise.all(recipients.map(personName));
    title = `🚨 Eskalacja końcowa [${priority}] ${key}`;
    comment = `🚨 ESKALACJA KOŃCOWA: alert nadal nie został podjęty (${age}). Powiadomiono: ${names.join(', ') || 'brak wskazanych osób'}`;
  }

  await addCommentToIssue(key, comment);

  const facts = [
    { name: 'Alert', value: key },
    { name: 'Priorytet', value: priority },
    { name: 'Zespół', value: team?.name || 'brak' },
    { name: 'Bez reakcji', value: age }
  ];
  if (team?.teamsWebhookUrl) {
    await sendToTeamsWithRetry(team.teamsWebhookUrl, buildTeamsMessage({
      title, subtitle: issue.fields.summary, color: action.type === 'reminder' ? 'Warning' : 'Attention', facts, actions: link
    }));
  }
  const dms = await Promise.all(recipients.map(id => sendDirectMessage(team, id, {
    title, subtitle: issue.fields.summary, color, facts, actions: link
  })));
  return { channel: !!team?.teamsWebhookUrl, directMessages: dms.filter(r => r.success).length };
}

async function runEscalationCheck(projectKey, now = new Date()) {
  const result = { projectKey, checked: 0, actions: [], skipped: null };
  const cfg = await loadProjectTeamsConfig(projectKey);
  if (!cfg.projectConfig.escalationPolicy?.enabled) return { ...result, skipped: 'Eskalacja wyłączona' };
  if (!cfg.projectConfig.incidentIssueTypeId) return { ...result, skipped: 'Brak skonfigurowanego typu alertu' };

  const policy = withDefaults(cfg.projectConfig.escalationPolicy);
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { ...result, skipped: `Niepoprawne ustawienia: ${errors[0]}` };

  const fieldsConfig = cfg.projectConfig.fieldsConfig || {};
  const priorityFieldId = fieldsConfig.customFieldMappings?.calculatedPriority;
  const fields = ['summary', 'status', 'created', 'assignee', 'reporter', 'labels'];
  if (priorityFieldId) fields.push(priorityFieldId);
  if (cfg.projectConfig.domainFieldId) fields.push(cfg.projectConfig.domainFieldId);

  const jql = `project = ${projectKey} AND issuetype = ${cfg.projectConfig.incidentIssueTypeId} AND statusCategory != Done AND created >= -${ESCALATION_LOOKBACK_DAYS}d ORDER BY created ASC`;
  const response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, maxResults: ESCALATION_MAX_ALERTS, fields })
  });
  if (!response.ok) throw new Error(`Nie udało się pobrać alertów: ${await response.text()}`);
  const { issues = [] } = await response.json();

  const jiraBaseUrl = await getJiraBaseUrl(projectKey);
  const deadline = Date.now() + ESCALATION_TIME_BUDGET_MS;

  for (const issue of issues) {
    if (Date.now() > deadline) {
      result.truncated = true;
      break;
    }
    const stateKey = `escalation_state_${issue.key}`;
    const state = (await storage.get(stateKey)) || freshState();
    if (state.takenAt) continue;

    const ageMin = businessMinutesBetween(issue.fields.created, now, policy.workingHours);
    const priority = await getAlertPriority(issue, fieldsConfig);
    const plan = planActions({ ageMin, state, rule: policy.priorities[priority] });
    result.checked++;
    if (plan.actions.length === 0) continue;

    // Dopiero gdy coś trzeba wysłać, sprawdzamy (drożej), czy alert nie został już podjęty
    const statusCategoryKey = issue.fields.status?.statusCategory?.key;
    const comments = statusCategoryKey === 'new' ? await fetchAlertComments(issue.key) : [];
    if (isTaken({
      statusCategoryKey,
      comments,
      reporterId: issue.fields.reporter?.accountId,
      assigneeId: issue.fields.assignee?.accountId
    })) {
      await storage.set(stateKey, { ...state, takenAt: now.toISOString() });
      continue;
    }

    // Stan zapisujemy przed wysyłką: przy błędzie nie powtarzamy powiadomień w nieskończoność
    await storage.set(stateKey, plan.state);
    const { team, duty } = await resolveIssueTeam(issue, cfg);
    for (const action of plan.actions) {
      try {
        const sent = await executeEscalationAction(action, { issue, priority, team, duty, policy, ageMin, jiraBaseUrl });
        result.actions.push({ key: issue.key, type: action.type, ...sent });
        await logAuditEntry({
          eventType: `escalation_${action.type}`,
          issueKey: issue.key,
          userId: 'system',
          details: { priority, ageMin, ...sent }
        });
      } catch (error) {
        console.error(`Eskalacja ${issue.key} (${action.type}) nie powiodła się:`, error);
      }
    }
  }
  return result;
}

// Projekty z włączoną eskalacją
async function listProjectsWithEscalation() {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/project/search?maxResults=100`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!response.ok) throw new Error('Failed to fetch projects');
  const { values = [] } = await response.json();

  const keys = [];
  for (const project of values) {
    const config = await storage.get(`project_config_${project.key}`);
    if (config?.escalationPolicy?.enabled) keys.push(project.key);
  }
  return keys;
}

// Wywoływane co godzinę przez scheduledTrigger (manifest) oraz ręcznie przez webtrigger
export async function scheduledSLACheck() {
  const projectKeys = await listProjectsWithEscalation();
  const results = [];
  for (const projectKey of projectKeys) {
    try {
      results.push(await runEscalationCheck(projectKey));
    } catch (error) {
      console.error(`Sprawdzanie eskalacji dla ${projectKey} nie powiodło się:`, error);
    }
  }
  return { success: true, projects: projectKeys.length, actions: results.flatMap(r => r.actions).length };
}

// Webtrigger Forge musi zwrócić odpowiedź HTTP, dlatego osobny wrapper
export async function slaWebTrigger() {
  const result = await scheduledSLACheck();
  return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(result) };
}

// Ustawienia eskalacji (z uzupełnionymi wartościami domyślnymi) - dla panelu konfiguracji
resolver.define('getEscalationPolicy', async ({ payload }) => {
  try {
    const { projectKey } = payload || {};
    if (!await isConfigAdmin(projectKey)) return NO_ADMIN_RESPONSE;
    const config = (await storage.get(`project_config_${projectKey}`)) || {};
    return { success: true, policy: withDefaults(config.escalationPolicy) };
  } catch (error) {
    console.error('Error in getEscalationPolicy:', error);
    return { success: false, error: error.message };
  }
});

// Ręczne uruchomienie sprawdzenia (przycisk w panelu), np. do przetestowania ustawień
resolver.define('runEscalationCheckNow', async ({ payload }) => {
  try {
    const { projectKey } = payload || {};
    if (!await isConfigAdmin(projectKey)) return NO_ADMIN_RESPONSE;
    return { success: true, result: await runEscalationCheck(projectKey) };
  } catch (error) {
    console.error('Error in runEscalationCheckNow:', error);
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
    
    debug(`🔍 Pobieranie zgłoszeń dla projektu: ${projectKey}, przedział: ${timeRange}`);
    
    // Pobierz typ zgłoszenia z konfiguracji projektu
    const projectConfig = await storage.get(`project_config_${projectKey}`);
    if (!projectConfig || !projectConfig.incidentIssueTypeId) {
      return { 
        success: false, 
        error: `Projekt ${projectKey} nie ma skonfigurowanego typu alertu. Skonfiguruj typ alertu w "Ustawienia Ogólne" przed przeliczaniem.` 
      };
    }
    
    // Buduj JQL query z filtrem projektu, typu zgłoszenia i czasu
    let jqlQuery = `project = ${projectKey} AND issuetype = ${projectConfig.incidentIssueTypeId}`;
    
    debug(`Dodano filtr po typie zgłoszenia: ${projectConfig.incidentIssueTypeId}`);
    
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
    
    debug(`JQL Query: ${jqlQuery}`);
    
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
          fields: ['summary', 'status', 'priority', 'created', 'assignee', 'reporter', 'project', 'labels']
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
    
    debug(`Znaleziono ${formattedIssues.length} zgłoszeń`);
    
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
      return { success: false, error: 'Nie wybrano żadnych alertów do przeliczenia' };
    }
    
    debug(`🔄 Przetwarzanie ${issueKeys.length} wybranych zgłoszeń z projektu: ${projectKey}`);
    
    let processed = 0;
    let errors = 0;
    const errorDetails = [];
    
    for (const issueKey of issueKeys) {
      try {
        debug(`Przetwarzam ${issueKey}...`);
        await processIncidentLogic(issueKey, 'system');
        processed++;
        debug(`✓ ${issueKey} przetworzony`);
      } catch (error) {
        console.error(`✗ Błąd dla ${issueKey}:`, error.message);
        errors++;
        errorDetails.push({ issueKey, error: error.message });
      }
    }
    
    const message = `Przetworzono: ${processed}/${issueKeys.length} alertów, Błędy: ${errors}`;
    debug(message);
    
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
    if (!await isConfigAdmin()) return NO_ADMIN_RESPONSE;
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
        configChanges: '[ukryte]' // dane mogą zawierać adresy webhooków
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

// ============================================================================
// GET MY ALERTS
// ============================================================================
resolver.define('getMyIncidents', async ({ payload, context }) => {
  try {
    const accountId = context.accountId;
    const { projectKey, issueTypeId, showAll = false } = payload || {};
    
    debug('getMyIncidents wywołane dla użytkownika:', accountId);
    debug('getMyIncidents - projectKey:', projectKey, 'issueTypeId:', issueTypeId, 'showAll:', showAll);
    
    // Buduj JQL query z filtrowaniem po projekcie i typie zgłoszenia
    // Jeśli showAll jest true, nie filtruj po reporter
    // Jira odrzuca zapytania bez ograniczenia, więc "wszystkie alerty" wymagają projektu
    if (showAll && !projectKey) {
      return { success: false, error: 'Nie można określić projektu. Wybierz projekt przyciskiem "Zmień projekt".' };
    }
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
    
    debug('getMyIncidents - JQL:', jql);
    
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
    debug('getMyIncidents - znaleziono zgłoszeń:', result.issues?.length || 0);
    
    if (!result.issues || result.issues.length === 0) {
      debug('getMyIncidents - brak zgłoszeń dla użytkownika');
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
        debug('getMyIncidents - używam jiraInstanceUrl z konfiguracji:', jiraInstanceUrl);
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
    
    debug('getMyIncidents - zwracam zgłoszenia:', incidents.map(i => i.key).join(', '));
    
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
    if (!await isConfigAdmin()) return NO_ADMIN_RESPONSE;
    const { limit = 100 } = payload;
    
    const sorted = (await readAuditEntries())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

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
    const { projectKey, domainId } = payload;
    
    if (!projectKey) {
      return { success: false, error: 'Project key is required' };
    }
    
    const cfg = await loadProjectTeamsConfig(projectKey);
    const { domain, team } = resolveDomainTeam(cfg, domainId);
    if (!team) {
      return { success: true, team: null, assignedPerson: null };
    }
    
    const duty = findDutyEntry(cfg.schedule, team.id);
    let assignedPersonInfo = null;
    if (duty?.assignedPerson) {
      const user = await getUserInfo(duty.assignedPerson);
      assignedPersonInfo = {
        accountId: duty.assignedPerson,
        displayName: user?.displayName || duty.assignedPerson,
        emailAddress: user?.emailAddress || null
      };
    }
    
    return {
      success: true,
      team: { id: team.id, name: team.name, description: team.description },
      domain: domain ? { id: domain.id, name: domain.name } : null,
      assignedPerson: assignedPersonInfo
    };
    
  } catch (error) {
    console.error('Error in getCurrentTeam:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// HARMONOGRAM DYŻURÓW dla team leaderów
// Administrator zmienia harmonogram każdego zespołu, team leader tylko swojego,
// pozostali użytkownicy mogą go tylko oglądać.
// ============================================================================
resolver.define('getDutySchedule', async ({ payload, context }) => {
  try {
    const { projectKey } = payload || {};
    if (!projectKey) return { success: false, error: 'Brak projektu' };

    const cfg = await loadProjectTeamsConfig(projectKey);
    const isAdmin = await isConfigAdmin(projectKey);
    const editable = editableTeamIds({ isAdmin, teams: cfg.teams, accountId: context.accountId });

    // Dyżurnymi mogą być tylko delegaci zespołów - zwracamy ich nazwy (użytkownik nie musi mieć dostępu do listy użytkowników)
    const delegateIds = [...new Set(cfg.teams.flatMap(t => asArray(t.delegates)))];
    const people = (await Promise.all(delegateIds.map(async accountId => {
      const user = await getUserInfo(accountId);
      return { accountId, displayName: user?.displayName || accountId, emailAddress: null };
    })));

    return {
      success: true,
      teams: cfg.teams.map(t => ({ id: t.id, name: t.name, delegates: asArray(t.delegates) })),
      schedule: cfg.schedule,
      people,
      editableTeamIds: editable
    };
  } catch (error) {
    console.error('Error in getDutySchedule:', error);
    return { success: false, error: error.message };
  }
});

resolver.define('saveDutySchedule', async ({ payload, context }) => {
  try {
    const { projectKey, schedule } = payload || {};
    if (!projectKey || !Array.isArray(schedule)) return { success: false, error: 'Niepoprawne dane' };

    const configKey = `project_config_${projectKey}`;
    const config = (await storage.get(configKey)) || {};
    const teams = asArray(config.escalationTeams);
    const isAdmin = await isConfigAdmin(projectKey);
    const editable = editableTeamIds({ isAdmin, teams, accountId: context.accountId });
    if (editable.length === 0) {
      return { success: false, error: 'Brak uprawnień: harmonogram zmienia team leader zespołu lub administrator' };
    }

    // Walidujemy tylko wpisy zespołów, które użytkownik może zmieniać
    const mine = schedule.filter(entry => editable.includes(entry.teamId));
    const errors = validateSchedule(mine, teams);
    if (errors.length > 0) return { success: false, error: errors.join('; ') };

    const merged = mergeSchedule(asArray(config.teamSchedule), mine, editable);
    await storage.set(configKey, { ...config, teamSchedule: merged });

    await logAuditEntry({
      eventType: 'duty_schedule_updated',
      userId: context.accountId,
      details: { projectKey, teamIds: editable, entries: mine.length }
    });

    return { success: true, schedule: merged, editableTeamIds: editable };
  } catch (error) {
    console.error('Error in saveDutySchedule:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// PODPOWIEDZI NA ŻĄDANIE: podobne alerty i kategoria (domena)
// Bez modelu językowego: słowa kluczowe + wyszukiwanie w Jirze (z uprawnieniami użytkownika, tylko w jednym projekcie).
// ============================================================================
// Wspólna logika: podobne alerty i podpowiedź domeny dla podanego tekstu (opcjonalnie bez wskazanego alertu)
async function findSimilarAlerts({ projectKey, summary, description, excludeKey = null }) {
  const cfg = await loadProjectTeamsConfig(projectKey);
  const issueTypeId = cfg.projectConfig.incidentIssueTypeId;
  const jiraBaseUrl = await getJiraBaseUrl(projectKey);

  const terms = extractTerms(summary, description);
  if (terms.length === 0) {
    return { success: true, similar: [], suggestion: null, jiraBaseUrl };
  }

  // Zapytanie zawsze ograniczone do projektu (Jira odrzuca nieograniczone) i do typu alertu
  const textClause = terms.map(term => `text ~ "${term}*"`).join(' OR ');
  const jql = `project = ${projectKey}${issueTypeId ? ` AND issuetype = ${issueTypeId}` : ''} AND (${textClause}) ORDER BY created DESC`;

  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      maxResults: 50,
      fields: ['summary', 'description', 'status', 'priority', 'labels', ...(cfg.projectConfig.domainFieldId ? [cfg.projectConfig.domainFieldId] : [])]
    })
  });
  if (!response.ok) {
    console.error('findSimilarAlerts - błąd API:', await response.text());
    return { success: false, error: 'Nie udało się przeszukać alertów' };
  }
  const { issues = [] } = await response.json();

  const candidates = issues.filter(issue => issue.key !== excludeKey).map(issue => toCandidate(issue, { domainFieldId: cfg.projectConfig.domainFieldId, domains: cfg.domains }));
  const ranked = rankCandidates(terms, candidates, { limit: 5 });
  const domainName = (id) => (cfg.domains.find(d => d.id === id) || {}).name || null;

  return {
    success: true,
    jiraBaseUrl,
    similar: ranked.map(c => ({
      key: c.key,
      summary: c.summary,
      status: c.status,
      done: c.done,
      priority: c.priority,
      domainName: domainName(c.domainId),
      score: c.score
    })),
    suggestion: suggestDomain(ranked, cfg.domains)
  };
}

// Podpowiedzi przy wypełnianiu formularza (alert jeszcze nie istnieje)
resolver.define('suggestForAlert', async ({ payload }) => {
  try {
    const { projectKey, summary = '', description = '' } = payload || {};
    if (!projectKey) return { success: false, error: 'Brak projektu' };
    if (String(summary).trim().length < 3) return { success: false, error: 'Wpisz podsumowanie alertu' };
    return await findSimilarAlerts({ projectKey, summary, description });
  } catch (error) {
    console.error('Error in suggestForAlert:', error);
    return { success: false, error: error.message };
  }
});

// Podobne do istniejącego alertu (weryfikacja po zgłoszeniu); szukamy w projekcie tego alertu
resolver.define('findSimilarToAlert', async ({ payload }) => {
  try {
    const { issueKey } = payload || {};
    if (!issueKey) return { success: false, error: 'Brak alertu' };

    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,project`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return { success: false, error: 'Nie udało się pobrać alertu' };
    const issue = await response.json();

    return await findSimilarAlerts({
      projectKey: issue.fields.project.key,
      summary: issue.fields.summary || '',
      description: adfToText(issue.fields.description),
      excludeKey: issueKey
    });
  } catch (error) {
    console.error('Error in findSimilarToAlert:', error);
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
        debug('Próba fallback do assignable/search dla projektu:', projectKey);
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
          debug(`getProjectUsers (fallback) - znaleziono ${formattedUsers.length} użytkowników`);
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
    
    debug(`getProjectUsers - znaleziono ${formattedUsers.length} użytkowników`);
    
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
        debug('Próba fallback do assignable/search po błędzie');
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
          debug(`getProjectUsers (fallback po błędzie) - znaleziono ${formattedUsers.length} użytkowników`);
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
        debug('Używam ikony z konfiguracji:', projectIcon);
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
      debug('asApp() nie zadziałało, używam asUser() jako fallback:', appError);
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
        debug('Project avatarUrls:', project.avatarUrls);
        // Spróbuj pobrać ikonę w kolejności: 48x48, 32x32, 24x24
        if (project.avatarUrls && project.avatarUrls['48x48']) {
          projectIcon = project.avatarUrls['48x48'];
          debug('Używam ikony 48x48 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['32x32']) {
          projectIcon = project.avatarUrls['32x32'];
          debug('Używam ikony 32x32 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['24x24']) {
          projectIcon = project.avatarUrls['24x24'];
          debug('Używam ikony 24x24 z API:', projectIcon);
        } else if (project.avatarUrls && project.avatarUrls['16x16']) {
          projectIcon = project.avatarUrls['16x16'];
          debug('Używam ikony 16x16 z API:', projectIcon);
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
          itemsType: fieldData.schema?.items || null,
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
        domains: [],
        teamsWebhooks: {}
      };
    } else {
      // Upewnij się, że wszystkie pola istnieją (dla kompatybilności wstecznej)
      if (!config.priorityRules) config.priorityRules = [];
      if (!config.escalationRules) config.escalationRules = [];
      if (!config.escalationTeams) config.escalationTeams = [];
      if (!config.teamSchedule) config.teamSchedule = [];
      if (!config.domains) config.domains = [];
      if (!config.teamsWebhooks) config.teamsWebhooks = {};
    }
    
    // Formularz zgłoszenia też czyta tę konfigurację - sekrety dostaje tylko administrator
    const admin = await isConfigAdmin(projectKey);
    return {
      success: true,
      config: admin ? config : redactTeamSecrets(config),
      isAdmin: admin
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
    if (!await isConfigAdmin(payload?.projectKey)) return NO_ADMIN_RESPONSE;
    const { projectKey, config } = payload;
    if (config?.escalationPolicy) {
      const errors = validatePolicy(withDefaults(config.escalationPolicy));
      if (errors.length > 0) return { success: false, error: errors.join('; ') };
    }
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
    debug(`extractAlertData - priority extracted: "${issue.fields.priority.name || issue.fields.priority}" -> "${data.priority}"`);
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

// Dziennik audytu trzymamy w kubełkach miesięcznych z limitem wpisów i rozmiaru,
// żeby nigdy nie przekroczyć limitu wartości w Forge Storage
const AUDIT_BUCKET_MAX_ENTRIES = 300;
const AUDIT_BUCKET_MAX_CHARS = 200 * 1024;
const AUDIT_MONTHS_TO_READ = 3;

const auditBucketKey = (date = new Date()) =>
  `audit_log_${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

async function logAuditEntry(entry) {
  try {
    const key = auditBucketKey();
    const entries = JSON.parse(await storage.get(key) || '[]');

    entries.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      ...entry
    });

    while (entries.length > AUDIT_BUCKET_MAX_ENTRIES || JSON.stringify(entries).length > AUDIT_BUCKET_MAX_CHARS) {
      entries.shift();
    }

    await storage.set(key, JSON.stringify(entries));
  } catch (error) {
    console.error('Failed to log audit entry:', error);
  }
}

async function readAuditEntries() {
  const now = new Date();
  const keys = [];
  for (let i = 0; i < AUDIT_MONTHS_TO_READ; i++) {
    keys.push(auditBucketKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  keys.push('audit_log'); // wpisy sprzed podziału na miesiące
  const buckets = await Promise.all(keys.map(async key => JSON.parse(await storage.get(key) || '[]')));
  return buckets.flat();
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
// Trigger zdarzenia utworzenia alertu (manifest: trigger.incident-created-trigger).
// To jest zwykła funkcja Forge, a nie resolver: Jira woła ją z (event, context), więc resolver.define by tu nie zadziałał.
export async function issueCreatedTrigger(event) {
  try {
    const issueKey = event?.issue?.key;
    if (!issueKey) return;

    const response = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=issuetype,project`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) {
      console.error(`Trigger: nie udało się pobrać ${issueKey}`);
      return;
    }
    const issue = await response.json();

    // Typ alertu z konfiguracji projektu (z fallbackiem do globalnej)
    const projectConfig = await storage.get(`project_config_${issue.fields.project.key}`);
    const globalConfig = await storage.get('global_config');
    const incidentTypeId = projectConfig?.incidentIssueTypeId || globalConfig?.incidentIssueTypeId;
    if (!incidentTypeId || issue.fields.issuetype.id !== incidentTypeId) return;

    // Alerty z formularza przetwarza createIncident i oznacza je znacznikiem; czekamy, aż ten znacznik się pojawi
    await sleep(8000);
    await processIncidentLogic(issueKey, 'system', null, { dedupe: true });
  } catch (error) {
    console.error('Trigger error:', error);
  }
}

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
    
    debug('getStatistics - JQL:', jql);
    
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
    
    debug(`getStatistics - znaleziono ${issues.length} zgłoszeń`);
    
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
    
    debug('getStatistics - trendData entries:', Object.keys(trendData).length);
    debug('getStatistics - sample trendData:', Object.entries(trendData).slice(0, 5));
    debug('getStatistics - totalIssues:', issues.length);
    
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
    if (!await isConfigAdmin(payload?.projectKey)) return NO_ADMIN_RESPONSE;
    const { webhookUrl, projectKey } = payload;
    
    if (!webhookUrl) {
      return { success: false, error: 'Webhook URL is required' };
    }
    
    debug('Testowanie webhooka Teams:', maskWebhookUrl(webhookUrl));
    debug('Project key:', projectKey);
    
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
    
    // Utwórz testową wiadomość (Adaptive Card dla Teams Workflows)
    const testPayload = buildTeamsMessage({
      title: '🧪 Test powiadomień Teams',
      subtitle: 'To jest testowa wiadomość z systemu zarządzania alertami',
      facts: [
        { name: 'Status', value: 'Test połączenia' },
        { name: 'Czas', value: new Date().toLocaleString('pl-PL') },
        { name: 'Projekt', value: projectKey || 'Globalny' }
      ],
      actions: [{ title: 'Otwórz Jira', url: jiraBaseUrl }]
    });
    
    debug('Wysyłam testową wiadomość do Teams...');
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    
    debug('Odpowiedź z Teams webhook:', response.status, response.statusText);
    
    if (response.ok) {
      const responseText = await response.text();
      debug('Odpowiedź z Teams (sukces):', responseText);
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

// ============================================================================
// METRYKI WG POLA - agregacja zgłoszeń po wybranym polu (osoba, domena, zespół...)
// ============================================================================
const BUILTIN_METRIC_FIELDS = [
  { id: 'reporter', name: 'Zgłaszający (user)' },
  { id: 'assignee', name: 'Dyżurny / przypisany (user)' },
  { id: 'domain', name: 'Domena' },
  { id: 'team', name: 'Zespół' },
  { id: 'priority', name: 'Priorytet' },
  { id: 'status', name: 'Status' }
];

const METRIC_MAX_ISSUES = 2000;
const METRIC_MAX_BUCKETS = 20;


resolver.define('getFieldMetricOptions', async ({ payload }) => {
  try {
    const { projectKey } = payload || {};
    const projectConfig = (projectKey && await storage.get(`project_config_${projectKey}`)) || {};
    const configured = asArray(projectConfig.fieldsConfig?.configuredFields)
      .filter(field => field.enabled && !['summary', 'description', 'priority'].includes(field.id))
      .map(field => ({ id: field.id, name: field.name || field.id }));
    return { success: true, options: [...BUILTIN_METRIC_FIELDS, ...configured] };
  } catch (error) {
    console.error('Error in getFieldMetricOptions:', error);
    return { success: false, error: error.message };
  }
});

resolver.define('getFieldMetrics', async ({ payload }) => {
  try {
    const { projectKey, issueTypeId, timeRange, field } = payload || {};
    if (!projectKey || !issueTypeId || !field) {
      return { success: false, error: 'Brak wymaganych parametrów: projectKey, issueTypeId, field' };
    }

    const days = { week: 7, month: 30, '30days': 30, '180days': 180 }[timeRange] || 30;
    const dateStr = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const jql = `project = ${projectKey} AND issuetype = ${issueTypeId} AND created >= "${dateStr}" ORDER BY created DESC`;

    const cfg = await loadProjectTeamsConfig(projectKey);
    const fields = ['status', 'priority', 'created', 'resolutiondate', 'assignee', 'reporter', 'labels'];
    if (cfg.projectConfig.domainFieldId) fields.push(cfg.projectConfig.domainFieldId);
    if (field.startsWith('customfield_') || !BUILTIN_METRIC_FIELDS.some(b => b.id === field)) {
      fields.push(field);
    }

    // Paginacja po nextPageToken (jedna strona to maks. 100 zgłoszeń)
    const issues = [];
    let nextPageToken;
    do {
      const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, maxResults: 100, fields, ...(nextPageToken ? { nextPageToken } : {}) })
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch issues: ${await response.text()}`);
      }
      const page = await response.json();
      issues.push(...(page.issues || []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken && issues.length < METRIC_MAX_ISSUES);

    const now = Date.now();
    const buckets = new Map();
    for (const issue of issues) {
      const created = new Date(issue.fields.created).getTime();
      const resolvedAt = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate).getTime() : null;
      const isDone = issue.fields.status?.statusCategory?.key === 'done' || !!resolvedAt;
      const priority = issue.fields.priority?.name || 'Brak';

      for (const { key, label } of extractMetricValues(issue, field, { ...cfg, defaultDomainId: cfg.projectConfig?.defaultDomainId, domainFieldId: cfg.projectConfig?.domainFieldId })) {
        if (!buckets.has(key)) {
          buckets.set(key, { key, label, total: 0, open: 0, resolved: 0, resolutionMsSum: 0, resolutionCount: 0, openAgeMsSum: 0, byPriority: {} });
        }
        const b = buckets.get(key);
        b.total++;
        b.byPriority[priority] = (b.byPriority[priority] || 0) + 1;
        if (isDone) {
          b.resolved++;
          if (resolvedAt && resolvedAt > created) {
            b.resolutionMsSum += resolvedAt - created;
            b.resolutionCount++;
          }
        } else {
          b.open++;
          b.openAgeMsSum += now - created;
        }
      }
    }

    let rows = [...buckets.values()]
      .map(b => ({
        key: b.key,
        label: b.label,
        total: b.total,
        open: b.open,
        resolved: b.resolved,
        avgResolutionMs: b.resolutionCount > 0 ? b.resolutionMsSum / b.resolutionCount : null,
        avgOpenAgeMs: b.open > 0 ? b.openAgeMsSum / b.open : null,
        byPriority: b.byPriority
      }))
      .sort((a, b) => b.total - a.total);

    // Pokazujemy najliczniejsze wartości; liczbę pominiętych zwracamy w hiddenValues
    const hiddenCount = Math.max(0, rows.length - METRIC_MAX_BUCKETS);
    if (hiddenCount > 0) rows = rows.slice(0, METRIC_MAX_BUCKETS);

    return {
      success: true,
      field,
      rows,
      totalIssues: issues.length,
      truncated: issues.length >= METRIC_MAX_ISSUES,
      hiddenValues: hiddenCount
    };
  } catch (error) {
    console.error('Error in getFieldMetrics:', error);
    return { success: false, error: error.message };
  }
});

// Export handler for resolver functions
export const handler = resolver.getDefinitions();

