# AI or Human

Webowa gra, w której gracz zgaduje, czy obraz został wygenerowany przez AI, czy stworzony przez człowieka.

## V1.6.4.5 — Restore Original Full-Page Circular Theme Reveal (QA pending)

Po uwadze użytkownika, że V1.6.4.4 zniszczyło zatwierdzony wizualnie efekt LIGHT/DARK, przywrócono **dosłownie** `js/theme-controller.js` i blok View Transition CSS z historycznej paczki `V1.6.3-test.11`. To jest kołowy `clip-path` na **całym nowym widoku strony**, uruchamiany przez `document.startViewTransition()` przez 560 ms. Wariant bez tej funkcji używa oryginalnego CSS fade, a reduced-motion natychmiast ustawia motyw. Usunięto późniejszy `#theme-reveal-backdrop` i wszystkie style tej podmiany. ThemeController jest jeden w HOME/SETUP/RESULT. Brak `acquireVisualStability`, oczekiwania na karty lub blokowania przełącznika.

**Ważne ograniczenie:** pełnodokumentowy View Transition może złapać inną klatkę obracającej się karty niż żywy renderer. Nie deklarujemy na podstawie lokalnego testu, że lustrzane klatki na wyniku zostały usunięte. Użytkownik priorytetowo wymagał odzyskania dokładnie oryginalnej animacji; osobno konieczny jest real-phone test podczas aktywnych obrotów. Rotacja 5 kart, gameplay, feedback, celebracja, content i Admin pozostają bez zmian.

Local `npm run test` i `npm run build` PASS, a inline Chromium potwierdza animację `theme-reveal` na `::view-transition-new(root)` i kołowe przejście całego UI. Wersja pozostaje READY FOR REAL-PHONE QA, nie PASS/CLOSED.

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

### V1.6.3 TEST — Results Celebration / Replay Flow

V1.6.3 jest celowo przygotowane jako **testowa paczka wizualna**, a nie zaakceptowane zamknięcie etapu. Wynik po ostatniej karcie jest teraz osobnym finałem rundy zamiast jednocześnie pełnić rolę konfiguratora następnej sesji. Domyślny stan pokazuje przede wszystkim `AI OR HUMAN`, cosmic divider, `Twój wynik`, duży rezultat oraz dwie niezależne akcje: `Zagraj ponownie` i `Wróć do strony głównej`.

`Zagraj ponownie` nie uruchamia od razu następnej sesji. Odsłania wewnątrz tego samego stabilnego action-stage selector 10/20/50 oraz `Rozpocznij`; dopiero `Rozpocznij` korzysta z istniejącego `prepareAndStartSession()`. Powrót do strony głównej przywraca kanoniczny `mode-select` bez przeładowania strony i bez tworzenia drugiej authority landingu. Ostatnio wybrana liczba obrazów pozostaje zachowana.

Celebracja reuse'uje dokładnie tę samą globalną atmosferę co homepage: pięć istniejących rewersów, orbity, gwiazdy, inverse theme mapping i display typography. Testowy profil jest celowo kontrolowany: wynik dostaje krótki halo/settle, gwiazdy jednorazowy sparkle, orbity spokojny przeciwbieżny ruch, a powierzchnie kart mały `rotateY` wokół własnej osi. Nie dodano confetti, trofeów, nowych assetów ani tekstu zależnego od wyniku. `prefers-reduced-motion` pozostawia statyczną kompozycję bez ciągłego ruchu.

Przy okazji motion atmosphere jest teraz faktycznie view-scoped: dekoracyjne floaty są aktywne w `mode-select`, `mode-setup` i `result`, a podczas niewidocznego gameplayu są zatrzymane zamiast dalej zużywać compositor work w tle. Theme switch nadal jest ukrywany wyłącznie podczas właściwego gameplayu.

Pakiet wymaga real-phone visual QA przed jakimkolwiek PASS: finał ostatniej karty, czytelność i intensywność celebracji, oba CTA, reveal replay setup bez pionowego skoku, 320/360/390/430 px, krótki portrait z browser chrome, light/dark, reduced motion oraz powrót do homepage i replay do gameplayu.

Test iteration `1.6.3-test.2` dodaje deployment/cache-coherence corrective po real-phone smoke pierwszej paczki testowej: zmienione publiczne `style.css` i `game.js` mają wersjonowane URL-e w `index.html`, a result substate synchronizuje także natywne `hidden`. Dzięki temu nowy HTML nie może pokazać jednocześnie celebration actions i replay setup tylko dlatego, że telefon zachował poprzedni CSS w cache.

`1.6.3-test.5` zachowuje zaakceptowaną rotację dokładnie pięciu kart z test.4, ale wzmacnia niewystarczająco widoczny victory impact i utrzymuje finał jako żywy stan do momentu opuszczenia głównej celebracji. `Twój wynik` ma dłuższy scale-in/settle, wynik czytelniejszy overshoot/pulse, a gold/blue halo trwa około 2 s. Lokalna warstwa ośmiu sparkli ma dłuższy wejściowy burst; po nim niezależne losowe kanały uruchamiają pojedyncze sparkle, delikatne halo-breath i flare centralnej gwiazdy dividera. Wyjście do replay/home natychmiast blokuje nowe zdarzenia, ale już rozpoczęte animacje kończą się bez snapu. LIGHT/DARK jest teraz synchronizowany z celebration motion: przed root View Transition zatrzymywane są nowe schedulery, aktywne WAAPI oraz CSS atmosphere motion są pauzowane w bieżącym `currentTime`, a po transition wznawiane z tego samego miejsca. Rapid theme taps nie mogą zagnieżdżać dwóch transition/hold cycles. Tekst zależny od wyniku pozostaje poza zakresem; nie ma canvas/WebGL/RAF.

`1.6.3-test.6` koryguje real-phone konflikt między aktywną rotacją kart a root View Transition. Pauzowanie karty w losowym kącie `rotateY()` powodowało podczas LIGHT/DARK wrażenie pokazania odbicia/tylnej płaszczyzny i późniejszego powrotu do układu. Primary result celebration oraz każdy jeszcze kończący się result effect omijają teraz snapshot całego dokumentu i używają live CSS fallbacku. Na czas zmiany motywu blokowane są wyłącznie nowe losowe starty; rozpoczęte obroty i finite decoration motion biegną dalej bez zatrzymania w pół ruchu. Root View Transition i `theme-motion-hold` pozostają dostępne dla stanów, w których nie ma aktywnego result motion. Rotacja pięciu kart i intensywność celebracji z test.5 nie zostały zmienione.

`1.6.3-test.7` naprawia właściwą regresję LIGHT/DARK zgłoszoną na homepage i `mode-setup`: dwustronny renderer 3D, dodany wyłącznie dla pełnych obrotów celebracji, był aktywny globalnie także na pre-game. Homepage/setup wracają do zaakceptowanej płaskiej powierzchni z jednym bezpośrednim `background-image`; `preserve-3d` oraz pseudo-front/back są teraz aktywne wyłącznie w `data-public-view="result"`. Circular theme reveal oraz inverse LIGHT UI -> DARK back / DARK UI -> LIGHT back pozostają bez zmian. Nie dodano kolejnego theme workaroundu.

`1.6.3-test.8` porządkuje celebrację bez ruszania zaakceptowanego result/replay flow ani homepage LIGHT/DARK. Osiem istniejących elementów sparkle nie ma już stałych pozycji i kolorów: działa jako bounded reusable pool. Każdy event losuje bezpieczną strefę poza centralnym korytarzem wyniku/CTA, rozmiar, obrót i jeden z czterech semantycznych tonów (`gold`, `blue`, `cream`, `ice`) kontrolowanych wyłącznie przez CSS. Ambient uruchamia zwykle 1, czasem 2, rzadko 3 sparkle w krótkim staggerze; zajęty slot nie może zostać użyty drugi raz przed zakończeniem własnej animacji. Pierwszy obrót kart został odsunięty do ok. 1,7–3,5 s, aby wejście tytułu, wyniku i sparkli miało pierwszeństwo wizualne; dalszy rytm pięciu niezależnych kart pozostaje bez zmian. Halo/star oraz theme architecture pozostają bez zmian w tym teście.

`1.6.3-test.9` zastępuje ograniczony single-sparkle subsystem jednym bounded systemem mini-fajerwerków na całym widoku wyniku. Runtime ma dokładnie trzy reużywalne burst-sloty po osiem cząstek i mały core flash; jeden wybuch używa 4–8 cząstek oraz jednej spójnej rodziny kolorów warm (`gold`/`cream`), cool (`blue`/`ice`) albo rzadszej mixed. Entry odpala trzy mocniejsze, rozłożone w czasie bursty, a później fajerwerki pojawiają się losowo przez cały główny `result/celebration` mniej więcej co 1,0–2,6 s, czasem z krótkim drugim wybuchem. Maksymalnie trzy bursty mogą być aktywne jednocześnie.

Centra wybuchów są losowane w pełnym widocznym viewportcie wyniku, ale poza rozszerzonymi prostokątami tytułu, wyniku, CTA i theme switcha oraz z bezpiecznym marginesem od krawędzi. Geometria jest odczytywana tylko przy wejściu do resultu i resize/orientation; nie ma RAF/canvas/WebGL. Po replay/home przestają powstawać nowe fajerwerki, ale już rozpoczęty burst zachowuje ownership swoich cząstek i kończy się naturalnie. Rotacja pięciu kart, opóźnienie pierwszego turnu z test.8, halo/star, replay flow, theme i homepage flat renderer pozostają bez zmian.

`1.6.3-test.10` dostraja wyłącznie intensywność widowiska z test.9, bez zmiany jego architektury. Bounded firework authority rośnie do pięciu reużywalnych burst-slotów po dwanaście cząstek; pojedynczy ambient burst używa 7–12 cząstek, entry 10–12. Promień jest wyraźnie większy (responsywnie do ok. 74/92/108/120 px), cząstki są większe i dłużej widoczne, a core flash mocniejszy. Entry planuje siedem burstów w pierwszych ~2 s, persistent cadence przyspiesza do ok. 0,5–1,35 s i może dodać jeden lub dwa bliskie follow-upy. Maksymalna równoległość pozostaje twardo ograniczona pięcioma slotami; DOM nie rośnie dynamicznie. Safe-zone authority nadal chroni wynik/CTA/theme switch, ale centra mogą podejść bliżej krawędzi, więc część promieni może naturalnie wyjść poza viewport. Rotacja pięciu kart, halo/star, replay flow, homepage LIGHT/DARK i reduced-motion pozostają bez zmian.

`1.6.3-test.11` porządkuje LIGHT/DARK po serii result-only corrective'ów i przywraca **jedną kanoniczną authority przejścia motywu dla całego publicznego flow**. Ekran wyniku używa teraz dokładnie tego samego circular root View Transition co homepage i `mode-setup`; usunięto result-only `shouldUseViewTransition`, hooki `beforeChange/afterChange`, `theme-motion-hold` oraz theme suspend/resume z `ResultCelebrationController`. Theme controller wraca do odpowiedzialności sprzed tych workaroundów: persisted LIGHT/DARK, `color-scheme`, `theme-color`, circular reveal i CSS fallback. Celebracja test.10, pięć kart, fajerwerki, replay flow oraz płaski renderer homepage/setup z test.7 pozostają bez zmian.


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

### V1.6.4 — Gameplay Visual Coherence + Feedback Effects

V1.6.3 jest PASS/CLOSED. V1.6.4 domyka wizualnie ostatni legacy-looking stan publicznego lifecycle — właściwą rozgrywkę — bez przepisywania mechaniki gry. HUD `POSTĘP/WYNIK`, pytanie, frame obrazu oraz odpowiedzi HUMAN/AI korzystają teraz ze wspólnego języka V1.6. HUMAN ma ciepłą złotą identyfikację kategorii, AI chłodną niebieską; obie odpowiedzi pozostają równorzędne. Zielony/czerwony są zarezerwowane wyłącznie dla semantyki `DOBRZE/ŹLE`.

Gameplay dostał własny short-portrait profile dla wysokości <=740 px: kompaktuje HUD/pytanie/marginesy i wylicza stage karty z dostępnej wysokości, bez ukrywania kontrolek i bez globalnego skalowania aplikacji. SwipeController zachowuje dotychczasowy decision threshold, ale przekazuje dodatkowe `decisionProgress` znormalizowane dokładnie do tego progu, dzięki czemu hint osiąga pełne potwierdzenie wizualne w momencie, w którym gest faktycznie staje się odpowiedzią.

Feedback odpowiedzi nadal jest osobnym overlayem poza rzucaną kartą i nadal biegnie równolegle z throw. V1.6.4 wzmacnia jego game-feel przez osobne kanały burst/ring/pill/icon: poprawna odpowiedź ma zielony pulse/settle, błędna czerwony lokalny shake/pulse. Nie zmienia to punktacji, kolejności kart ani czasu mechanicznego handoffu.

`V1.6.4.1` usuwa redundantny dolny pasek `← CZŁOWIEK · AI →`; dwa główne przyciski oraz swipe hints na karcie są wystarczającą authority wyboru. Corrective porządkuje też zmianę LIGHT/DARK na ekranie wyniku bez tworzenia drugiego theme systemu: `ThemeController` pozostaje jedyną kanoniczną authority i nadal używa tego samego circular root reveal co homepage. Jedynie karta będąca już w trakcie pełnego `rotateY()` zapamiętuje semantyczny wariant artworku, z którym rozpoczęła obrót, i zwalnia go po powrocie do neutralnego 360°. Dzięki temu globalna zmiana motywu nie podmienia tekstury w połowie aktywnego ruchu.

`V1.6.4.2` upraszcza wygląd gameplayu po real-phone ocenie użytkownika: usuwa dwa dekoracyjne, rozmyte panele HUD, gradientową złoto-niebieską ramkę obrazu i ciężkie kapsuły odpowiedzi. Statystyki są teraz lekkim wierszem informacyjnym, karta ma neutralną cienką ramkę, a równorzędne przyciski mają ograniczony ciepły/chłodny akcent. Nie zmienia to tekstów, logiki rozgrywki, ruchu swipe ani wcześniej zaakceptowanego wyglądu homepage/result. Feedback `DOBRZE / ŹLE` pozostaje osobnym overlayem poza przesuwaną kartą, ale nie przycina już całej animacji: osobny local-wash jest obcięty do zdjęcia, natomiast ring, rozbłysk i komunikat mają nieprzycinaną warstwę. Rozmiar pierścienia ma viewport-aware bound, a rozbłysk miękki falloff. Czasy feedbacku i równoległy throw pozostają nietknięte.

Status: **V1.6.4.2 LOCAL QA PASS / READY FOR REAL-PHONE VISUAL QA — VISUAL ACCEPTANCE PENDING**.


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
- **V1.6 — ACTIVE — Gameplay Feel / Public UI / Homepage.** V1.6.2.2 PASS/CLOSED; V1.6.3 Results Celebration / Replay Flow PASS/CLOSED; V1.6.4.2 Gameplay UI Simplification + Feedback Overflow Corrective LOCAL QA PASS / READY FOR REAL-PHONE VISUAL QA.
- **V1.7 — Multi-Mode.** Dotychczasowy zakres V1.6 został przeniesiony w całości na V1.7.

### V1.6.2.2 — Pre-Game Interaction / Copy / Theme Corrective

Real-phone smoke V1.6.2.1 ujawnił cztery mniejsze, ale widoczne niespójności. Programowy focus na `Klasyczny` (`tabindex=-1`) pokazywał na iOS/Chrome domyślny niebieski browser focus-box; cały statyczny tekst pre-game mógł też zostać przypadkowo zaznaczony dotykiem. Corrective zachowuje focus handoff dla dostępności, ale usuwa surowy obrys przeglądarki z nietabbowalnego nagłówka i blokuje przypadkową selekcję statycznej warstwy pre-game.

Setup nie powtarza już `Wybierz liczbę obrazów` bezpośrednio nad `LICZBA OBRAZÓW`; pozostaje jedna wystarczająca etykieta kontrolki. Usunięto również setup-only `opacity` całej atmosfery i osobne przygaszenie orbit, ponieważ `mode-setup` jest stanem tego samego shellu, a nie modalem. Theme switch jest dostępny przez cały pre-game i znika dopiero po wejściu do widoku gameplayu.
