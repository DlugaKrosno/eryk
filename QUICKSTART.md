# 🚀 Incident Reporter (Forge) - QuickStart

## 5-Minutowy Przegląd

**Incident Reporter** to aplikacja Forge dla Jira Cloud, która automatyzuje zgłaszanie, priorytetyzację i eskalację incydentów.

### Co robi aplikacja?

1. 👤 **User zgłasza incident** → formularz w Jira
2. 🤖 **System automatycznie:**
   - Wyznacza priorytet P1-P4 (według reguł)
   - Przypisuje do zespołu
   - Przypisuje do konkretnej osoby
   - Wysyła alert do Microsoft Teams
3. 👨‍💼 **Admin konfiguruje** reguły i zespoły przez panel

---

## Instalacja (15 minut)

### 1. Zainstaluj Forge CLI

```bash
npm install -g @forge/cli
forge login
```

### 2. Zbuduj i wdeploy aplikację

```bash
git clone <repository-url>
cd incident-reporter-forge
npm install
npm run build
forge register
forge deploy
forge install
```

### 3. Skonfiguruj Jira

1. **Utwórz projekt** INC
2. **Utwórz issue type** "Incident" (zanotuj ID)
3. **Utwórz 8 custom fields:**
   - System/Service (select)
   - Environment (select)
   - Category (select)
   - Impact (select)
   - Urgency (select)
   - Has Workaround (checkbox)
   - Calculated Priority (text)
   - Assigned Team (text)
4. **Zanotuj Custom Field IDs** (customfield_XXXXX)

### 4. Skonfiguruj aplikację

1. W Jira: **Apps** → **Incident Reporter Admin**
2. **General Settings:**
   - Project Key: `INC`
   - Issue Type ID: `10001` (Twoje)
3. **Fields & Dictionaries:**
   - Zmapuj wszystkie 8 custom fields
4. **Priority Rules:**
   - Dodaj co najmniej 1 regułę (np. P1 dla Production + Critical)
5. **Teams & Escalation:**
   - Dodaj co najmniej 1 zespół
6. **(Opcjonalnie) Microsoft Teams:**
   - Skonfiguruj webhook

### 5. Test!

1. Przejdź do projektu INC
2. Kliknij **Report Incident**
3. Wypełnij formularz
4. Submit!
5. Sprawdź czy:
   - Issue utworzony ✅
   - Priority ustawiony ✅
   - Zespół przypisany ✅
   - Teams notification wysłany ✅ (jeśli skonfigurowane)

---

## Podstawowe Użycie

### Użytkownik - Zgłoszenie Incydentu

```
Project INC → Report Incident
↓
Wypełnij formularz:
  - System: Payment Gateway
  - Environment: Production
  - Category: Outage
  - Description: System nie odpowiada
  - Impact: Critical
  - Urgency: Immediate
  - Workaround: nie
↓
Submit Incident
↓
✅ INC-1234 utworzony, automatycznie P1, przypisany do SRE
```

### Admin - Dodanie Reguły

```
Apps → Incident Reporter Admin → Priority Rules
↓
+ Add Rule
↓
  Name: P1 - Production Critical
  Priority: P1
  Conditions: AND
    - Environment = Production
    - Impact = Critical
    - HasWorkaround = false
↓
Save Rule
↓
✅ Reguła aktywna, będzie stosowana dla nowych incydentów
```

---

## Kluczowe Koncepcje

### 1. Priority Rules (P1-P4)

**First Match Wins:**
- Reguły sprawdzane od góry do dołu (według order)
- Pierwsza pasująca reguła wygrywa
- Jeśli żadna nie pasuje → default priority (P3)

**Przykład:**
```
Order 1: IF Production + Critical + No Workaround → P1
Order 2: IF Production + Critical → P2
Order 3: IF Critical → P3
```

Issue: Production + Critical + No Workaround
→ **Pasuje reguła 1 → P1** (reguły 2 i 3 nie są sprawdzane)

### 2. Team Assignment

**Strategie:**
- **Fixed:** Zawsze ta sama osoba (np. Team Lead)
- **Round Robin:** Rotacja między członkami zespołu
- **None:** Brak auto-assignment

**Team Mapping:**
```
IF System = "Payment Gateway" → Payments Team
IF Environment = "Production" + P1 → SRE Team
```

### 3. Microsoft Teams Integration

**Incoming Webhook:**
- Kopiujesz URL z Teams
- Wklejasz w Admin Panel
- Każdy incident wysyła powiadomienie

**Format:**
- P1: 🚨 Czerwony alert "INCIDENT ALERT"
- P2: ⚠️ Pomarańczowy
- P3-P4: ℹ️ Informacyjny

---

## Struktura Projektu

```
incident-reporter-forge/
├── src/index.js              # Backend (Rule Engine, Escalation, Teams)
├── static/user/              # Frontend (Zgłaszanie)
├── static/admin/             # Frontend (Konfiguracja)
├── manifest.yml              # Definicja Forge app
├── README.md                 # Pełna dokumentacja
├── INSTALLATION_GUIDE.md     # Szczegółowa instalacja
└── ARCHITECTURE.md           # Techniczne szczegóły
```

---

## Najczęstsze Problemy

### ❌ "Issue nie jest tworzony"

**Sprawdź:**
1. Czy `targetProjectKey` jest poprawny?
2. Czy `incidentIssueTypeId` istnieje?
3. Logi: `forge logs --follow`

### ❌ "Priority nie jest ustawiony"

**Sprawdź:**
1. Czy custom field ID dla "Calculated Priority" jest poprawny?
2. Czy co najmniej 1 reguła priorytetyzacji jest włączona?
3. Audit Log → czy reguły zadziałały?

### ❌ "Teams webhook nie działa"

**Sprawdź:**
1. Czy webhook URL jest poprawny? (outlook.office.com)
2. Test notification z Admin Panel
3. Czy connector w Teams jest aktywny?
4. Audit Log → status wysyłki

---

## Następne Kroki

Po instalacji:

1. 📖 **Przeczytaj README.md** - kompletna dokumentacja
2. ⚙️ **Skonfiguruj więcej reguł** - dostosuj do swoich potrzeb
3. 👥 **Dodaj zespoły** - mapuj systemy do zespołów
4. 📢 **Skonfiguruj Teams** - powiadomienia real-time
5. 👨‍🏫 **Przeszkol użytkowników** - jak zgłaszać incydenty
6. 📊 **Monitoruj Audit Log** - sprawdzaj czy wszystko działa

---

## Linki do Dokumentacji

- **README.md** - Pełna dokumentacja (2000+ linii)
- **INSTALLATION_GUIDE.md** - Szczegółowa instalacja krok po kroku
- **EXAMPLES_CONFIG.md** - Przykłady konfiguracji (Startup, Enterprise)
- **ARCHITECTURE.md** - Techniczne szczegóły i diagramy
- **PROJECT_SUMMARY.md** - Podsumowanie projektu

---

## Pomoc

W razie problemów:
1. Sprawdź **README.md** → sekcja "Rozwiązywanie Problemów"
2. Sprawdź logi: `forge logs --follow`
3. Sprawdź Audit Log w Admin Panel
4. Otwórz issue w repository

---

## Licencja

MIT License - zobacz LICENSE file

---

**Gotowy na automatyzację incydentów? Zaczynajmy! 🚀**

---

*QuickStart v1.0 - Incident Reporter (Forge)*

