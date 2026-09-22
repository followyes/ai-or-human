# CHANGELOG

## V0.1.3

### Swipe
- usunięto zależność swipe od `matchMedia("(pointer: coarse)")` / `maxTouchPoints`,
- Pointer Events obsługują touch/pen bez kruchej detekcji urządzenia,
- dodano fallback Touch Events dla nietypowych/starszych silników,
- karta zawsze ma `touch-action: pan-y`,
- dodano rozróżnienie gestu poziomego od pionowego,
- `prefers-reduced-motion` skraca ruch zamiast całkowicie ukrywać animację karty.

### Obrazy / GitHub Pages
- dodano workflow `.github/workflows/pages.yml`,
- manifest obrazów jest generowany automatycznie przed każdym deployem,
- dodano czysty build `dist/`,
- dodano formaty `.jfif` i `.bmp`,
- dodanie obrazów bez ręcznego uruchamiania generatora jest obsługiwane po przełączeniu Pages na GitHub Actions.

### Historia gry
- usunięto trwałe `localStorage`,
- historia obrazów jest przechowywana wyłącznie w pamięci aktualnie otwartej strony,
- kolejne rundy bez odświeżenia nadal nie powtarzają obrazów,
- pełny refresh celowo zeruje historię i stan gry.

### QA
- rozszerzono audyt o swipe, historię sesji i workflow Pages.
