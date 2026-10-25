# Historia zmian

## 3.0.0

**Nowy model organizacyjny**
- Domeny (kategorie alertów) na stałe przypisane do zespołów; alert trafia do dyżurnego zespołu domeny.
- Harmonogram dyżurów per zespół, wyłącznie w zakładce Zespoły; dyżurnego wybiera się spośród delegatów zespołu.
- Obserwatorzy: team leaderzy i product ownerzy zespołu.
- Domena domyślna dla alertów utworzonych poza formularzem.

**Powiadomienia**
- Webhooki Office 365 (MessageCard) zastąpione Teams Workflows (Adaptive Card), plus opcjonalna wiadomość prywatna do dyżurnego.

**Podpowiedzi przy zgłaszaniu**
- Na żądanie: podpowiedź kategorii (domeny) i podobne alerty z projektu, bez modelu językowego.
- Przycisk "Podobne" przy alertach na zakładce "Zgłoszone alerty" (weryfikacja po zgłoszeniu).

**Eskalacja alertów**
- Nowa zakładka Eskalacje: przypomnienia dla dyżurnego, eskalacja do team leaderów i PO, eskalacja końcowa do wskazanych osób. Czas liczony w godzinach pracy; alert podjęty = zmiana statusu lub komentarz człowieka. Zastępuje stare reguły eskalacji i SLA.

**Statystyki**
- Moduł "Metryki wg pola" (zgłaszający, dyżurny, domena, zespół, priorytet, status, dowolne pole formularza).

**Panel administratora**
- Lista kontrolna konfiguracji, nowa kolejność zakładek, eksport i import konfiguracji projektu.
- Usunięte zakładki: Integracja Teams, Reguły Eskalacji (wrócą w nowej formie).
- Harmonogram dyżurów dla team leaderów: zakładka w formularzu alertu (zmiana tylko własnego zespołu, dyżurny z delegatów, bez nakładania).
- Naprawiony błąd "Zgłoszone alerty" (nieograniczone zapytanie JQL bez projektu) i wybór projektu przyciskiem "Zmień projekt".
- Konfiguracja przeniesiona do Ustawień Jiry (Aplikacje); "Twoje aplikacje" pokazują formularz alertu z wyborem projektu.
- Poprawiony trigger tworzenia alertu (wcześniej nie działał, bo był zdefiniowany jako resolver).

**Bezpieczeństwo i jakość**
- Zmiana konfiguracji wymaga administratora Jiry lub projektu; adresy webhooków widzi tylko administrator.
- Dziennik audytu w kubełkach miesięcznych z limitami; bez sekretów.
- Ochrona przed podwójnym przetwarzaniem alertu (formularz + trigger).
- Szczegółowe logi wyłączone domyślnie (`DEBUG_LOGS=true` je włącza).
- Migracja z `storage` (`@forge/api`) na `@forge/kvs`.
- Cykliczne sprawdzanie SLA co godzinę (tylko projekty z aktywnymi regułami).
- Testy jednostkowe routingu, walidacji harmonogramu i importu (`npm test`).
- Usunięte: trzy zduplikowane interfejsy (`static/user`, `static/admin`, `static/main`), martwy kod, nieużywane resolvery, stare klucze globalne (zespoły, harmonogram, webhooki).

## 2.6.0

Poprzednia wersja (globalny harmonogram dyżurów, webhooki Office 365).
