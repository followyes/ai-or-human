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

Publiczny flow rozpoczyna się od ekranu `Wybierz tryb gry`. V1.6.2 pokazuje wyłącznie aktualny tryb `Klasyczny`; po jego wyborze ten sam pre-game shell płynnie zmienia się w konfigurację 10, 20 albo 50 obrazów zamiast wyglądać jak przejście na osobną stronę. Sesja zawiera dokładnie wybraną liczbę unikalnych obrazów, bez wymuszonego balansu AI/HUMAN. Mobile obsługuje swipe lewo = CZŁOWIEK i prawo = AI; desktop korzysta z przycisków.

Jeżeli publiczny katalog Supabase zawiera mniej niż 10 aktywnych obrazów albo jest niedostępny, aplikacja pokazuje kontrolowany ekran błędu. Nie przełącza się na drugie źródło contentu.

V1.5.9 zmienia także prezentację obrazów w publicznej grze: pełny oryginał nadal jest źródłem obrazu, ale karta renderuje go przez `object-fit: cover` i centralne kadrowanie. Poziome obrazy proporcjonalnie wypełniają kartę bez białych pasów; nadmiar jest przycinany zamiast rozciągania obrazu. Swipe, preload, losowanie i klasyfikacja pozostają bez zmian.

## V1.6.0 — Light / Dark Theme Foundation

V1.6 rozpoczyna przebudowę publicznego doświadczenia od wspólnej authority motywu. Publiczna strona ma teraz pełne warianty jasny i ciemny oparte na jednym zestawie tokenów CSS zamiast niezależnych, ręcznie wpisywanych kolorów. Motyw obejmuje ekran startowy, grę, wynik i błąd; Admin pozostaje poza tym etapem.

W prawym górnym rogu publicznej strony znajduje się dostępny klawiaturowo suwak motywu. Wybór jest zapamiętywany w `localStorage` pod jedną kluczową preferencją i odtwarzany jeszcze w `<head>`, zanim UI zostanie pokazane, żeby uniknąć błysku złego motywu. Zmiana aktualizuje także `color-scheme` oraz `meta[name=theme-color]`.

Na wspieranych przeglądarkach nowy motyw rozchodzi się od położenia suwaka jako kołowy View Transition reveal. Na pozostałych przeglądarkach działa kontrolowany fallback fade. `prefers-reduced-motion` omija reveal i przełącza motyw bez rozbudowanej animacji. Mechanika sesji, swipe, feedback, preload, Supabase i Admin nie zostały zmienione przez V1.6.0. W samym V1.6.0 rewersy jasny/ciemny nie były jeszcze używane; ich integrację wprowadza V1.6.1.

Aktualny kontrakt widoczności kontrolki jest kontekstowy: na publicznej stronie przełącznik motywu pozostaje dostępny podczas całego pre-game, w tym `Wybierz tryb gry` i konfiguracji Klasycznego. Znika dopiero po wejściu do właściwego widoku gameplayu; wybrany motyw nadal obowiązuje. Drugim zatwierdzonym miejscem dla przełącznika jest `/admin`; pełne dopasowanie wizualne Admina nie jest automatycznie częścią tego etapu.

### V1.6.1 — Mobile Game Selection / Floating Cards Foundation

V1.6.1 implementuje mobile-first landing `Wybierz tryb gry` i oddziela go od konfiguracji klasyka. Publicznie widoczny jest dokładnie jeden kafelek `Klasyczny`; nie ma drugiego trybu, placeholdera ani `Wkrótce`. Architektura posiada osobne `selectedGameMode`, ale V1.7 pozostaje niewidoczne i niezaimplementowane.

Classic setup zawiera zachowany selector 10/20/50 i `Rozpocznij`. Landing nie czeka już na Supabase manifest: content klasyka prefetchuje się po pierwszym paint, a setup ma własny stan ładowania i retry. Przejście select <-> setup obsługuje osobny coordinator oparty na Web Animations, `inert`/`aria-hidden`, focus handoff i reduced-motion timing. Gameplay swipe/card lifecycle pozostaje niezależny.

Pierwszy ekran ma pięć dekoracyjnych rewersów na viewport-level atmosphere. Runtime używa dwóch zoptymalizowanych WebP, wielokrotnie reuseowanych przez CSS. Mapping jest odwrotny: LIGHT UI używa DARK rewersu, DARK UI używa LIGHT rewersu. Karty są `aria-hidden`, `pointer-events:none`, poruszają się tylko transformami i stają się statyczne przy `prefers-reduced-motion: reduce`. Oryginalne PNG są zachowane jako package masters poza runtime.

Theme switch jest widoczny w obu stanach pre-game i znika dopiero w widoku gameplayu. Po opuszczeniu gameplayu może ponownie być dostępny; wybrany motyw pozostaje jedną wspólną preferencją. Admin pozostaje drugim zatwierdzonym miejscem dla switcha; ten etap nie przebudowuje Admin UI.

Build publikuje teraz również `assets/`. Mobile acceptance: 320/360/390/430 px + safe-area/dynamic browser chrome przed desktopową akceptacją.

### V1.6.2 — Mode Setup Morph / Shared Pre-Game Shell

V1.6.2 scala wybór trybu i konfigurację klasyka w jeden publiczny `pre-game-screen`. Wewnątrz tego samego shell działają dwa wzajemnie wykluczające się panele: `mode-select` oraz `mode-setup`. Kliknięcie `Klasyczny` nie przełącza już pełnego publicznego ekranu; centralna zawartość morphuje kierunkowo do konfiguracji 10/20/50, a `Wróć` odwraca ten sam lifecycle.

Atmosfera V1.6.1 pozostaje widoczna w obu stanach pre-game, dzięki czemu lewitujące rewersy i orbitalna oprawa nie znikają podczas konfiguracji. Setup zachowuje tę samą siłę atmosfery i orbit co wybór trybu; nie używamy opacity-dimmingu udającego modal. Theme switch pozostaje widoczny także w `mode-setup` i znika dopiero po wejściu do właściwego gameplayu.

Wspólny `pre-game-stage` ma zarezerwowaną stabilną wysokość, aby różnica rozmiaru obu paneli nie powodowała pionowego skoku podczas animacji. `PreGameTransitionCoordinator` pozostaje jedyną authority animacji/accessibility i obsługuje jawny kierunek `forward` / `back`, `inert`, `aria-hidden`, rapid-tap lock, focus handoff oraz reduced-motion. Manifest klasyka, retry, 10/20/50 i gameplay pozostają bez zmian.

### V1.6.2.1 — Pre-Game Visual Coherence Corrective

Real-phone smoke V1.6.2 wykazał, że wspólny shell był poprawny technicznie, ale setup nadal korzystał z wizualnego języka starego V1.5. V1.6.2.1 ujednolica oba stany bez zmiany mechaniki: `Wybierz tryb gry` oraz `Klasyczny` używają tej samej pre-game typografii display, tego samego `AI OR HUMAN` + cosmic divider, tych samych landingowych tokenów złoto/navy/blue i tej samej rodziny powierzchni. Selector 10/20/50 oraz `Rozpocznij` mają teraz dedykowany pre-game skin zamiast legacy generic UI.

`Wróć` pozostaje tym samym semantycznym przyciskiem i tym samym handlerem, ale nie jest już wypychany ujemnym `top` w pole dekoracyjnych kart. Jest częścią bezpiecznego flow setupu, ma co najmniej 44 px touch target i używa landingowej powierzchni/borderu. Dla krótkich telefonów istnieje osobny kompaktowy portrait profile, żeby back, selector i CTA pozostały dostępne przy dynamicznym browser chrome. Gameplay/data/Admin pozostają nietknięte.

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

Build kopiuje statyczny runtime (`index.html`, `css/`, `js/`, `admin/`, `assets/`) i nie generuje repozytoryjnego manifestu contentu.

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
- **V1.6 — ACTIVE — Gameplay Feel / Public UI / Homepage.** V1.6.1: Mobile Game Selection / Floating Cards Foundation — absorbed into V1.6.2 architecture. V1.6.2: shared shell/morph intermediate build — visual smoke rejected. V1.6.2.1: superseded by V1.6.2.2 after real-phone interaction/copy/theme findings. V1.6.2.2: Pre-Game Interaction / Copy / Theme Corrective — LOCAL QA PASS / deploy + real-phone visual smoke pending.
- **V1.7 — Multi-Mode.** Dotychczasowy zakres V1.6 został przeniesiony w całości na V1.7.

### V1.6.2.2 — Pre-Game Interaction / Copy / Theme Corrective

Real-phone smoke V1.6.2.1 ujawnił cztery mniejsze, ale widoczne niespójności. Programowy focus na `Klasyczny` (`tabindex=-1`) pokazywał na iOS/Chrome domyślny niebieski browser focus-box; cały statyczny tekst pre-game mógł też zostać przypadkowo zaznaczony dotykiem. Corrective zachowuje focus handoff dla dostępności, ale usuwa surowy obrys przeglądarki z nietabbowalnego nagłówka i blokuje przypadkową selekcję statycznej warstwy pre-game.

Setup nie powtarza już `Wybierz liczbę obrazów` bezpośrednio nad `LICZBA OBRAZÓW`; pozostaje jedna wystarczająca etykieta kontrolki. Usunięto również setup-only `opacity` całej atmosfery i osobne przygaszenie orbit, ponieważ `mode-setup` jest stanem tego samego shellu, a nie modalem. Theme switch jest dostępny przez cały pre-game i znika dopiero po wejściu do widoku gameplayu.
