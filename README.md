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

## AUTH-03 — panel Użytkownicy (właściciel potwierdził deploy)

W panelu administratora nowa zakładka z generowaniem i unieważnianiem kodów oraz listą/zarządzaniem kontami. Właściciel potwierdził GitHub deploy, AUTH-03 SQL 2/2 service-only RPC i aktualizację Edge `auth02-admin` przez Supabase Dashboard. Zmiana statusu `blocked` jest zapisywana w profilu, ale realne egzekwowanie przed grą należy do AUTH-05.

## AUTH-04A — kod zamiast potwierdzenia e-mail (poprawka po deploy AUTH-04)

Nowy przycisk `Konto` otwiera rejestrację wyłącznie jednorazowym kodem/linkiem wydanym przez Admina, e-mail (identyfikator logowania) i hasło (min. 12 znaków), logowanie, wylogowanie i podgląd konta. Link `#register=…` jedynie wypełnia formularz, nie zużywa kodu po wejściu. **Nie ma weryfikacji e-mail ani SMTP:** serwerowy `auth02-register` zakłada już aktywne konto po bezpiecznym zarezerwowaniu i zużyciu kodu. `email_confirm:true` jest świadomą techniczną autoaktywacją; **nie oznacza, że udowodniono posiadanie tego adresu**. Użytkownik podaje prawdziwy, unikalny e-mail na potrzeby logowania.

Admin `Użytkownicy`: widoczna informacja o skopiowaniu, nowe wizualne dropdowny z obsługą klawiatury. Historyczny mechanizm AUTH-04B przechowywał pełne kody tylko do odświeżenia; **zastąpiła go korekta AUTH-04C**, opisana poniżej.

Bez SMTP nie działa samodzielny reset hasła. Aby nie obiecywać nieistniejącej funkcji, formularze mailowego potwierdzenia i recovery są ukryte/usunięte; przy rejestracji widnieje ostrzeżenie, by zachować hasło w menedżerze. W przyszłości możemy dodać bezpieczny reset administrowany albo przywrócić SMTP osobnym etapem.

**AUTH-04A zostało potwierdzone jako wdrożone przez właściciela.** Nie aktualizujemy ponownie `auth02-register` bez niezależnego powodu. Gra wciąż używa starego profilu i nie wymaga konta do AUTH-05/07; Browser ID pozostaje.

## AUTH-04B — trwała poprawka Admina i czyszczenie kodów

Wydawane pełne kody można wielokrotnie zaznaczać i kopiować w ramach tej samej otwartej strony Admina, również po zwinięciu panelu, przełączeniu zakładek i wydaniu kolejnej partii. Po logout/reload pełny kod nie zostaje zachowany w przeglądarce. Wybór `Usuń` uruchamia serwerowo **fizyczny DELETE** tylko niewykorzystanego, niepowiązanego kodu. Kody `reserved`/`consumed` i związane próby/konta pozostają na potrzeby bezpieczeństwa i kluczy obcych.

**AUTH-04B SQL POSTCHECK i Deploy potwierdzone przez właściciela (PASS).** Nie uruchamiamy tej migracji ponownie. Jedna testowa baza nie ma zweryfikowanej kopii.

## AUTH-04C — pełna przebudowa ponownego odczytu kodów (paczka do wdrożenia)

Przyczyna błędu po opuszczeniu strony: stare kody były przechowywane w bazie wyłącznie jako HMAC i czteroznakowy hint. Rozdzielone listy Admina („wygenerowane w sesji” i „wydane”) zostały zastąpione **jedną listą**. Aktywny nowy kod można otworzyć przyciskiem `Pokaż`, zaznaczyć jako zwykły tekst, wielokrotnie skopiować wraz z linkiem i `Ukryj`. Po reload lub ponownym zalogowaniu pełny kod jest dostępny poprzez nowy **serwerowo szyfrowany** zapis AES-256-GCM, a nie z pamięci przeglądarki.

Szyfrogram znajduje się w prywatnej tabeli, odczyt następuje wyłącznie przez Edge `auth02-admin` po walidacji JWT i aktywnej roli Admina; używa odrębnego sekretu `AUTH04_CODE_ENCRYPTION_KEY` w Supabase. Szyfrogram jest usuwany po wykorzystaniu lub fizycznym usunięciu kodu. Przed wydaniem nowego panel musi wczytać historię i ostrzega o istniejącym aktywnym kodzie. **Starych kodów HMAC-only nie można odzyskać**, nawet po nowej migracji — w UI widać tę informację.

AUTH-04C wymaga odrębnej migracji SQL, aktualizacji **tylko** `auth02-admin` w Supabase Dashboard oraz nowego frontend GitHub. Nie dotyka `auth02-register` (AUTH-04A PASS), 11 wyników legacy ani bieżących zasad gry. Pełne instrukcje bez terminala, SQL i QA są w aktualnej paczce `OUTSIDE_REPO/AUTH04C_DEPLOY_NO_TERMINAL.md`. **Korekta ma LOCAL QA PASS, ale nie jest jeszcze wdrożona — AUTH-04 pozostaje OPEN do testu rejestracji i ponownego odczytu.**
