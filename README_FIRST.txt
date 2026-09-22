AI OR HUMAN — V0.1.4

NAJWAŻNIEJSZE:
1. Wrzuć swoje zdjęcia do:
   images/AI/
   images/HUMAN/

2. Po wdrożeniu tej wersji ustaw w GitHub:
   Settings -> Pages -> Source -> GitHub Actions

3. Od tej chwili GitHub sam generuje listę zdjęć przed każdym deployem.
   Nie musisz ręcznie poprawiać data/images.json po wrzuceniu zdjęć przez stronę GitHuba.

4. Historia zdjęć działa tylko podczas aktualnie otwartej strony:
   - Zagraj ponownie -> wcześniejsze zdjęcia się nie powtarzają.
   - F5 / odświeżenie -> nowa sesja, historia jest czyszczona.

5. Mobile:
   swipe w lewo = CZŁOWIEK
   swipe w prawo = AI

6. Desktop:
   podstawowe sterowanie przyciskami.

Lokalny pełny test:
npm run build

V0.1.4: po każdej rundzie zawsze widoczny jest przycisk Zagraj ponownie.
