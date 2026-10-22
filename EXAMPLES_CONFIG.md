# 📋 Przykładowe Konfiguracje - Incident Reporter (Forge)

## Scenariusz 1: Startup z małym zespołem DevOps

### Kontekst
- 1 zespół: DevOps
- Systemy: Web App, API, Database
- Środowiska: Production, Staging
- Proste reguły priorytetyzacji

### Konfiguracja

#### Priority Rules (3 reguły)

```json
[
  {
    "name": "P1 - Production Down",
    "order": 1,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "category", "operator": "equals", "value": "Outage" }
      ]
    },
    "actions": { "setPriority": "P1" }
  },
  {
    "name": "P2 - Production Performance Issue",
    "order": 2,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "category", "operator": "equals", "value": "Performance" }
      ]
    },
    "actions": { "setPriority": "P2" }
  },
  {
    "name": "P3 - Staging or Development",
    "order": 3,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "in", "value": ["Staging", "Development"] }
      ]
    },
    "actions": { "setPriority": "P3" }
  }
]
```

#### Teams (1 zespół)

```json
[
  {
    "id": "team-devops",
    "name": "DevOps",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:account-id-1",
      "557058:account-id-2",
      "557058:account-id-3"
    ],
    "watchers": ["557058:manager-account-id"],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/...",
    "teamsChannelName": "incidents"
  }
]
```

#### Team Mappings (1 mapowanie - wszystko do DevOps)

```json
[
  {
    "id": "mapping-all-to-devops",
    "priority": "any",
    "conditions": {
      "operator": "AND",
      "rules": []
    },
    "teamId": "team-devops",
    "order": 1
  }
]
```

---

## Scenariusz 2: Średnia firma z wyspecjalizowanymi zespołami

### Kontekst
- 4 zespoły: SRE, Platform, Payments, Frontend
- Systemy: Payment Gateway, Core API, Web App, Mobile App, Database
- Różne strategie assignmentu
- Zaawansowane reguły priorytetyzacji

### Konfiguracja

#### Priority Rules (6 reguł)

```json
[
  {
    "name": "P1 - Payment Critical Production",
    "order": 1,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Payment Gateway" },
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "equals", "value": "Critical" }
      ]
    },
    "actions": { "setPriority": "P1" }
  },
  {
    "name": "P1 - Database Outage Production",
    "order": 2,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Database" },
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "category", "operator": "equals", "value": "Outage" }
      ]
    },
    "actions": { "setPriority": "P1" }
  },
  {
    "name": "P2 - Any Critical with Workaround",
    "order": 3,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "impact", "operator": "equals", "value": "Critical" },
        { "field": "hasWorkaround", "operator": "equals", "value": true }
      ]
    },
    "actions": { "setPriority": "P2" }
  },
  {
    "name": "P2 - High Impact Production",
    "order": 4,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "equals", "value": "High" }
      ]
    },
    "actions": { "setPriority": "P2" }
  },
  {
    "name": "P3 - UAT High Priority",
    "order": 5,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "UAT" },
        { "field": "urgency", "operator": "equals", "value": "High" }
      ]
    },
    "actions": { "setPriority": "P3" }
  },
  {
    "name": "P4 - Everything Else",
    "order": 6,
    "conditions": {
      "operator": "AND",
      "rules": []
    },
    "actions": { "setPriority": "P4" }
  }
]
```

#### Teams (4 zespoły)

```json
[
  {
    "id": "team-sre",
    "name": "SRE",
    "description": "Site Reliability Engineering - Infrastructure & Production",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:sre-engineer-1",
      "557058:sre-engineer-2",
      "557058:sre-engineer-3",
      "557058:sre-engineer-4"
    ],
    "watchers": ["557058:sre-lead"],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/sre-channel",
    "teamsChannelName": "sre-incidents"
  },
  {
    "id": "team-platform",
    "name": "Platform",
    "description": "Platform Team - Core API & Integrations",
    "assignmentStrategy": "fixed",
    "defaultAssignee": "557058:platform-lead",
    "watchers": [
      "557058:platform-lead",
      "557058:platform-engineer-1"
    ],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/platform-channel",
    "teamsChannelName": "platform-incidents"
  },
  {
    "id": "team-payments",
    "name": "Payments",
    "description": "Payments Team - Payment Gateway & Processing",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:payments-engineer-1",
      "557058:payments-engineer-2"
    ],
    "watchers": [
      "557058:payments-lead",
      "557058:finance-manager"
    ],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/payments-channel",
    "teamsChannelName": "payments-critical"
  },
  {
    "id": "team-frontend",
    "name": "Frontend",
    "description": "Frontend Team - Web & Mobile Apps",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:frontend-engineer-1",
      "557058:frontend-engineer-2",
      "557058:frontend-engineer-3"
    ],
    "watchers": ["557058:frontend-lead"],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/frontend-channel",
    "teamsChannelName": "frontend-bugs"
  }
]
```

#### Team Mappings (Zaawansowane)

```json
[
  {
    "id": "mapping-payment-critical",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Payment Gateway" }
      ]
    },
    "teamId": "team-payments",
    "order": 1
  },
  {
    "id": "mapping-database-sre",
    "priority": "any",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Database" }
      ]
    },
    "teamId": "team-sre",
    "order": 2
  },
  {
    "id": "mapping-api-platform",
    "priority": "any",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Core API" }
      ]
    },
    "teamId": "team-platform",
    "order": 3
  },
  {
    "id": "mapping-frontend-apps",
    "priority": "any",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "in", "value": ["Web App", "Mobile App"] }
      ]
    },
    "teamId": "team-frontend",
    "order": 4
  },
  {
    "id": "mapping-production-p1-sre",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" }
      ]
    },
    "teamId": "team-sre",
    "order": 5
  }
]
```

**Uwaga:** Mapowania są sprawdzane w kolejności `order`. Pierwsze dopasowanie wygrywa.

---

## Scenariusz 3: Enterprise z SLA i 24/7 support

### Kontekst
- 6 zespołów (+ NOC jako first-line)
- SLA requirements: P1 < 15min, P2 < 1h, P3 < 4h
- 24/7 coverage z round-robin
- Wielopoziomowa eskalacja

### Konfiguracja

#### Priority Rules (z uwzględnieniem SLA)

```json
[
  {
    "name": "P1 - SLA Critical (15min) - No Workaround",
    "order": 1,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "equals", "value": "Critical" },
        { "field": "urgency", "operator": "equals", "value": "Immediate" },
        { "field": "hasWorkaround", "operator": "equals", "value": false }
      ]
    },
    "actions": { "setPriority": "P1" },
    "description": "SLA: 15 minutes response time"
  },
  {
    "name": "P1 - Data Loss Risk",
    "order": 2,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "category", "operator": "equals", "value": "Data Loss" },
        { "field": "environment", "operator": "equals", "value": "Production" }
      ]
    },
    "actions": { "setPriority": "P1" },
    "description": "SLA: 15 minutes - Data integrity at risk"
  },
  {
    "name": "P1 - Security Breach",
    "order": 3,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "category", "operator": "equals", "value": "Security" },
        { "field": "impact", "operator": "in", "value": ["Critical", "High"] }
      ]
    },
    "actions": { "setPriority": "P1" },
    "description": "SLA: 15 minutes - Security incident"
  },
  {
    "name": "P2 - SLA High (1 hour) - Production",
    "order": 4,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "in", "value": ["Critical", "High"] }
      ]
    },
    "actions": { "setPriority": "P2" },
    "description": "SLA: 1 hour response time"
  },
  {
    "name": "P3 - SLA Medium (4 hours)",
    "order": 5,
    "conditions": {
      "operator": "OR",
      "rules": [
        {
          "field": "environment",
          "operator": "equals",
          "value": "Production",
          "and": { "field": "impact", "operator": "equals", "value": "Medium" }
        },
        {
          "field": "environment",
          "operator": "equals",
          "value": "UAT",
          "and": { "field": "urgency", "operator": "equals", "value": "High" }
        }
      ]
    },
    "actions": { "setPriority": "P3" },
    "description": "SLA: 4 hours response time"
  },
  {
    "name": "P4 - SLA Low (next business day)",
    "order": 6,
    "conditions": {
      "operator": "AND",
      "rules": []
    },
    "actions": { "setPriority": "P4" },
    "description": "SLA: Next business day"
  }
]
```

#### Teams (z NOC jako first-line)

```json
[
  {
    "id": "team-noc",
    "name": "NOC",
    "description": "Network Operations Center - 24/7 First Line",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:noc-shift-1-person-1",
      "557058:noc-shift-1-person-2",
      "557058:noc-shift-2-person-1",
      "557058:noc-shift-2-person-2",
      "557058:noc-shift-3-person-1",
      "557058:noc-shift-3-person-2"
    ],
    "watchers": ["557058:noc-manager"],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/noc-alerts",
    "teamsChannelName": "noc-alerts-24x7"
  },
  {
    "id": "team-sre-oncall",
    "name": "SRE On-Call",
    "description": "SRE On-Call Engineers - Critical Escalation",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:sre-oncall-week-1",
      "557058:sre-oncall-week-2",
      "557058:sre-oncall-week-3",
      "557058:sre-oncall-week-4"
    ],
    "watchers": [
      "557058:sre-lead",
      "557058:infrastructure-director"
    ],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/sre-critical",
    "teamsChannelName": "sre-critical-oncall"
  },
  {
    "id": "team-security",
    "name": "Security",
    "description": "Security Team - Incidents & Breaches",
    "assignmentStrategy": "fixed",
    "defaultAssignee": "557058:security-lead",
    "watchers": [
      "557058:security-lead",
      "557058:ciso",
      "557058:legal-compliance"
    ],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/security-alerts",
    "teamsChannelName": "security-incidents"
  },
  {
    "id": "team-database-dba",
    "name": "DBA Team",
    "description": "Database Administrators - Data Issues",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:dba-senior-1",
      "557058:dba-senior-2",
      "557058:dba-junior-1"
    ],
    "watchers": ["557058:dba-lead"],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/dba-incidents",
    "teamsChannelName": "dba-incidents"
  }
]
```

#### Team Mappings (Eskalacja wielopoziomowa)

```json
[
  {
    "id": "mapping-p1-security-to-security-team",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "category", "operator": "equals", "value": "Security" }
      ]
    },
    "teamId": "team-security",
    "order": 1
  },
  {
    "id": "mapping-p1-data-loss-to-dba",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "category", "operator": "equals", "value": "Data Loss" }
      ]
    },
    "teamId": "team-database-dba",
    "order": 2
  },
  {
    "id": "mapping-p1-production-to-sre-oncall",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" }
      ]
    },
    "teamId": "team-sre-oncall",
    "order": 3
  },
  {
    "id": "mapping-p2-p3-to-noc",
    "priority": "any",
    "conditions": {
      "operator": "AND",
      "rules": []
    },
    "teamId": "team-noc",
    "order": 10
  }
]
```

**Flow:**
1. P1 Security → Security Team (natychmiastowa eskalacja)
2. P1 Data Loss → DBA Team (specjaliści od baz)
3. P1 Production (inne) → SRE On-Call (krytyczne infrastruktury)
4. P2-P4 → NOC (pierwsza linia, mogą eskalować ręcznie)

---

## Najlepsze Praktyki

### 1. Reguły Priorytetyzacji

✅ **DO:**
- Utrzymuj reguły proste i czytelne
- Używaj opisowych nazw (np. "P1 - Payment Critical Production")
- Testuj każdą regułę przed włączeniem
- Dokumentuj SLA w description
- Regularnie przeglądaj i aktualizuj reguły

❌ **DON'T:**
- Tworzyć zbyt wielu reguł (max 10-15)
- Używać skomplikowanych zagnieżdżonych warunków
- Pozostawiać włączonych nieużywanych reguł
- Duplikować warunków (consolidate!)

### 2. Assignment Strategies

**Round Robin - kiedy używać:**
- ✅ Zespół ma wielu członków o podobnych kompetencjach
- ✅ Chcesz równomiernie rozłożyć obciążenie
- ✅ Masz 24/7 coverage z rotacją zmian

**Fixed - kiedy używać:**
- ✅ Jedna osoba jest "punktem kontaktowym"
- ✅ Mały zespół (1-2 osoby)
- ✅ Lider zespołu dystrybuuje zadania ręcznie

**None - kiedy używać:**
- ✅ Zespół sam wybiera zadania z backlogu
- ✅ Używasz innego systemu assignmentu

### 3. Microsoft Teams Notifications

**Best practices:**
- Oddzielne kanały per priorytet/zespół
- P1 → dedykowany kanał z @mentions
- P2-P3 → wspólny kanał incydentów
- P4 → opcjonalnie wyłącz notifications
- Test webhooks regularnie (co miesiąc)

### 4. Custom Fields

**Opcje dla Select Lists:**
- Utrzymuj krótkie listy (max 10 opcji)
- Zawsze dodaj "Other" jako fallback
- Używaj jasnych, jednoznacznych nazw
- Unikaj skrótów nieznanych użytkownikom

---

## Migracja między Scenariuszami

### Z Scenariusz 1 → Scenariusz 2

1. Utwórz dodatkowe zespoły (Platform, Payments, Frontend)
2. Dodaj team mappings per system
3. Zaktualizuj reguły priorytetyzacji (dodaj system-specific rules)
4. Skonfiguruj oddzielne webhooks Teams per zespół
5. Przeszkol użytkowników o nowych zespołach

### Z Scenariusz 2 → Scenariusz 3

1. Utwórz zespół NOC jako first-line
2. Zmień assignment strategy na roundRobin dla 24/7 coverage
3. Dodaj SLA descriptions do reguł
4. Zaktualizuj team mappings z eskalacją wielopoziomową
5. Skonfiguruj dedykowane kanały Teams per SLA tier
6. Zintegruj z external monitoring (jeśli potrzebne)

---

## Przykładowe Custom Field Options

### System/Service (według branży)

**E-commerce:**
```
- Payment Gateway
- Shopping Cart
- Inventory Management
- Order Processing
- Customer Portal
- Shipping Integration
- Analytics Platform
- Email Service
```

**SaaS:**
```
- Core API
- Web Application
- Mobile App (iOS)
- Mobile App (Android)
- Authentication Service
- Database Cluster
- CDN / Static Assets
- Background Jobs
- Notification Service
```

**Fintech:**
```
- Core Banking System
- Payment Processing
- KYC / Compliance
- Trading Platform
- Mobile Banking App
- ATM Network
- Card Processing
- Fraud Detection
```

---

## Template: Eksport/Import Konfiguracji

Użyj tego template do backupu konfiguracji:

```json
{
  "exportDate": "2025-01-15T10:00:00Z",
  "version": "1.0.0",
  "config": {
    "global": { /* AppConfig */ },
    "fields": { /* FieldsConfig */ },
    "rules": [ /* PriorityRule[] */ ],
    "teams": [ /* EscalationTeam[] */ ],
    "mappings": [ /* TeamMapping[] */ ]
  }
}
```

*Uwaga: Import/Export UI nie jest zaimplementowany w MVP - użyj ręcznej migracji przez Admin Panel.*

---

**Powodzenia w konfiguracji! 🚀**

