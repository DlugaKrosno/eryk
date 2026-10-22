# Incident Reporter (Forge) - Dokumentacja Kompletna

## 📋 Spis Treści

1. [Przegląd Aplikacji](#przegląd-aplikacji)
2. [Architektura i Technologia](#architektura-i-technologia)
3. [Wymagania i Instalacja](#wymagania-i-instalacja)
4. [Konfiguracja Jira](#konfiguracja-jira)
5. [Przewodnik Użytkownika](#przewodnik-użytkownika)
6. [Przewodnik Administratora](#przewodnik-administratora)
7. [Integracja Microsoft Teams](#integracja-microsoft-teams)
8. [Specyfikacja Reguł Priorytetyzacji](#specyfikacja-reguł-priorytetyzacji)
9. [Model Danych](#model-danych)
10. [Scenariusze Testowe](#scenariusze-testowe)
11. [Rozwiązywanie Problemów](#rozwiązywanie-problemów)
12. [Ograniczenia i Obejścia](#ograniczenia-i-obejścia)

---

## 📱 Przegląd Aplikacji

**Incident Reporter (Forge)** to aplikacja dla Jira Cloud zbudowana na platformie Atlassian Forge, która umożliwia:

- ✅ Zgłaszanie incydentów/awarii systemów przez użytkowników
- 🤖 Automatyczne wyznaczanie priorytetu P1-P4 na podstawie konfigurowalnych reguł
- 👥 Automatyczne przypisanie do zespołów i konkretnych osób (fixed/round-robin)
- 📢 Integrację z Microsoft Teams (powiadomienia webhook)
- ⚙️ Pełną konfigurowalność przez panel administracyjny
- 📊 Audyt wszystkich operacji

### Kluczowe Funkcje

**User Mode:**
- Prosty formularz zgłoszenia z walidacją
- Automatyczne prefillowanie danych użytkownika
- Widok "Moje zgłoszenia" z statusami
- Natychmiastowy feedback po zgłoszeniu

**Admin Mode:**
- Konfiguracja projektu docelowego i pól
- CRUD reguł priorytetyzacji P1-P4
- Zarządzanie zespołami eskalacyjnymi
- Konfiguracja webhooków Microsoft Teams
- Podgląd audytu wszystkich operacji

---

## 🏗️ Architektura i Technologia

### Wybór Platformy: Custom UI (React)

**Uzasadnienie:**
- Pełna kontrola nad UX i złożonymi formularzami
- React + Atlassian Design System = spójny UI
- Lepsza obsługa dynamicznych walidacji i conditional rendering
- Możliwość używania external libraries w ramach ograniczeń Forge

### Moduły Forge

```yaml
jira:projectPage     - Panel zgłaszania incydentów (User Mode)
jira:globalPage      - Panel administracyjny (Admin Mode)
jira:issuePanel      - Podgląd szczegółów incydentu na issue
function             - Backend functions (logika biznesowa)
trigger              - jira:issueCreated (automatyczne przetwarzanie)
```

**Dlaczego NIE workflow post-function:**
- Wymaga ręcznej konfiguracji workflow przez admina
- Trigger + Function = autonomiczne, działa out-of-the-box

### Wymagane Scopes

```yaml
scopes:
  - read:jira-work          # Odczyt issues, projektów
  - write:jira-work         # Tworzenie/aktualizacja issues
  - read:jira-user          # Informacje o użytkownikach
  - storage:app             # Forge Storage
  - external:fetch          # Webhooks Microsoft Teams
```

**Uzasadnienie minimalności:** Brak uprawnień admin/delete - tylko niezbędne operacje.

---

## 📦 Wymagania i Instalacja

### Wymagania

- Node.js 18+ i npm
- Forge CLI 6.0+
- Konto Atlassian Cloud z uprawnieniami do instalacji aplikacji Forge
- Projekt Jira Cloud (lub możliwość utworzenia nowego)

### Instalacja Krok po Kroku

#### 1. Instalacja Forge CLI

```bash
npm install -g @forge/cli
```

#### 2. Logowanie do Forge

```bash
forge login
```

Przejdź przez proces uwierzytelniania w przeglądarce.

#### 3. Pobranie projektu

```bash
git clone <repository-url>
cd incident-reporter-forge
```

#### 4. Instalacja zależności backendu

```bash
npm install
```

#### 5. Budowanie frontendów

```bash
npm run build
```

To polecenie zbuduje wszystkie trzy aplikacje React:
- User Mode (zgłaszanie)
- Admin Mode (konfiguracja)
- Issue Panel (podgląd)

#### 6. Rejestracja aplikacji

```bash
forge register
```

Podaj:
- Nazwę aplikacji: `incident-reporter-forge`
- Wybierz workspace

#### 7. Deploy aplikacji

```bash
forge deploy
```

#### 8. Instalacja w Jira

```bash
forge install
```

Wybierz:
- Produkt: Jira
- Site: Twoja instancja Jira Cloud

---

## ⚙️ Konfiguracja Jira

### 1. Utworzenie Projektu

1. Utwórz nowy projekt w Jira (np. klucz: **INC**)
2. Typ projektu: Company-managed lub Team-managed

### 2. Utworzenie Issue Type "Incident"

1. Jira Settings → Issues → Issue types
2. Kliknij **Add issue type**
3. Nazwa: **Incident**
4. Typ: Standard issue type
5. Zanotuj **Issue Type ID** (widoczny w URL po kliknięciu)

### 3. Utworzenie Custom Fields

Utwórz następujące custom fields:

| Nazwa Pola | Typ | Opis |
|------------|-----|------|
| System/Service | Select List (single choice) | System którego dotyczy incident |
| Environment | Select List (single choice) | Środowisko (Prod/UAT/Dev) |
| Category | Select List (single choice) | Kategoria incydentu |
| Impact | Select List (single choice) | Wpływ (Critical/High/Medium/Low) |
| Urgency | Select List (single choice) | Pilność (Immediate/High/Medium/Low) |
| Has Workaround | Checkbox | Czy istnieje obejście |
| Calculated Priority | Short Text | Automatycznie wyliczony priorytet P1-P4 |
| Assigned Team | Short Text | Nazwa przypisanego zespołu |

**Jak znaleźć Custom Field ID:**
1. Jira Settings → Issues → Custom fields
2. Kliknij na custom field
3. Sprawdź URL: `.../fields/customfield_10100` → ID to `customfield_10100`

### 4. Dodanie Custom Fields do Screen

1. Jira Settings → Issues → Screens
2. Wybierz screen używany przez projekt INC
3. Dodaj wszystkie utworzone custom fields
4. Zapisz

### 5. Konfiguracja Field Configuration

1. Jira Settings → Issues → Field configurations
2. Znajdź konfigurację używaną przez projekt INC
3. Ustaw pola jako wymagane/opcjonalne według potrzeb

---

## 👤 Przewodnik Użytkownika

### Zgłaszanie Incydentu

1. Przejdź do projektu INC w Jira
2. W menu bocznym znajdź **"Report Incident"**
3. Wypełnij formularz:
   - **System/Service*** - wybierz dotknięty system
   - **Environment*** - wybierz środowisko
   - **Category*** - wybierz kategorię
   - **Description*** - opisz problem (min. 10 znaków)
   - **Impact*** - określ wpływ
   - **Urgency*** - określ pilność
   - **Has Workaround?** - zaznacz jeśli istnieje obejście
4. Kliknij **"Submit Incident"**

### Po Zgłoszeniu

- Otrzymasz potwierdzenie z numerem zgłoszenia (np. INC-1234)
- System automatycznie:
  - Wyliczy priorytet P1-P4
  - Przypisze do odpowiedniego zespołu
  - Wyśle powiadomienie do Microsoft Teams
- Możesz kliknąć **"View Issue"** aby zobaczyć szczegóły

### Moje Zgłoszenia

1. Przejdź do zakładki **"My Incidents"**
2. Zobaczysz listę wszystkich swoich zgłoszeń z:
   - Kluczem issue (link do Jira)
   - Statusem
   - Priorytetem
   - Osobą przypisaną
3. Kliknij **"Refresh"** aby odświeżyć listę

---

## 👨‍💼 Przewodnik Administratora

### Dostęp do Panelu Administracyjnego

1. W Jira, kliknij **Apps** w górnym menu
2. Wybierz **"Incident Reporter Admin"**
3. Panel składa się z 6 zakładek

### Tab 1: General Settings

Podstawowa konfiguracja aplikacji.

**Pola:**
- **Target Project Key** - klucz projektu (np. INC)
- **Incident Issue Type ID** - ID typu issue "Incident"
- **Jira Instance URL** - URL instancji (np. company.atlassian.net)
- **Default Priority** - priorytet gdy żadna reguła nie pasuje (domyślnie P3)

**Zapisanie:** Kliknij **"Save Settings"**

### Tab 2: Fields & Dictionaries

Mapowanie Custom Fields Jira do pól aplikacji.

**Pola do skonfigurowania:**
- System Field ID → `customfield_10100`
- Environment Field ID → `customfield_10101`
- Category Field ID → `customfield_10102`
- Impact Field ID → `customfield_10103`
- Urgency Field ID → `customfield_10104`
- Has Workaround Field ID → `customfield_10105`
- Calculated Priority Field ID → `customfield_10106`
- Assigned Team Field ID → `customfield_10107`

**Zapisanie:** Kliknij **"Save Field Mappings"**

### Tab 3: Priority Rules

Najważniejsza konfiguracja - reguły automatycznej priorytetyzacji.

#### Dodawanie Reguły

1. Kliknij **"+ Add Rule"**
2. Wypełnij:
   - **Rule Name** - nazwa opisowa (np. "P1 - Production Critical")
   - **Description** - szczegółowy opis
   - **Set Priority To** - wybierz P1/P2/P3/P4
   - **Conditions Operator** - AND (wszystkie muszą pasować) lub OR (dowolny)
   - **Enabled** - czy reguła aktywna
3. Kliknij **"Save Rule"**

#### Kolejność Reguł (First Match Wins)

- Reguły są sprawdzane **od góry do dołu**
- **Pierwsza pasująca reguła wygrywa**
- Użyj przycisków **↑↓** aby zmienić kolejność
- Reguły z niższym numerem Order mają wyższy priorytet

#### Testowanie Reguły

1. Kliknij **"Test"** przy regule
2. System pokaże przykładowe dane
3. Kliknij **"Run Test"**
4. Zobaczysz czy reguła pasuje do danych testowych

#### Przykładowe Reguły

**Reguła 1: P1 - Production Critical Outage**
```
Order: 1
Conditions: AND
  - Environment equals "Production"
  - Impact equals "Critical"
  - HasWorkaround equals false
Action: Set Priority = P1
```

**Reguła 2: P2 - High Impact or Immediate**
```
Order: 2
Conditions: OR
  - Impact equals "Critical"
  - Urgency equals "Immediate"
Action: Set Priority = P2
```

**Reguła 3: P3 - Medium Impact**
```
Order: 3
Conditions: AND
  - Impact in ["Medium", "High"]
Action: Set Priority = P3
```

### Tab 4: Teams & Escalation

Zarządzanie zespołami i strategiami przypisywania.

#### Dodawanie Zespołu

1. Kliknij **"+ Add Team"**
2. Podaj nazwę zespołu (np. "SRE", "Platform", "Payments")
3. Zespół pojawi się na liście

#### Edycja Zespołu

1. Kliknij **"Edit"** przy zespole
2. Skonfiguruj:
   - **Team Name** - nazwa
   - **Description** - opis
   - **Assignment Strategy:**
     - **Fixed** - zawsze przypisuj do tej samej osoby
     - **Round Robin** - rotacja między członkami zespołu
     - **None** - nie przypisuj automatycznie
   - **Default Assignee** - Jira Account ID (dla Fixed)
   - **Round Robin Members** - lista Account IDs (dla Round Robin)
   - **Watchers** - lista Account IDs zawsze dodawanych jako watchers

**Jak znaleźć Jira Account ID:**
1. Otwórz profil użytkownika w Jira
2. Sprawdź URL: `.../people/{accountId}` lub użyj Jira API

#### Mapowanie Zespołów

Określ, który zespół dostaje zgłoszenie na podstawie warunków.

**Przykład:**
- Priority = P1 AND System = "Payment Gateway" → Payments Team
- Priority = P1 AND Environment = "Production" → SRE Team
- Category = "Performance" → Platform Team

### Tab 5: Microsoft Teams

Konfiguracja webhooków dla powiadomień.

#### Utworzenie Webhooka w Teams

1. Otwórz Microsoft Teams
2. Przejdź do kanału gdzie mają trafiać powiadomienia
3. Kliknij **⋯** (More options) → **Connectors**
4. Wyszukaj **"Incoming Webhook"** → **Configure**
5. Podaj nazwę (np. "Incident Reporter") i opcjonalnie ikonę
6. Kliknij **Create**
7. **Skopiuj URL webhooka**

#### Konfiguracja w Aplikacji

1. Wybierz zespół z dropdown
2. Wypełnij:
   - **Teams Channel Name** - nazwa kanału (do wyświetlenia)
   - **Webhook URL** - wklej skopiowany URL
3. Kliknij **"Save Configuration"**
4. Kliknij **"🧪 Send Test Notification"** aby przetestować

#### Format Powiadomień

**P1 (Krytyczne):**
- Kolor: Czerwony
- Emoji: 🚨
- Etykieta: "ALERT"

**P2 (Wysokie):**
- Kolor: Pomarańczowy
- Emoji: ⚠️

**P3-P4 (Średnie/Niskie):**
- Kolor: Niebieski/Domyślny
- Emoji: ℹ️

**Zawartość:**
- Issue Key
- Priority
- System/Environment
- Impact/Urgency
- Reporter
- Assigned Team
- Direct link do Jira

### Tab 6: Audit Log

Pełna historia operacji.

**Wyświetlane zdarzenia:**
- **Incident Created** - utworzenie zgłoszenia
- **Priority Calculated** - wyliczenie priorytetu (z informacją która reguła)
- **Team Assigned** - przypisanie zespołu
- **Teams Notification Sent** - status wysyłki do Teams
- **Config Changed** - zmiana konfiguracji

**Funkcje:**
- Kliknij **"Details"** aby zobaczyć pełne dane JSON
- Kliknij **"Refresh"** aby odświeżyć
- Limit: ostatnie 100 wpisów

---

## 📢 Integracja Microsoft Teams

### Retry i Obsługa Błędów

System automatycznie **retry** nieudanych wysyłek:
- **Maksymalnie 3 próby**
- **Exponential backoff**: 2s, 4s, 8s między próbami
- **Client errors (4xx)**: nie retry (błąd konfiguracji)
- **Server errors (5xx)**: retry z backoffem

Wszystkie próby są logowane w Audit Log.

### Bezpieczeństwo Webhooków

- URL webhooka jest **maskowany** w UI (wyświetlany jako password field)
- Przechowywany w Forge Storage (encrypted at rest)
- Dostęp tylko dla adminów Jira
- Walidacja URL (tylko `*.webhook.office.com`)

### Diagnostyka Problemów

Jeśli powiadomienia nie docierają:

1. **Sprawdź Audit Log** - status "teams_notification_sent"
2. **Przeczytaj błąd** - jeśli status = "failed"
3. **Możliwe przyczyny:**
   - Webhook URL niepoprawny lub wygasł
   - Kanał Teams został usunięty
   - Connector został wyłączony
4. **Rozwiązanie:**
   - Utwórz nowy webhook w Teams
   - Zaktualizuj URL w konfiguracji
   - Wyślij test notification

---

## 🧠 Specyfikacja Reguł Priorytetyzacji

### Algorytm: First Match Wins

**Działanie:**
1. Reguły są sortowane według pola `order` (ASC)
2. System sprawdza reguły **od góry do dołu**
3. **Pierwsza reguła** gdzie wszystkie warunki są spełnione **wygrywa**
4. Jeśli żadna reguła nie pasuje → użyj **Default Priority**

**Zalety:**
- ✅ Deterministyczne (zawsze ten sam wynik dla tych samych danych)
- ✅ Łatwe debugowanie (widać dokładnie która reguła zadziałała)
- ✅ Admin ma pełną kontrolę przez kolejność

**Conflict Resolution:**
Jeśli dwie reguły mogłyby pasować (np. jedna daje P1, druga P2):
→ Wygrywa ta z **niższym numerem order** (wyżej na liście)

### Operatory Warunków

**Condition Operators:**
- `AND` - wszystkie warunki muszą być spełnione
- `OR` - dowolny warunek musi być spełniony

**Field Operators:**
- `equals` - dokładne dopasowanie
- `notEquals` - różne od
- `in` - wartość w liście
- `notIn` - wartość poza listą
- `contains` - zawiera (case-insensitive)

### Przykładowa Konfiguracja Produkcyjna

```javascript
[
  {
    "order": 1,
    "name": "P1 - Production Outage bez obejścia",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "equals", "value": "Critical" },
        { "field": "hasWorkaround", "operator": "equals", "value": false }
      ]
    },
    "actions": { "setPriority": "P1" }
  },
  {
    "order": 2,
    "name": "P1 - Krytyczny system w Production",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "system", "operator": "in", "value": ["Payment Gateway", "Core API"] },
        { "field": "impact", "operator": "equals", "value": "Critical" }
      ]
    },
    "actions": { "setPriority": "P1" }
  },
  {
    "order": 3,
    "name": "P2 - Production z obejściem LUB High Impact",
    "conditions": {
      "operator": "OR",
      "rules": [
        { 
          "field": "environment", 
          "operator": "equals", 
          "value": "Production",
          "and": { "field": "hasWorkaround", "operator": "equals", "value": true }
        },
        { "field": "impact", "operator": "equals", "value": "High" },
        { "field": "urgency", "operator": "equals", "value": "Immediate" }
      ]
    },
    "actions": { "setPriority": "P2" }
  },
  {
    "order": 4,
    "name": "P3 - Medium Impact",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "impact", "operator": "in", "value": ["Medium", "High"] }
      ]
    },
    "actions": { "setPriority": "P3" }
  },
  {
    "order": 5,
    "name": "P4 - Low Impact",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "impact", "operator": "equals", "value": "Low" }
      ]
    },
    "actions": { "setPriority": "P4" }
  }
]
```

### Audyt Reguł

Każde uruchomienie reguł jest logowane:
- Która reguła została zastosowana
- Jakie dane wejściowe
- Jaki wynik (priorytet)
- Timestamp

Dostęp w: **Admin Panel → Audit Log**

---

## 💾 Model Danych

### Forge Storage - Encje

#### 1. AppConfig (Singleton: `global_config`)

```json
{
  "targetProjectKey": "INC",
  "incidentIssueTypeId": "10001",
  "defaultPriority": "P3",
  "enableAuditLog": true,
  "enableTeamsIntegration": true,
  "jiraInstanceUrl": "company.atlassian.net"
}
```

#### 2. FieldsConfig (Singleton: `fields_config`)

```json
{
  "fields": {
    "system": {
      "required": true,
      "label": "System/Service",
      "options": ["Payment Gateway", "API", "Database", "Web App", "Mobile App"]
    },
    "environment": {
      "required": true,
      "options": ["Production", "UAT", "Development", "Staging"]
    },
    // ... inne pola
  },
  "customFieldMappings": {
    "system": "customfield_10100",
    "environment": "customfield_10101",
    "category": "customfield_10102",
    "impact": "customfield_10103",
    "urgency": "customfield_10104",
    "hasWorkaround": "customfield_10105",
    "calculatedPriority": "customfield_10106",
    "assignedTeam": "customfield_10107"
  }
}
```

#### 3. PriorityRule (Collection: `priority_rules` - JSON array)

```json
[
  {
    "id": "rule-1234567890",
    "name": "P1 - Production Critical",
    "order": 1,
    "enabled": true,
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "environment", "operator": "equals", "value": "Production" },
        { "field": "impact", "operator": "equals", "value": "Critical" }
      ]
    },
    "actions": {
      "setPriority": "P1"
    },
    "description": "Krytyczne awarie produkcji"
  }
]
```

#### 4. EscalationTeam (Collection: `escalation_teams` - JSON array)

```json
[
  {
    "id": "team-1234567890",
    "name": "SRE",
    "description": "Site Reliability Engineering",
    "defaultAssignee": "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077",
    "assignmentStrategy": "roundRobin",
    "roundRobinMembers": [
      "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077",
      "557058:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    ],
    "watchers": [
      "557058:manager-account-id"
    ],
    "teamsWebhookUrl": "https://outlook.office.com/webhook/...",
    "teamsChannelName": "incidents-critical"
  }
]
```

#### 5. TeamMapping (Collection: `team_mappings` - JSON array)

```json
[
  {
    "id": "mapping-1234567890",
    "priority": "P1",
    "conditions": {
      "operator": "AND",
      "rules": [
        { "field": "system", "operator": "equals", "value": "Payment Gateway" }
      ]
    },
    "teamId": "team-1234567890",
    "order": 1
  }
]
```

#### 6. AuditLogEntry (Collection: `audit_log` - JSON array)

```json
[
  {
    "id": "audit-1234567890-abc123",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "eventType": "priority_calculated",
    "issueKey": "INC-1234",
    "userId": "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077",
    "details": {
      "appliedRuleId": "rule-1234567890",
      "appliedRuleName": "P1 - Production Critical",
      "calculatedPriority": "P1",
      "assignedTeamId": "team-1234567890",
      "assignedTeamName": "SRE",
      "assignedTo": "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077"
    }
  }
]
```

#### 7. RoundRobinState (Singleton per team: `rr-{teamId}`)

```json
{
  "teamId": "team-1234567890",
  "lastAssignedIndex": 2,
  "lastAssignedAt": "2025-01-15T10:30:00.000Z"
}
```

### Limity Storage

- **Max size per key:** 250KB
- **Max operations:** 1000/minute
- **Retention:** Nieograniczone (dopóki aplikacja zainstalowana)

**Optymalizacja:**
- Audit Log: limit do 1000 ostatnich wpisów (automatyczne czyszczenie)
- Używanie JSON.stringify() dla kolekcji zamiast entity storage (mniej requestów)

---

## 🧪 Scenariusze Testowe

### Test Suite 1: Zgłaszanie Incydentu (User Mode)

#### TC-001: Pomyślne zgłoszenie incydentu

**Given:** Użytkownik jest zalogowany i ma dostęp do projektu INC  
**When:** Użytkownik otwiera "Report Incident" i wypełnia wszystkie wymagane pola:
- System: "Payment Gateway"
- Environment: "Production"
- Category: "Outage"
- Description: "System nie odpowiada od 10 minut"
- Impact: "Critical"
- Urgency: "Immediate"
- Has Workaround: unchecked

**And:** Klikaautomat "Submit Incident"  
**Then:** 
- ✅ Wyświetla się komunikat sukcesu
- ✅ Issue zostaje utworzone w Jira z kluczem INC-XXXX
- ✅ Użytkownik otrzymuje link do issue
- ✅ Issue zawiera wszystkie wprowadzone dane

#### TC-002: Walidacja wymaganych pól

**Given:** Użytkownik jest w formularzu zgłoszenia  
**When:** Użytkownik klika "Submit" bez wypełnienia pól wymaganych  
**Then:** 
- ✅ Formularz pokazuje błędy walidacji
- ✅ Issue nie zostaje utworzone
- ✅ Użytkownik widzi jasne komunikaty błędów

#### TC-003: Widok "Moje zgłoszenia"

**Given:** Użytkownik zgłosił 3 incydenty  
**When:** Użytkownik przechodzi do zakładki "My Incidents"  
**Then:** 
- ✅ Wyświetla się tabela z 3 wpisami
- ✅ Każdy wpis zawiera: Key, Summary, Status, Priority, Assignee
- ✅ Linki do issues działają

---

### Test Suite 2: Rule Engine (Priority Calculation)

#### TC-101: P1 - Produkcja Critical bez obejścia

**Given:** Skonfigurowana reguła:
```
IF Environment = Production AND Impact = Critical AND HasWorkaround = false
THEN Priority = P1
```

**When:** Issue zostaje utworzone z:
- Environment: Production
- Impact: Critical
- HasWorkaround: false

**Then:**
- ✅ Priority zostaje ustawione na P1
- ✅ Audit Log zawiera wpis "priority_calculated" z nazwą reguły
- ✅ Issue comment zawiera informację o zastosowanej regule

#### TC-102: First Match Wins - konflikt reguł

**Given:** Dwie reguły:
1. (Order: 1) IF Impact = Critical THEN P1
2. (Order: 2) IF Environment = Production THEN P2

**When:** Issue spełnia oba warunki (Impact=Critical, Environment=Production)  
**Then:** 
- ✅ Stosowana jest REGUŁA 1 (niższy order)
- ✅ Priority = P1
- ✅ Audit Log wskazuje reguła 1

#### TC-103: Brak dopasowania - Default Priority

**Given:** Żadna reguła nie pasuje do danych issue  
**And:** Default Priority = P3  
**When:** Issue zostaje przetworzone  
**Then:** 
- ✅ Priority = P3
- ✅ Audit Log: appliedRuleName = "Default Priority"

#### TC-104: Wyłączona reguła jest pomijana

**Given:** Reguła z enabled = false  
**When:** Dane issue pasują do tej reguły  
**Then:** 
- ✅ Reguła jest pomijana
- ✅ Sprawdzana jest następna reguła w kolejności

---

### Test Suite 3: Escalation & Assignment

#### TC-201: Fixed Assignment

**Given:** Zespół SRE z:
- assignmentStrategy: "fixed"
- defaultAssignee: "user-123"

**And:** Mapowanie: P1 → SRE  
**When:** Issue P1 zostaje przypisane  
**Then:** 
- ✅ Assignee = user-123
- ✅ Custom field "Assigned Team" = "SRE"

#### TC-202: Round Robin Assignment

**Given:** Zespół Platform z:
- assignmentStrategy: "roundRobin"
- roundRobinMembers: ["user-1", "user-2", "user-3"]
- lastAssignedIndex: 0

**When:** Trzy kolejne issues zostają przypisane  
**Then:** 
- ✅ Issue 1: Assignee = user-2 (index 1)
- ✅ Issue 2: Assignee = user-3 (index 2)
- ✅ Issue 3: Assignee = user-1 (index 0, wrap around)

#### TC-203: Watchers dodawani automatycznie

**Given:** Zespół z watchers: ["manager-1", "manager-2"]  
**When:** Issue zostaje przypisane do tego zespołu  
**Then:** 
- ✅ manager-1 i manager-2 są dodani jako watchers w Jira

---

### Test Suite 4: Microsoft Teams Integration

#### TC-301: Wysyłka powiadomienia P1

**Given:** Zespół SRE ma skonfigurowany webhook Teams  
**And:** Issue INC-1234 z priorytetem P1 zostaje przypisane do SRE  
**When:** System wysyła powiadomienie  
**Then:** 
- ✅ Webhook otrzymuje POST z Adaptive Card
- ✅ Karta zawiera:
  - Kolor czerwony (d63031)
  - Tytuł: "🚨 [P1] INCIDENT ALERT"
  - Issue Key: INC-1234
  - Link do Jira
- ✅ Audit Log: teamsWebhookStatus = "success"

#### TC-302: Retry po błędzie serwera

**Given:** Webhook Teams zwraca 500 Internal Server Error  
**When:** System wysyła powiadomienie  
**Then:** 
- ✅ System wykonuje 3 próby (0s, 2s, 4s, 8s)
- ✅ Po 3 nieudanych próbach status = "failed"
- ✅ Audit Log zawiera informację o błędzie

#### TC-303: Brak retry dla błędu klienta

**Given:** Webhook URL jest niepoprawny (404 Not Found)  
**When:** System wysyła powiadomienie  
**Then:** 
- ✅ System NIE wykonuje retry
- ✅ Status = "failed" po pierwszej próbie
- ✅ Audit Log zawiera kod błędu 404

---

### Test Suite 5: Admin Panel

#### TC-401: Dodawanie nowej reguły

**Given:** Admin jest w zakładce "Priority Rules"  
**When:** Admin klika "+ Add Rule" i tworzy regułę:
- Name: "Test Rule"
- Priority: P2
- Condition: Impact = High

**And:** Zapisuje  
**Then:** 
- ✅ Reguła pojawia się na liście
- ✅ Ma przypisany unikalny ID
- ✅ Order = max(existing orders) + 1
- ✅ Audit Log: eventType = "config_changed"

#### TC-402: Zmiana kolejności reguł

**Given:** 3 reguły z order: [1, 2, 3]  
**When:** Admin klika ↑ na regule order=3  
**Then:** 
- ✅ Kolejność zmienia się na [1, 3, 2]
- ✅ Zmiana zapisana w storage

#### TC-403: Test reguły

**Given:** Reguła: IF Impact=Critical THEN P1  
**When:** Admin klika "Test" i podaje dane: Impact=Critical  
**Then:** 
- ✅ Wynik testu: "✅ Rule Matches!"
- ✅ "Would set priority to: P1"

**When:** Admin testuje z Impact=Low  
**Then:** 
- ✅ Wynik testu: "❌ Rule Does Not Match"

---

### Test Suite 6: Edge Cases & Error Handling

#### TC-501: Brak konfiguracji projektu

**Given:** Aplikacja nie ma skonfigurowanego targetProjectKey  
**When:** Użytkownik próbuje zgłosić incident  
**Then:** 
- ✅ Wyświetla się komunikat: "Application not configured. Please contact administrator."
- ✅ Issue nie zostaje utworzone

#### TC-502: Custom field nie istnieje

**Given:** Custom field ID w konfiguracji nie istnieje w Jira  
**When:** System próbuje zaktualizować issue  
**Then:** 
- ✅ Jira API zwraca błąd
- ✅ Error jest logowany
- ✅ Issue zostaje utworzone (bez custom fields)

#### TC-503: Webhook Teams timeout

**Given:** Webhook Teams nie odpowiada (timeout)  
**When:** System wysyła powiadomienie  
**Then:** 
- ✅ Po timeout wykonywany jest retry
- ✅ Max 3 próby
- ✅ Eventual failure logowany w Audit Log

---

### Checklist Akceptacyjny

#### User Mode
- [ ] Formularz zgłoszenia ładuje się bez błędów
- [ ] Wszystkie pola wymagane są walidowane
- [ ] Zgłoszenie tworzy issue w Jira
- [ ] "Moje zgłoszenia" wyświetla listę issues
- [ ] Linki do issues działają

#### Rule Engine
- [ ] Reguły są wykonywane w kolejności order
- [ ] First match wins działa poprawnie
- [ ] Default priority stosowany gdy brak dopasowania
- [ ] Wyłączone reguły są pomijane
- [ ] Audit log zawiera informację o zastosowanej regule

#### Escalation
- [ ] Fixed assignment przypisuje do stałej osoby
- [ ] Round robin rotuje między członkami
- [ ] Watchers są dodawani automatycznie
- [ ] Team mapping działa według warunków

#### Teams Integration
- [ ] Webhooks są wysyłane dla każdego incydentu
- [ ] Format wiadomości jest poprawny
- [ ] Kolory różnią się per priorytet
- [ ] Retry działa dla błędów serwera
- [ ] Błędy są logowane w Audit Log

#### Admin Panel
- [ ] Wszystkie 6 zakładek ładują się
- [ ] General Settings zapisuje konfigurację
- [ ] Priority Rules CRUD działa
- [ ] Zmiana kolejności reguł działa
- [ ] Test reguły działa
- [ ] Teams & Escalation CRUD działa
- [ ] Teams Integration webhook test działa
- [ ] Audit Log wyświetla wpisy

---

## 🔧 Rozwiązywanie Problemów

### Problem: Aplikacja nie instaluje się

**Objawy:** `forge install` kończy się błędem

**Rozwiązania:**
1. Sprawdź czy jesteś zalogowany: `forge whoami`
2. Sprawdź czy app jest zdeployowana: `forge deploy`
3. Sprawdź logi: `forge install --verbose`
4. Upewnij się że masz uprawnienia do instalacji apps w Jira

---

### Problem: Issue nie jest tworzony

**Objawy:** "Submit Incident" kończy się błędem lub timeout

**Rozwiązania:**
1. Sprawdź logi Forge: `forge logs`
2. Sprawdź czy targetProjectKey jest poprawny
3. Sprawdź czy incidentIssueTypeId istnieje
4. Sprawdź scopes w manifest.yml (`write:jira-work`)
5. Sprawdź czy użytkownik ma uprawnienia do tworzenia issues w projekcie

---

### Problem: Priorytet nie jest ustawiany

**Objawy:** Issue jest tworzone ale Priority pozostaje pusty

**Rozwiązania:**
1. Sprawdź Audit Log - czy reguły zostały wykonane?
2. Sprawdź czy Custom Field ID dla "calculatedPriority" jest poprawny
3. Sprawdź czy custom field jest na screen i field configuration
4. Sprawdź logi: `forge logs --follow`

---

### Problem: Teams webhook nie działa

**Objawy:** Powiadomienia nie docierają do Teams

**Rozwiązania:**
1. Sprawdź Audit Log - status "teams_notification_sent"
2. Kliknij "Send Test Notification" w admin panelu
3. Sprawdź czy webhook URL jest poprawny (outlook.office.com)
4. Sprawdź czy connector w Teams jest aktywny
5. Utwórz nowy webhook w Teams i zaktualizuj konfigurację

---

### Problem: Round Robin nie rotuje

**Objawy:** Zawsze przypisywany jest ten sam użytkownik

**Rozwiązania:**
1. Sprawdź czy roundRobinMembers lista ma > 1 element
2. Sprawdź czy assignmentStrategy = "roundRobin" (a nie "fixed")
3. Sprawdź Forge Storage key `rr-{teamId}` - czy lastAssignedIndex się zmienia
4. Sprawdź logi: `forge logs`

---

### Problem: Custom fields nie zapisują się

**Objawy:** Wartości pól nie pojawiają się w Jira issue

**Rozwiązania:**
1. Sprawdź czy Custom Field IDs są poprawne (customfield_XXXXX)
2. Sprawdź czy custom fields są na screen używanym przez issue
3. Sprawdź czy typ pola jest zgodny (text/checkbox/select)
4. Sprawdź logi Jira API response: `forge logs`

---

## ⚠️ Ograniczenia i Obejścia

### Ograniczenie 1: Załączniki w Forge Custom UI

**Problem:** Forge Custom UI ma ograniczoną obsługę file uploads.

**Obejście:**
- Użyj Jira native attachment po utworzeniu issue
- Lub: Użyj external storage (S3) + signed URLs (wymaga dodatkowych modułów)
- **Rekomendacja MVP:** Poproś użytkownika o dodanie załączników ręcznie do utworzonego issue

---

### Ograniczenie 2: @mention w Teams webhooks

**Problem:** Incoming Webhooks nie wspierają natywnych @mentions (@channel, @user).

**Obejście:**
- Użyj bold text: **@channel** w wiadomości (wizualnie podobne)
- Lub: Użyj Microsoft Graph API + Bot (wymaga rejestracji Azure AD App)
- **Rekomendacja MVP:** Użyj emoji i ALL CAPS dla P1: "🚨 CRITICAL ALERT 🚨"

---

### Ograniczenie 3: Watchers API w Jira Cloud

**Problem:** Dodawanie watchers wymaga osobnego API call per user.

**Obejście:**
- Loop przez listę watchers i wykonuj pojedyncze requesty
- Ignoruj błędy jeśli user nie istnieje lub nie ma uprawnień
- **Implementowane:** W `updateIssueWithResults()` w `src/index.js`

---

### Ograniczenie 4: Forge Storage - 250KB per key

**Problem:** Audit Log może przekroczyć limit jeśli za dużo wpisów.

**Obejście:**
- Automatyczne czyszczenie: zachowuj tylko ostatnie 1000 wpisów
- Lub: Użyj Forge External Storage (wymaga backend)
- **Implementowane:** W `logAuditEntry()` - automatyczne przycinanie

---

### Ograniczenie 5: UI Kit vs Custom UI - trade-offs

**Wybór: Custom UI (React)**

**Trade-offs:**
- ✅ Pełna kontrola nad UI
- ✅ Złożone formularze i walidacje
- ❌ Większy bundle size
- ❌ Więcej kodu do utrzymania
- ❌ Wymaga build step (React)

**Alternatywa UI Kit:**
- ✅ Mniejszy kod, szybszy development
- ✅ Native Forge components
- ❌ Ograniczone możliwości customizacji
- ❌ Trudniejsze conditional rendering

**Rekomendacja:** Custom UI dla MVP, ewentualnie migracja części do UI Kit later.

---

## 📚 Dodatkowe Zasoby

### Dokumentacja Forge
- [Forge Documentation](https://developer.atlassian.com/platform/forge/)
- [Forge CLI Reference](https://developer.atlassian.com/platform/forge/cli-reference/)
- [Custom UI with React](https://developer.atlassian.com/platform/forge/custom-ui/)
- [Forge Storage](https://developer.atlassian.com/platform/forge/storage/)

### Jira Cloud API
- [Jira REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Custom Fields](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/#ad-hoc-fields)

### Microsoft Teams
- [Incoming Webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
- [Adaptive Cards](https://adaptivecards.io/)
- [MessageCard Schema](https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference)

### Atlassian Design System
- [Design System](https://atlassian.design/)
- [React Components](https://atlassian.design/components)

---

## 📞 Wsparcie

W razie problemów:
1. Sprawdź logi: `forge logs --follow`
2. Sprawdź Audit Log w admin panelu
3. Sprawdź dokumentację Forge
4. Otwórz issue w repository

---

## 📝 Changelog

### v1.0.0 (2025-01-15)
- ✨ Initial release
- ✅ User Mode: Report Incident + My Incidents
- ✅ Admin Mode: 6 configuration tabs
- ✅ Rule Engine: P1-P4 automatic priority
- ✅ Escalation Engine: Fixed + Round Robin assignment
- ✅ Microsoft Teams integration
- ✅ Audit Log
- ✅ Complete documentation

---

## 📄 Licencja

MIT License - see LICENSE file

---

**Incident Reporter (Forge)** - Zbudowane z ❤️ na Atlassian Forge Platform

