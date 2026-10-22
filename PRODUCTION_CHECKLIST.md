# ✅ Checklist Produkcyjny - DrEryk Alert Management

## 🔍 Przed Wdrożeniem Produkcyjnym

### 1. Kod i Konfiguracja

- [ ] **Wersja zaktualizowana** w `package.json` (obecna: 2.6.0)
- [ ] **Wszystkie komponenty zbudowane:**
  ```bash
  npm run build
  ```
  - [ ] `static/user/build` istnieje i zawiera pliki
  - [ ] `static/admin/build` istnieje i zawiera pliki
  - [ ] `static/issue-panel/build` istnieje i zawiera pliki

- [ ] **manifest.yml zweryfikowany:**
  - [ ] `app.id` jest poprawne
  - [ ] `app.runtime.name` = `nodejs20.x`
  - [ ] Wszystkie funkcje są zdefiniowane
  - [ ] Wszystkie uprawnienia są wymienione
  - [ ] External fetch dla Teams jest skonfigurowane

- [ ] **package.json zweryfikowany:**
  - [ ] Nazwa aplikacji jest poprawna
  - [ ] Wersja jest aktualna
  - [ ] Opis jest kompletny
  - [ ] Keywords są odpowiednie
  - [ ] License jest ustawiona

### 2. Testy i Weryfikacja

- [ ] **Testy funkcjonalne:**
  - [ ] Formularz zgłoszenia alertu działa
  - [ ] Panel administracyjny działa
  - [ ] Reguły priorytetyzacji działają
  - [ ] Przypisanie zespołów działa
  - [ ] Integracja Teams działa
  - [ ] Konfiguracja per projekt działa

- [ ] **Testy w środowisku deweloperskim:**
  ```bash
  forge deploy
  forge install
  ```
  - [ ] Wdrożenie się powiodło
  - [ ] Instalacja się powiodła
  - [ ] Wszystkie funkcje działają poprawnie

- [ ] **Sprawdzenie logów:**
  ```bash
  forge logs
  ```
  - [ ] Brak błędów krytycznych
  - [ ] Wszystkie operacje są logowane poprawnie

### 3. Dokumentacja

- [ ] **README.md** jest aktualny
- [ ] **DEPLOYMENT.md** jest przygotowany
- [ ] **MARKETPLACE_GUIDE.md** jest przygotowany
- [ ] **INSTALLATION_GUIDE.md** jest aktualny
- [ ] Wszystkie instrukcje są poprawne

### 4. Bezpieczeństwo

- [ ] **Brak wrażliwych danych w kodzie:**
  - [ ] Brak hardcoded credentials
  - [ ] Brak API keys w kodzie
  - [ ] Wszystkie dane wrażliwe w Forge Storage

- [ ] **Uprawnienia są minimalne:**
  - [ ] Tylko wymagane scopes
  - [ ] Tylko wymagane external fetch

- [ ] **Walidacja danych:**
  - [ ] Wszystkie inputy są walidowane
  - [ ] Brak SQL injection (nie dotyczy - używamy Storage API)
  - [ ] Brak XSS (React automatycznie escape'uje)

### 5. Performance

- [ ] **Build size:**
  - [ ] Sprawdź rozmiar plików build
  - [ ] Upewnij się, że nie są zbyt duże

- [ ] **Optymalizacja:**
  - [ ] React components są zoptymalizowane
  - [ ] Brak niepotrzebnych re-renderów
  - [ ] Lazy loading gdzie możliwe

## 🚀 Proces Wdrożenia Produkcyjnego

### Krok 1: Finalna weryfikacja

```bash
# 1. Sprawdź status git (jeśli używasz)
git status

# 2. Zbuduj wszystko
npm run build

# 3. Sprawdź czy build się powiódł
ls static/user/build
ls static/admin/build
ls static/issue-panel/build
```

### Krok 2: Wdrożenie do produkcji

```bash
# 1. Zaloguj się
forge login

# 2. Wdróż do produkcji
forge deploy --environment production

# 3. Zweryfikuj wdrożenie
forge logs
```

### Krok 3: Instalacja w instancji produkcyjnej

```bash
# 1. Zainstaluj w instancji
forge install --upgrade

# 2. Wybierz instancję produkcyjną
# 3. Zweryfikuj instalację
```

### Krok 4: Testy produkcyjne

- [ ] Przetestuj formularz zgłoszenia
- [ ] Przetestuj panel administracyjny
- [ ] Przetestuj wszystkie funkcjonalności
- [ ] Sprawdź logi pod kątem błędów

## 📦 Publikacja w Marketplace

### Przed publikacją:

- [ ] **Developer Portal skonfigurowany:**
  - [ ] App details wypełnione
  - [ ] Screenshots przygotowane (opcjonalnie)
  - [ ] Support information dostępne
  - [ ] Documentation URL ustawiony

- [ ] **Distribution skonfigurowany:**
  - [ ] Tryb Private wybrany
  - [ ] Organizacje wybrane
  - [ ] Pricing ustawiony

- [ ] **Wersja przygotowana:**
  - [ ] Version number: 2.6.0
  - [ ] Release notes napisane
  - [ ] Changelog przygotowany

### Proces publikacji:

1. Zaloguj się do Developer Portal
2. Przejdź do sekcji Distribution
3. Kliknij "Publish" lub "Make available to organization"
4. Wypełnij formularz
5. Kliknij "Publish"

### Po publikacji:

- [ ] Zweryfikuj instalację z Marketplace
- [ ] Przetestuj wszystkie funkcjonalności
- [ ] Sprawdź logi
- [ ] Monitoruj feedback

## 🔄 Aktualizacja Wersji

### Proces aktualizacji:

1. **Zaktualizuj wersję:**
   ```json
   // package.json
   "version": "2.6.1"
   ```

2. **Zbuduj:**
   ```bash
   npm run build
   ```

3. **Wdróż:**
   ```bash
   forge deploy --environment production
   ```

4. **Dodaj wersję w Developer Portal:**
   - Przejdź do Versions
   - Kliknij "Add version"
   - Wypełnij formularz
   - Opublikuj

## 📊 Monitoring

### Regularne sprawdzanie:

- [ ] Sprawdzaj logi: `forge logs`
- [ ] Monitoruj metryki w Developer Portal
- [ ] Sprawdzaj feedback użytkowników
- [ ] Monitoruj wydajność

### Alerty:

- [ ] Ustaw alerty dla błędów krytycznych
- [ ] Monitoruj rate limits
- [ ] Sprawdzaj storage usage

## 🆘 Wsparcie

### W przypadku problemów:

1. Sprawdź logi: `forge logs`
2. Sprawdź dokumentację Forge
3. Sprawdź dokumentację Marketplace
4. Skontaktuj się z Atlassian Support

### Przydatne linki:

- Developer Portal: https://developer.atlassian.com/console/myapps/
- Forge Docs: https://developer.atlassian.com/platform/forge/
- Marketplace Docs: https://developer.atlassian.com/docs/atlassian-marketplace/

---

**Data ostatniej weryfikacji:** _______________
**Wersja:** 2.6.0
**Status:** ☐ Gotowe do produkcji / ☐ W trakcie przygotowania
