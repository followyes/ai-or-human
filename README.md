# AI OR HUMAN

Mobilna gra przeglądarkowa: rozpoznawanie, czy obraz stworzył człowiek, czy AI. GitHub Pages + Supabase.

## Aktualne funkcje (baseline V1.7.1B-R2.5.1)

- **Klasyczny:** 20, 50 lub 100 obrazów bez powtórek aż do wyczerpania puli (także między rozgrywkami), zależnie od dostępności puli.
- **Speed Run:** łatwy 7 s / 3 życia, średni 5 s / 2 życia, trudny 3 s / 1 życie; gra do utraty żyć.
- **Profile lokalne:** login bez spacji, animowane przykłady pseudonimów, bez konta i hasła; odrębne Player ID, Browser ID i Game ID. Identyfikatory nie potwierdzają tożsamości.
- **Wynik:** liczba trafień, procent i trofeum. Każda ukończona sesja to osobny rekord w Supabase (R1), z lokalnym ponawianiem niepotwierdzonego zapisu.
- **Seria trafień:** po 3, 10, 20, 30… kolejnych poprawnych odpowiedziach, po zwykłym „DOBRZE”, krótki złoty napis i świetlne iskry w zwolnionej przestrzeni po karcie. Następna karta i zegar Speed Run zaczynają działać dopiero po tej krótkiej celebracji.
- **Admin `/admin/`:** Biblioteka obrazów, prywatne Wyniki oraz prosta edytowalna lista Gratyfikacji. Komunikaty losowane bez powtórzeń w jednej rozgrywce i zapisywane w Supabase (R2.5).

## Interfejs

Ekran główny służy wyborowi trybu. Profil wybiera się w osobnym oknie z jednym widocznym nagłówkiem „Nazwa gracza”, bez podwójnej etykiety; input korzysta z tego nagłówka jako nazwy dostępnej. Dla aktywnego profilu potwierdzenie brzmi „Gotowe”. ikona profilu jest w prawym górnym rogu, a motyw LIGHT/DARK w lewym. Nie pokazujemy w normalnym UI szczegółów technicznych ani redundantnych instrukcji. Zobacz wiążące zasady w `OUTSIDE_REPO/AGENTS.md` (w paczce projektowej, **nie** na GitHubie).

Historia obrazów jest zapisywana w przeglądarce dla Player ID. Oba tryby korzystają z jednej rotacji, a do historii trafiają tylko obrazy rzeczywiście wyświetlone graczowi. Wyczyszczenie danych strony lub zmiana urządzenia rozpoczyna historię od nowa.

## Źródło obrazów

Publiczne obrazy są pobierane wyłącznie z Supabase (`public.game_images` i Storage). Klasyfikacja zależy od `content_class`, nie nazwy pliku. Repo nie zawiera zapasowego katalogu obrazów. Admin generuje także pochodne miniatury AVIF wyłącznie do Biblioteki.

## Uruchomienie / testy

```bash
npm run test
npm run build
```

Wdrożenie: GitHub **Settings → Pages → Build and deployment → GitHub Actions**. Workflow `.github/workflows/pages.yml` uruchamia testy i publikuje statyczny `dist/`. Testy CI muszą działać wyłącznie na zawartości repo, bez `OUTSIDE_REPO`.

## Migracje i bezpieczeństwo

Pliki SQL **nie są częścią repo GitHub**. Dla istniejącej instalacji wykonuj R1, następnie R2 i R2.5 (każda: PRECHECK → migracja → POSTCHECK), zanim opublikujesz frontend wymagający nowych uprawnień. `OUTSIDE_REPO/SQL/ALL_IN_ONE.sql` służy do odtworzenia nowego projektu; nie uruchamiaj go na działającej bazie jako migracji.

Gracze mogą anonimowo wysyłać wyniki, ale nie mogą ich czytać ani usuwać. Tabela Admina jest chroniona przez Supabase RLS i operacje administracyjne. Wynik anonimowy i losowe ID nie dowodzą tożsamości ani poprawności odpowiedzi.

## Status i dokumentacja

**R2.5.1: LOCAL NODE/BUILD/CHROMIUM PASS; produkcyjne SQL R1/R2/R2.5, GitHub Pages i real-phone Safari/Chrome — bez potwierdzonego zakończenia QA.** Oryginalne przejście kołowe LIGHT/DARK wymaga osobnego testu Safari podczas animacji kart wyniku.

Dokumentacja poza repo: `AGENTS.md` (zasady), `ROADMAP.md` (plan), `CHANGELOG.md` (pełna historia), `CONTINUE_IN_NEW_CHAT.md` (kontynuacja), `QA_CURRENT.md` (otwarte testy), `README_FIRST.txt` (wdrożenie). Historycznych opisów wydań nie powielamy w README.


## AUTH-02 — backend wdrożony przez właściciela (SQL + 2 Edge Functions)

The new `supabase/functions/auth02-admin` and `auth02-register` folders implement the invitation-code backend for the future account system. They are **source files only**; `npm run build` intentionally copies only the existing public game/admin assets into `dist/` and does not deploy Edge Functions or SQL. Production game behavior is unchanged until AUTH-03 through AUTH-07.

The AUTH-02 SQL migration, PRECHECK/POSTCHECK and security/runbook documentation are distributed separately under **OUTSIDE_REPO/SQL/AUTH_02_*.sql**, never committed to the public static website. Server credentials (`SUPABASE_SERVICE_ROLE_KEY`, `AUTH02_HMAC_SECRET`) must stay in Supabase secrets, not in browser/config files. See `OUTSIDE_REPO/AUTH/AUTH_02/README_FIRST.md` before any deployment. AUTH-02 SQL POSTCHECK 13/13 i obie Edge Functions potwierdzone przez właściciela; 401 ADMIN_LOGIN_REQUIRED i 400 INVALID_CODE PASS. Pełne testy generatora i race nadal otwarte; patrz AUTH-03 README.

**AUTH-02 release corrective:** original backend SQL rejected the configured global rate limit of 300; this source release requires the corrected migration and standalone contract QA. Never deploy code with the earlier AUTH-02 SQL.

## AUTH-03 — panel Użytkownicy (źródła gotowe; deploy oczekuje)

W panelu administratora nowa zakładka z generowaniem i unieważnianiem kodów oraz listą/zarządzaniem kontami. Wymaga `OUTSIDE_REPO/SQL/AUTH_03_ADMIN_ACCOUNTS.sql` i aktualizacji istniejącej Edge Function `auth02-admin` przez Supabase Dashboard. Zmiana statusu `blocked` jest zapisywana w profilu, a realne egzekwowanie przed grą należy do AUTH-05. Pełna instrukcja bez terminala: `OUTSIDE_REPO/AUTH03_README_FIRST.md` w archiwum wydania.
