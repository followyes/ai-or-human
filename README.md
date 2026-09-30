# AI or Human

Webowa gra, w której gracz zgaduje, czy obraz został wygenerowany przez AI, czy stworzony przez człowieka.

## Architektura contentu

Supabase jest jedynym produkcyjnym źródłem obrazów.

```text
/admin upload
→ lokalna walidacja / pełny AVIF produkcyjny
→ mały pochodny AVIF dla Biblioteki Admina
→ Supabase Storage: game-images
→ public.game_images
→ publiczna gra używa wyłącznie pełnego oryginału
```

Nie ma repozytoryjnego katalogu contentu, `data/images.json` ani runtime fallbacku do GitHuba. Klasa obrazu jest zapisywana w `public.game_images.content_class` (`ai` albo `human`); nazwa pliku nie klasyfikuje obrazu.

## Gra

Przed rozpoczęciem gracz wybiera 10, 20 albo 50 obrazów. Sesja zawiera dokładnie wybraną liczbę unikalnych obrazów, bez wymuszonego balansu AI/HUMAN. Mobile obsługuje swipe lewo = CZŁOWIEK i prawo = AI; desktop korzysta z przycisków.

Jeżeli publiczny katalog Supabase zawiera mniej niż 10 aktywnych obrazów albo jest niedostępny, aplikacja pokazuje kontrolowany ekran błędu. Nie przełącza się na drugie źródło contentu.

## `/admin` — V1.5.7B.1

Panel jest niepodlinkowaną publicznie trasą `/admin/` i wymaga Supabase Auth oraz aktywnego wpisu w `private.admin_users`.

Sesja jest przechowywana w `sessionStorage`. Access token odnawia się automatycznie przed wygaśnięciem oraz po obsługiwalnym auth `401/403`.

Desktop admin działa jako pełnoekranowy workspace:

```text
┌───────────────────────────────────────────────┐
│ Panel administratora                 Wyloguj │
├───────────────────┬───────────────────────────┤
│ Upload            │ Biblioteka                │
│ AI / HUMAN        │ WSZYSTKIE n · AI n · ... │
│ Drop zone         │ wewnętrznie przewijana   │
│ Queue             │ siatka obrazów            │
└───────────────────┴───────────────────────────┘
```

Na węższych ekranach upload i biblioteka układają się pionowo.

Uploader zachowuje trwałe kontrakty V1.5.6: AVIF 1:1 bez rekompresji dla gotowych AVIF, lokalna konwersja JPG/PNG/WebP, sekwencyjny batch, duplikaty SHA-256, kontynuacja po zwykłym błędzie pliku oraz fatalny abort po rzeczywistej utracie sesji. V1.5.7B.1 automatycznie tworzy również mały pochodny AVIF używany tylko przez Bibliotekę Admina. Nie zmienia to produkcyjnego obrazu ani publicznej gry.

Biblioteka zachowuje paginację >1000, lazy loading, filtrowanie AI/HUMAN, refresh i kontrolowane usuwanie Storage + metadata. Kafelki preferują mały zasób biblioteczny i mają jednorazowy fallback do pełnego obrazu. Usunięcie rekordu sprząta oba należące do niego obiekty. `is_active` nadal istnieje w modelu danych, ale nie jest eksponowane jako redundantny status w normalnym UI.

Produkcja została uzupełniona o małe zasoby biblioteczne dla istniejącego katalogu. Jednorazowa akcja backfillu została usunięta po zerowym postchecku; normalny panel zawiera wyłącznie stały workflow uploadu, biblioteki, odświeżania i usuwania. Panel nie opisuje technicznych szczegółów generowania zasobu pochodnego.

V1.5.7B.1 zachowuje transition/polish z V1.5.7B: ręczne logowanie płynnie rozszerza kartę logowania do pełnego workspace, szybki restore zapisanej sesji pozostaje wizualnie cichy, a wolniejsza weryfikacja pokazuje `Sprawdzanie sesji…`. Corrective usuwa też konflikt szerokości formularza logowania bez zmiany morphu.

## Supabase

Publiczna gra ma anonimowy odczyt tylko aktywnych rekordów przez RLS. Admin ma CRUD po potwierdzeniu `private.is_admin()`.

`is_active` pozostaje trwałym polem publikacji/recovery i ma domyślną wartość `true`.

Kanoniczny fresh schema:

```text
OUTSIDE_REPO/SQL/ALL_IN_ONE.sql
```

V1.5.7B.1 dodaje nullable `thumbnail_path` wyłącznie do autoryzowanego modelu Admina. Anonimowy katalog publicznej gry nadal nie ma dostępu do tej kolumny.

Migracja obecnego wdrożenia:

```text
OUTSIDE_REPO/SQL/V1_5_7B_1.sql
```

## Build

```bash
npm run test
npm run build
```

Build kopiuje statyczny runtime (`index.html`, `css/`, `js/`, `admin/`) i nie generuje repozytoryjnego manifestu contentu.

## GitHub Pages

Wymagany tryb: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Workflow `.github/workflows/pages.yml` uruchamia testy, buduje `dist/`, weryfikuje runtime oraz potwierdza brak repozytoryjnego manifestu i `dist/images/`.

## Status roadmapy

- V1.5.6 — PASS / CLOSED.
- V1.5.7A — Admin Workspace Redesign — PASS/CLOSED.
- V1.5.7B — Auth Transition & UX Polish — production smoke wykrył corrective.
- V1.5.7B.1 — login corrective + optimized Admin Library pipeline — Phase A production backfill PASS; Phase B local QA PASS / final repo deploy + smoke pending.
- V1.6 — Multi-Mode.
