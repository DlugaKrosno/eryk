# Domeny, dyżury zespołowe i powiadomienia Teams

## Model

- **Domena** (kategoria zgłoszenia) należy do jednego **zespołu**. Domeny dodaje się w panelu admina, w zakładce *Domeny*. Dodanie domeny bez wskazania zespołu tworzy zespół o tej samej nazwie.
- Użytkownik wybiera domenę w formularzu. Zgłoszenie dostaje label `domain-<id>`, po którym kolejne przetwarzanie (trigger, SLA) odnajduje zespół.
- Każdy zespół ma **delegatów do dyżuru** i własne wpisy w harmonogramie (zakładka *Zespoły*). Dyżurny z harmonogramu na dziś jest przypisywany jako assignee. Bez wpisu działa strategia zespołu (fixed / round-robin).
- **Obserwatorzy** zgłoszenia: team leaderzy zespołu oraz product ownerzy domeny.
- Reguły SLA i przypomnienia trafiają do zespołu domeny zgłoszenia, a nie do jednego globalnego zespołu dyżurnego.

Konfiguracja leży w `project_config_<KEY>`: `domains`, `escalationTeams` (`teamLeaders`, `delegates`, `teamsWebhookUrl`, `dutyDmWorkflowUrl`), `teamSchedule`.
Projekt bez zdefiniowanych domen nie wymaga wyboru kategorii, ale zgłoszenia nie dostaną wtedy zespołu.

## Powiadomienia (webhooki Office 365 wycofane)

Aplikacja wysyła Adaptive Card w formacie `{ type: "message", attachments: [...] }` na adres **Teams Workflows**.

1. **Kanał zespołu**: w Teams utwórz workflow z szablonu *Post to a channel when a webhook request is received* i wklej jego URL w polu *Teams Workflow URL - kanał zespołu*.
2. **Wiadomość do dyżurnego** (opcjonalnie): w Power Automate utwórz flow *When a Teams webhook request is received* → *Post card in a chat or channel* (Chat with Flow bot / user). Odbiorcę weź z `triggerBody()?['recipientEmail']`, a kartę z `triggerBody()?['attachments'][0]['content']`. Wklej URL w polu *wiadomość do dyżurnego*.
   Adres e-mail dyżurnego musi być widoczny dla aplikacji (ustawienia prywatności konta Atlassian).
3. Manifest zezwala na `*.logic.azure.com` i `*.powerplatform.com`. Po zmianie manifestu wykonaj `forge deploy` i `forge install --upgrade`, bo dochodzą nowe uprawnienia fetch.

Przycisk *Test* przy zespole wysyła testową kartę.
