// Czysta walidacja importu konfiguracji projektu. Testowana w test/configImport.test.js.

// Pola konfiguracji, które można przenosić między środowiskami (development, produkcja) lub z kopii zapasowej
export const TRANSFERABLE_KEYS = [
  'incidentIssueTypeId', 'jiraInstanceUrl', 'defaultPriority', 'enableAutoProcessing',
  'fieldsConfig', 'priorityRules', 'domains', 'defaultDomainId', 'domainFieldId', 'domainFieldMulti', 'escalationTeams', 'teamSchedule'
];

// Zwraca listę błędów struktury; pusta lista oznacza, że można importować
export function validateImport(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Oczekiwano obiektu JSON'];

  const list = (key, requiredFields) => {
    if (data[key] === undefined) return;
    if (!Array.isArray(data[key])) {
      errors.push(`"${key}" musi być listą`);
      return;
    }
    data[key].forEach((item, i) => {
      requiredFields.forEach(field => {
        if (!item || item[field] === undefined || item[field] === '') errors.push(`${key}[${i}]: brak pola "${field}"`);
      });
    });
  };
  list('domains', ['id', 'name', 'teamId']);
  list('escalationTeams', ['id', 'name']);
  list('teamSchedule', ['teamId', 'startDate', 'endDate']);

  if (Array.isArray(data.escalationTeams) && Array.isArray(data.domains)) {
    const teamIds = new Set(data.escalationTeams.map(t => t && t.id));
    data.domains.forEach(d => {
      if (d && !teamIds.has(d.teamId)) errors.push(`Domena "${d.name}" wskazuje nieistniejący zespół`);
    });
  }
  if (data.defaultDomainId && Array.isArray(data.domains) && !data.domains.some(d => d && d.id === data.defaultDomainId)) {
    errors.push('Domena domyślna nie istnieje na liście domen');
  }
  return errors;
}
