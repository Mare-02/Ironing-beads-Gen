# Perlenwerk

Statische Web-Seite, die aus einem Bild (oder einer fertigen Bügelperlen-Vorlage) eine Vorlage in den Perlenfarben macht, die die Nutzerin besitzt. Zielgruppe ist eine einzelne Bastlerin ohne Technik-Hintergrund, die vor allem am **Tablet/Handy** arbeitet. Repo: https://github.com/Mare-02/Ironing-beads-Gen

## Starten & Testen

```bash
python3 -m http.server 8080        # dann http://localhost:8080 (file:// geht nicht, ES-Module)
node --test tests/logic.test.mjs   # Logik-Tests
```

Im Desktop-App-Browser: `.claude/launch.json` → Konfiguration `perlenwerk`.

## Technik-Grundsätze

- **Kein Build, keine Abhängigkeiten.** Reines HTML/CSS + Vanilla-JS-ES-Module. Keine Frameworks oder npm-Pakete einführen; die Seite soll per GitHub Pages direkt aus `main` laufen.
- **Kein Server.** Alles läuft im Browser; gespeichert wird in `localStorage` (`perlenwerk.palette.v1`, `perlenwerk.project.v1`). Bei Formatänderungen die Version im Schlüssel erhöhen oder migrieren.
- **Sprache:** Oberfläche, Kommentare, Testnamen und Commit-Messages auf **Deutsch**, Bezeichner im Code englisch. UI-Texte duzen und alltagssprachlich halten („Stift“, „Reihe“, „Platte“ – keine Fachbegriffe).
- Touch zuerst: Bedienelemente mind. 44 px, keine Hover-only-Funktionen, kein horizontales Scrollen bei 375 px Breite.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Alle 4 Schritte als `<section>`: Farben → Bild → Vorlage → Bauen |
| `css/style.css` | Gesamtes Styling, Farb-Tokens in `:root` |
| `js/main.js` | Zustand (`state`), Rendering der Schritte, alle Event-Handler |
| `js/palette.js` | Hama-Midi-Standardfarben (Hex-Werte sind Näherungen, in der UI anpassbar) |
| `js/color.js` | RGB→Lab, CIEDE2000 (`deltaE00`), Textfarbe für Kontrast |
| `js/convert.js` | Bild → Zellen (`sampleImage`), fertige Vorlage auslesen (`sampleChart`, `detectGrid`, `period`), Zellen → Farbcodes (`buildPattern`, Hintergrund, Farbreduktion, Glätten) |
| `js/grid.js` | Reine Raster-Funktionen: Verbindungs-Check, Platzieren, Verschieben, Startperle, Reihen-Abschnitte |
| `js/check.js` | Fortschritts-Check per Foto: Homographie aus 4 Ecken, Vergleich Foto ↔ Vorlage |
| `js/render.js` | `drawBoard` – zeichnet Raster/Platten als Canvas (Lineale, Nähte, Markierungen) |
| `js/storage.js` | localStorage-Zugriff |

DOM-freie Logik (`grid.js`, `color.js`, `check.js`, `buildPattern`/`period` in `convert.js`) gehört getestet in `tests/logic.test.mjs`. Neue Logik möglichst dort ansiedeln statt in `main.js`.

## Fachliche Regeln (nicht ändern ohne Rückfrage)

- **Platte = 29 × 29 Stifte** (`PEG`), Baufläche = `px × py` Platten (max. 6 × 6).
- **Raster** = flaches Array der Länge `W*H`, Eintrag = Farbcode (String, z. B. `'05'`) oder `null`. Index `i = y * W + x`.
- **Verbunden nur seitlich (4er-Nachbarschaft).** Diagonal anliegende Perlen gelten als lose – beim Bügeln verschmelzen sie nur mit direkten Nachbarn. Größtes zusammenhängendes Stück = Hauptstück.
- **Koordinaten für die Nutzerin** sind immer plattenlokal und 1-basiert: „Platte n, Reihe r von oben, Stift s von links“, gezählt ab der oberen linken Ecke der jeweiligen Platte. Lineale nummerieren pro Platte neu.
- **Startperle** = erste Perle in Leserichtung (oben → unten, links → rechts).
- Die Vorlage liegt immer auf der vollen Baufläche, passt also per Konstruktion auf die Platten.
- Fertig-Markierungen beim Bauen sind pro Platte gespeichert (`"platte:reihe"`), weil nebeneinanderliegende Platten dieselben Rasterzeilen teilen.

## Bekannte Grenzen

- Weiß auf Weiß (Perle vs. heller Hintergrund/Platte) ist farblich nicht unterscheidbar – betrifft Hintergrund-Entfernung und Foto-Check (`unsure`).
- Der Foto-Check wurde bisher nur mit künstlich erzeugten Fotos getestet, nicht mit echten Kamerabildern.
