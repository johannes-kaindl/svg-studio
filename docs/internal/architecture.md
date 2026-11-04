# Aufbau von svg-studio

Modul-Layout und Datenfluss. Das Warum steht in `docs/internal/decisions.md`, die Regeln im Kern (`AGENTS.md`).

## Schichten

- `src/core/**` ist obsidian-, DOM- und node-frei (`npm run check:pure`). Hier liegt der Fachkern; er rechnet auf dem SVG-**Text**, nicht auf einem DOM.
- `src/main.ts` verdrahtet Befehle, den ```svg-studio-Block, die Einbettungsknöpfe, das Kontextmenü und die Einstellungen; das Panel hat Gerüst, Modellzeile und Lauf mit Rückfrage (C2); Vorschau im Shadow Root, Übernehmen und Prüfliste folgen mit C3, C4, D1.
- `src/vendor/kit/` trägt die Kit-Module aus code-kit 0.52.1 (`svg-guard`, `safe-markdown`, `answer-retry`, `llm-answer`, `think-splitter`, `sha256`, `data-url`, `slug`; `fences`, `panel-session`, `rounds`, `run-slot` aus 0.54.0, `measured-quality` aus 0.55.0) und obsidian-kit 0.79.1 (`block-writer`, `fence-scan`, `plugin-id`); `src/vendor/kit-obsidian/` die Obsidian-Schicht (`status-indicator`, `choice-modal`, `write-ports`, `help-setting`, `settings_walker`, `confirm`, `segmented-control`, `panel-accept`, `review-list`, `redline`, `file-snapshot`; seit C2 `llm-connection` samt Hülle, `model-bar`, `thinking-control`, `stream-area`, `version-list`, `request-section`, `chat-host`; die code-kit-Teile der Verbindung mit eigenem Pin 0.55.0); `tests/vendor/kit/` die Test-Helfer (`kit-css`, `linear-probe`, `window-timers`). Vendort über `tools/sync-kit.sh` (Wrapper auf `tools/kit-sync`) mit Herkunfts-Header, nie von Hand.

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

## Obsidian-Schicht `src/obsidian/`

- `render-block.ts` — `renderSvgBlock`: Block als `<img>` mit Data-URL nach `checkSvg`; abgelehnt → Liste der Probleme und Knöpfe Reparieren/Bearbeiten; nie Markup aus dem Quelltext im DOM. `VIEW_TYPE_SVG_STUDIO`.
- `embed-button.ts` — Knopf an `.internal-embed.image-embed` mit `.svg`-Ziel; ein Beobachter je Fenster (`window-open`/`window-close`), Rücknahme beim Entladen.
- `entry.ts` — `targetFromContext` (aktive `.svg`, Block oder Einbettung am Cursor im Quellmodus), `registerFileMenu`.
- `settings-tab.ts` — zweigleisig deklarativ (Hilfe-Zeile zuerst, dann „Übernehmen als“, dann der Abschnitt „Sprachmodell“ der Kit-Verbindung).
- `llm-ask.ts` — `askFor`: die Brücke von `LlmConnection.complete` zu `askUntilValid` (wirft `LlmAskError` mit Art `aborted`/`no-endpoint`/`error`). K5 passt nicht (auf `RepairResult` zugeschnitten), deshalb hier.
- `read-target.ts` — der Text des Ziels jetzt (Datei über den Vault, Block über `readBlockText` mit Fingerabdruck).
- `panel/shell.ts` — der **formatneutrale** Panel-Kern (K9-Nähte, ein Test hält ihn frei von `core/`-Importen): Kopf mit Zielzeile, Kit-Modellzeile (`model-bar` mit Denkstufe), Messzeile, Prompt, Kit-Antwortbereich (`stream-area`) mit Status (`status-indicator`) und Abbruch, Vorschau- und Änderungsplatz, Rundenliste (`version-list`), Übernehmen/Verwerfen; hält die `PanelSession` und den Lauf (`run-slot`: genau ein Lauf, Senden gesperrt). Alles Formatgebundene kommt als `PanelSlots` herein.
- `panel/slots.ts` — die SVG-Slots (Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau als `<img>`; die Prüfliste ist ein Platzhalter bis D1). `panel/run.ts` — der Lauf: Erzeugen und Verfeinern mit `askUntilValid` (`maxRetries: 2`, `stopOnTruncated: true`, `RETRY_INSTRUCTION`), abgeschnitten und ungültig = genau eine Anfrage und die Meldung „zu groß“, Elemente ohne `id` = keine Anfrage. `panel/view.ts` — die `ItemView`; ein Schließen mit offenen Runden fragt per Bestätigung, „Behalten“ merkt die Sitzung im Plugin (Obsidian lässt das Schließen eines Blatts nicht verhindern).
- Die LLM-Anbindung (`createLlmConnection`, Modus `transform`, `max_tokens` 16384) wird in `main.ts` gebaut; die Daten (`settings.llm`: lokale Endpunkt-Zeilen, Wahl, Anfrage-Einstellungen) liest `core/settings.ts` mit den Kit-Prüfern.

## Messlabor

`scripts/svg-lab.ts` mit `scripts/lab/` (`analyse.ts` Auswertung, `page.ts` und `chrome.ts` Rendern und `getBBox()` in chrome-headless-shell, `prompts.json` die zehn Erzeugen- und acht Verfeinern-Fälle, `system-prompt.md`). Läuft außerhalb des Gates, wird aber typgeprüft (`tsconfig.test.json`). Rohdaten als JSONL unter `tests/fixtures/lab/`, je Modell und Antwortform. Bedienung: `docs/internal/LAB.md`.

## Tests

- `tests/core/*.test.ts` — vitest gegen den Fachkern: Offsets gegen Quelltext, Kommentare, CDATA, Attribute mit `>` in Anführungszeichen; nicht betroffene Bytes gleich, alles oder nichts, Round-Trip; viewBox-Varianten.
- `tests/smoke.test.ts` — das Gerüst lädt gegen den Obsidian-Mock (`tests/__mocks__/obsidian.ts`).
- Ein GUI-Smoke gegen eine Obsidian-Zweitinstanz kommt mit dem Panel (Spec § 11).
