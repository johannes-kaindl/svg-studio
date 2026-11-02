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
- Das Rendern für die Maßtreue läuft in chrome-headless-shell aus dem Playwright-Cache (`getBBox()`; happy-dom kann das nicht).

## Stand der Messung

Gemessen am 2026-11-02: qwen3.8-27b@4bit und gemma-4-e4b, Rohdaten unter `tests/fixtures/lab/`. Ergebnis und Vorbehalte (n = 1 je Fall, Grundriss-Prompts geben Namen vor) stehen in der Messnote im Cockpit, `_SDD/2026-11-02-svg-studio-messung.md`.
