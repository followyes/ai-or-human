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
