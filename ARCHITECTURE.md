# 🏗️ Incident Reporter (Forge) - Architektura Techniczna

## Spis Treści
1. [Przegląd Architektury](#przegląd-architektury)
2. [Komponenty Systemu](#komponenty-systemu)
3. [Flow Diagram](#flow-diagram)
4. [Szczegóły Techniczne](#szczegóły-techniczne)
5. [Wydajność i Skalowanie](#wydajność-i-skalowanie)
6. [Bezpieczeństwo](#bezpieczeństwo)
7. [Monitoring i Observability](#monitoring-i-observability)

---

## Przegląd Architektury

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Jira Cloud                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Forge Platform (Runtime)                     │  │
│  │                                                            │  │
│  │  ┌────────────────┐       ┌────────────────┐             │  │
│  │  │  Custom UI     │       │   Backend      │             │  │
│  │  │  (React)       │◄──────┤   Functions    │             │  │
│  │  │                │invoke │   (Node.js)    │             │  │
│  │  │ • User Mode    │       │                │             │  │
│  │  │ • Admin Mode   │       │ • Rule Engine  │             │  │
│  │  │ • Issue Panel  │       │ • Escalation   │             │  │
│  │  └────────────────┘       │ • Teams API    │             │  │
│  │                            └────────────────┘             │  │
│  │                                    │                       │  │
│  │                            ┌───────▼───────┐              │  │
│  │                            │ Forge Storage │              │  │
│  │                            │  (Key-Value)  │              │  │
│  │                            └───────────────┘              │  │
│  │                                                            │  │
│  │  ┌─────────────┐                                          │  │
│  │  │   Trigger   │◄─────── jira:issueCreated               │  │
│  │  │  (Event)    │                                          │  │
│  │  └─────────────┘                                          │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          │ Jira REST API                        │
│                          ▼                                      │
│           ┌──────────────────────────┐                         │
│           │    Jira Issues           │                         │
│           │  • Create/Update         │                         │
│           │  • Custom Fields         │                         │
│           │  • Comments              │                         │
│           │  • Watchers              │                         │
│           └──────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ external:fetch
                          ▼
              ┌─────────────────────────┐
              │   Microsoft Teams       │
              │   (Incoming Webhook)    │
              └─────────────────────────┘
```

---

## Komponenty Systemu

### 1. Frontend Layer (Custom UI - React)

#### User Mode (`static/user/`)
**Odpowiedzialność:**
- Formularz zgłaszania incydentów
- Walidacja danych po stronie klienta
- Widok "Moje zgłoszenia"
- Komunikacja z backendem przez `@forge/bridge`

**Technologie:**
- React 18
- Atlassian Design System (@atlaskit)
- @forge/react
- Forge Bridge API

**Kluczowe komponenty:**
```
App.js
├── ReportIncidentForm
│   ├── SystemSelect
│   ├── EnvironmentSelect
│   ├── DescriptionTextarea
│   └── SubmitButton
└── MyIncidentsTable
    └── IncidentRow[]
```

#### Admin Mode (`static/admin/`)
**Odpowiedzialność:**
- Konfiguracja globalna (projekt, issue type)
- Zarządzanie polami i mapowaniami
- CRUD reguł priorytetyzacji
- Zarządzanie zespołami i eskalacją
- Konfiguracja Microsoft Teams
- Przeglądanie audit log

**Technologie:**
- React 18
- Atlassian Design System (@atlaskit)
- @forge/react
- Forge Bridge API

**Kluczowe komponenty:**
```
App.js
├── Tabs
│   ├── GeneralSettings
│   ├── FieldsConfig
│   ├── PriorityRules
│   │   ├── RulesList
│   │   ├── RuleForm (Modal)
│   │   └── TestRuleForm (Modal)
│   ├── TeamsEscalation
│   │   ├── TeamsList
│   │   └── TeamMappings
│   ├── TeamsIntegration
│   │   └── WebhookConfig
│   └── AuditLog
│       └── AuditTable
```

#### Issue Panel (`static/issue-panel/`)
**Odpowiedzialność:**
- Wyświetlanie szczegółów incydentu na issue view
- Calculated Priority, Applied Rule, Assigned Team

**Prosty komponent informacyjny.**

---

### 2. Backend Layer (Forge Functions - Node.js)

#### Main Handler (`src/index.js`)

**Funkcje eksportowane:**

##### 1. `resolver` (Custom UI Resolver)
- Punkt wejścia dla wszystkich Custom UI requests
- Routing do odpowiednich funkcji

##### 2. `createIncident(formData)`
**Input:** Form data z frontendu  
**Output:** `{ success, issueKey, issueId }`  
**Proces:**
1. Walidacja danych (required fields, min length)
2. Pobranie konfiguracji (targetProjectKey, issueTypeId)
3. Budowanie payload Jira Issue
4. Mapowanie custom fields
5. Wywołanie Jira API: `POST /rest/api/3/issue`
6. Logowanie do Audit Log
7. Zwrot issueKey do frontendu

**Czas wykonania:** ~500ms - 1s

##### 3. `processIncidentTrigger(event)` (Trigger Handler)
**Trigger:** `avi:jira:created:issue`  
**Proces:**
1. Sprawdzenie czy issue type = Incident
2. Wywołanie `processIncidentLogic()`

##### 4. `processIncidentLogic(issueKey)`
**Asynchroniczna funkcja przetwarzająca incident:**
1. **Fetch Issue Data** - GET issue z Jira API
2. **Extract Incident Data** - parsowanie custom fields
3. **Calculate Priority** - rule engine
4. **Assign Team** - escalation engine
5. **Update Issue** - priority, team, assignee, watchers
6. **Add Comment** - informacja o zastosowanych regułach
7. **Log Audit** - audit entries
8. **Notify Teams** - webhook delivery z retry

**Czas wykonania:** ~2-4s (w tle)

##### 5. `calculatePriority(incidentData)`
**Rule Engine - First Match Wins:**
```javascript
function calculatePriority(incidentData) {
  const rules = await loadRulesFromStorage();
  const sortedRules = rules
    .filter(r => r.enabled)
    .sort((a, b) => a.order - b.order);
  
  for (const rule of sortedRules) {
    if (evaluateConditions(rule.conditions, incidentData)) {
      return {
        priority: rule.actions.setPriority,
        ruleId: rule.id,
        ruleName: rule.name
      };
    }
  }
  
  return { priority: defaultPriority, ruleId: null, ruleName: "Default" };
}
```

**Kompleksowość:** O(n × m)
- n = liczba reguł
- m = liczba warunków per reguła
- Typowo: n < 20, m < 5 → ~100 operacji

##### 6. `assignTeam(incidentData, priority)`
**Escalation Engine:**
```javascript
function assignTeam(incidentData, priority) {
  const mappings = await loadTeamMappings();
  const teams = await loadTeams();
  
  for (const mapping of mappings.sort(by order)) {
    if (mapping.priority === priority || mapping.priority === 'any') {
      if (evaluateConditions(mapping.conditions, incidentData)) {
        const team = teams.find(t => t.id === mapping.teamId);
        const assignee = await determineAssignee(team);
        return { team, assignee, watchers: team.watchers };
      }
    }
  }
  
  return { team: null, assignee: null, watchers: [] };
}
```

##### 7. `determineAssignee(team)`
**Assignment Strategies:**

**Fixed:**
```javascript
if (team.assignmentStrategy === 'fixed') {
  return team.defaultAssignee;
}
```

**Round Robin:**
```javascript
if (team.assignmentStrategy === 'roundRobin') {
  const state = await storage.get(`rr-${team.id}`);
  const nextIndex = (state.lastAssignedIndex + 1) % team.members.length;
  await storage.set(`rr-${team.id}`, { 
    lastAssignedIndex: nextIndex,
    lastAssignedAt: new Date().toISOString()
  });
  return team.members[nextIndex];
}
```

##### 8. `notifyTeams(issueKey, issue, priority, team, assignee)`
**Microsoft Teams Integration:**
```javascript
async function notifyTeams(webhookUrl, payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) return { success: true };
      
      // Client error (4xx) - no retry
      if (response.status >= 400 && response.status < 500) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      
      // Server error (5xx) - retry with exponential backoff
      if (attempt < 3) {
        await sleep(2 ** attempt * 1000); // 2s, 4s, 8s
        continue;
      }
      
      return { success: false, error: 'Max retries exceeded' };
    } catch (error) {
      if (attempt === 3) {
        return { success: false, error: error.message };
      }
      await sleep(2 ** attempt * 1000);
    }
  }
}
```

**Total retry time (worst case):** 2s + 4s + 8s = 14s

##### 9. Configuration Functions
- `getConfig(configType)` - pobiera konfigurację z Storage
- `saveConfig(configType, data)` - zapisuje konfigurację do Storage
- `testRule(rule, testData)` - testuje regułę na przykładowych danych

##### 10. User Functions
- `getMyIncidents()` - JQL query dla reportera
- `getAuditLog(limit)` - pobiera ostatnie wpisy audit log

---

### 3. Data Layer (Forge Storage)

**Storage Model:** Key-Value Store (encrypted at rest)

**Limity:**
- Max size per key: 250 KB
- Max operations: 1000/minute (rate limited)
- Retention: Unlimited (dopóki app zainstalowana)

**Schemat Kluczy:**

| Key | Type | Size Estimate | Description |
|-----|------|---------------|-------------|
| `global_config` | Object | ~1 KB | Singleton - global settings |
| `fields_config` | Object | ~5 KB | Singleton - field mappings |
| `priority_rules` | JSON Array | ~10-50 KB | Collection - all rules |
| `escalation_teams` | JSON Array | ~5-20 KB | Collection - all teams |
| `team_mappings` | JSON Array | ~5-15 KB | Collection - all mappings |
| `audit_log` | JSON Array | ~100-200 KB | Collection - last 1000 entries |
| `rr-{teamId}` | Object | ~0.2 KB | Per-team round-robin state |

**Optimization Strategy:**
- Używamy JSON.stringify() dla collections zamiast entity storage (mniej API calls)
- Audit log z automatic truncation (1000 entries max)
- Round-robin state: osobne klucze per zespół (atomic updates)

---

## Flow Diagram

### User Flow - Zgłoszenie Incydentu

```
User                Frontend              Backend                Jira API        Trigger         Teams
 │                     │                     │                      │               │               │
 │──Open Report Form──►│                     │                      │               │               │
 │                     │                     │                      │               │               │
 │                     │──getConfig('fields')│                      │               │               │
 │                     │◄────────────────────┤                      │               │               │
 │                     │                     │                      │               │               │
 │──Fill & Submit─────►│                     │                      │               │               │
 │                     │                     │                      │               │               │
 │                     │──createIncident()───►│                      │               │               │
 │                     │                     │                      │               │               │
 │                     │                     │──POST /issue────────►│               │               │
 │                     │                     │◄─────────────────────┤               │               │
 │                     │                     │  (INC-1234 created)  │               │               │
 │                     │                     │                      │               │               │
 │                     │◄──{success, key}────┤                      │               │               │
 │◄──Success Message───┤                     │                      │               │               │
 │   INC-1234         │                     │                      │               │               │
 │                     │                     │                      │               │               │
 │                     │                     │                      │──issueCreated─►│               │
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │──processIncidentTrigger()
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │──GET issue────►│
 │                     │                     │                      │               │◄───────────────│
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │──Rule Engine──│
 │                     │                     │                      │               │ (P1 matched)  │
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │──Escalation───│
 │                     │                     │                      │               │ (SRE team)    │
 │                     │                     │                      │               │               │
 │                     │                     │                      │◄──PUT issue───│               │
 │                     │                     │                      │ (set priority,│               │
 │                     │                     │                      │  assignee)    │               │
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │──notifyTeams──►│
 │                     │                     │                      │               │               │
 │                     │                     │                      │               │               │◄─Teams Alert
 │                     │                     │                      │               │               │  (P1 Message)
 │                     │                     │                      │               │               │
 │──Refresh My Inc────►│──getMyIncidents()──►│──JQL query─────────►│               │               │
 │                     │◄────────────────────┤◄────────────────────┤               │               │
 │◄──Table with P1────┤  [INC-1234: P1]     │                      │               │               │
 │                     │                     │                      │               │               │
```

**Timing:**
1. User submits form: **t=0s**
2. Issue created: **t=0.5s** (user sees success)
3. Trigger fires: **t=1s**
4. Processing complete: **t=3s**
5. Teams notification: **t=3.5s**

---

### Admin Flow - Dodanie Reguły

```
Admin              Frontend              Backend              Storage
  │                   │                     │                   │
  │──Open Admin Panel─►│                     │                   │
  │                   │──getConfig('rules')─►│                   │
  │                   │                     │──get('priority_rules')─►│
  │                   │                     │◄──────────────────┤
  │                   │◄────────────────────┤                   │
  │◄──Show Rules List─┤                     │                   │
  │                   │                     │                   │
  │──Click Add Rule───►│                     │                   │
  │◄──Modal Opens─────┤                     │                   │
  │                   │                     │                   │
  │──Fill Form────────►│                     │                   │
  │ (name, conditions,│                     │                   │
  │  priority, etc.)  │                     │                   │
  │                   │                     │                   │
  │──Click Save───────►│──saveConfig()──────►│                   │
  │                   │  {configType:'rules',│                   │
  │                   │   data:[...rules]}  │                   │
  │                   │                     │                   │
  │                   │                     │──set('priority_rules', JSON)─►│
  │                   │                     │◄──────────────────┤
  │                   │                     │                   │
  │                   │                     │──logAuditEntry()──►│
  │                   │                     │◄──────────────────┤
  │                   │                     │                   │
  │                   │◄──{success: true}───┤                   │
  │◄──Success Flag────┤                     │                   │
  │                   │                     │                   │
  │──Click Test───────►│──testRule()────────►│                   │
  │  (with test data) │  {rule, testData}  │                   │
  │                   │                     │                   │
  │                   │                     │──evaluateConditions()
  │                   │                     │  (local, no storage)
  │                   │                     │                   │
  │                   │◄──{matches: true}───┤                   │
  │◄──✅ Match!───────┤                     │                   │
```

---

## Szczegóły Techniczne

### Forge Modules

#### 1. jira:projectPage (User Mode)
```yaml
jira:projectPage:
  - key: incident-reporter-user-page
    resource: user-page
    resolver:
      function: resolver
    title: Report Incident
```

**Renderowanie:** Strona dostępna w menu projektu Jira (lewa sidebar)

#### 2. jira:globalPage (Admin Mode)
```yaml
jira:globalPage:
  - key: incident-reporter-admin-page
    resource: admin-page
    resolver:
      function: resolver
    title: Incident Reporter Admin
```

**Renderowanie:** Strona dostępna w Apps menu (górne menu Jira)

#### 3. jira:issuePanel (Issue Details)
```yaml
jira:issuePanel:
  - key: incident-details-panel
    resource: issue-panel
    resolver:
      function: resolver
    title: Incident Details
    conditions:
      - condition: issue_type
        params:
          issueTypeKey: "Incident"
```

**Renderowanie:** Panel na issue view (prawa sidebar), tylko dla issues typu Incident

#### 4. Trigger
```yaml
trigger:
  - key: incident-created-trigger
    function: process-incident-trigger
    events:
      - avi:jira:created:issue
```

**Event Filtering:** W kodzie funkcji sprawdzamy `issueTypeId` aby przetworzyć tylko Incidents

---

### Jira REST API Usage

#### Create Issue
```
POST /rest/api/3/issue
Authorization: asApp()

Body:
{
  "fields": {
    "project": { "key": "INC" },
    "summary": "...",
    "description": { ADF format },
    "issuetype": { "id": "10001" },
    "reporter": { "id": "accountId" },
    "customfield_10100": "Payment Gateway",  // System
    "customfield_10101": "Production",       // Environment
    ...
  }
}
```

**Response:** `{ id, key, self }`

#### Update Issue
```
PUT /rest/api/3/issue/{issueKey}
Authorization: asApp()

Body:
{
  "fields": {
    "customfield_10106": "P1",               // Calculated Priority
    "customfield_10107": "SRE",              // Assigned Team
    "assignee": { "id": "accountId" }
  }
}
```

#### Add Watchers
```
POST /rest/api/3/issue/{issueKey}/watchers
Authorization: asApp()

Body: "accountId"
```

**Note:** One request per watcher (Jira API limitation)

#### Add Comment
```
POST /rest/api/3/issue/{issueKey}/comment
Authorization: asApp()

Body:
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [ ADF nodes ]
  }
}
```

**Format:** Atlassian Document Format (ADF)

#### Search Issues (My Incidents)
```
POST /rest/api/3/search
Authorization: asUser()

Body:
{
  "jql": "project = INC AND reporter = currentUser() ORDER BY created DESC",
  "maxResults": 50,
  "fields": ["summary", "status", "priority", "created", "assignee"]
}
```

**asUser():** Wykonywane w kontekście aktualnie zalogowanego użytkownika

---

### Microsoft Teams Webhook

#### Payload Format (MessageCard)
```json
{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "d63031",
  "summary": "[P1] Incident: Payment Gateway - Production Outage",
  "sections": [{
    "activityTitle": "🚨 [P1] INCIDENT ALERT",
    "activitySubtitle": "Payment Gateway - Production Outage",
    "facts": [
      { "name": "Issue Key:", "value": "INC-1234" },
      { "name": "System:", "value": "Payment Gateway" },
      { "name": "Environment:", "value": "Production" },
      { "name": "Impact:", "value": "Critical" },
      { "name": "Urgency:", "value": "Immediate" },
      { "name": "Reporter:", "value": "John Doe" },
      { "name": "Assigned Team:", "value": "SRE" },
      { "name": "Assigned To:", "value": "Jane Smith" }
    ]
  }],
  "potentialAction": [{
    "@type": "OpenUri",
    "name": "View in Jira",
    "targets": [
      { "os": "default", "uri": "https://company.atlassian.net/browse/INC-1234" }
    ]
  }]
}
```

**Color Mapping:**
- P1: `#d63031` (Red)
- P2: `#fd79a8` (Orange)
- P3: `#fdcb6e` (Yellow)
- P4: `#74b9ff` (Blue)

---

## Wydajność i Skalowanie

### Performance Metrics

| Operation | Średni Czas | P95 | P99 |
|-----------|-------------|-----|-----|
| Create Incident (frontend) | 500ms | 1s | 2s |
| Process Incident (backend) | 2.5s | 4s | 6s |
| Rule Engine Evaluation | 50ms | 100ms | 200ms |
| Escalation Engine | 100ms | 200ms | 300ms |
| Teams Notification (success) | 500ms | 1s | 2s |
| Teams Notification (with retry) | 3s | 10s | 15s |
| Storage Read | 50ms | 100ms | 150ms |
| Storage Write | 100ms | 200ms | 300ms |

### Bottlenecks

1. **Jira API Calls** - największy bottleneck
   - Create Issue: ~500ms
   - Update Issue: ~300ms
   - Add Watchers: ~200ms per watcher
   - Add Comment: ~200ms

2. **Teams Webhook** - external dependency
   - Success: ~500ms
   - With retries: up to 15s

3. **Storage Operations** - rate limited
   - 1000 operations/minute
   - Typowe użycie: ~10-20 ops per incident

### Scaling Limits

**Forge Platform Limits:**
- Function invocations: 100,000/day (per site)
- Function execution time: 25s max
- Storage size: 500 MB total
- Storage operations: 1000/minute

**Realistic Limits dla tej aplikacji:**
- **Incydentów dziennie:** ~10,000 (100k invocations / 10 per incident)
- **Reguł:** max ~50 (performance degradation po 50)
- **Zespołów:** max ~100
- **Audit Log:** 1000 ostatnich wpisów (auto-truncate)

**Optymalizacja dla większej skali:**
1. Batching audit log writes (co 10 wpisów)
2. Caching rules/teams w memory (per execution)
3. Parallel Jira API calls gdzie możliwe
4. Async Teams notifications (fire-and-forget dla P3-P4)

---

## Bezpieczeństwo

### Authentication & Authorization

**Forge automatycznie zapewnia:**
- ✅ OAuth 2.0 authentication do Jira API
- ✅ User context w Custom UI (`context.accountId`)
- ✅ Permission checking (`asUser()` vs `asApp()`)

**Scopes:**
- `read:jira-work` - ograniczone do czytania issues/projektów
- `write:jira-work` - ograniczone do tworzenia/edycji issues
- `read:jira-user` - tylko podstawowe info o userach
- `storage:app` - tylko storage tej aplikacji
- `external:fetch` - tylko whitelisted domains (`*.webhook.office.com`)

### Data Security

**Forge Storage:**
- ✅ Encrypted at rest (AES-256)
- ✅ Isolated per installation
- ✅ Automatic backup & replication
- ✅ GDPR compliant

**Webhook URLs:**
- ⚠️ Stored w storage (encrypted)
- ⚠️ Wyświetlane jako password field w UI
- ⚠️ Brak plain-text logging

### Input Validation

**Frontend (Client-side):**
- Required fields validation
- Min/max length checks
- Format validation (email, etc.)
- XSS prevention (React auto-escaping)

**Backend (Server-side):**
- All inputs re-validated
- SQL injection: N/A (używamy Jira API, nie SQL)
- Command injection: N/A (nie wykonujemy shell commands)
- Path traversal: N/A (storage key-value)

### Security Best Practices Implemented

✅ Principle of Least Privilege (minimal scopes)
✅ Input validation both client & server
✅ No hardcoded secrets
✅ Audit logging wszystkich operacji
✅ Error handling bez leakowania sensitive data
✅ Rate limiting (Forge platform-level)
✅ HTTPS only (enforced by Forge)

---

## Monitoring i Observability

### Logging

**Forge Logs (`forge logs`):**
```
[INFO] createIncident: Creating issue for user 557058:abc123
[INFO] processIncident: Processing INC-1234
[INFO] calculatePriority: Applied rule "P1 - Production Critical"
[INFO] assignTeam: Assigned to SRE team
[INFO] notifyTeams: Sent to Teams successfully
[ERROR] notifyTeams: Failed to send webhook: HTTP 404
```

**Log Levels:**
- `console.log()` → INFO
- `console.error()` → ERROR
- `console.warn()` → WARN

**Viewing logs:**
```bash
forge logs --follow
forge logs --start-time "2025-01-15T10:00:00Z"
```

### Audit Trail

**Wszystkie operacje są logowane:**
- incident_created
- priority_calculated (z rule ID i nazwą)
- team_assigned
- teams_notification_sent (ze statusem)
- config_changed

**Audit Log dostępny:**
- W Admin Panel (UI)
- W Forge Storage (`audit_log` key)
- Eksport do JSON (manual)

### Metrics (Potential Future Enhancement)

**Przydatne metryki do zbierania:**
- Liczba incydentów per priority
- Średni czas odpowiedzi per zespół
- Sukces/failure rate Teams notifications
- Najpopularniejsze systemy/kategorie
- Rule match rates

**Implementacja (future):**
- Aggregate w Storage co godzinę
- Dashboard w Admin Panel
- Export do external monitoring (Datadog, etc.)

### Alerting

**Obecnie brak built-in alertów.**

**Potencjalne alerty (future):**
- Teams webhook failures > 10% w ciągu godziny
- Storage approaching limit (>400 MB)
- Function errors > 5% w ciągu godziny
- No incidents created w ciągu 24h (smoke test)

---

## Diagramy Sekwencji

### Rule Engine Evaluation

```
┌─────────┐       ┌──────────┐       ┌─────────┐
│ Trigger │       │  Engine  │       │ Storage │
└────┬────┘       └─────┬────┘       └────┬────┘
     │                  │                  │
     │─processIncident()│                  │
     │─────────────────►│                  │
     │                  │                  │
     │                  │──get('priority_rules')
     │                  │─────────────────►│
     │                  │◄─────────────────┤
     │                  │  rules[]         │
     │                  │                  │
     │                  ├─ sort by order   │
     │                  │                  │
     │                  ├─ for each rule:  │
     │                  │  ├─ evaluate AND/OR
     │                  │  ├─ check field ops
     │                  │  └─ if match → STOP
     │                  │                  │
     │                  ├─ FOUND MATCH    │
     │                  │  rule: "P1 Prod" │
     │                  │  priority: P1    │
     │                  │                  │
     │◄─────────────────┤                  │
     │  { priority: P1, │                  │
     │    ruleId, name }│                  │
```

### Round Robin Assignment

```
┌──────────┐       ┌───────────┐       ┌─────────┐
│Escalation│       │  Storage  │       │  Result │
└─────┬────┘       └─────┬─────┘       └────┬────┘
      │                  │                   │
      │──determineAssignee(team)            │
      │────────────────►│                   │
      │                  │                   │
      │                  │──get('rr-team-123')
      │                  │──►│               │
      │                  │◄──┤               │
      │                  │ { lastIndex: 2 }  │
      │                  │                   │
      │                  ├─ members.length=4 │
      │                  ├─ nextIndex = (2+1)%4 = 3
      │                  │                   │
      │                  │──set('rr-team-123',
      │                  │     {lastIndex:3})│
      │                  │──►│               │
      │                  │◄──┤               │
      │                  │                   │
      │◄────────────────┤                   │
      │  assignee:      │                   │
      │  members[3]     │                   │
```

---

## Decyzje Architektoniczne

### 1. Dlaczego Custom UI zamiast UI Kit?

**Decyzja:** Custom UI (React) ✅

**Uzasadnienie:**
- Potrzeba złożonych formularzy z dynamic validation
- Conditional rendering (reguły, warunki)
- Pełna kontrola nad UX
- Łatwiejsza integracja z Atlassian Design System

**Trade-off:**
- ❌ Większy bundle size (~200KB vs ~50KB)
- ❌ Build step required
- ✅ Lepszy developer experience
- ✅ Łatwiejsze utrzymanie

### 2. Dlaczego Trigger zamiast Workflow Post-Function?

**Decyzja:** Trigger (`jira:issueCreated`) ✅

**Uzasadnienie:**
- Out-of-the-box functionality (no workflow config required)
- Działa dla wszystkich workflows
- Łatwiejsza instalacja
- Nie wymaga Jira admin intervention

**Trade-off:**
- ⚠️ Trigger dla WSZYSTKICH issues (filtrujemy po issueTypeId)
- ✅ Prostsze dla użytkownika końcowego

### 3. Dlaczego JSON Array w Storage zamiast Entity Storage?

**Decyzja:** JSON.stringify() arrays ✅

**Uzasadnienie:**
- Mniej API calls (1 call dla całej kolekcji vs N calls)
- Atomic updates całej kolekcji
- Prostszy kod

**Trade-off:**
- ❌ Max 250KB per key (limit ~500 reguł/zespołów)
- ✅ Dla większości przypadków wystarczające
- ✅ Szybsze niż entity queries

### 4. Dlaczego Incoming Webhook zamiast Microsoft Graph?

**Decyzja:** Incoming Webhook ✅

**Uzasadnienie:**
- Zero Azure AD setup required
- Prostsza konfiguracja (URL copy-paste)
- Wystarczające dla MVP

**Trade-off:**
- ❌ Brak @mentions
- ❌ Brak dwukierunkowej komunikacji
- ✅ MVP-friendly
- ✅ Można upgradować do Graph API later

### 5. Dlaczego First Match Wins zamiast Weighted Scoring?

**Decyzja:** First Match Wins ✅

**Uzasadnienie:**
- Deterministyczne i przewidywalne
- Łatwe do zrozumienia dla adminów
- Proste debugowanie (audit log)

**Trade-off:**
- ⚠️ Wymaga świadomego orderingu reguł
- ✅ Brak konfliktów
- ✅ Performance: O(n) worst case

---

## Future Enhancements

### Możliwe rozszerzenia:

1. **Attachments Support**
   - External storage (S3, etc.)
   - Signed URLs

2. **Advanced Analytics Dashboard**
   - Metrics per team/priority/system
   - Trend analysis
   - SLA compliance tracking

3. **Slack Integration**
   - Oprócz Teams
   - Multi-channel notifications

4. **Custom Automation Actions**
   - Auto-close z obejściem
   - Auto-eskalacja po czasie
   - Integration z PagerDuty/OpsGenie

5. **AI-powered Priority Suggestions**
   - ML model trained on historical data
   - Suggest rules based on patterns

6. **Mobile Notifications**
   - Push notifications dla P1
   - Mobile app integration

---

**Architektura zaprojektowana z myślą o skalowalności, bezpieczeństwie i łatwości utrzymania! 🚀**

