# Aufbau von svg-studio

Modul-Layout und Datenfluss. Das Warum steht in `docs/internal/decisions.md`, die Regeln im Kern (`AGENTS.md`).

## Schichten

- `src/core/**` ist obsidian-, DOM- und node-frei (`npm run check:pure`). Hier liegt der Fachkern; er rechnet auf dem SVG-**Text**, nicht auf einem DOM.
- `src/main.ts` ist heute ein leeres Plugin-Gerüst. Rendern, Panel und Schreibwege kommen mit Plan 2 (Inkremente 2 bis 5 der Spec).
- `src/vendor/kit/` trägt die Kit-Module aus code-kit 0.52.1 (`svg-guard`, `safe-markdown`, `answer-retry`, `llm-answer`, `think-splitter`, `sha256`, `data-url`, `slug`) und obsidian-kit 0.78.0 (`block-writer`); `src/vendor/kit-obsidian/` die Obsidian-Schicht (`status-indicator`, `choice-modal`, `write-ports`); `tests/vendor/kit/` die Test-Helfer (`kit-css`, `linear-probe`, `window-timers`). Vendort über `tools/sync-kit.sh` (Wrapper auf `tools/kit-sync`) mit Herkunfts-Header, nie von Hand.

## Module in `src/core/`

- `elements.ts` — `scanElements(text)`: linearer Scanner über die Start-Tags mit UTF-16-Offsets je Element und je Attribut (`AttrSpan`), Schlüssel je Element (`#wurzel`, `#style-n`, `#title`/`#desc`, sonst `id`, sonst `@n`), Befunde als `ScanIssue` (`syntax` | `duplicate-id`). `attr(el, name)` liest einen Wert mit aufgelösten Entities.
- `measure.ts` — `measureCanvas(text)`: Bildfläche aus `viewBox` bzw. `width`/`height`, mit Einheit aus `data-unit`. Die Ausdehnung einzelner Elemente (`getBBox()`) misst erst das Panel.
- `changes.ts` — `SvgChange` (`change`, `add`, `remove`, `move`) und `applyChanges(text, changes)`: Spannen-Ersetzungen gegen den Originaltext, alles oder nichts, Round-Trip-Wächter (`roundTripProblems`). Der Vertrag (Anker unbewegt, keine `@n`-Schlüssel, Markup genau ein sauberes Element, Steuerzeichen abgelehnt, TAB/LF/CR als Zeichenreferenz) steht im Kopfkommentar.
- `format.ts` — `assignMissingIds(text)` vergibt fehlende `id`s byte-treu, `ensureUnit(text, unit)` setzt `data-unit` an der Wurzel.

Geplant mit Plan 2: `diff.ts` (zwei SVGs → Änderungsliste per `id`-Paarung, „nicht zerlegbar“ als Ganz-ersetzt-Eintrag), `protocol.ts` (Nachrichten ans Modell, Antwort lesen), `quality.ts` (Messzeile je Modell).

## Messlabor

`scripts/svg-lab.ts` mit `scripts/lab/` (`analyse.ts` Auswertung, `page.ts` und `chrome.ts` Rendern und `getBBox()` in chrome-headless-shell, `prompts.json` die zehn Erzeugen- und acht Verfeinern-Fälle, `system-prompt.md`). Läuft außerhalb des Gates, wird aber typgeprüft (`tsconfig.test.json`). Rohdaten als JSONL unter `tests/fixtures/lab/`, je Modell und Antwortform. Bedienung: `docs/internal/LAB.md`.

## Tests

- `tests/core/*.test.ts` — vitest gegen den Fachkern: Offsets gegen Quelltext, Kommentare, CDATA, Attribute mit `>` in Anführungszeichen; nicht betroffene Bytes gleich, alles oder nichts, Round-Trip; viewBox-Varianten.
- `tests/smoke.test.ts` — das Gerüst lädt gegen den Obsidian-Mock (`tests/__mocks__/obsidian.ts`).
- Ein GUI-Smoke gegen eine Obsidian-Zweitinstanz kommt mit dem Panel (Spec § 11).
