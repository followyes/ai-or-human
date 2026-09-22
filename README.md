# AI or Human

Prosta gra webowa: gracz zgaduje, czy obraz został wygenerowany przez AI, czy stworzony przez człowieka.

## Obrazy

Jedyną klasyfikacją jest folder:

- `images/AI/` — obrazy AI,
- `images/HUMAN/` — obrazy stworzone przez człowieka.

Nazwy plików nie mają znaczenia. Możesz używać także podfolderów.

Obsługiwane formaty: JPG/JPEG/JFIF, PNG, BMP, WebP, AVIF, GIF i SVG.

## Zasady V1

- jedna runda = dokładnie 20 unikalnych obrazów,
- proporcja AI/HUMAN jest losowa,
- brak powtórzeń w obrębie jednej rundy,
- pomiędzy rundami powtórki są dozwolone, ale niedawno pokazane obrazy mają niższą wagę losowania,
- pełne odświeżenie strony zaczyna nową sesję wag,
- mobile: swipe w lewo = CZŁOWIEK, swipe w prawo = AI,
- desktop: przyciski.

## Build

```bash
npm run test
npm run build
```

`npm run build` skanuje `images/AI/**` i `images/HUMAN/**`, waliduje pulę i generuje produkcyjny `dist/data/images.json`.

`data/images.json` **nie jest plikiem źródłowym w repozytorium** i nie powinien być utrzymywany ręcznie. Build wymaga co najmniej 20 unikalnych obrazów łącznie.

## GitHub Pages — wymagany tryb wdrożenia

V1 **nie może być publikowane przez `Deploy from a branch` z katalogu głównego repozytorium**. Źródłowy kod celowo nie zawiera `data/images.json`; plik powstaje dopiero podczas builda.

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

Jeżeli aplikacja ładuje się, ale konsola pokazuje:

```text
GET .../data/images.json 404
```

to nie oznacza problemu z nazwami zdjęć. Oznacza, że GitHub Pages serwuje źródła repo zamiast zbudowanego artefaktu `dist/` albo build/deploy nie został wykonany.

Sprawdź kolejno:

1. czy `.github/workflows/pages.yml` naprawdę znajduje się na GitHubie,
2. czy **Settings → Pages → Source** ma wartość **GitHub Actions**,
3. czy najnowszy workflow w **Actions** zakończył się PASS,
4. czy krok `Verify generated Pages artifact` raportuje poprawny manifest.
