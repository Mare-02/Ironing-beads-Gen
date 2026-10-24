# Perlenwerk – Bügelperlen-Vorlagen aus Bildern

Statische Web-Seite (ohne Server, ohne Build-Schritt), die aus einem Bild eine Bügelperlen-Vorlage in genau den Farben macht, die man zu Hause hat. Gedacht für Hama Midi (Platten mit 29 × 29 Stiften), optimiert für Tablet und Handy.

## Was sie kann

1. **Farben** – die eigenen Hama-Farben abhaken, Farbtöne an die echten Perlen anpassen, eigene Farben ergänzen, Auswahl als Datei sichern/übertragen.
2. **Bild** – Baufläche wählen (1–6 Platten nebeneinander/untereinander) und entweder
   - ein **Foto/Bild** umrechnen lassen (Rahmen ziehen, Rand automatisch abschneiden, Hintergrund entfernen, Farbanzahl begrenzen, Ausreißer glätten) oder
   - eine **fertige Vorlage** importieren: Das Raster wird erkannt (Anzahl Perlen anpassbar) und die Farben werden auf die eigenen Perlen übertragen.
3. **Vorlage** – Radierer, „Fläche löschen“, Stift, Pipette, Rückgängig, Verschieben auf der Platte. **Verbindungs-Check**: Perlen, die nur diagonal oder gar nicht am Hauptstück hängen, werden rot markiert und können gelöscht werden. Export als PNG mit Farbliste.
4. **Bauen** – klare Startposition (Platte, Reihe, Stift, freie Ränder), Reihe für Reihe mit Farbfolge, Fortschritt abhaken. **Fortschritt prüfen**: Foto der Platte machen, die 4 Eck-Stifte antippen – die Seite entzerrt das Foto und markiert falsche Farben, überzählige und fehlende Perlen.

Alles wird nur im Browser gespeichert (`localStorage`).

## Lokal starten

```bash
python3 -m http.server 8080
```

Dann <http://localhost:8080> öffnen. (Direktes Öffnen der `index.html` per Doppelklick funktioniert nicht, weil Browser JS-Module nur über einen Server laden.)

## Online stellen

Über GitHub Pages: Repository → Settings → Pages → „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.

## Tests

```bash
node --test tests/logic.test.mjs
```

Getestet wird die reine Logik: Farbabstand (CIEDE2000), Hintergrund-Erkennung, Verbindungs-Check, Platzierung, Raster-Erkennung, Entzerrung und Fortschritts-Vergleich.
