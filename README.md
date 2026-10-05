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

V1.5.9 zmienia także prezentację obrazów w publicznej grze: pełny oryginał nadal jest źródłem obrazu, ale karta renderuje go przez `object-fit: cover` i centralne kadrowanie. Poziome obrazy proporcjonalnie wypełniają kartę bez białych pasów; nadmiar jest przycinany zamiast rozciągania obrazu. Swipe, preload, losowanie i klasyfikacja pozostają bez zmian.

## `/admin` — V1.5.9.3.2

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

V1.5.8 dodaje do nagłówka Biblioteki kompaktowy wskaźnik pojemności Storage: aktualne zużycie, skonfigurowany limit, procent, przybliżone wolne miejsce i pasek wykorzystania. Pasek jest zielony poniżej 70%, pomarańczowy od 70% i czerwony od 90% wykorzystania. Aktualne bajty są pobierane przez Admin-only RPC z `storage.objects`, a limit jest przechowywany prywatnie po stronie SQL. Dla obecnej organizacji skonfigurowano potwierdzony plan Free: 1 GiB. Podczas batch uploadu licznik aktualizuje się po każdym poprawnie zapisanym obrazie o dokładny rozmiar pełnego AVIF-a i jego zasobu bibliotecznego, a po całej partii wykonywana jest autorytatywna synchronizacja z Supabase. Po operacjach usuwania wskaźnik również jest uzgadniany z rzeczywistym Storage.

Uploader zachowuje trwałe kontrakty V1.5.6: AVIF 1:1 bez rekompresji dla gotowych AVIF, lokalna konwersja JPG/PNG/WebP, duplikaty SHA-256, kontynuacja po zwykłym błędzie pliku oraz fatalny abort po rzeczywistej utracie sesji. V1.5.9.3 przyspiesza batch przez ograniczony pipeline `1 prepare + 1 commit`: w danym momencie wykonywane jest najwyżej jedno ciężkie przygotowanie/dekodowanie/AVIF, ale przygotowanie następnego obrazu może nakładać się na sieciowy commit poprzedniego. Dwa ciężkie encode'y nie biegną równolegle. Odświeżenie sesji dla nakładających się etapów jest single-flight. V1.5.7B.1 automatycznie tworzy również mały pochodny AVIF używany tylko przez Bibliotekę Admina. Nie zmienia to produkcyjnego obrazu ani publicznej gry.

V1.5.9.2 dodaje twardy gate kategorii przed wejściem plików do uploadu. Dopóki operator nie wybierze `AI` albo `HUMAN`, klik/tap nie otwiera pickera/galerii, ukryty `file-input` pozostaje natywnie `disabled`, a drag&drop nie aktywuje dropzone ani nie przekazuje plików do kolejki. Dropzone nadal przechwytuje drag/drop i blokuje domyślne otwieranie pliku przez przeglądarkę. Po wyborze kategorii upload odblokowuje się natychmiast; późny guard w `handleFiles()` zostaje jako defense-in-depth. Wybrana kategoria pozostaje aktywna po zakończeniu batcha tak jak wcześniej.

Biblioteka zachowuje paginację >1000, lazy loading, filtrowanie AI/HUMAN i kontrolowane usuwanie Storage + metadata. Kafelki preferują mały zasób biblioteczny i mają jednorazowy fallback do pełnego obrazu. Poza szybkim pojedynczym delete panel ma tryb `Zaznacz`: można zaznaczyć dowolne karty albo użyć `Zaznacz wszystkie` dla całego aktualnego filtra i usunąć je po jednym potwierdzeniu. V1.5.9 wzmacnia destrukcyjne zaznaczenie czerwonym obramowaniem i pełnokafelkowym półprzezroczystym czerwonym overlayem. V1.5.9.3 stosuje w obu miejscach ten sam czytelny marker SVG: czerwone wypełnione koło z białym `×`. V1.5.9.3.1 usuwa starą widoczną białą skórę okrągłego buttona spod SVG, więc single delete i zaznaczony bulk pokazują tylko jedno czerwone koło z białym `×`; hit-area przycisku pozostaje większy i przezroczysty. Na telefonie Biblioteka renderuje teraz dwie kolumny kart zamiast jednej, z ciaśniejszym gapem/paddingiem i skalą metadanych dopasowaną do węższych kafelków. V1.5.9.3.2 stabilizuje pionowy układ Biblioteki: `inventory-status` ma stale zarezerwowany jednoliniowy slot, więc pojawienie się i zniknięcie komunikatów `Usuwanie…` / `Usunięto…` nie przesuwa siatki zdjęć; dłuższy tekst jest obcinany ellipsis zamiast zawijać się i zmieniać wysokość. Pojedyncze usuwanie używa teraz jawnej kolejki: podczas wykonywania jednego delete można potwierdzić kolejne obrazy, które zostaną wykonane bezpiecznie po kolei przez ten sam hardened `deleteGameImage()`. Biblioteka i Storage są autorytatywnie uzgadniane raz po opróżnieniu kolejki. Bulk delete pozostaje sekwencyjny; zwykły błąd jednego obrazu nie zatrzymuje reszty, a utrata sesji zatrzymuje batch. Ręczny przycisk `Odśwież` został usunięty jako zbędny — synchronizacja pozostaje automatyczna po wejściu, uploadzie i delete. Usunięcie rekordu sprząta oba należące do niego obiekty. `is_active` nadal istnieje w modelu danych, ale nie jest eksponowane jako redundantny status w normalnym UI.

Produkcja została uzupełniona o małe zasoby biblioteczne dla istniejącego katalogu. Jednorazowa akcja backfillu została usunięta po zerowym postchecku; normalny panel zawiera wyłącznie stały workflow uploadu, biblioteki, zaznaczania i usuwania. Panel nie opisuje technicznych szczegółów generowania zasobu pochodnego.

V1.5.7B.1 zachowuje transition/polish z V1.5.7B: ręczne logowanie płynnie rozszerza kartę logowania do pełnego workspace, szybki restore zapisanej sesji pozostaje wizualnie cichy, a wolniejsza weryfikacja pokazuje `Sprawdzanie sesji…`. Corrective usuwa też konflikt szerokości formularza logowania bez zmiany morphu.

## Supabase

Publiczna gra ma anonimowy odczyt tylko aktywnych rekordów przez RLS. Admin ma CRUD po potwierdzeniu `private.is_admin()`.

`is_active` pozostaje trwałym polem publikacji/recovery i ma domyślną wartość `true`.

Kanoniczny fresh schema:

```text
OUTSIDE_REPO/SQL/ALL_IN_ONE.sql
```

V1.5.7B.1 dodał nullable `thumbnail_path` wyłącznie do autoryzowanego modelu Admina. Anonimowy katalog publicznej gry nadal nie ma dostępu do tej kolumny.

V1.5.8 dodaje prywatną konfigurację pojemności i `public.get_admin_storage_usage()`. RPC jest wykonywalne tylko przez `authenticated` i dodatkowo wymaga aktywnego `private.is_admin()`. Frontend nie zawiera Management API tokena ani innego sekretu.

Migracja obecnego wdrożenia:

```text
OUTSIDE_REPO/SQL/V1_5_8.sql
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

- V1.5.6 — PASS/CLOSED.
- V1.5.7A — Admin Workspace Redesign — PASS/CLOSED.
- V1.5.7B + V1.5.7B.1 Library Optimization + Admin Motion Corrective — PASS/CLOSED.
- V1.5.8 — Admin Storage Capacity Indicator + Library Bulk Delete UX — PASS/CLOSED.
- V1.5.9 — Public Image Fit + Admin Selection UX — PASS/CLOSED.
- V1.5.9.1 — Admin Delete Marker Consistency Corrective — included in V1.5.9.2; standalone package superseded before production closure.
- V1.5.9.2 — Admin Upload Category Gate Corrective — PASS/CLOSED.
- V1.5.9.3 — Admin Mutation Queue + Upload Pipeline Corrective — superseded before production closure by V1.5.9.3.1.
- V1.5.9.3.1 — Delete Marker + Mobile Library Grid Corrective — superseded before production closure by V1.5.9.3.2.
- V1.5.9.3.2 — Stable Library Status Slot Corrective — LOCAL QA PASS / READY FOR DEPLOY / PRODUCTION SMOKE PENDING.
- V1.6 — Multi-Mode, po zamknięciu V1.5.9.3.2.
