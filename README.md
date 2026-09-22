# AI or Human — V0.1.3

Gra internetowa, w której gracz ocenia, czy obraz stworzył człowiek, czy AI.

## Najważniejsze zasady

- Jedna runda ma maksymalnie 20 obrazów.
- `images/AI/` = poprawna odpowiedź **AI**.
- `images/HUMAN/` = poprawna odpowiedź **CZŁOWIEK**.
- Typ obrazu wynika wyłącznie z folderu.
- W jednej otwartej sesji strony obraz nie pojawia się ponownie, także po kliknięciu **Zagraj ponownie**.
- Pełne odświeżenie strony (`F5` / reload) celowo rozpoczyna nową sesję i czyści historię pokazanych obrazów.
- Desktop: podstawowe sterowanie przyciskami.
- Mobile: przyciski + swipe.
- Swipe w lewo = **CZŁOWIEK**.
- Swipe w prawo = **AI**.
- UI odpowiedzi jest neutralny: bez czerwonego/zielonego i bez ikon sugerujących wybór.

## Dodawanie obrazów — GitHub

Od V0.1.3 nie musisz ręcznie aktualizować `data/images.json` po każdym dodaniu zdjęć do repozytorium.

Workflow GitHub Actions:

1. pobiera aktualne repo,
2. skanuje `images/AI/` i `images/HUMAN/`,
3. generuje świeży `data/images.json`,
4. wykonuje audyt,
5. buduje stronę,
6. publikuje ją na GitHub Pages.

### Jednorazowa konfiguracja Pages

Po wrzuceniu V0.1.3:

1. GitHub → **Settings**
2. **Pages**
3. **Build and deployment**
4. **Source → GitHub Actions**

Od tego momentu zwykłe dodanie zdjęć do folderów i commit/push wystarczy.

## Dodawanie obrazów lokalnie

Jeśli pracujesz lokalnie:

```bash
npm run images
```

albo pełny build:

```bash
npm run build
```

Nie trzeba wykonywać `npm install` — projekt nie ma zewnętrznych zależności npm.

## Obsługiwane formaty

Generator przyjmuje:

- `.jpg`
- `.jpeg`
- `.jfif`
- `.png`
- `.bmp`
- `.webp`
- `.avif`
- `.gif`
- `.svg`

Rozszerzenia mogą być zapisane wielkimi lub małymi literami.

## Dlaczego wcześniej zdjęcia wrzucone do folderów nie pojawiały się w grze?

GitHub Pages jest hostingiem statycznym. JavaScript uruchomiony w przeglądarce nie może poprosić serwera o listę plików z katalogu `images/AI/` lub `images/HUMAN/`.

W V0.1.2 trzeba było po dodaniu zdjęć ręcznie wykonać:

```bash
npm run images
```

i zacommitować wygenerowany `data/images.json`.

V0.1.3 przenosi ten krok do GitHub Actions, więc manifest jest generowany automatycznie przed każdym deployem.

## Swipe

V0.1.3 nie opiera swipe na wykrywaniu „czy urządzenie jest mobilne”. Karta korzysta z Pointer Events dla dotyku/pióra oraz ma fallback Touch Events.

`touch-action: pan-y` pozwala stronie zachować pionowe przewijanie, a poziomy gest karty przejmuje gra.

Dla użytkowników z systemowym `prefers-reduced-motion` ruch jest skrócony, ale podstawowa animacja karty pozostaje widoczna.

## Lokalny start

```bash
python -m http.server 8080
```

Następnie:

`http://localhost:8080`

## Testy

```bash
npm run audit
```
