AI OR HUMAN — V0.1

1. Otwórz projekt w terminalu.
2. Dodaj swoje obrazy:
   - images/AI/
   - images/HUMAN/
3. Uruchom:
   npm run images
4. Uruchom lokalny serwer, np.:
   python -m http.server 8080
5. Wejdź na:
   http://localhost:8080

WAŻNE:
- Nie trzeba robić npm install.
- data/images.json jest generowany automatycznie.
- Odpowiedź wynika z folderu, nie z nazwy pliku.
- Jedna runda = maksymalnie 20 niewidzianych obrazów.
- Historia widzianych obrazów jest zapisywana w localStorage.
- Mobile: swipe w lewo = CZŁOWIEK, swipe w prawo = AI.
