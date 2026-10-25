# drEryk Alert

Aplikacja Atlassian Forge dla Jira Cloud do zgłaszania i obsługi alertów systemowych.

## Jak to działa

1. Użytkownik wybiera w formularzu **kategorię (domenę)** zgłoszenia.
2. Każda domena jest na stałe przypisana do **zespołu**. Zespół ma własny **harmonogram dyżurów** i listę **delegatów**.
3. Zgłoszenie dostaje priorytet P1-P4 z silnika reguł, jest przypisywane **dyżurnemu zespołu** (osoba z harmonogramu na dziś), a **team leaderzy i product ownerzy** zespołu trafiają na listę obserwatorów.
4. Zespół dostaje powiadomienie na kanale Microsoft Teams (Teams Workflows), a dyżurny opcjonalnie wiadomość prywatną.
5. Statystyki pokazują trend, czasy w statusach i metryki wg dowolnego pola (np. zgłaszający, dyżurny, domena).

Konfiguracja leży w Forge Storage pod `project_config_<KLUCZ_PROJEKTU>`: `domains`, `escalationTeams`, `teamSchedule`, `priorityRules`, `fieldsConfig`.

## Panel administratora

Dostępny w **Ustawienia Jiry → Aplikacje → drEryk Alert - konfiguracja** (strona `jira:adminPage`, widoczna dla administratorów Jiry). Formularz alertu jest na stronie projektu oraz w "Twoje aplikacje" (z przyciskiem **Zmień projekt**). Zakładki panelu:
**Ustawienia Ogólne**, **Domeny**, **Zespoły** (z harmonogramem), **Konfiguracja Pól**, **Reguły Priorytetyzacji**, **Dziennik Audytu**.
U góry panelu lista kontrolna pokazuje, czego jeszcze brakuje do pełnej konfiguracji.

Konfigurację zmienia tylko administrator Jiry (backend dopuszcza też administratorów projektu, ale strona konfiguracji jest dostępna tylko w ustawieniach Jiry). Adresy webhooków Teams widzi tylko administrator.

- **Domena domyślna** (zakładka Domeny): alerty utworzone poza formularzem, np. bezpośrednio w Jirze, trafiają do jej zespołu.
- **Kopia konfiguracji** (pod Ustawieniami Ogólnymi): eksport i import JSON, przydatne do przeniesienia konfiguracji z development do produkcji. Zawiera adresy webhooków, więc traktuj ją jak hasło.

## Podpowiedzi przy zgłaszaniu (na żądanie)

W formularzu alertu, pod opisem, panel **Podpowiedzi (opcjonalnie)** z dwoma przyciskami. Nic nie dzieje się samo:
- **Podpowiedz kategorię**: domena, do której należą najbardziej podobne alerty z projektu. Przycisk "Użyj tej kategorii" ustawia ją w formularzu.
- **Sprawdź podobne alerty**: do 5 podobnych alertów z linkami, statusem, domeną i procentem podobieństwa.

Te same podpowiedzi są dostępne po zgłoszeniu: na zakładce **Zgłoszone alerty** przycisk **Podobne** przy alercie pokazuje podobne alerty z projektu (z pominięciem samego siebie) i najczęstszą kategorię.

Działa bez modelu językowego: słowa kluczowe z podsumowania i opisu, wyszukiwanie w Jirze (tylko w jednym projekcie, z uprawnieniami użytkownika) i ranking po podobieństwie (`src/similarity.js`, testy w `test/similarity.test.js`). Jakość rośnie wraz z liczbą alertów w projekcie i tym, że mają przypisaną domenę.

## Przypomnienia i eskalacja

Zakładka **Eskalacje** w panelu konfiguracji (per projekt, domyślnie wyłączona). Gdy alert nie zostanie podjęty:
1. **Przypomnienia** dla dyżurnego (karta na kanale zespołu, wiadomość prywatna, komentarz w alercie),
2. **eskalacja do team leaderów i product ownerów** zespołu alertu,
3. **eskalacja końcowa** do wskazanych osób.

- **Alert podjęty** = zmiana statusu z "Do zrobienia" albo komentarz człowieka (komentarze aplikacji i samego zgłaszającego się nie liczą, chyba że jest też dyżurnym).
- **Czas liczony tylko w godzinach pracy** (strefa, godziny i dni konfigurowalne; święta nie są uwzględniane). Progi są w minutach czasu pracy, osobno dla P1-P4; 0 wyłącza etap.
- Sprawdzanie działa **co godzinę** (`scheduledTrigger`), więc przypomnienie może przyjść z opóźnieniem do godziny. Przycisk **Uruchom sprawdzenie teraz** robi to samo na żądanie.
- Każdy etap wysyłany jest raz na alert (stan w `escalation_state_<KLUCZ>`). Logika czasu i etapów: `src/escalation.js` (testy: `test/escalation.test.js`).

## Harmonogram dyżurów

Harmonogram prowadzą **team leaderzy**, a nie administratorzy Jiry. Zakładka **Harmonogram** w formularzu alertu (strona projektu i "Twoje aplikacje"):
- team leader zmienia harmonogram swojego zespołu (dyżurnym może być tylko delegat zespołu, dyżury tego samego zespołu nie mogą się nakładać),
- administrator Jiry lub projektu zmienia harmonogram każdego zespołu (też w panelu konfiguracji),
- pozostali użytkownicy widzą go tylko do odczytu.

## Powiadomienia Teams

Szczegóły konfiguracji workflow: [DOMENY_I_POWIADOMIENIA.md](DOMENY_I_POWIADOMIENIA.md).

## Struktura

| Ścieżka | Zawartość |
|---|---|
| `src/index.js` | backend: resolvery, silnik reguł, przypisanie, powiadomienia, statystyki |
| `static/smart` | interfejs React (formularz, statystyki, panel admina) |
| `static/issue-panel` | niewykorzystywany szkielet panelu na alercie (pod przyszłe funkcje AI) |
| `manifest.yml` | moduły Forge, uprawnienia, adresy zewnętrzne |

## Logi

Domyślnie logowane są tylko błędy i ostrzeżenia. Szczegółowe logi (zawierają dane alertów i konfiguracji) włączysz zmienną:

```bash
forge variables set DEBUG_LOGS true -e development
forge deploy -e development   # zmienne wymagają ponownego wdrożenia
```

## Rozwój i wdrożenie

```bash
npm install                 # zależności backendu
npm test                    # testy jednostkowe (routing, harmonogram, import)
npm run build               # buduje static/smart
forge lint
forge deploy -e development
forge install --upgrade -e development   # tylko przy zmianie uprawnień
```

Zmiana uprawnień lub adresów zewnętrznych w `manifest.yml` to wersja **major**: wdrożenie wymaga `--approve MAJOR_VERSION_RULE`, a administrator witryny musi zatwierdzić aktualizację. Zwykłe zmiany kodu rozchodzą się automatycznie.

## Ograniczenia

- Eskalacja nie uwzględnia świąt, a sprawdzanie działa co godzinę.
- Konfiguracja każdego środowiska (development, produkcja) jest osobna.
