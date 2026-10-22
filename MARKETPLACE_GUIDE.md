# Przewodnik Publikacji w Atlassian Marketplace (Tryb Private)

## 📦 Przygotowanie Aplikacji do Marketplace

### 1. Wymagania wstępne

- ✅ Konto Atlassian z dostępem do Developer Portal
- ✅ Aplikacja Forge wdrożona i działająca
- ✅ Wszystkie komponenty zbudowane
- ✅ Dokumentacja przygotowana
- ✅ Testy przeprowadzone

### 2. Konfiguracja w Developer Portal

#### A. Podstawowe informacje

1. **App Name:** DrEryk Alert Management
2. **App Key:** (automatycznie generowany)
3. **Short Description:** 
   ```
   Comprehensive alert management system for Jira Cloud with automated prioritization, team assignment, and Microsoft Teams integration.
   ```
4. **Long Description:**
   ```
   DrEryk Alert Management to zaawansowany system zarządzania alertami dla Jira Cloud, który automatyzuje proces zgłaszania, priorytetyzacji i eskalacji alertów systemowych.

   Główne funkcje:
   - Formularz zgłoszenia alertu z walidacją
   - Automatyczna kalkulacja priorytetu (P1-P4) na podstawie reguł
   - Automatyczne przypisanie do zespołów i użytkowników
   - Integracja z Microsoft Teams (powiadomienia webhook)
   - Panel administracyjny z pełną konfiguracją
   - Zarządzanie regułami priorytetyzacji i eskalacji
   - Harmonogram dyżurów zespołów
   - Dziennik audytu wszystkich operacji
   - Konfiguracja per projekt

   Aplikacja jest w pełni konfigurowalna i pozwala na dostosowanie do specyficznych potrzeb organizacji.
   ```

#### B. Kategorie i tagi

- **Primary Category:** Project Management
- **Secondary Categories:** Incident Management, Automation
- **Tags:** alert, incident, automation, teams, escalation, priority, sla

#### C. Screenshots (opcjonalnie, ale zalecane)

Przygotuj zrzuty ekranu:
1. Formularz zgłoszenia alertu
2. Panel administracyjny - Ustawienia ogólne
3. Panel administracyjny - Reguły priorytetyzacji
4. Panel administracyjny - Zespoły i eskalacja
5. Powiadomienie w Microsoft Teams

#### D. Support Information

- **Support URL:** (URL do dokumentacji lub strony support)
- **Documentation URL:** (URL do README.md lub dokumentacji)
- **Support Email:** (opcjonalnie)

### 3. Konfiguracja Distribution (Tryb Private)

#### A. Ustawienia Private Distribution

1. **Distribution Type:** Private
2. **Availability:**
   - Wybierz organizacje, które mają mieć dostęp
   - Lub ustaw jako dostępne dla całej organizacji Atlassian

3. **Pricing:**
   - **Free** - dla wewnętrznego użycia
   - Lub ustaw odpowiednią cenę/licencję

#### B. Wymagane uprawnienia

Upewnij się, że wszystkie uprawnienia są wymienione:

```yaml
permissions:
  scopes:
    - read:jira-work      # Odczyt i tworzenie issues
    - write:jira-work     # Modyfikacja issues
    - read:jira-user     # Odczyt informacji o użytkownikach
    - storage:app        # Przechowywanie konfiguracji
  external:
    fetch:
      backend:
        - "*.webhook.office.com"  # Integracja z Microsoft Teams
```

### 4. Proces Publikacji

#### Krok 1: Przygotowanie wersji

```bash
# 1. Zaktualizuj wersję w package.json
# 2. Zbuduj aplikację
npm run build

# 3. Wdróż do produkcji
forge deploy --environment production
```

#### Krok 2: Publikacja w Developer Portal

1. Zaloguj się do: https://developer.atlassian.com/console/myapps/
2. Wybierz swoją aplikację
3. Przejdź do sekcji "Distribution"
4. Kliknij "Publish" lub "Make available to organization"
5. Wypełnij formularz:
   - **Version:** 2.6.0
   - **Release Notes:** Opisz zmiany
   - **Screenshots:** (opcjonalnie)
6. Kliknij "Publish"

#### Krok 3: Weryfikacja

1. Zainstaluj aplikację w testowej instancji z Marketplace
2. Przetestuj wszystkie funkcjonalności
3. Sprawdź logi pod kątem błędów
4. Zweryfikuj uprawnienia

### 5. Instalacja przez użytkowników

#### Z Marketplace (tryb Private):

1. Użytkownik loguje się do: https://marketplace.atlassian.com/
2. Wyszukuje "DrEryk Alert Management"
3. Klika "Get it now"
4. Wybiera instancję Jira
5. Zatwierdza uprawnienia
6. Aplikacja jest instalowana

#### Bezpośredni link:

Możesz udostępnić bezpośredni link do instalacji:
```
https://marketplace.atlassian.com/apps/[APP-ID]/dreryk-alert-management
```

### 6. Aktualizacja wersji

#### Proces aktualizacji:

1. **Zaktualizuj wersję:**
   ```json
   // package.json
   "version": "2.6.1"
   ```

2. **Zbuduj i wdróż:**
   ```bash
   npm run build
   forge deploy --environment production
   ```

3. **Dodaj nową wersję w Developer Portal:**
   - Przejdź do sekcji "Versions"
   - Kliknij "Add version"
   - Wypełnij:
     - Version number: 2.6.1
     - Release notes: Opisz zmiany
   - Kliknij "Publish"

4. **Użytkownicy otrzymają powiadomienie o aktualizacji:**
   - Mogą zaktualizować aplikację z Marketplace
   - Lub automatycznie (w zależności od ustawień)

### 7. Monitoring i Wsparcie

#### Monitoring:

- Sprawdzaj logi: `forge logs`
- Monitoruj metryki w Developer Portal
- Sprawdzaj feedback użytkowników

#### Wsparcie:

- Przygotuj dokumentację użytkownika
- Utwórz FAQ
- Zapewnij kanał komunikacji (email, support URL)

---

## 📋 Checklist Publikacji

### Przed publikacją:
- [ ] Kod został przetestowany
- [ ] Wszystkie komponenty zbudowane
- [ ] Wersja zaktualizowana
- [ ] Dokumentacja przygotowana
- [ ] Screenshots przygotowane (opcjonalnie)
- [ ] Release notes napisane
- [ ] Support information dostępne
- [ ] Privacy policy (jeśli wymagana)
- [ ] Terms of service (jeśli wymagane)

### Po publikacji:
- [ ] Zweryfikowano instalację
- [ ] Przetestowano funkcjonalności
- [ ] Sprawdzono logi
- [ ] Przygotowano plan aktualizacji

---

## 🔗 Przydatne Linki

- **Developer Portal:** https://developer.atlassian.com/console/myapps/
- **Marketplace:** https://marketplace.atlassian.com/
- **Forge Docs:** https://developer.atlassian.com/platform/forge/
- **Marketplace Docs:** https://developer.atlassian.com/docs/atlassian-marketplace/
