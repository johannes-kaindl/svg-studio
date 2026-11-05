# AGENTS — svg-studio

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

Obsidian-Plugin `svg-studio` („SVG Studio“) von Johannes Kaindl, nicht veröffentlicht. Der Nutzer beschreibt ein Icon, Logo, Schema oder einen Grundriss in Worten und bekommt ein echtes, exaktes SVG in seine Notiz; danach verbessert er es in Runden, per Prompt oder an einzelnen Zahlen, und nimmt jede Änderung eines Elements einzeln an oder lehnt sie ab. Die 2D-Schwester von `3d-codeblocks`. Endpunkte und Modelle kommen über das Kit (`llm-endpoint-manager`), das Plugin trägt keine eigenen Schlüssel.

Stand 2026-11-05: Version 1 ist gebaut, aber nicht veröffentlicht (Plan 1 und Plan 2 abgeschlossen: Fachkern, Diff, Protokoll, Rendern als Bild, Panel mit Modellzeile, Lauf mit Rückfrage, Prüfliste, Zahlenfelder, Übernehmen als Datei und Block, Reparatur am Bestand; GUI-Smoke gegen eine Zweitinstanz grün). Das erste Release braucht Johannes' ausdrückliche Freigabe (E6). Spec, Pläne, Messnote und Tasks liegen im Coding-Cockpit des Maintainers unter `25_Coding/svg-studio/` (vault-relativ, maintainer-lokal, `$CODING_COCKPIT_VAULT`).

## Architecture principles

- **Echtes SVG ist die Quelle**, keine eigene 2D-Sprache (Spec Nr. 1, durch die Messung bestätigt). Jedes Element unter der Wurzel trägt eine `id`; Diff, Zahlenfelder und die spätere 3D-Übergabe hängen daran.
- **Byte-treu ändern:** Änderungen sind Spannen-Ersetzungen gegen den **aktuellen** Text, alles oder nichts, mit Round-Trip-Wächter. Was nicht betroffen ist, bleibt Byte für Byte gleich; eine Handänderung geht nie verloren.
- **Fremdes SVG nur geprüft in den DOM:** Der Bereiniger `svg-guard` (code-kit) lehnt ab statt zu entfernen. Bei Erfolg liefert er den geprüften Baum (`{ ok: true, svg }`); im Panel (Vorschau, Zahlenfelder) wird **genau dieser Baum** per `importNode`/`adoptNode` in einen Shadow Root eingefügt, nie der Text per `innerHTML` (Parser-Differenz HTML gegen XML). Der Block und die Einbettung in der Notiz zeigen das geprüfte SVG dagegen als `<img class="svg-studio-img">` mit Data-URL (`render-block.ts`), ohne Shadow Root.
- **Pure-Core-Trennung:** `src/core/` bleibt Obsidian-, DOM- und node-frei (`npm run check:pure`).
- **Bibliothek ab Eins (Kit-first):** Wiederverwendbares liegt von Anfang an in `obsidian-kit` bzw. `code-kit`; eine neue reine Funktion ohne plugin-eigenen Typ geht durchs Bibliothek-Gate des Dachs.
- Aufbau und Warum: `docs/internal/architecture.md`, `docs/internal/decisions.md`.

## Commands

```bash
npm run gate       # lint + typecheck + typecheck:test + typecheck:scripts (ohne ../tools übersprungen) + test + check:pure + check:bundle
npm test           # Pfad-Guard + NUL-Guard + vitest run
npm run lint       # eslint src (0 Warnungen erlaubt)
npm run dev        # esbuild im Watch-/Dev-Modus
npm run build      # Typecheck + Production-Bundle
npm run deploy     # build + Kopie nach $OBSIDIAN_PLUGIN_DIR
npm run lab -- --status          # Messlabor (außerhalb des Gates), siehe docs/internal/LAB.md
npm run smoke:gui -- --port 9660 [--nur <punkt,…>] [--bilder <ordner>]   # GUI-Smoke gegen eine Zweitinstanz (Stub statt Modell), Aufruf in einem Zug: Kopf von scripts/gui-smoke.ts (messlauf.sh des Dachs)
sh tools/sync-kit.sh [--check]   # Kit vendoren bzw. Drift messen
```

Release-Infra steht (`release.yml`, `versions.json`, Remote `github` privat; `npm run release` und `npm run preflight` brauchen das Dach, GitHub bekommt Branch und Tag nur über `release.mjs`); das erste Release fährt der Master mit Johannes' Freigabe. README-Bilder: `npm run shots` (Zweitinstanz, Vertrag `docs/images/README.md`), `npm run shots:check` prüft sie. `npm run deploy` kopiert den Build nach `$OBSIDIAN_PLUGIN_DIR` (für Messungen am Gerät).

## Conventions

- Conventional Commits, deutsche Beschreibung erlaubt. Nur berührte Dateien stagen, per Pathspec.
- Ein Test mit DOM setzt `// @vitest-environment happy-dom` in die Kopfzeile. happy-dom parst anders als Chromium: für Sicherheits- und Parserfragen zählt der Lauf im echten Chromium (code-kit `npm run check:svg-guard-chromium`).
- **`src/vendor/` ist ein Verbatim-Snapshot** aus `code-kit` (heute `svg-guard`, `safe-markdown`, `i18n`, `answer-retry`, `llm-answer`, `think-splitter`, `sha256`, `data-url`, `slug`, Pin 0.59.0; `fences`, `panel-session`, `rounds`, `run-slot` mit eigenem Pin 0.54.0, `measured-quality` 0.55.0) und `obsidian-kit` (heute `block-writer`, `fence-scan`, `plugin-id`, `status-indicator`, `choice-modal`, `write-ports`, `help-setting`, `settings_walker`, `folder-suggest`, `confirm`, `segmented-control`, `panel-accept`, `review-list`, `redline`, `file-snapshot`, Pin 0.80.1; Test-Helfer unter `tests/vendor/kit`) — nie von Hand editieren, sondern `sh tools/sync-kit.sh` fahren (Quellen, Pins und Zielordner in `tools/kit-sync.json`). Bricht ein Kit-Modul hier, gehört der Fix ins Kit.
- Vor einer neuen Hilfsfunktion `../REGISTRY.md` und `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>` prüfen.
- Specs, Pläne, Messnoten und Task-Reports gehören ins Cockpit (`25_Coding/svg-studio/_SDD/`), nicht ins Repo (CORE-META-14).

## Gotchas

- **Schlüssel in einer Änderungsliste beziehen sich auf den Ausgangstext.** Ein in derselben Liste hinzugefügtes oder verschobenes Element ist kein Anker; `@n`-Schlüssel nimmt `applyChanges` nicht an (erst `assignMissingIds`). `change`, `add`, `remove` und `move` auf Nachfahren eines verschobenen Elements gelten am neuen Ort (Scheiben, seit Plan 2 B2); `remove` von `#style-n`, `#title`, `#desc` braucht `expect` (kanonische Form). Vertrag im Kopfkommentar von `src/core/changes.ts`.
- **svg-guard lehnt ab, was Modelle gelegentlich schreiben:** CSS-Kommentare `/*` in `<style>`, `<a>`, `<image>`, Inkscape-Namensräume (`sodipodi:`, `inkscape:`), jeden Backslash in Attributen oder CSS. Das ist Kit-Vertrag, kein Fehler im Plugin.
- **Der Kostenwert des Bereinigers ist eine Schätzung, kein Schutz (code-kit 0.58.0, Befundfelder `kind`/`cost`/`limit` seit 0.59.0):** `checkSvg` lehnt Teures als `too-costly` ab und liefert `cost`; Block, Panel-Vorschau und Vergleichszellen ab `CLICK_COST` (250 000, Viertel der Grenze) zeichnen erst nach einem Klick (Freigabe je Text im Wächter, geteilt), die Absturzmarke bleibt die Absicherung; das Kit-Raster ruckelt eher, als dass es Obsidian einfriert (decisions.md). Ein führendes BOM schneidet der Bereiniger ab (`bom: true`): gezeichnet wird der Text ohne BOM, `acceptText` stellt es beim Schreiben wieder voran. Herkunft der Schwelle und die Entscheidungen: `docs/internal/decisions.md`.
- **Gemma antwortet „Entwurf, `<channel|>`, Antwort“** (Denkkanal im `content`); der Leser des Plugins (`protocol.ts` `extractSvg`, Kit `stripThinkBlocks` mit `channel: true`, Rückfall auf den Text davor) nimmt die Antwort, der Labor-Leser früher den Entwurf. Messzeile und Messnote gelten für den Leser des Plugins.
- **Ein Schreibweg läuft immer über `acceptText` → `acceptPanel` → `checkWrite`:** die Runde wird gegen den Text von JETZT angewendet; eine Runde „ganzes Bild“ oder „Namen vergeben“ mit Folgerunde greift nur, wenn der Text noch ihr Ausgang ist (sonst Abbruch, nichts geschrieben). Vorschau und Felder rendern nur den geprüften Baum (`importNode` in einen Shadow Root mit `contain: paint`-Wrapper).
- **Das Panel-Bundle trägt die LLM-Verbindung des Kits:** `check-bundle` mit Schranke 400 KB (angehoben 2026-11-05).
- **Das Gate im Dach ist nicht das Gate der CI.** GitHub klont ohne Dach (kein `../tools`): alles unter `scripts/`, das `../../tools/obsidian-cdp` importiert, gehört nicht in `typecheck:test`, sondern in `typecheck:scripts` (Existenz-Guard). Vor einem Release die CI nachstellen: `git clone` in ein Verzeichnis außerhalb des Dachs, dort `npm ci && npm run gate`; der Dry-Run sieht das nicht (0.1.0 trug deshalb keinen GitHub-Release, 2026-11-05).
- **Messlabor lädt große lokale Modelle:** vorher Netzteil und Last prüfen und Johannes fragen, Modell per `lms load` mit festem Kontext laden (nicht per JIT), danach sofort entladen. Details `docs/internal/LAB.md`.
- Nie im Repo: absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen (`$CODING_COCKPIT_VAULT`, repo-relativ). Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Context index

- Vor jeder Änderung am Verhalten: die Spec im Cockpit (Note „2026-11-02-svg-studio-design“ in _SDD), besonders § 3 „Was nicht passieren darf“ und § 5 „Der SVG-Vertrag“.
- Vor Arbeit am Panel, an Prompts oder an der Messzeile: die Messnote (Note „2026-11-02-svg-studio-messung“ in _SDD, mit dem Abschnitt „Korrektur der Auswertung 2026-11-04“) und der Plan 2 (Note „2026-11-03-svg-studio-plan-2-diff-protokoll-rendern-panel“ in _SDD); offene Reste: die Cockpit-Tasks „Reste aus Plan 2 …“ und „Befunde aus Plan 2 …“ in `_Tasks/`.
- Vor Änderungen an Modul-Layout oder Datenfluss: `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung (echtes SVG, Antwortform, Codeblock-Sprache, Ablage, Bereiniger lehnt ab) übernimmst: `docs/internal/decisions.md`.
- Vor einem Messlauf mit lokalen Modellen: `docs/internal/LAB.md`.
- Vor UI-Arbeit: `../UI-STANDARD.md` und `../.claude/rules/ui-bausteine.md`.
- Vor einem Release: `../.claude/rules/release-und-store.md`, Skill `plugin-release-setup`.
- Dach-Kontext: `../AGENTS.md` (Kit-first-Regel), `../REGISTRY.md`, `../KIT-MATRIX.md`.

## Memory

Projekt-Memory unter `~/.claude/projects/<slug>/memory/` mit `MEMORY.md`-Index. Lesestoff für Johannes gehört ins Cockpit (`25_Coding/svg-studio/`), nicht ins Memory.

## Abweichungen von der Leitkonvention

- CORE-META-11 (Uplink-Seite): offen, Vorschlag liegt beim Master (Dach/Website); die Seite entsteht nach dem ersten Release.
