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

## V1.6.0 — Light / Dark Theme Foundation

V1.6 rozpoczyna przebudowę publicznego doświadczenia od wspólnej authority motywu. Publiczna strona ma teraz pełne warianty jasny i ciemny oparte na jednym zestawie tokenów CSS zamiast niezależnych, ręcznie wpisywanych kolorów. Motyw obejmuje ekran startowy, grę, wynik i błąd; Admin pozostaje poza tym etapem.

W prawym górnym rogu publicznej strony znajduje się dostępny klawiaturowo suwak motywu. Wybór jest zapamiętywany w `localStorage` pod jedną kluczową preferencją i odtwarzany jeszcze w `<head>`, zanim UI zostanie pokazane, żeby uniknąć błysku złego motywu. Zmiana aktualizuje także `color-scheme` oraz `meta[name=theme-color]`.

Na wspieranych przeglądarkach nowy motyw rozchodzi się od położenia suwaka jako kołowy View Transition reveal. Na pozostałych przeglądarkach działa kontrolowany fallback fade. `prefers-reduced-motion` omija reveal i przełącza motyw bez rozbudowanej animacji. Mechanika sesji, swipe, feedback, preload, Supabase i Admin nie są zmieniane przez ten etap. Rewersy jasny/ciemny nie są jeszcze używane w runtime.

## `/admin` — V1.5 final baseline (runtime V1.5.9.6)

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

Uploader zachowuje trwałe kontrakty V1.5.6: AVIF 1:1 bez rekompresji dla gotowych AVIF, lokalna konwersja JPG/PNG/WebP, duplikaty SHA-256, kontynuacja po zwykłym błędzie pliku oraz fatalny abort po rzeczywistej utracie sesji. V1.5.9.3 zachowuje ograniczony pipeline `1 prepare + 1 commit`: w danym momencie wykonywane jest najwyżej jedno ciężkie przygotowanie obrazu, ale przygotowanie następnego może nakładać się na sieciowy commit poprzedniego. V1.5.9.5 przenosi source SHA/decode/canvas/AVIF preparation do dedykowanego module Web Workera, więc pełnowymiarowy `getImageData()` i jSquash AVIF encode nie wykonują się już na głównym wątku panelu. Production AVIF i mały zasób Biblioteki powstają z jednego decode źródła; nie ma już dodatkowego dekodowania gotowego production AVIF wyłącznie po to, aby stworzyć preview. Worker jawnie zwalnia `ImageBitmap` i full-resolution canvas przed dalszym encode/verification oraz jest terminowany po zakończeniu batcha, aby duży heap WASM/canvas nie pozostawał między partiami. Pipeline nadal dopuszcza maksymalnie jedno prepare + jeden network commit, a dwa ciężkie encode'y nie biegną równolegle. Odświeżenie sesji dla nakładających się etapów pozostaje single-flight. V1.5.7B.1 automatycznie tworzy mały pochodny AVIF używany tylko przez Bibliotekę Admina; nie zmienia to produkcyjnego obrazu ani publicznej gry.

V1.5.9.2 dodaje twardy gate kategorii przed wejściem plików do uploadu. Dopóki operator nie wybierze `AI` albo `HUMAN`, klik/tap nie otwiera pickera/galerii, ukryty `file-input` pozostaje natywnie `disabled`, a drag&drop nie aktywuje dropzone ani nie przekazuje plików do kolejki. V1.5.9.6 upraszcza ten stan do jednego czytelnego komunikatu `Wybierz kategorię`; pozostała instrukcja uploadu pojawia się dopiero po wybraniu AI/HUMAN, bez zmiany wysokości dropzone. Dropzone nadal przechwytuje drag/drop i blokuje domyślne otwieranie pliku przez przeglądarkę. Po wyborze kategorii upload odblokowuje się natychmiast; późny guard w `handleFiles()` zostaje jako defense-in-depth. Wybrana kategoria pozostaje aktywna po zakończeniu batcha tak jak wcześniej.

Biblioteka zachowuje paginację >1000, lazy loading, filtrowanie AI/HUMAN i kontrolowane operacje na Storage + metadata. Kafelki preferują mały zasób biblioteczny i mają jednorazowy fallback do pełnego obrazu. V1.5.9.6 usuwa ogólny przycisk `Zaznacz` i rozdziela operacje już przed zaznaczaniem: idle pokazuje `Przenieś` oraz destrukcyjne `Usuń wiele`. Tryb delete zachowuje czerwone obramowanie, czerwony pełnokafelkowy overlay i czerwone koło z białym `×`; w tym trybie nie ma żadnych akcji przenoszenia. Tryb move ma osobny pomarańczowy border/overlay oraz pomarańczowy marker transferu i nie renderuje `Usuń zaznaczone`. W filtrze AI dostępny jest tylko kierunek HUMAN, w HUMAN tylko AI, a w WSZYSTKIE oba kierunki z licznikami obejmującymi wyłącznie pozycje, które faktycznie zmienią klasę. `Zaznacz wszystkie` zawsze oznacza wszystkie rekordy aktywnego filtra, a zmiana filtra czyści selekcję.

Przeniesienie zachowuje ID, hashe, nazwę, wymiary, `created_at` i publikację obrazu. Oryginał oraz preview są kopiowane server-side do docelowego namespace `ai/` lub `human/`, następnie jeden optymistyczny PATCH atomowo przełącza `content_class`, `storage_path` i `thumbnail_path`, a dopiero po tym stare obiekty są sprzątane. Błąd przed commit powoduje rollback nowych kopii; błąd cleanupu po commit nie cofa poprawnego przeniesienia i jest raportowany jako ostrzeżenie. Batch move działa sekwencyjnie po jednym obrazie i kończy się jednym autorytatywnym odświeżeniem Biblioteki oraz Storage. Nie pobiera obrazów do przeglądarki, nie rekompresuje AVIF i nie korzysta z upload Workera.

V1.5.9.3 stosuje dla delete czytelny marker SVG: czerwone wypełnione koło z białym `×`. V1.5.9.3.1 usuwa starą widoczną białą skórę okrągłego buttona spod SVG, a V1.5.9.4 zwiększa hit-area do 44×44 px i SVG do 34×34 px zarówno na desktopie, jak i mobile. Na telefonie Biblioteka renderuje dwie kolumny kart, z ciaśniejszym gapem/paddingiem i skalą metadanych dopasowaną do węższych kafelków. V1.5.9.3.2 stabilizuje pionowy układ Biblioteki: `inventory-status` ma stale zarezerwowany jednoliniowy slot, więc pojawienie się i zniknięcie komunikatów nie przesuwa siatki zdjęć; dłuższy tekst jest obcinany ellipsis zamiast zawijać się i zmieniać wysokość.

V1.5.9.4 przebudowuje pojedyncze usuwanie na testowalny `DeleteDrainCoordinator`. Każde potwierdzone ID ma jedno ownership, destructive primitive nadal wykonuje się fizycznie serialnie przez hardened `deleteGameImage()`, ale kolejne `×` pozostają enqueueowalne także podczas końcowego listowania Biblioteki i odświeżania Storage. Reconciliation single-delete nie używa foregroundowego `inventoryBusy`; po każdej asynchronicznej synchronizacji coordinator ponownie sprawdza pending queue i kończy dopiero przy rzeczywistym stanie quiescent. Dodatkowy finalny restart invariant zapobiega stanowi `worker idle + queue non-empty`. Zwykły błąd jednego obrazu odblokowuje jego kartę i nie zatrzymuje dalszych pozycji; fatalna utrata sesji porzuca pending ownership i wraca do logowania. Bulk delete pozostaje osobnym sekwencyjnym flow. Ręczny przycisk `Odśwież` pozostaje zbędny — synchronizacja jest automatyczna po wejściu, uploadzie i delete. Usunięcie rekordu sprząta oba należące do niego obiekty. `is_active` nadal istnieje w modelu danych, ale nie jest eksponowane jako redundantny status w normalnym UI.

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

- **V1.5 — PASS/CLOSED.** Finalny runtime baseline: V1.5.9.6.
- V1.5.6 — PASS/CLOSED.
- V1.5.7A — Admin Workspace Redesign — PASS/CLOSED.
- V1.5.7B + V1.5.7B.1 Library Optimization + Admin Motion Corrective — PASS/CLOSED.
- V1.5.8 — Admin Storage Capacity Indicator + Library Bulk Delete UX — PASS/CLOSED.
- V1.5.9 — Public Image Fit + Admin Selection UX — PASS/CLOSED.
- V1.5.9.1–V1.5.9.5 — corrective chain absorbed into the final V1.5 baseline.
- V1.5.9.6 — Admin Move / Separate Multi-Action Modes — final V1.5 runtime baseline.
- **V1.6 — ACTIVE — Gameplay Feel / Public UI / Homepage.** V1.6.0: Light / Dark Theme Foundation — LOCAL QA PASS / deploy smoke pending.
- **V1.7 — Multi-Mode.** Dotychczasowy zakres V1.6 został przeniesiony w całości na V1.7.
