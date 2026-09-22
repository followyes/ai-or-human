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

`npm run build` skanuje `images/AI/**` i `images/HUMAN/**`, waliduje pulę i generuje `dist/data/images.json`. Manifest nie jest utrzymywany ręcznie w repozytorium.

Build wymaga co najmniej 20 unikalnych obrazów łącznie.

## GitHub Pages

Repo zawiera workflow `.github/workflows/pages.yml`. W ustawieniach repozytorium ustaw:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Każdy push do `main` uruchamia testy, buduje manifest z aktualnych folderów obrazów i wdraża `dist/` na GitHub Pages.
