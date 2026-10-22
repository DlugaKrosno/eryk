# Instrukcja Wdrożenia Produkcyjnego i Publikacji w Marketplace

## 📋 Przygotowanie do Produkcji

### 1. Weryfikacja przed wdrożeniem

#### ✅ Checklist przed wdrożeniem produkcyjnym:

- [ ] Wszystkie komponenty React zostały zbudowane (`npm run build`)
- [ ] Wersja w `package.json` została zaktualizowana
- [ ] `manifest.yml` zawiera poprawny `app.id`
- [ ] Wszystkie testy przeszły pomyślnie
- [ ] Dokumentacja jest aktualna
- [ ] Pliki `.gitignore` są skonfigurowane poprawnie
- [ ] Brak danych testowych w kodzie produkcyjnym
- [ ] Wszystkie zmienne środowiskowe są skonfigurowane

### 2. Budowanie aplikacji

```bash
# Zainstaluj zależności główne
npm install

# Zbuduj wszystkie komponenty UI
npm run build

# Sprawdź czy build się powiódł
# Sprawdź foldery: static/user/build, static/admin/build, static/issue-panel/build
```

### 3. Weryfikacja manifest.yml

Upewnij się, że `manifest.yml` zawiera:

```yaml
app:
  runtime:
    name: nodejs20.x
  id: ari:cloud:ecosystem::app/YOUR-APP-ID

permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - read:jira-user
    - storage:app
  external:
    fetch:
      backend:
        - "*.webhook.office.com"
```

### 4. Wdrożenie do środowiska produkcyjnego

```bash
# Zaloguj się do Forge
forge login

# Wdróż do produkcji
forge deploy --environment production

# Alternatywnie (jeśli nie używasz flagi --environment)
forge deploy
# Następnie wybierz "production" z listy
```

### 5. Instalacja w instancji produkcyjnej

```bash
# Zainstaluj aplikację w instancji Jira
forge install --upgrade

# Wybierz instancję produkcyjną z listy
```

---

## 🏪 Publikacja w Atlassian Marketplace (Tryb Private)

### Krok 1: Przygotowanie Developer Portal

1. **Zaloguj się do Atlassian Developer Portal:**
   - Przejdź do: https://developer.atlassian.com/console/myapps/
   - Zaloguj się kontem Atlassian

2. **Utwórz nową aplikację (jeśli jeszcze nie istnieje):**
   - Kliknij "Create" → "Forge app"
   - Wypełnij podstawowe informacje:
     - **Name:** DrEryk Alert Management
     - **Description:** Comprehensive alert management system for Jira Cloud
     - **App key:** (zostanie wygenerowany automatycznie)

### Krok 2: Konfiguracja aplikacji w Developer Portal

1. **App details:**
   - **App name:** DrEryk Alert Management
   - **Short description:** Alert management with automated prioritization and Teams integration
   - **Long description:** (Użyj treści z README.md)
   - **Category:** Project management / Incident management
   - **Support URL:** (URL do dokumentacji lub support)
   - **Documentation URL:** (URL do dokumentacji)

2. **Distribution:**
   - **Distribution type:** Private (dla wewnętrznego użycia)
   - **Pricing:** Free (lub ustaw odpowiednią cenę)

3. **Scopes & permissions:**
   - Upewnij się, że wszystkie wymagane uprawnienia są wymienione:
     - `read:jira-work`
     - `write:jira-work`
     - `read:jira-user`
     - `storage:app`

4. **External connections:**
   - Dodaj: `*.webhook.office.com` (dla integracji Teams)

### Krok 3: Przygotowanie do publikacji

1. **Zbuduj aplikację:**
   ```bash
   npm run build
   ```

2. **Wdróż do produkcji:**
   ```bash
   forge deploy --environment production
   ```

3. **Zweryfikuj wdrożenie:**
   - Sprawdź logi: `forge logs`
   - Przetestuj wszystkie funkcjonalności w środowisku produkcyjnym

### Krok 4: Publikacja w Marketplace

1. **W Developer Portal:**
   - Przejdź do sekcji "Distribution"
   - Kliknij "Publish" lub "Submit for review" (dla publicznego Marketplace)
   - Dla trybu Private: Kliknij "Make available to organization"

2. **Wypełnij formularz publikacji:**
   - **Version:** 2.6.0 (zgodna z package.json)
   - **Release notes:** Opisz zmiany w tej wersji
   - **Screenshots:** (opcjonalnie) Dodaj zrzuty ekranu aplikacji
   - **Support information:** Podaj kontakt do supportu

3. **Dla trybu Private:**
   - Wybierz organizacje, które mają mieć dostęp
   - Ustaw datę publikacji
   - Kliknij "Publish"

### Krok 5: Instalacja z Marketplace (dla użytkowników)

Po publikacji, użytkownicy mogą zainstalować aplikację:

1. **Z Marketplace (tryb Private):**
   - Przejdź do: https://marketplace.atlassian.com/
   - Wyszukaj "DrEryk Alert Management"
   - Kliknij "Get it now"
   - Wybierz instancję Jira
   - Zatwierdź uprawnienia

2. **Bezpośrednio z Developer Portal:**
   - Użytkownicy z dostępem mogą zainstalować z Developer Portal
   - Link do instalacji będzie dostępny w sekcji "Distribution"

---

## 🔐 Bezpieczeństwo i Best Practices

### 1. Zmienne środowiskowe
- Nie przechowuj wrażliwych danych w kodzie
- Używaj Forge Storage API dla konfiguracji
- Nie loguj wrażliwych danych

### 2. Uprawnienia
- Używaj minimalnych wymaganych uprawnień
- Dokumentuj wszystkie wymagane uprawnienia
- Regularnie przeglądaj uprawnienia

### 3. Monitoring
- Monitoruj logi aplikacji: `forge logs`
- Sprawdzaj metryki w Developer Portal
- Ustaw alerty dla błędów

### 4. Aktualizacje
- Regularnie aktualizuj zależności
- Testuj aktualizacje w środowisku deweloperskim
- Dokumentuj zmiany w release notes

---

## 📝 Checklist Publikacji

### Przed publikacją:
- [ ] Kod został przetestowany w środowisku produkcyjnym
- [ ] Wszystkie komponenty zostały zbudowane
- [ ] Dokumentacja jest kompletna i aktualna
- [ ] Wersja została zaktualizowana w package.json
- [ ] Release notes zostały przygotowane
- [ ] Screenshots zostały przygotowane (opcjonalnie)
- [ ] Support information jest dostępne
- [ ] Privacy policy jest dostępna (jeśli wymagana)
- [ ] Terms of service są dostępne (jeśli wymagane)

### Po publikacji:
- [ ] Zweryfikuj instalację w testowej instancji
- [ ] Przetestuj wszystkie funkcjonalności
- [ ] Sprawdź logi pod kątem błędów
- [ ] Monitoruj feedback użytkowników
- [ ] Przygotuj plan aktualizacji

---

## 🚀 Aktualizacja wersji

### Proces aktualizacji:

1. **Zaktualizuj wersję w package.json:**
   ```json
   "version": "2.6.1"
   ```

2. **Zbuduj aplikację:**
   ```bash
   npm run build
   ```

3. **Wdróż nową wersję:**
   ```bash
   forge deploy --environment production
   ```

4. **Zaktualizuj w Developer Portal:**
   - Dodaj nową wersję w sekcji "Versions"
   - Wypełnij release notes
   - Opublikuj nową wersję

5. **Powiadom użytkowników:**
   - Wyślij powiadomienie o aktualizacji
   - Opisz nowe funkcjonalności
   - Wskaż breaking changes (jeśli występują)

---

## 📞 Wsparcie

W przypadku problemów z wdrożeniem lub publikacją:

1. Sprawdź dokumentację Atlassian Forge: https://developer.atlassian.com/platform/forge/
2. Sprawdź dokumentację Marketplace: https://developer.atlassian.com/docs/atlassian-marketplace/
3. Sprawdź logi: `forge logs`
4. Skontaktuj się z Atlassian Support

---

## 🔗 Przydatne linki

- **Atlassian Developer Portal:** https://developer.atlassian.com/console/myapps/
- **Forge Documentation:** https://developer.atlassian.com/platform/forge/
- **Marketplace Documentation:** https://developer.atlassian.com/docs/atlassian-marketplace/
- **Forge CLI Reference:** https://developer.atlassian.com/platform/forge/cli-reference/
