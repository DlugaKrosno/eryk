// Czysta logika routingu alertów (domena -> zespół -> dyżurny) i agregacji metryk.
// Bez zależności od Forge, dzięki czemu da się ją testować samym Node (npm test).

// Id domeny ma postać 'domain-<znacznik>' i jest jednocześnie labelem alertu
export const DOMAIN_LABEL_PREFIX = 'domain-';

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseScheduleDate(value, endOfDay) {
  if (!value) return null;
  const str = String(value);
  // Daty bez godziny traktujemy jako cały dzień (w przeciwnym razie ostatni dzień dyżuru by nie wchodził)
  const date = new Date(str.length === 10 ? `${str}T${endOfDay ? '23:59:59' : '00:00:00'}` : str);
  return isNaN(date.getTime()) ? null : date;
}

export function findDutyEntry(schedule, teamId, now = new Date()) {
  return asArray(schedule).find(entry => {
    if (entry.teamId !== teamId) return false;
    const start = parseScheduleDate(entry.startDate, false);
    const end = parseScheduleDate(entry.endDate, true);
    return start && end && now >= start && now <= end;
  }) || null;
}

// Zwraca domenę i jej zespół; wyłączona domena nie routuje
export function resolveDomainTeam(cfg, domainId) {
  const domain = asArray(cfg.domains).find(d => d.id === domainId && d.enabled !== false) || null;
  const team = domain ? (asArray(cfg.teams).find(t => t.id === domain.teamId) || null) : null;
  return { domain, team };
}

// Domena zapisana w labelu alertu
export function domainIdFromLabels(labels) {
  const label = asArray(labels).find(l => typeof l === 'string' && l.startsWith(DOMAIN_LABEL_PREFIX));
  return label || null;
}

// Obserwatorzy alertu: team leaderzy i product ownerzy zespołu (+ PO domeny ze starego modelu), bez duplikatów
export function collectWatchers(team, domain) {
  return [...new Set([
    ...asArray(team?.teamLeaders),
    ...asArray(team?.productOwners),
    ...asArray(domain?.productOwners)
  ])];
}

// Adresy webhooków to sekrety - zwykli użytkownicy dostają tylko informację, czy są ustawione
export function redactTeamSecrets(config) {
  return {
    ...config,
    escalationTeams: asArray(config.escalationTeams).map(team => {
      const { teamsWebhookUrl, dutyDmWorkflowUrl, ...safe } = team;
      return { ...safe, hasWebhook: !!teamsWebhookUrl, hasDutyDm: !!dutyDmWorkflowUrl };
    })
  };
}

// Wartości pola alertu do metryk: lista {key, label}; pole wielokrotnego wyboru liczy alert w każdej wartości
export function extractMetricValues(issue, fieldId, ctx) {
  const f = issue.fields || {};
  const single = (key, label) => [{ key: String(key), label: String(label) }];
  const none = (label) => single('__none__', label);

  switch (fieldId) {
    case 'reporter':
      return f.reporter ? single(f.reporter.accountId, f.reporter.displayName) : none('Brak');
    case 'assignee':
      return f.assignee ? single(f.assignee.accountId, f.assignee.displayName) : none('Nieprzypisane');
    case 'priority':
      return f.priority ? single(f.priority.name, f.priority.name) : none('Brak');
    case 'status':
      return f.status ? single(f.status.name, f.status.name) : none('Brak');
    case 'domain':
    case 'team': {
      const domainId = pickDomainId({
        fieldValue: ctx.domainFieldId ? f[ctx.domainFieldId] : null,
        labels: f.labels,
        fallback: ctx.defaultDomainId,
        domains: ctx.domains
      });
      const domain = asArray(ctx.domains).find(d => d.id === domainId);
      if (!domain) return none('Bez domeny');
      if (fieldId === 'domain') return single(domain.id, domain.name);
      const team = asArray(ctx.teams).find(t => t.id === domain.teamId);
      return team ? single(team.id, team.name) : none('Bez zespołu');
    }
    default: {
      const raw = f[fieldId];
      if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
        return none('Brak wartości');
      }
      const toValue = (v) => {
        if (v && typeof v === 'object') {
          const label = v.displayName || v.value || v.name || v.key || JSON.stringify(v);
          return { key: String(v.accountId || v.id || label), label: String(label) };
        }
        return { key: String(v), label: String(v) };
      };
      return (Array.isArray(raw) ? raw : [raw]).map(toValue);
    }
  }
}

// ---------------------------------------------------------------------------
// Harmonogram dyżurów: kto co może zmieniać i walidacja
// ---------------------------------------------------------------------------

// Zespoły, których harmonogram może zmieniać użytkownik: administrator - wszystkie, team leader - swoje
export function editableTeamIds({ isAdmin, teams, accountId }) {
  return asArray(teams)
    .filter(team => isAdmin || (accountId && asArray(team.teamLeaders).includes(accountId)))
    .map(team => team.id);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Błędy walidacji wpisów harmonogramu (pusta lista = poprawne). Dyżurny musi być delegatem zespołu.
export function validateSchedule(entries, teams) {
  const errors = [];
  const teamById = new Map(asArray(teams).map(t => [t.id, t]));
  const byTeam = new Map();

  asArray(entries).forEach((entry, i) => {
    const label = `Dyżur ${i + 1}`;
    const team = teamById.get(entry?.teamId);
    if (!team) {
      errors.push(`${label}: nieznany zespół`);
      return;
    }
    if (!ISO_DATE.test(entry.startDate || '') || !ISO_DATE.test(entry.endDate || '')) {
      errors.push(`${label} (${team.name}): niepoprawna data`);
      return;
    }
    if (entry.endDate < entry.startDate) {
      errors.push(`${label} (${team.name}): koniec przed początkiem`);
      return;
    }
    if (!entry.assignedPerson || !asArray(team.delegates).includes(entry.assignedPerson)) {
      errors.push(`${label} (${team.name}): dyżurny musi być delegatem zespołu`);
      return;
    }
    const list = byTeam.get(team.id) || [];
    const clash = list.find(other => entry.startDate <= other.endDate && other.startDate <= entry.endDate);
    if (clash) errors.push(`${label} (${team.name}): nakłada się na inny dyżur tego zespołu`);
    list.push(entry);
    byTeam.set(team.id, list);
  });
  return errors;
}

// Łączy zapisany harmonogram z przesłanym: wpisy zespołów, których użytkownik nie może zmieniać, zostają bez zmian
export function mergeSchedule(existing, submitted, editableIds) {
  const editable = new Set(editableIds);
  return [
    ...asArray(existing).filter(entry => !editable.has(entry.teamId)),
    ...asArray(submitted).filter(entry => editable.has(entry.teamId))
  ];
}

// ---------------------------------------------------------------------------
// Domena z pola Jira (jednokrotnego wyboru): opcja pola <-> domena (domain.optionId)
// ---------------------------------------------------------------------------
// Pole jednokrotnego wyboru daje jedną wartość, pole wielokrotnego wyboru listę: bierzemy pierwszą, która ma domenę
export function domainIdFromField(fieldValue, domains) {
  const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  for (const value of values) {
    if (!value) continue;
    const optionId = typeof value === 'object' ? value.id : value;
    if (optionId === undefined || optionId === null) continue;
    const domain = asArray(domains).find(d => d.optionId !== undefined && d.optionId !== null && String(d.optionId) === String(optionId));
    if (domain) return domain.id;
  }
  return null;
}

// Kolejność: pole Jira (można je zmienić w alercie i trasa się zmieni) > label > zapis z formularza > domena domyślna
export function pickDomainId({ fieldValue, labels, stored, fallback, domains }) {
  return domainIdFromField(fieldValue, domains) || domainIdFromLabels(labels) || stored || fallback || null;
}

// Wartość pola domeny w Jirze: lista z jednym elementem dla pola wielokrotnego wyboru, obiekt dla jednokrotnego
export function domainFieldPayload(optionId, multi) {
  const option = { id: String(optionId) };
  return multi ? [option] : option;
}
