# AI or Human — V0.1.1

Prosta gra internetowa: gracz ocenia, czy obraz stworzył człowiek, czy AI.

## Założenia V0.1

- 20 obrazów na rundę.
- `images/AI/` = poprawna odpowiedź **AI**.
- `images/HUMAN/` = poprawna odpowiedź **CZŁOWIEK**.
- Brak ręcznego opisywania obrazów jako `true` / `false`.
- `data/images.json` jest generowany automatycznie.
- Wykorzystane obrazy są zapamiętywane w `localStorage`.
- Ten sam obraz nie wraca w kolejnych rundach, dopóki historia nie zostanie zresetowana.
- Mobile: przyciski + swipe.
- Swipe w lewo = CZŁOWIEK.
- Swipe w prawo = AI.
- Desktop: podstawowe sterowanie przyciskami.
- Obrazy używają `object-fit: contain`, więc gra nie kadruje istotnych fragmentów.

## Dodawanie obrazów

1. Wrzuć obrazy AI do:

   `images/AI/`

2. Wrzuć obrazy stworzone przez człowieka do:

   `images/HUMAN/`

3. W katalogu projektu uruchom:

   ```bash
   npm run images
   ```

4. Zacommituj obrazy oraz wygenerowany `data/images.json`.

Nie ma zależności npm i nie trzeba uruchamiać `npm install`.

## Dlaczego generator jest potrzebny?

GitHub Pages nie udostępnia JavaScriptowi listy plików znajdujących się w katalogu. Dlatego skrypt Node.js skanuje oba foldery przed publikacją i tworzy gotowy manifest.

Typ obrazu jest wyznaczany wyłącznie przez folder.

## Identyfikatory obrazów

Generator używa SHA-256 zawartości pliku jako ID.

Dzięki temu:
- nie trzeba pilnować specjalnych nazw plików,
- zmiana nazwy pliku nie powoduje ponownego pokazania tego samego obrazu,
- identyczne kopie pliku w jednym folderze są deduplikowane,
- identyczny plik umieszczony jednocześnie w `AI` i `HUMAN` zatrzyma generator błędem.

## Lokalne uruchomienie

Nie otwieraj `index.html` bezpośrednio przez `file://`, ponieważ gra pobiera `data/images.json` przez `fetch()`.

Możesz użyć dowolnego prostego serwera lokalnego, np.:

```bash
python -m http.server 8080
```

Następnie otwórz:

`http://localhost:8080`

## GitHub Pages

Po wrzuceniu projektu do repozytorium:

1. GitHub → **Settings**
2. **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`
5. Folder: `/ (root)`
6. Save

Strona będzie działała z relatywnych ścieżek, więc pasuje do adresu projektu w rodzaju:

`https://followyes.github.io/ai-or-human/`

## Pliki demonstracyjne

V0.1 zawiera po dwa proste pliki SVG w obu folderach tylko po to, aby można było natychmiast sprawdzić działanie pętli gry.

Przed użyciem prawdziwej bazy możesz je bezpiecznie usunąć i ponownie wykonać:

```bash
npm run images
```


## V0.1.1 — UI / mobile correction

- usunięto czerwony i zielony z odpowiedzi oraz feedbacku,
- usunięto symbole `×` i `✓` z przycisków,
- oba wybory są wizualnie neutralne,
- ekran startowy nie pokazuje opisu rundy ani liczby niewidzianych obrazów,
- usunięto stale widoczny napis `Ładowanie…`; komunikat pojawia się tylko przy realnym błędzie obrazu,
- poprawiono poziome rozszerzanie strony podczas swipe/odrzucania karty na urządzeniach mobilnych.
