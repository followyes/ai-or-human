# AI OR HUMAN

Mobilna gra przeglądarkowa: rozpoznawanie, czy obraz stworzył człowiek, czy AI. GitHub Pages + Supabase.

## Aktualne funkcje (szkoleniowe R3.1, bazujące na V1.7.1B-R2.4)

- **Klasyczny:** 20, 50 lub 100 niepowtarzających się obrazów w jednej rozgrywce, zależnie od dostępności puli.
- **Speed Run:** łatwy 7 s / 3 życia, średni 5 s / 2 życia, trudny 3 s / 1 życie; gra do utraty żyć.
- **Profile lokalne:** pseudonim bez konta i hasła; odrębne Player ID, Browser ID i Game ID. Identyfikatory nie potwierdzają tożsamości.
- **Wynik:** liczba trafień, procent i trofeum. Każda ukończona sesja to osobny rekord w Supabase (R1), z lokalnym ponawianiem niepotwierdzonego zapisu.
- **Seria trafień:** po 3 i 10 kolejnych poprawnych odpowiedziach, po zwykłym „DOBRZE”, krótki złoty napis i świetlne iskry w zwolnionej przestrzeni po karcie. Następna karta i zegar Speed Run zaczynają działać dopiero po tej krótkiej celebracji.
- **Admin `/admin/`:** Biblioteka obrazów oraz prywatne Wyniki — wyszukiwanie, filtry, paginacja i usuwanie (R2).
- **Szkolenia R3.1:** administrator generuje 1–200 jednorazowych kodów z kopiowaniem; gracz podaje kod z nazwą profilu, a kolejne rozgrywki potwierdza lokalnym tokenem w Supabase, wyłącznie przez 24 godziny od pierwszego wykorzystania kodu. Po terminie wymagany jest nowy kod.

## Interfejs

Ekran główny służy wyborowi trybu. Profil wybiera się w osobnym, minimalnym oknie przed startem sesji, jeśli brak aktywnego gracza; ikona profilu jest w prawym górnym rogu, a motyw LIGHT/DARK w lewym. Nie pokazujemy w normalnym UI szczegółów technicznych ani redundantnych instrukcji. Zobacz wiążące zasady w `OUTSIDE_REPO/AGENTS.md` (w paczce projektowej, **nie** na GitHubie).

## Źródło obrazów

Publiczne obrazy są pobierane wyłącznie z Supabase (`public.game_images` i Storage). Klasyfikacja zależy od `content_class`, nie nazwy pliku. Repo nie zawiera zapasowego katalogu obrazów. Admin generuje także pochodne miniatury AVIF wyłącznie do Biblioteki.

## Uruchomienie / testy

```bash
npm run test
npm run build
```

Wdrożenie: GitHub **Settings → Pages → Build and deployment → GitHub Actions**. Workflow `.github/workflows/pages.yml` uruchamia testy i publikuje statyczny `dist/`. Testy CI muszą działać wyłącznie na zawartości repo, bez `OUTSIDE_REPO`.

## Migracje i bezpieczeństwo

Pliki SQL **nie są częścią repo GitHub**. **Wdrożenie R3.1 wymaga dodatkowej migracji `SQL/01_TRAINING_ACCESS.sql` z osobnej paczki dokumentacji (PRECHECK → migracja → POSTCHECK) przed wdrożeniem frontendu.** Dla istniejącej instalacji wykonuj R1, następnie R2 (każda: PRECHECK → migracja → POSTCHECK), zanim opublikujesz frontend wymagający nowych uprawnień. `OUTSIDE_REPO/SQL/ALL_IN_ONE.sql` służy do odtworzenia nowego projektu; nie uruchamiaj go na działającej bazie jako migracji.

Gracze mogą anonimowo wysyłać wyniki, ale nie mogą ich czytać ani usuwać. Tabela Admina jest chroniona przez Supabase RLS i operacje administracyjne. Wynik anonimowy i losowe ID nie dowodzą tożsamości ani poprawności odpowiedzi.

## Status i dokumentacja

**R3.1: LOCAL TEST/BUILD PASS (16.11.2026); SQL R3, GitHub Pages i real-phone Safari/Chrome — bez potwierdzonego zakończenia QA.** Oryginalne przejście kołowe LIGHT/DARK wymaga osobnego testu Safari podczas animacji kart wyniku.

Dokumentacja poza repo: `AGENTS.md` (zasady), `ROADMAP.md` (plan), `CHANGELOG.md` (pełna historia), `CONTINUE_IN_NEW_CHAT.md` (kontynuacja), `QA_CURRENT.md` (otwarte testy), `README_FIRST.txt` (wdrożenie). Historycznych opisów wydań nie powielamy w README.

## Granice zabezpieczenia R3.1

Kod powstaje i jest jednorazowo wykorzystywany **po stronie Supabase**; zwykłe konto nie może wywołać generatora. Rozpoczęcie nowej sesji w zwykłym UI wymaga serwerowej walidacji niewygasłego tokenu lub pomyślnego wykorzystania nowego kodu. Także trwającą rundę aplikacja sprawdza co 30 s i po powrocie do karty; bez serwerowego potwierdzenia przerywa rundę. Obrazy nadal znajdują się w publicznym Storage i katalogu; nie są chronione przed osobą modyfikującą aplikację lub pobierającą zasoby bezpośrednio. Pełne ograniczenie dostępu do treści wymaga prywatnego Storage i dodatkowego backendu (poza R3.1).
