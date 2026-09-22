# AUDIT V0.1.4

Zakres kontroli:
- ekran końcowy,
- ponowne rozpoczęcie gry,
- historia sesji,
- manifest obrazów,
- workflow GitHub Pages,
- swipe,
- build statyczny.

Wynik:
- przycisk `Zagraj ponownie` pozostaje widoczny po każdej zakończonej rundzie,
- brak publicznego resetu historii,
- po wyczerpaniu całej puli replay automatycznie zaczyna świeżą sesję,
- pełny refresh nadal zeruje historię sesji,
- katalog obrazów jest generowany przed deployem przez GitHub Actions,
- runtime ładuje bieżący obraz i preładuje następny zamiast pobierać całą bazę obrazów.
