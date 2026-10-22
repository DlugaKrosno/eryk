# Release Notes - DrEryk Alert Management

## Version 2.6.0 (Current)

### 🎉 Nowe Funkcjonalności

- **Globalny selektor projektu** - Wybierz projekt raz, wszystkie zakładki będą konfigurowane dla tego projektu
- **Konfiguracja per projekt** - Każdy projekt może mieć własne:
  - Reguły priorytetyzacji
  - Reguły eskalacji
  - Zespoły i harmonogram
  - Webhooki Teams
  - Mapowanie pól niestandardowych
- **Ulepszony panel administracyjny** - Intuicyjny interfejs z globalnym wyborem projektu

### 🔄 Zmiany

- Zmieniono terminologię z "Incydent" na "Alert" w całej aplikacji
- Zaktualizowano backend do obsługi konfiguracji per projekt
- Ulepszono zapisywanie i odczytywanie konfiguracji

### 🐛 Poprawki

- Naprawiono problemy z odczytywaniem konfiguracji projektu
- Poprawiono zapisywanie reguł priorytetyzacji per projekt
- Naprawiono integrację z Microsoft Teams dla konfiguracji per projekt

### 📚 Dokumentacja

- Dodano `DEPLOYMENT.md` - Instrukcje wdrożenia produkcyjnego
- Dodano `MARKETPLACE_GUIDE.md` - Przewodnik publikacji w Marketplace
- Dodano `PRODUCTION_CHECKLIST.md` - Checklist przed wdrożeniem
- Zaktualizowano `README.md` z nowymi funkcjonalnościami

---

## Version 2.5.0

### 🎉 Nowe Funkcjonalności

- Integracja z Microsoft Teams
- Automatyczne przypisanie zespołów
- Harmonogram dyżurów

### 🔄 Zmiany

- Ulepszona obsługa reguł eskalacji
- Poprawiona wydajność przetwarzania alertów

---

## Version 2.0.0

### 🎉 Nowe Funkcjonalności

- Panel administracyjny
- Silnik reguł priorytetyzacji
- Automatyczne przypisanie priorytetów

### 🔄 Zmiany

- Przepisano aplikację na Forge
- Dodano React UI

---

## Version 1.0.0

### 🎉 Pierwsza wersja

- Podstawowy formularz zgłoszenia alertu
- Automatyczne tworzenie Issue w Jira
- Podstawowa integracja z Teams

---

## Upgrade Instructions

### Z wersji 2.5.0 do 2.6.0

1. Zaktualizuj aplikację:
   ```bash
   forge install --upgrade
   ```

2. W panelu administracyjnym:
   - Wybierz projekt z globalnego selektora
   - Skonfiguruj ustawienia dla wybranego projektu
   - Wszystkie istniejące konfiguracje będą dostępne jako fallback

3. Migracja danych (automatyczna):
   - Istniejące globalne konfiguracje będą nadal działać
   - Możesz je skopiować do konfiguracji projektu w panelu administracyjnym

### Breaking Changes

- **Brak** - Aplikacja jest wstecznie kompatybilna
- Istniejące konfiguracje będą działać jako fallback

---

## Support

W przypadku problemów:
- Sprawdź dokumentację w `README.md`
- Sprawdź `DEPLOYMENT.md` dla instrukcji wdrożenia
- Sprawdź logi: `forge logs`

---

**Data wydania:** 2025-01-XX
**Wersja:** 2.6.0
