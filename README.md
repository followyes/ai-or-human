# AI or Human

Prosta gra webowa: gracz zgaduje, czy obraz został wygenerowany przez AI, czy stworzony przez człowieka.

## Obrazy

Jedyną klasyfikacją jest folder:

- `images/AI/` — obrazy AI,
- `images/HUMAN/` — obrazy stworzone przez człowieka.

Nazwy plików nie mają znaczenia. Możesz używać także podfolderów.

Obsługiwane formaty: JPG/JPEG/JFIF, PNG, BMP, WebP, AVIF, GIF i SVG.

## Zasady V1.2

Aktualny tryb gry jest wewnętrznie traktowany jako **Sesja**, ale nazwa trybu nie jest jeszcze pokazywana w interfejsie. Gdy pojawią się kolejne tryby, obecna mechanika dostanie dedykowany przycisk `Sesja`.

Przed rozpoczęciem gracz wybiera liczbę obrazów:

- 10,
- 20,
- 50.

Pozostałe zasady:

- wybrana sesja zawiera dokładnie tyle unikalnych obrazów, ile wskazał gracz,
- proporcja AI/HUMAN jest losowa,
- brak powtórzeń w obrębie jednej sesji,
- pomiędzy sesjami powtórki są dozwolone, ale niedawno pokazane obrazy mają niższą wagę losowania,
- pełne odświeżenie strony zaczyna nową historię wag,
- mobile: swipe w lewo = CZŁOWIEK, swipe w prawo = AI,
- desktop: przyciski,
- po udanym swipe stara karta pozostaje ukryta do chwili pełnej gotowości następnego obrazu,
- następny obraz jest ładowany i dekodowany przed reveal,
- przyciski i swipe są odblokowywane dopiero po zakończeniu reveal,
- ostatnia karta po throw przechodzi bezpośrednio do wyniku i nie wraca na środek.

Jeżeli pula zawiera mniej obrazów niż dany wariant, ten wariant jest w UI wyłączony. Minimalna poprawna pula dla aplikacji to 10 obrazów.

## Build

```bash
npm run test
npm run build
```

`npm run build` skanuje `images/AI/**` i `images/HUMAN/**`, waliduje pulę i generuje produkcyjny `dist/data/images.json`.

`data/images.json` **nie jest plikiem źródłowym w repozytorium** i nie powinien być utrzymywany ręcznie. Build wymaga co najmniej 10 unikalnych obrazów łącznie.

## GitHub Pages — wymagany tryb wdrożenia

Aplikacja **nie może być publikowana przez `Deploy from a branch` z katalogu głównego repozytorium**. Źródłowy kod celowo nie zawiera `data/images.json`; plik powstaje dopiero podczas builda.

W repozytorium musi istnieć:

```text
.github/workflows/pages.yml
```

Następnie ustaw jednorazowo:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Po każdym pushu do `main` workflow:

1. uruchamia testy,
2. skanuje aktualne `images/AI/**` i `images/HUMAN/**`,
3. buduje `dist/`,
4. weryfikuje `dist/data/images.json`,
5. publikuje dokładnie `dist/` na GitHub Pages.

Stronę należy sprawdzać dopiero po zielonym `PASS` całego workflow w zakładce **Actions**.

## 404 dla `data/images.json`

Jeżeli aplikacja ładuje się, ale konsola pokazuje `GET .../data/images.json 404`, GitHub Pages serwuje źródła repo zamiast zbudowanego artefaktu `dist/` albo build/deploy nie został wykonany.


## V1.3

- real-touch swipe hardening (`touch-action: none`, immediate pointer capture),
- pointer-cancel recovery,
- independent green/red answer feedback layer,
- correct = green + ✓ + DOBRZE,
- incorrect = red + × + ŹLE,
- feedback and throw animate in parallel,
- reduced-motion keeps semantic feedback.


## V1.3.1 deployment correction

- Pages workflow minimum aligned with Session minimum: 10 images.
- Source-contract test now parses and verifies the workflow threshold semantically instead of relying on one exact whitespace string.


## V1.3.2 — Animation Timing Polish

Production timing was rebalanced:
- answer feedback: 680 ms,
- card throw: 500 ms,
- short-swipe return: 220 ms,
- next-card reveal: 150 ms.

There is still no artificial pause before throw. Feedback and card motion start immediately in parallel.
The result remains visible for 180 ms after the outgoing card finishes, then the next image is revealed.


## V1.3.3 — Slower Animation Tuning

Current timings:
- answer feedback: 950 ms,
- card throw: 700 ms,
- short-swipe return: 260 ms,
- next-card reveal: 200 ms.

CI no longer enforces narrow subjective timing ranges. It keeps only functional invariants such as positive durations and feedback outliving the outgoing card.


## V1.4 — Liquid Session Size Picker

The 10 / 20 / 50 selector now uses one shared moving indicator instead of three separate selected backgrounds.

- selected option = dark neutral pill + white number,
- adjacent changes use a native liquid stretch / flow / settle animation,
- direct 10 ↔ 50 uses one continuous stronger morph,
- start and result pickers remain synchronized,
- hidden pickers snap to the correct state rather than animating invisibly,
- resize/orientation re-aligns the indicator,
- reduced-motion disables the liquid deformation,
- no GSAP/MorphSVG dependency was added.

## V1.4.1 — True Liquid SVG Morph

V1.4's moving one-slot indicator was replaced rather than layered over.
The Session-size selector now uses a selector-wide SVG path whose actual geometry stretches from the source slot to the target slot, holds a connected liquid bridge, transfers the trailing edge, and settles on the target.

Key properties:
- true source-to-target path deformation instead of `translate + scaleX`,
- direct 10 ↔ 50 remains one continuous morph,
- 760 ms adjacent / 900 ms two-slot transition,
- stronger static selection: dark pill + white label,
- reduced motion snaps without liquid deformation,
- no GSAP/MorphSVG dependency,
- hidden picker sync and resize refresh preserved.


## V1.4.2 — Reference-Driven Bean Morph

The Session size selector keeps the existing three-option control, but its selected bean now follows a hand-authored motion language derived from the approved switch reference:

- 150 ms hard leading-edge stretch,
- 150 ms mass transfer,
- 500 ms elastic settle for adjacent moves,
- dedicated long-route poses for 10 ↔ 50,
- 150 ms hover pre-pull on pointer devices,
- reduced-motion snaps directly to the target.

The previous generic V1.4.1 liquid-width algorithm was removed rather than layered underneath the new motion system.


## V1.4.3 — Simple Sliding Session Pill

The rejected liquid/morph experiments were removed from the active picker.

Current Session-size control:
- one fixed outer track,
- one plain inner pill,
- pill slides between 10 / 20 / 50 with a 320 ms CSS transform transition,
- no SVG path morph,
- no stretch / liquid / elastic stages,
- no hover morph,
- reduced-motion snaps instantly,
- hidden picker and resize synchronization remain intact.

The active choice is emphasized by the moving white pill, stronger border/shadow, full text opacity and heavier label weight.

## Roadmap po V1.4.3

### V1.5 — External Content Library + `/admin`

Następny większy etap przenosi obrazy poza repozytorium GitHub, aby zarządzanie contentem nie wymagało commitów ani przebudowy GitHub Pages.

Założenia:
- publiczna gra nadal nie ma logowania ani kont użytkowników,
- panel administracyjny jest dostępny bezpośrednio pod `.../admin`,
- uwierzytelnianie istnieje wyłącznie wewnątrz panelu admina,
- admin wybiera klasę `AI` albo `HUMAN`,
- obsługiwany jest drag & drop wielu obrazów,
- pliki źródłowe JPG/PNG/WebP/itd. są automatycznie konwertowane do AVIF,
- po potwierdzonej konwersji przechowywany jest tylko zoptymalizowany AVIF,
- exact duplicates oraz cross-class duplicates są blokowane po hash-u,
- content usuwa się przez kontrolkę `X`,
- dodanie/usunięcie obrazu nie wymaga Git commit / GitHub Actions / deployu strony.

Provider został wybrany: **Supabase**. V1.5.1 tworzy fundament DB/Storage/RLS; publiczna gra nadal korzysta z repozytoryjnego `data/images.json` do czasu V1.5.2.

### V1.6 — Multi-Mode

Gdy pojawią się kolejne tryby, obecna ukryta nazwa `Sesja` staje się widocznym trybem w selektorze.

Planowane tryby:

1. **Sesja** — obecny klasyczny tryb.
2. **7 sekund** — każda karta ma 7 sekund; timeout zmienia kartę i daje 0 punktów.
3. **Death mech** — wspólny timer 60 s; dobra odpowiedź `+3 s`, zła `-5 s`, maksimum 60 s, minimum 0 s; przy 0 s tryb się kończy.

Szczegóły, które pozostają do ustalenia przed Death mech:
- czy ignoruje wybór 10 / 20 / 50 i działa wyłącznie do wyzerowania czasu,
- czy istnieje osobny timeout na pojedynczą kartę,
- jaki dokładnie zestaw statystyk pokazuje ekran końcowy.

Pełny plan etapów i acceptance gates znajduje się w `OUTSIDE_REPO/ROADMAP.md`.
## V1.5.1 — Supabase Foundation

Status: **PASS / CLOSED** after production SQL + consolidated postcheck.

Supabase foundation contains:
- `private.admin_users`,
- `private.is_admin()`,
- `public.game_images`,
- grants + RLS,
- public `game-images` bucket restricted to AVIF,
- admin-only Storage mutation policies.

## V1.5.2 — External Content Read Path

V1.5.2 moves ownership of the public image catalog out of `game.js` and into
`js/content-source.js`.

The migration behavior is intentionally safe:
- if Supabase public config is valid and at least 10 active images exist, the game uses Supabase,
- the REST catalog is paged until an empty page, so the client does not impose a 1000-image ceiling,
- public AVIF URLs are built from the `game-images` bucket,
- if Supabase is unconfigured, unavailable or still has fewer than 10 active images, the existing repository `data/images.json` remains the temporary fallback,
- the fallback is removed only after the real content migration is verified in V1.5.6.

Public configuration lives in:
`js/supabase-config.js`

Only a **Project URL** and **sb_publishable_...** key belong there. Never place an
`sb_secret_...` key in browser code.

V1.5.2 also narrows anonymous database privileges to only the public catalog
columns required by the game. Hashes, original filenames and internal metadata
are no longer table-wide readable by the anonymous role.


### V1.5.2 — Production public configuration

The public runtime is now configured for the project's Supabase instance:

- Project URL: `https://kopmcnabslumyweebjgf.supabase.co`
- credential type: `sb_publishable_*` (public browser key)

The publishable key is intentionally browser-visible and relies on the V1.5.2
grants + RLS boundary. No secret/service-role credential or database password
belongs in the repository.

Production SQL/postcheck for V1.5.2: **PASS**.

Current production data state at the SQL gate:
- `game_image_count = 0`
- `admin_user_count = 0`

Therefore, after this code is deployed, the expected migration behavior is:

1. query Supabase,
2. receive an empty active catalog,
3. fall back to the existing repository manifest,
4. keep the game playable.

V1.5.2 is not considered CLOSED until that browser smoke is confirmed on the
deployed GitHub Pages site.


## V1.5.3 — Admin Auth

V1.5.2 is production-verified and CLOSED.

V1.5.3 adds a direct, unlinked admin route:
`/admin/`

Public game:
- no Admin link,
- no Login link,
- no registration UI,
- gameplay behavior unchanged.

Admin authentication:
- Supabase email/password sign-in,
- direct Auth REST API using the existing public `sb_publishable_*` key,
- session stored only in `sessionStorage` for the current browser tab,
- expired access tokens refresh through Supabase Auth,
- current user is revalidated through `/auth/v1/user`,
- authorization is independently checked by the DB RPC `is_current_user_admin()`,
- sign-out uses local-session scope.

Security change:
the public `game_images_public_read_active` RLS policy is now `anon` only.
An authenticated user who is not listed in `private.admin_users` therefore
cannot inherit the public policy and read full internal image metadata.

V1.5.3 does not yet implement upload, AVIF conversion or delete-X. Those remain
V1.5.4/V1.5.5.


## V1.5.4 — Drag & Drop + AVIF

V1.5.3 `/admin` + Auth is production-verified and CLOSED.

V1.5.4 adds the first real content-ingestion path:
- explicit AI/HUMAN category selection,
- multi-file click/drag-and-drop,
- sequential processing to avoid memory spikes,
- SHA-256 of the original source,
- browser-side decode,
- browser-side AVIF encoding using pinned `@jsquash/avif@2.1.1`,
- generated AVIF verification,
- SHA-256 of the final AVIF,
- duplicate preflight against Supabase metadata,
- raw AVIF upload to `game-images`,
- metadata insert into `public.game_images`,
- compensating Storage cleanup if metadata insert fails,
- per-file status and before/after byte measurements.

Original JPG/PNG/WebP/AVIF source files are never uploaded to Supabase.

Migration safety:
all V1.5.4 uploads are inserted with `is_active=false`, and the database default
is also changed to false. Test batches cannot replace the current public
repository-backed game pool. Publication remains a V1.5.6 operation.

The exact long-term AVIF quality/resizing/file-size policy is intentionally not
frozen here. V1.5.4 first collects real source/output measurements using the
encoder default while preserving original pixel dimensions.


## V1.5.5 — Content Inventory + Delete X

V1.5.4 Drag & Drop + AVIF is production-verified and CLOSED.

V1.5.5 turns `/admin` into a basic content-management surface:

- authoritative inventory loaded from `public.game_images`,
- paginated reads without a client-side 1000-row ceiling,
- total / AI / HUMAN / active counters,
- ALL / AI / HUMAN filters,
- public Storage thumbnails,
- active/inactive state badges,
- manual refresh,
- `×` delete on every image,
- clearer duplicate and cross-class duplicate messages.

Delete lifecycle:
1. if a future item is active, mark it inactive first,
2. delete the exact AVIF Storage object,
3. delete the `game_images` metadata row,
4. refresh the authoritative inventory.

If Storage deletion fails for an originally active item, the client attempts to
restore `is_active=true`. If Storage succeeds but metadata deletion fails, the
metadata row remains inactive and the panel reports a partial failure instead
of claiming success.

V1.5.5 adds `idx_game_images_class_created` for category-filtered inventory
ordered newest-first.

Public gameplay remains unchanged and still ignores all inactive staging rows.


## V1.5.6 — Production Content Migration

V1.5.5 Content Inventory + Delete X is production-verified and CLOSED.

V1.5.6 introduces a controlled two-phase production migration.

### Phase A — migrate + verify + cut over

`/admin` reads the current generated repository manifest (`data/images.json`)
as the exact migration target. The manifest `id` is already the SHA-256 of
each repository image, so cutover validates exact file identity + class,
not only aggregate counts. It compares:

- total image count,
- AI count,
- HUMAN count,
- Supabase metadata count,
- Supabase Storage count,
- exact repository SHA-256/class pairs against `game_images.source_sha256`,
- missing expected repository images,
- unexpected metadata rows,
- class mismatches,
- AVIF payload mismatches (`avif_sha256 != repository SHA-256`),
- missing Storage objects,
- Storage orphans.

The **Aktywuj Supabase** button stays disabled until the DB RPC confirms exact
parity.

The cutover RPC atomically:
- verifies the expected AI/HUMAN counts again server-side,
- requires zero Storage/metadata drift,
- activates the full verified `game_images` pool,
- sets `private.content_runtime.external_live=true`.

After cutover, a DB trigger becomes authoritative for new uploads and marks
future inserted images active automatically.

A controlled rollback RPC remains available while repository fallback still
exists.

### Phase B — repository runtime cleanup

The repository fallback and image-tree runtime dependency are NOT removed in
the first V1.5.6 package.

They are removed only after the production public game is proven to load the
full Supabase pool after cutover. This prevents an irreversible one-deploy
migration.


### V1.5.6 corrective — batch upload + AVIF passthrough

Before continuing the production migration, V1.5.6 hardens the admin batch
uploader:

- every selected file is registered in the queue immediately as `OCZEKUJE`;
- processing remains sequential to keep browser memory bounded;
- the queue has its own bounded scroll viewport and a new batch clears old rows;
- `OCZEKUJE` is yellow/amber, `GOTOWE` green and `BŁĄD` red;
- a normal per-file error is promoted to the top and does not stop later files;
- duplicates are tracked separately from actual failures;
- existing AVIF files use byte-identical passthrough and never load the AVIF encoder;
- JPG/PNG/WebP still use the existing AVIF conversion path;
- the redundant second source-SHA preflight is skipped after the UI has already
  completed that exact check.

Migration repair:
if a staged repository AVIF was uploaded before this corrective and therefore
re-encoded, dropping the exact current repository AVIF again repairs the same
staged row in place. The Storage object is overwritten with the exact source
bytes and `avif_sha256` is updated. Active production rows are never eligible
for this automatic repair.

Cutover additionally requires `payload_mismatch = 0`, so a row whose source
identity matches the repository but whose stored AVIF was re-encoded cannot be
accepted accidentally.

Because this exact-payload gate is defined for the current all-AVIF production
repository corpus, the V1.5.6 migration target parser also refuses a manifest
containing a non-AVIF repository path instead of silently applying the wrong
payload invariant.


### Pre-cutover session corrective

`payload_mismatch` remains visible as a legacy quality warning, but no longer
blocks cutover after explicit acceptance of the 150 pre-passthrough AI files.
All structural migration gates remain strict.

Admin auth now refreshes access tokens proactively before expiry and retries an
auth-user 401/403 once through the refresh token. Long sequential upload batches
check token freshness before each file. Session state remains in sessionStorage.
