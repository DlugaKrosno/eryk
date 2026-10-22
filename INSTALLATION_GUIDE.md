# 🚀 Incident Reporter (Forge) - Przewodnik Instalacji

## Szybki Start (15 minut)

### Krok 1: Przygotowanie środowiska

```bash
# Zainstaluj Forge CLI
npm install -g @forge/cli

# Zaloguj się do Forge
forge login
```

Zostaniesz przekierowany do przeglądarki - zaloguj się kontem Atlassian.

---

### Krok 2: Sklonuj i przygotuj projekt

```bash
# Sklonuj repozytorium
git clone <repository-url>
cd incident-reporter-forge

# Zainstaluj zależności backendu
npm install

# Zbuduj frontendy (User, Admin, Issue Panel)
npm run build
```

**Uwaga:** Build może potrwać 2-3 minuty.

---

### Krok 3: Zarejestruj i wdeploy aplikację

```bash
# Zarejestruj nową aplikację Forge
forge register

# Podaj nazwę: incident-reporter-forge
# Wybierz workspace

# Deploy aplikacji
forge deploy

# Instalacja w Jira
forge install
```

Podczas `forge install`:
- Wybierz produkt: **Jira**
- Wybierz swoją instancję Jira Cloud

---

### Krok 4: Konfiguracja Jira (Admin)

#### 4.1 Utwórz Projekt

1. W Jira: **Projects** → **Create project**
2. Template: Company-managed lub Team-managed
3. Klucz projektu: **INC**
4. Nazwa: **Incidents**

#### 4.2 Utwórz Issue Type

1. **Jira Settings** → **Issues** → **Issue types**
2. Kliknij **Add issue type**
3. Nazwa: **Incident**
4. Typ: Standard Issue Type
5. **Zanotuj Issue Type ID** (zobacz URL lub użyj API)

**Jak znaleźć Issue Type ID:**
```bash
# Użyj Jira REST API
curl -u email@example.com:api_token \
  https://your-instance.atlassian.net/rest/api/3/issuetype
```

Znajdź `"name": "Incident"` i skopiuj `"id": "10001"`.

#### 4.3 Utwórz Custom Fields

Utwórz następujące custom fields w Jira:

| Nazwa | Typ Pola | Opcje (jeśli select) |
|-------|----------|---------------------|
| System/Service | Select List (single) | Payment Gateway, API, Database, Web Application, Mobile App, Other |
| Environment | Select List (single) | Production, UAT, Development, Staging, Other |
| Category | Select List (single) | Performance, Outage, Data Loss, Security, Integration, Other |
| Impact | Select List (single) | Critical, High, Medium, Low |
| Urgency | Select List (single) | Immediate, High, Medium, Low |
| Has Workaround | Checkbox | - |
| Calculated Priority | Short Text | - |
| Assigned Team | Short Text | - |

**Krok po kroku:**
1. **Jira Settings** → **Issues** → **Custom fields**
2. **Create custom field**
3. Wybierz typ (Select List lub Checkbox lub Text Field)
4. Podaj nazwę i opis
5. Jeśli Select - dodaj opcje
6. **Associate field** z projektem INC
7. Dodaj do odpowiednich **screens** (Create, Edit, View)
8. **Zanotuj Custom Field ID** dla każdego

**Jak znaleźć Custom Field ID:**
- Kliknij na custom field
- Sprawdź URL: `.../customfield_10100` → ID to `customfield_10100`

---

### Krok 5: Konfiguracja Aplikacji (Panel Admin)

#### 5.1 Otwórz Admin Panel

1. W Jira, kliknij **Apps** w górnym menu
2. Wybierz **Incident Reporter Admin**

#### 5.2 Tab "General Settings"

Wypełnij:
- **Target Project Key**: `INC`
- **Incident Issue Type ID**: `10001` (Twoje ID z kroku 4.2)
- **Jira Instance URL**: `your-company.atlassian.net`
- **Default Priority**: `P3`

Kliknij **Save Settings**.

#### 5.3 Tab "Fields & Dictionaries"

Mapuj Custom Field IDs:
- **System Field ID**: `customfield_10100`
- **Environment Field ID**: `customfield_10101`
- **Category Field ID**: `customfield_10102`
- **Impact Field ID**: `customfield_10103`
- **Urgency Field ID**: `customfield_10104`
- **Has Workaround Field ID**: `customfield_10105`
- **Calculated Priority Field ID**: `customfield_10106`
- **Assigned Team Field ID**: `customfield_10107`

*(Zastąp numerami swoich custom fields)*

Kliknij **Save Field Mappings**.

#### 5.4 Tab "Priority Rules"

Utwórz przykładowe reguły:

**Reguła 1: P1 - Production Critical**
- Name: `P1 - Production Critical Outage`
- Priority: `P1`
- Conditions: `AND`
  - Environment equals Production
  - Impact equals Critical
  - HasWorkaround equals false
- Enabled: ✅

**Reguła 2: P2 - High Impact**
- Name: `P2 - High Impact`
- Priority: `P2`
- Conditions: `OR`
  - Impact equals Critical
  - Urgency equals Immediate

**Reguła 3: P3 - Medium**
- Name: `P3 - Medium Impact`
- Priority: `P3`
- Conditions: `AND`
  - Impact in [Medium, High]

Kliknij **Save Rule** dla każdej.

Użyj **↑↓** aby ustawić kolejność (1, 2, 3).

#### 5.5 Tab "Teams & Escalation"

Utwórz przykładowy zespół:

1. Kliknij **+ Add Team**
2. Nazwa: `SRE`
3. Kliknij **Edit** i skonfiguruj:
   - **Assignment Strategy**: `Fixed` lub `Round Robin`
   - **Default Assignee**: Jira Account ID (zobacz poniżej)
   - **Watchers**: Jira Account IDs managerów

**Jak znaleźć Jira Account ID:**
1. Otwórz profil użytkownika
2. URL: `.../jira/people/{accountId}` → skopiuj accountId
3. Lub użyj API: `/rest/api/3/user/search?query=email@example.com`

#### 5.6 Tab "Microsoft Teams" (opcjonalne)

1. Otwórz Microsoft Teams
2. Przejdź do kanału (np. #incidents)
3. **⋯ More options** → **Connectors**
4. Wyszukaj **Incoming Webhook** → **Configure**
5. Nazwa: `Incident Reporter`
6. **Create** → Skopiuj URL

W aplikacji:
1. Wybierz zespół: `SRE`
2. **Teams Channel Name**: `incidents`
3. **Webhook URL**: Wklej skopiowany URL
4. **Save Configuration**
5. Kliknij **🧪 Send Test Notification** - sprawdź Teams

---

### Krok 6: Test Aplikacji

#### Test 1: Zgłoś testowy incident

1. Przejdź do projektu **INC**
2. W menu bocznym kliknij **Report Incident**
3. Wypełnij formularz:
   - System: Payment Gateway
   - Environment: Production
   - Category: Outage
   - Description: Test incident - please ignore
   - Impact: Critical
   - Urgency: Immediate
   - Has Workaround: unchecked
4. Kliknij **Submit Incident**

**Oczekiwany rezultat:**
- ✅ Komunikat sukcesu
- ✅ Issue utworzony (np. INC-1)
- ✅ Priority = P1 (zgodnie z regułą)
- ✅ Przypisany do zespołu SRE
- ✅ Powiadomienie w Microsoft Teams (jeśli skonfigurowane)

#### Test 2: Sprawdź Audit Log

1. Otwórz **Incident Reporter Admin**
2. Przejdź do zakładki **Audit Log**
3. Sprawdź wpisy:
   - incident_created
   - priority_calculated
   - team_assigned
   - teams_notification_sent (jeśli Teams skonfigurowane)

---

## ✅ Checklist Instalacji

- [ ] Forge CLI zainstalowane i zalogowane
- [ ] Projekt sklonowany i zbudowany (`npm run build`)
- [ ] Aplikacja zarejestrowana (`forge register`)
- [ ] Aplikacja wdrożona (`forge deploy`)
- [ ] Aplikacja zainstalowana w Jira (`forge install`)
- [ ] Projekt INC utworzony w Jira
- [ ] Issue Type "Incident" utworzony
- [ ] 8 Custom Fields utworzonych i zmapowanych
- [ ] General Settings skonfigurowane
- [ ] Fields & Dictionaries zmapowane
- [ ] Co najmniej 1 reguła priorytetyzacji utworzona
- [ ] Co najmniej 1 zespół utworzony
- [ ] (Opcjonalnie) Microsoft Teams webhook skonfigurowany
- [ ] Testowy incident zgłoszony i przetworzony poprawnie

---

## 🔧 Troubleshooting

### Problem: "forge: command not found"

**Rozwiązanie:**
```bash
npm install -g @forge/cli
```

---

### Problem: Build fails

**Rozwiązanie:**
```bash
# Usuń node_modules i zbuduj ponownie
rm -rf node_modules static/*/node_modules
npm install
npm run build
```

---

### Problem: "Permission denied" podczas instalacji

**Rozwiązanie:**
- Upewnij się że masz uprawnienia Jira Site Admin
- Lub poproś admina o instalację aplikacji

---

### Problem: Custom fields nie zapisują wartości

**Rozwiązanie:**
1. Sprawdź czy custom fields są na odpowiednich screens
2. Sprawdź czy Field IDs są poprawne w "Fields & Dictionaries"
3. Sprawdź logi: `forge logs --follow`

---

### Problem: Teams webhook nie działa

**Rozwiązanie:**
1. Sprawdź czy URL jest poprawny (zawiera `outlook.office.com/webhook`)
2. Użyj "Send Test Notification" - sprawdź błąd
3. Utwórz nowy webhook w Teams jeśli stary wygasł
4. Sprawdź Audit Log dla szczegółów błędu

---

## 📚 Dalsze Kroki

Po instalacji:
1. **Przeczytaj README.md** - pełna dokumentacja
2. **Skonfiguruj więcej reguł** - dostosuj do swoich potrzeb
3. **Dodaj więcej zespołów** - mapuj systemy do zespołów
4. **Przeszkol użytkowników** - jak zgłaszać incydenty
5. **Monitoruj Audit Log** - sprawdzaj czy wszystko działa

---

## 🆘 Potrzebujesz pomocy?

- 📖 Przeczytaj **README.md** - szczegółowa dokumentacja
- 🔍 Sprawdź logi: `forge logs --follow`
- 💬 Otwórz issue w repository
- 📧 Skontaktuj się z zespołem

---

**Gratulacje! Aplikacja Incident Reporter jest gotowa do użycia! 🎉**

