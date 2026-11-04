# Aufbau von svg-studio

Modul-Layout und Datenfluss. Das Warum steht in `docs/internal/decisions.md`, die Regeln im Kern (`AGENTS.md`).

## Schichten

- `src/core/**` ist obsidian-, DOM- und node-frei (`npm run check:pure`). Hier liegt der Fachkern; er rechnet auf dem SVG-**Text**, nicht auf einem DOM.
- `src/main.ts` ist heute ein leeres Plugin-Gerüst. Rendern, Panel und Schreibwege kommen mit Plan 2 (Inkremente 2 bis 5 der Spec).
- `src/vendor/kit/` trägt die Kit-Module aus code-kit 0.52.1 (`svg-guard`, `safe-markdown`, `answer-retry`, `llm-answer`, `think-splitter`, `sha256`, `data-url`, `slug`; `measured-quality`, `fences`, `panel-session`, `rounds`, `run-slot` aus 0.54.0) und obsidian-kit 0.78.0 (`block-writer`); `src/vendor/kit-obsidian/` die Obsidian-Schicht (`status-indicator`, `choice-modal`, `write-ports`); `tests/vendor/kit/` die Test-Helfer (`kit-css`, `linear-probe`, `window-timers`). Vendort über `tools/sync-kit.sh` (Wrapper auf `tools/kit-sync`) mit Herkunfts-Header, nie von Hand.

## Module in `src/core/`

- `elements.ts` — `scanElements(text)`: linearer Scanner über die Start-Tags mit UTF-16-Offsets je Element und je Attribut (`AttrSpan`), Schlüssel je Element (`#wurzel`, `#style-n`, `#title`/`#desc`, sonst `id`, sonst `@n`), Befunde als `ScanIssue` (`syntax` | `duplicate-id`). `attr(el, name)` liest einen Wert mit aufgelösten Entities.
- `measure.ts` — `measureCanvas(text)`: Bildfläche aus `viewBox` bzw. `width`/`height`, mit Einheit aus `data-unit`. Die Ausdehnung einzelner Elemente (`getBBox()`) misst erst das Panel.
- `changes.ts` — `SvgChange` (`change`, `add`, `remove`, `move`) und `applyChanges(text, changes)`: Spannen-Ersetzungen gegen den Originaltext, alles oder nichts, Round-Trip-Wächter (`roundTripProblems`). Der Vertrag (Anker unbewegt, keine `@n`-Schlüssel, Markup genau ein sauberes Element, Steuerzeichen abgelehnt, TAB/LF/CR als Zeichenreferenz) steht im Kopfkommentar. Seit Plan 2 B2: Nachkommen verschobener Elemente gelten am neuen Ort (Besitzer-Regel und „Scheiben“, Stückliste mit Offset-Abbildung statt `mapOffset`), `remove` trägt optional `expect` (kanonische Form), gegenseitiges Ineinanderschieben scheitert.
- `format.ts` — `assignMissingIds(text)` vergibt fehlende `id`s byte-treu, `ensureUnit(text, unit)` setzt `data-unit` an der Wurzel.
- `canon.ts` — kanonische Form eines Dokuments oder Elements (`buildCanonTree`, `canonNode`, `canonDocument`, `normalizeValue`): Attribute sortiert, Leerraum und Kommentare egal, eigener Text je Element mit seiner Stelle zwischen den Kindern; doppelte ids erlaubt (Index statt Schlüssel). Verbraucher: `remove.expect` in `changes.ts`, später `diff.ts`.
- `diff.ts` — `diffSvg(ausgang, antwort)`: Paarung über den Schlüssel, Einträge je Änderung (`attr`, `add`, `remove`, `move`, `replace` mit Grund `text`/`style`/`moved-and-text`/`wrap`/`unwrap`), jeder mit eigener Änderungsliste; am Ende werden alle Einträge angewendet und kanonisch mit der Antwort verglichen (Vollständigkeitsprüfung, sonst „nicht zerlegbar“ mit Grund). `changesFor(einträge, angenommene)` bildet die Liste der angenommenen. Das Messlabor nutzt dieselbe Funktion (`scripts/lab/analyse.ts`).
- `protocol.ts` — die Prompts der Messung wortgleich (`CREATE_SYSTEM`, `REFINE_SYSTEM`; Test gegen `scripts/lab/system-prompt.md`), `RETRY_INSTRUCTION` (ungemessen), Nachrichten (`buildCreateMessages`, `buildRefineMessages`, `buildRepairMessages`), `promptFingerprint` (Kit `measured-quality`), Antwortleser `extractSvg` (Denken weg, Denkkanal von Gemma, `<svg` bis letztes `</svg>`) und die Prüfer `validateCreate`, `validateRefine`, `validateRepair` für `askUntilValid`. Der Bereiniger kommt als Funktion herein (`GuardFn`); der Kern kennt kein DOM.
- `quality.ts` — die vier Messzeilen (Erzeugen und Verfeinern, qwen3.8-27b und gemma-4-e4b; Zahlen nach der Korrektur der Auswertung 2026-11-04) und `svgQualityLine`/`svgFailureHint` auf dem Kit-Baustein `measured-quality`; jede Zeile trägt den Prompt-Fingerabdruck aus `protocol.ts`, `quality.test.ts` leitet die Zahlen aus `tests/fixtures/lab/auswertung-2026-11-02.json` ab.
- `session.ts` — Rundenmodell (Spec § 6.3) auf Kit `panel-session` und `rounds`: `SvgRound` (`art`, `instruction`, `basedOn`, `body` als Liste mit Entscheidungen, ganzes Bild oder Regel, `result`), `addRound`, `addHandChange` (Handänderungen sammeln sich in einer Runde), `decide` (gesperrt bei Nachfolger), `acceptText` (angenommene Einträge aller Runden bis zur aktiven auf den Text von JETZT; ein seither geändertes Element oder Attribut bricht ab), `refineBaseText`, `canRefine`, `feedbackOf`.
- `editor-metadata.ts` — `stripEditorMetadata(text)`: Änderungsliste, die `sodipodi:`/`inkscape:`-Elemente und -Attribute, ein `metadata` mit RDF und ungebrauchte `xmlns:`-Deklarationen entfernt (E4 a); Elemente ohne id → „erst Namen vergeben“.

Geplant mit Plan 2: `fields.ts` (Zahlenfelder).

## Messlabor

`scripts/svg-lab.ts` mit `scripts/lab/` (`analyse.ts` Auswertung, `page.ts` und `chrome.ts` Rendern und `getBBox()` in chrome-headless-shell, `prompts.json` die zehn Erzeugen- und acht Verfeinern-Fälle, `system-prompt.md`). Läuft außerhalb des Gates, wird aber typgeprüft (`tsconfig.test.json`). Rohdaten als JSONL unter `tests/fixtures/lab/`, je Modell und Antwortform. Bedienung: `docs/internal/LAB.md`.

## Tests

- `tests/core/*.test.ts` — vitest gegen den Fachkern: Offsets gegen Quelltext, Kommentare, CDATA, Attribute mit `>` in Anführungszeichen; nicht betroffene Bytes gleich, alles oder nichts, Round-Trip; viewBox-Varianten.
- `tests/smoke.test.ts` — das Gerüst lädt gegen den Obsidian-Mock (`tests/__mocks__/obsidian.ts`).
- Ein GUI-Smoke gegen eine Obsidian-Zweitinstanz kommt mit dem Panel (Spec § 11).
