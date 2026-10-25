// Import domen z opcji pola Jira (jednokrotnego wyboru). Czyste funkcje, testowane w test/domainImport.test.js.

const norm = (name) => String(name || '').trim().toLowerCase();

const emptyTeam = (id, name) => ({
  id, name, description: '', teamLeaders: [], productOwners: [], delegates: [], teamsWebhookUrl: '', dutyDmWorkflowUrl: ''
});

// Plan: które opcje utworzą nowe domeny, które połączą się z istniejącymi (po nazwie), a które już są powiązane
export function planFieldImport(options, domains) {
  const toCreate = [];
  const toLink = [];
  let unchanged = 0;
  const seen = new Set();

  for (const option of options || []) {
    const optionId = String(option.id);
    const name = String(option.name || option.value || optionId).trim();
    if (!name || seen.has(optionId)) continue;
    seen.add(optionId);

    if (domains.some(d => d.optionId !== undefined && d.optionId !== null && String(d.optionId) === optionId)) {
      unchanged++;
      continue;
    }
    const sameName = domains.find(d => (d.optionId === undefined || d.optionId === null || d.optionId === '') && norm(d.name) === norm(name));
    if (sameName) toLink.push({ domainId: sameName.id, optionId, name });
    else toCreate.push({ optionId, name });
  }
  return { toCreate, toLink, unchanged };
}

// Stosuje plan: łączy istniejące domeny z opcjami, a dla nowych tworzy domenę i jej zespół
export function applyFieldImport(plan, domains, teams, stamp = Date.now()) {
  const linked = domains.map(domain => {
    const link = plan.toLink.find(l => l.domainId === domain.id);
    return link ? { ...domain, optionId: link.optionId } : domain;
  });

  const newTeams = [];
  const newDomains = plan.toCreate.map((item, i) => {
    const teamId = `team-${stamp}-${i}`;
    newTeams.push(emptyTeam(teamId, item.name));
    return { id: `domain-${stamp}-${i}`, name: item.name, description: '', teamId, optionId: item.optionId, enabled: true };
  });

  return { domains: [...linked, ...newDomains], teams: [...teams, ...newTeams] };
}
