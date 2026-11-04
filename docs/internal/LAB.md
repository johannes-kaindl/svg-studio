# Messlabor — lokale Modelle messen

`scripts/svg-lab.ts` misst, ob ein lokales Modell brauchbare SVGs schreibt (Spec § 10). Es läuft außerhalb des Gates und lädt selbst kein Modell; es fragt nur, was der Endpunkt gerade bedient.

## Vor dem Lauf

1. **Netzteil und Last prüfen und Johannes fragen.** Ein 27B-Modell zieht viel Strom; der Rechner hängt an einem schwachen Netzteil.
2. **Modell mit festem Kontext laden, nicht per JIT.** In LM Studio zum Beispiel:

   ```bash
   lms load qwen/qwen3.8-27b --context-length 65536 --identifier qwen/qwen3.8-27b@4bit -y
   ```

   Andere Sessions können denselben Server nutzen: vorher fragen, ob er frei ist.
3. Nach dem Lauf das Modell sofort entladen (`lms unload <identifier>`) und das Ende den anderen Sessions melden.

## Befehle

```bash
npm run lab -- --endpoint http://localhost:1234/v1 --model <id> [--phase erzeugen|verfeinern|alles] [--nur E8,V3]
npm run lab -- --auswerten [--json] [--dir <ordner mit *.jsonl>]
npm run lab -- --status
```

- Jeder Fall läuft **strikt nacheinander**, nicht streamend; eine Anfrage wird nie vor 15 Minuten abgebrochen.
- Wiederaufnahme: Schon vorhandene Fälle (Modell, Fall, Antwortform) werden übersprungen. Ein Transportfehler beendet den Lauf ohne Zeile: erst nachsehen, ob der Endpunkt lebt, dann neu starten.
- Vorgabe ist `reasoning_effort: none` (Denken aus, Produktmodus `transform`, Temperatur 0,2). `--effort <x>` überschreibt, `--effort weglassen` sendet das Feld nicht. Mit Denken dauert ein Fall rund 50-mal so lang.
- Das Rendern für die Maßtreue läuft in chrome-headless-shell aus dem Playwright-Cache (`getBBox()`; happy-dom kann das nicht). Die Maße misst dieselbe Funktion wie das Panel (`src/obsidian/panel/bbox.ts`).

## Fan-out-Messung (Rendern, kein Modell)

`scripts/lab/fanout.ts` fragt, ob es SVGs unter 1 MB gibt, die der Bereiniger annimmt und die sich trotzdem sehr lange rendern (marker- und `feImage`-Verweise zählt er nicht). Es lädt kein Modell, nur chrome-headless-shell (Playwright-Cache) über das DevTools-Protokoll.

```bash
npx vite-node scripts/lab/fanout.ts -- [--runs 5] [--nur a,b,b2,b4,b8,c,c2] [--json] [--shots <ordner>]
```

- Fälle: (a) `polyline` mit 50 000 Punkten und `marker-mid` auf einen `marker` mit 200 Elementen, (b) `feImage`-Kette über `href="#g"` in zehn Stufen (b2, b4, b8: 2, 4, 8 `feImage` je Stufe), (c) verschachtelte `pattern`-Füllungen (c2: vier Flächen je Kachel), dazu ein Kreis als Grundlinie.
- Je Fall: besteht `checkSvg` im echten Chromium, und die Renderzeit (Einfügen bis Ende von `Page.captureScreenshot`, Grundlinie abgezogen, Median) als `<img>` mit Data-URL und als DOM im Shadow Root (die echte `buildPreview`, dazu die Zeit von `boxOf(null)`). Ein Lauf über 5 s beendet die Reihe, ein Aufruf über 120 s gilt als Zeitüberschreitung.
- Dazu die Isolationsprobe im echten Chromium: `<style>* { color: red }</style>` im Shadow Root ändert die Farbe außerhalb nicht.
- Fehlt chrome-headless-shell, steht „NICHTS GEMESSEN“ da. Ein Fall über 1 000 ms, den `checkSvg` annimmt, ist ein Befund für den Bereiniger (Task im code-kit-Cockpit), kein Umweg im Plugin.

## Proben der Vorschau im echten Chromium (kein Modell)

Zwei Skripte prüfen, was happy-dom nicht kann. Beide laufen in chrome-headless-shell über `scripts/lab/cdp.ts`, mit den echten Modulen der Vorschau, enden mit Exit-Code 1 bei einer Abweichung und melden „NICHTS GEMESSEN“, wenn der Browser fehlt.

```bash
npx vite-node scripts/lab/isolation.ts       # Angriffe aus dem SVG auf das Panel, Vererbung von Obsidians Stilen
npx vite-node scripts/lab/measure-probe.ts   # Maße (verschachteltes svg, display:none, symbol, rotiert, defs/use, viewBox, CSS-Transform), Laufzeit, verborgenes Panel
```

- `isolation.ts`: `position: absolute` und `fixed` an der Wurzel, `:host { position: fixed !important; contain: none !important }` und `:host { transform }` legen sich über Knopf und Maßzeile, wenn der Wrapper fehlt (Gegenprobe im selben Lauf); mit dem Wrapper (`contain: paint`) bleiben `elementFromPoint` und die Pixel unberührt. Dazu: Schrift und Farbe der Seite erben nicht ins Bild.
- `measure-probe.ts`: Soll und Ist je Fall; die Zahlen von Hand gerechnet.

## Stand der Messung

Gemessen am 2026-11-02: qwen3.8-27b@4bit und gemma-4-e4b, Rohdaten unter `tests/fixtures/lab/`. Ergebnis und Vorbehalte (n = 1 je Fall, Grundriss-Prompts geben Namen vor) stehen in der Messnote im Cockpit, `_SDD/2026-11-02-svg-studio-messung.md`.
