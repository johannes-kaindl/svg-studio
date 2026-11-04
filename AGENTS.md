# AGENTS — svg-studio

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

Obsidian-Plugin `svg-studio` („SVG Studio“) von Johannes Kaindl, nicht veröffentlicht. Der Nutzer beschreibt ein Icon, Logo, Schema oder einen Grundriss in Worten und bekommt ein echtes, exaktes SVG in seine Notiz; danach verbessert er es in Runden, per Prompt oder an einzelnen Zahlen, und nimmt jede Änderung eines Elements einzeln an oder lehnt sie ab. Die 2D-Schwester von `3d-codeblocks`. Endpunkte und Modelle kommen über das Kit (`llm-endpoint-manager`), das Plugin trägt keine eigenen Schlüssel.

Stand 2026-11-02: Plan 1 ist abgeschlossen (Fachkern pure in `src/core/`, Messung lokaler Modelle). Das Plugin selbst ist noch ein Gerüst (`src/main.ts` lädt nichts). Plan 2 (Diff, Protokoll, Rendern, Panel) ist für Welle 30 eingeplant. Spec, Pläne, Messnote und Tasks liegen im Coding-Cockpit des Maintainers unter `25_Coding/svg-studio/` (vault-relativ, maintainer-lokal, `$CODING_COCKPIT_VAULT`).

## Architecture principles

- **Echtes SVG ist die Quelle**, keine eigene 2D-Sprache (Spec Nr. 1, durch die Messung bestätigt). Jedes Element unter der Wurzel trägt eine `id`; Diff, Zahlenfelder und die spätere 3D-Übergabe hängen daran.
- **Byte-treu ändern:** Änderungen sind Spannen-Ersetzungen gegen den **aktuellen** Text, alles oder nichts, mit Round-Trip-Wächter. Was nicht betroffen ist, bleibt Byte für Byte gleich; eine Handänderung geht nie verloren.
- **Fremdes SVG nur geprüft in den DOM:** Der Bereiniger `svg-guard` (code-kit) lehnt ab statt zu entfernen. Bei Erfolg liefert er den geprüften Baum (`{ ok: true, svg }`); eingefügt wird **genau dieser Baum** per `importNode`/`adoptNode`, nie der Text per `innerHTML` (Parser-Differenz HTML gegen XML).
- **Pure-Core-Trennung:** `src/core/` bleibt Obsidian-, DOM- und node-frei (`npm run check:pure`).
- **Bibliothek ab Eins (Kit-first):** Wiederverwendbares liegt von Anfang an in `obsidian-kit` bzw. `code-kit`; eine neue reine Funktion ohne plugin-eigenen Typ geht durchs Bibliothek-Gate des Dachs.
- Aufbau und Warum: `docs/internal/architecture.md`, `docs/internal/decisions.md`.

## Commands

```bash
npm run gate       # lint + typecheck + typecheck:test + test + check:pure + check:bundle
npm test           # Pfad-Guard + NUL-Guard + vitest run
npm run lint       # eslint src (0 Warnungen erlaubt)
npm run dev        # esbuild im Watch-/Dev-Modus
npm run build      # Typecheck + Production-Bundle
npm run deploy     # build + Kopie nach $OBSIDIAN_PLUGIN_DIR
npm run lab -- --status          # Messlabor (außerhalb des Gates), siehe docs/internal/LAB.md
sh tools/sync-kit.sh [--check]   # Kit vendoren bzw. Drift messen
```

Release-Infra und GitHub-Mirror kommen erst mit dem ersten Release (Skill `plugin-release-setup`, `npm run release` braucht das Dach).

## Conventions

- Conventional Commits, deutsche Beschreibung erlaubt. Nur berührte Dateien stagen, per Pathspec.
- Ein Test mit DOM setzt `// @vitest-environment happy-dom` in die Kopfzeile. happy-dom parst anders als Chromium: für Sicherheits- und Parserfragen zählt der Lauf im echten Chromium (code-kit `npm run check:svg-guard-chromium`).
- **`src/vendor/` ist ein Verbatim-Snapshot** aus `code-kit` (heute `svg-guard`, `safe-markdown`, `answer-retry`, `llm-answer`, `think-splitter`, `sha256`, `data-url`, `slug`, Pin 0.52.1) und `obsidian-kit` (heute `block-writer`, `status-indicator`, `choice-modal`, `write-ports`, Pin 0.78.0; Test-Helfer unter `tests/vendor/kit`) — nie von Hand editieren, sondern `sh tools/sync-kit.sh` fahren (Quellen, Pins und Zielordner in `tools/kit-sync.json`). Bricht ein Kit-Modul hier, gehört der Fix ins Kit.
- Vor einer neuen Hilfsfunktion `../REGISTRY.md` und `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>` prüfen.
- Specs, Pläne, Messnoten und Task-Reports gehören ins Cockpit (`25_Coding/svg-studio/_SDD/`), nicht ins Repo (CORE-META-14).

## Gotchas

- **Schlüssel in einer Änderungsliste beziehen sich auf den Ausgangstext.** Ein in derselben Liste hinzugefügtes oder verschobenes Element ist kein Anker; `@n`-Schlüssel nimmt `applyChanges` nicht an (erst `assignMissingIds`). `change`, `add`, `remove` und `move` auf Nachfahren eines verschobenen Elements gelten am neuen Ort (Scheiben, seit Plan 2 B2); `remove` von `#style-n`, `#title`, `#desc` braucht `expect` (kanonische Form). Vertrag im Kopfkommentar von `src/core/changes.ts`.
- **svg-guard lehnt ab, was Modelle gelegentlich schreiben:** CSS-Kommentare `/*` in `<style>`, `<a>`, `<image>`, Inkscape-Namensräume (`sodipodi:`, `inkscape:`), jeden Backslash in Attributen oder CSS. Das ist Kit-Vertrag, kein Fehler im Plugin.
- **Messlabor lädt große lokale Modelle:** vorher Netzteil und Last prüfen und Johannes fragen, Modell per `lms load` mit festem Kontext laden (nicht per JIT), danach sofort entladen. Details `docs/internal/LAB.md`.
- Nie im Repo: absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen (`$CODING_COCKPIT_VAULT`, repo-relativ). Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Context index

- Vor jeder Änderung am Verhalten: die Spec im Cockpit (Note „2026-11-02-svg-studio-design“ in _SDD), besonders § 3 „Was nicht passieren darf“ und § 5 „Der SVG-Vertrag“.
- Vor Arbeit an Plan 2 oder dem Panel: Cockpit-Task „Plan 2 schreiben — Diff, Protokoll, Rendern, Panel“ (alle Eingänge aus Plan 1) und die Messnote (Note „2026-11-02-svg-studio-messung“ in _SDD).
- Vor Änderungen an Modul-Layout oder Datenfluss: `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung (echtes SVG, Antwortform, Codeblock-Sprache, Ablage, Bereiniger lehnt ab) übernimmst: `docs/internal/decisions.md`.
- Vor einem Messlauf mit lokalen Modellen: `docs/internal/LAB.md`.
- Vor UI-Arbeit: `../UI-STANDARD.md` und `../.claude/rules/ui-bausteine.md`.
- Vor einem Release: `../.claude/rules/release-und-store.md`, Skill `plugin-release-setup`.
- Dach-Kontext: `../AGENTS.md` (Kit-first-Regel), `../REGISTRY.md`, `../KIT-MATRIX.md`.

## Memory

Projekt-Memory unter `~/.claude/projects/<slug>/memory/` mit `MEMORY.md`-Index. Lesestoff für Johannes gehört ins Cockpit (`25_Coding/svg-studio/`), nicht ins Memory.

## Abweichungen von der Leitkonvention

- CORE-META-03/04 (Bilder, Nutzer-Doku nach Diátaxis) und CORE-META-11 (Uplink-Seite): offen bis zum ersten Release; das Plugin hat noch keine Oberfläche.
