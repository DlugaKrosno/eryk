# DrEryk Alert - Instrukcja SLA i Przypomnień

## 📋 Jak działa SLA i przypomnienia

### 1. Konfiguracja w Panelu Admin

#### Reguły Eskalacji (Admin → Reguły Eskalacji)
Każda reguła może mieć:
- **SLA (czas reakcji)**: np. P1 = 1h, P2 = 4h, P3 = 8h
- **Przypomnienia**: co X minut, maksymalnie Y razy
- **Ścieżki eskalacji**: po upływie czasu → akcje (przypisz użytkownika, wyślij powiadomienie)

#### Harmonogram Zespołów (Admin → Zespoły)
- Ustaw harmonogram dyżurów (który zespół w którym tygodniu)
- Każdy zespół powinien mieć **Teams Webhook URL** dla powiadomień

### 2. Jak uruchomić sprawdzanie SLA

#### Opcja A: Ręcznie (testowanie)
1. Przejdź do **Admin Panel**
2. Kliknij przycisk **"🔍 Sprawdź SLA/Przypomnienia"** (górny prawy róg)
3. System sprawdzi wszystkie otwarte zgłoszenia

#### Opcja B: Automatycznie (zewnętrzny scheduler)
Ponieważ Forge nie wspiera scheduled triggers w podstawowej wersji, musisz użyć zewnętrznego narzędzia:

**Przykład: GitHub Actions**
```yaml
name: DrEryk Alert SLA Check
on:
  schedule:
    - cron: '*/5 * * * *'  # Co 5 minut
jobs:
  sla-check:
    runs-on: ubuntu-latest
    steps:
      - name: Call Forge Webtrigger
        run: |
          curl -X POST https://YOUR_WEBTRIGGER_URL
```

**Jak uzyskać Webtrigger URL:**
```bash
forge webtrigger
# Wybierz: sla-check-trigger
# Skopiuj URL
```

### 3. Co się dzieje podczas sprawdzania SLA

Dla każdego otwartego zgłoszenia:

1. **Sprawdza priorytet** (P1-P4)
2. **Sprawdza wiek zgłoszenia**
3. **Jeśli SLA przekroczone**:
   - Dodaje komentarz do zgłoszenia
   - Eskaluje według ścieżek eskalacji
   - Wysyła powiadomienie na Teams (jeśli skonfigurowane)
4. **Jeśli czas na przypomnienie**:
   - Dodaje komentarz przypomnienia
   - Wysyła powiadomienie na Teams

### 4. Przykład konfiguracji

**Reguła eskalacji dla P1:**
- Nazwa: "Krytyczne P1"
- Warunki: Priorytety = [P1]
- SLA reakcji: P1 = 1h
- Przypomnienia: Co 15 minut, max 4 razy
- Ścieżka eskalacji:
  - Po 30 min → przypisz do user@example.com
  - Po 60 min → wyślij powiadomienie na Teams

**Co się stanie:**
- 0 min: Zgłoszenie utworzone
- 15 min: Przypomnienie #1 (komentarz + Teams)
- 30 min: Przypomnienie #2 + ESKALACJA (przypisz do usera)
- 45 min: Przypomnienie #3
- 60 min: Przypomnienie #4 + ESKALACJA (powiadomienie Teams "SLA BREACH")

### 5. Troubleshooting

**Brak powiadomień na Teams:**
- Sprawdź czy zespół ma skonfigurowany **Teams Webhook URL**
- Sprawdź w `forge logs` czy jest komunikat "Webhook URL zespołu: SKONFIGUROWANY"

**Brak komentarzy:**
- Sprawdź czy reguła eskalacji jest **włączona**
- Sprawdź czy priorytet zgłoszenia pasuje do warunków reguły

**Jak sprawdzić logi:**
```bash
forge logs
```

### 6. Testowanie

1. Utwórz zgłoszenie testowe
2. Ustaw SLA na 1 minutę w regule eskalacji
3. Poczekaj 1 minutę
4. Kliknij **"🔍 Sprawdź SLA/Przypomnienia"** w Admin Panel
5. Sprawdź komentarze w zgłoszeniu Jira
6. Sprawdź powiadomienie na Teams (jeśli webhook skonfigurowany)
7. Sprawdź logi: `forge logs`


