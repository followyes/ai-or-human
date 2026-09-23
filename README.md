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
