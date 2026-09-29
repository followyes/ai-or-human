# AI or Human

Webowa gra, w której gracz zgaduje, czy obraz został wygenerowany przez AI, czy stworzony przez człowieka.

## V1.5.6 — architektura contentu

Supabase jest jedynym produkcyjnym źródłem obrazów.

```text
/admin upload
→ lokalna walidacja / konwersja do AVIF
→ Supabase Storage: game-images
→ public.game_images
→ publiczna gra
```

Nie ma już repozytoryjnego katalogu `images/AI/**` / `images/HUMAN/**`, `data/images.json` ani runtime fallbacku do GitHuba.

Klasyfikacja obrazu jest zapisywana wyłącznie w `public.game_images.content_class` (`ai` albo `human`). Nazwa pliku nigdy nie służy do klasyfikacji.

## Gra

Aktualny tryb pozostaje bez widocznej nazwy trybu do czasu V1.6 Multi-Mode.

Przed rozpoczęciem gracz wybiera liczbę obrazów:

- 10,
- 20,
- 50.

Zasady:

- sesja zawiera dokładnie wybraną liczbę unikalnych obrazów;
- proporcja AI/HUMAN jest losowa;
- brak powtórzeń w jednej sesji;
- między sesjami powtórki są dozwolone, ale niedawno pokazane obrazy mają niższą wagę;
- odświeżenie strony resetuje historię wag;
- mobile: swipe w lewo = CZŁOWIEK, swipe w prawo = AI;
- desktop: przyciski;
- feedback poprawnej/błędnej odpowiedzi animuje się równolegle z wyrzutem karty;
- następny obraz jest ładowany i dekodowany przed reveal.

Jeżeli publiczny katalog Supabase zawiera mniej niż 10 aktywnych obrazów albo nie jest dostępny, aplikacja pokazuje kontrolowany ekran błędu. Nie przełącza się na drugie źródło contentu.

## `/admin`

Panel jest niepodlinkowaną publicznie trasą `/admin/` i wymaga:

1. Supabase Auth,
2. aktywnego wpisu w `private.admin_users`.

Sesja jest przechowywana w `sessionStorage`. Access token jest odnawiany automatycznie przed wygaśnięciem oraz raz po auth `401/403`; zamknięcie sesji przeglądarki usuwa lokalny stan logowania.

Uploader:

- wymaga jawnego wyboru AI/HUMAN;
- obsługuje JPG/JPEG/JFIF, PNG, WebP i AVIF;
- JPG/PNG/WebP konwertuje lokalnie do AVIF;
- AVIF przechodzi 1:1 bez rekompresji;
- przetwarza batch sekwencyjnie;
- błędy pojedynczego pliku nie zatrzymują pozostałych plików;
- duplikaty są wykrywane po SHA-256;
- zapisuje wyłącznie AVIF do bucketu `game-images`;
- metadata trafiają do `public.game_images`;
- nowy poprawny upload jest aktywny domyślnie.

Biblioteka admina pokazuje rekordy, klasy, stan aktywności i umożliwia kontrolowane usunięcie Storage + metadata.

## Supabase

Publiczna gra ma anonimowy odczyt tylko aktywnych rekordów przez RLS. Admin ma pełny CRUD wyłącznie po potwierdzeniu `private.is_admin()`.

`is_active` pozostaje trwałym polem publikacji/recovery. W finalnym V1.5.6 jego domyślna wartość to `true`.

Jednorazowe obiekty migracyjne V1.5.6 (`content_runtime`, migration status, cutover, rollback) nie należą do finalnego schematu.

Kanoniczny fresh schema:

```text
OUTSIDE_REPO/SQL/ALL_IN_ONE.sql
```

Delta produkcyjna domykająca V1.5.6:

```text
OUTSIDE_REPO/SQL/V1_5_6.sql
```

## Build

```bash
npm run test
npm run build
```

Build kopiuje wyłącznie runtime statyczny:

```text
index.html
css/
js/
admin/
```

Nie skanuje obrazów i nie generuje manifestu contentu.

## GitHub Pages

Wymagany tryb:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Workflow `.github/workflows/pages.yml`:

1. uruchamia `npm run test`,
2. buduje `dist/`,
3. potwierdza wymagane pliki runtime,
4. potwierdza brak `dist/data/images.json` i `dist/images/`,
5. publikuje `dist/`.

Po zmianie workflow przez web uploader trzeba upewnić się osobno, że ukryty katalog `.github/` faktycznie został zaktualizowany.

## Status roadmapy

- V1.5.1–V1.5.5 — CLOSED.
- V1.5.6 — finalny cleanup Supabase-only; closure dopiero po produkcyjnym deployu, finalnym SQL, upload smoke i public smoke.
- V1.5.7 — UI/UX Cleanup & Redesign.
- V1.6 — Multi-Mode.
