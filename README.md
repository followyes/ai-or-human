# AI OR HUMAN

Mobilna gra przeglądarkowa: rozpoznawanie, czy obraz stworzył człowiek, czy AI. GitHub Pages + Supabase.

## Aktualne funkcje (baseline V1.7.1B-R2.4)

- **Klasyczny:** 20, 50 lub 100 niepowtarzających się obrazów w jednej rozgrywce, zależnie od dostępności puli.
- **Speed Run:** łatwy 7 s / 3 życia, średni 5 s / 2 życia, trudny 3 s / 1 życie; gra do utraty żyć.
- **Profile lokalne:** pseudonim bez konta i hasła; odrębne Player ID, Browser ID i Game ID. Identyfikatory nie potwierdzają tożsamości.
- **Wynik:** liczba trafień, procent i trofeum. Każda ukończona sesja to osobny rekord w Supabase (R1), z lokalnym ponawianiem niepotwierdzonego zapisu.
- **Seria trafień:** po 3 i 10 kolejnych poprawnych odpowiedziach, po zwykłym „DOBRZE”, krótki złoty napis i świetlne iskry w zwolnionej przestrzeni po karcie. Następna karta i zegar Speed Run zaczynają działać dopiero po tej krótkiej celebracji.
- **Admin `/admin/`:** Biblioteka obrazów oraz prywatne Wyniki — wyszukiwanie, filtry, paginacja i usuwanie (R2).

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

Pliki SQL **nie są częścią repo GitHub**. Dla istniejącej instalacji wykonuj R1, następnie R2 (każda: PRECHECK → migracja → POSTCHECK), zanim opublikujesz frontend wymagający nowych uprawnień. `OUTSIDE_REPO/SQL/ALL_IN_ONE.sql` służy do odtworzenia nowego projektu; nie uruchamiaj go na działającej bazie jako migracji.

Gracze mogą anonimowo wysyłać wyniki, ale nie mogą ich czytać ani usuwać. Tabela Admina jest chroniona przez Supabase RLS i operacje administracyjne. Wynik anonimowy i losowe ID nie dowodzą tożsamości ani poprawności odpowiedzi.

## Status i dokumentacja

**R2.4: LOCAL QA PASS; produkcyjne SQL R1/R2, GitHub Pages i real-phone Safari/Chrome — bez potwierdzonego zakończenia QA.** Oryginalne przejście kołowe LIGHT/DARK wymaga osobnego testu Safari podczas animacji kart wyniku.

Dokumentacja poza repo: `AGENTS.md` (zasady), `ROADMAP.md` (plan), `CHANGELOG.md` (pełna historia), `CONTINUE_IN_NEW_CHAT.md` (kontynuacja), `QA_CURRENT.md` (otwarte testy), `README_FIRST.txt` (wdrożenie). Historycznych opisów wydań nie powielamy w README.
