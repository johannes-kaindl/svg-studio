# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

Obsidian-Plugin `svg-studio` („SVG Studio") von Johannes Kaindl, Stand: gerade angelegt, nicht veröffentlicht. Der Nutzer beschreibt ein Icon, Logo, Schema oder einen Grundriss in Worten und bekommt ein echtes, exaktes SVG in seine Notiz; danach verbessert er es in Runden (Prompt oder Zahlenfelder, Element-Diff mit Annehmen/Ablehnen). Die 2D-Schwester von `3d-codeblocks`; Endpunkte und Modelle kommen vom Kit (`llm-endpoint-manager`), das Plugin trägt keine eigenen Schlüssel. Die Spec liegt im Coding-Cockpit des Maintainers: `25_Coding/svg-studio/_SDD/2026-11-02-svg-studio-design.md` (vault-relativ, maintainer-lokal); der Bauplan daneben als `…-plan-1-vorlauf-und-fachkern.md`.

## Commands

```bash
npm run dev        # esbuild im Watch-/Dev-Modus
npm run build      # Typecheck + Production-Bundle
npm test           # Pfad-Guard + NUL-Guard + vitest run
npm run lint       # eslint src (0 Warnungen erlaubt)
npm run gate       # lint + typecheck(+test) + test + check:pure + check:bundle
npm run deploy     # build + Kopie nach $OBSIDIAN_PLUGIN_DIR
npm run release    # Release via ../tools/release/ (braucht das Dach-Verzeichnis)
sh tools/sync-kit.sh [--check]   # Kit vendoren bzw. Drift messen
```

## Conventions

- Conventional Commits, deutsche Beschreibung erlaubt. Nur berührte Dateien stagen.
- Pure-Core-Trennung: `src/core/` bleibt Obsidian-frei (`npm run check:pure` erzwingt das); Tests mit vitest. Ein Test mit DOM setzt `// @vitest-environment happy-dom` in die Kopfzeile.
- **Bibliothek ab Eins (Kit-first):** Wiederverwendbares liegt von Anfang an in `obsidian-kit` bzw. `code-kit`. Der SVG-Bereiniger (`svg-guard`) kommt aus code-kit, nicht aus einer Plugin-Kopie. Vor einer neuen Hilfsfunktion `../REGISTRY.md` und `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>` prüfen.
- **`src/vendor/` ist ein Verbatim-Snapshot aus `obsidian-kit` und `code-kit`** — nie von Hand editieren, sondern `sh tools/sync-kit.sh` fahren (Wrapper auf `../tools/kit-sync/kit-sync.mjs`; Quellen, Pins und Zielordner stehen in `tools/kit-sync.json`). Bricht ein Kit-Modul hier, gehört der Fix ins Kit und danach ein erneutes Vendoring.

## Gotchas

- Der Pin `code-kit` 0.45.0 in `tools/kit-sync.json` zeigt auf einen Tag, der mit dem Kit-Release entsteht; vorher ist `src/vendor/` leer und darf nichts importieren.
- Fremdes SVG nie ungeprüft in den DOM: erst durch den Bereiniger (`svg-guard`), der ablehnt statt zu entfernen (Spec § 3 und § 5).
- Nie im Repo: absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen (`$VAULT/…`, repo-relativ). Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Context index

- Vor jeder Änderung am Verhalten: die Spec im Cockpit (Pfad oben), besonders § 3 „Was nicht passieren darf" und § 5 „Der SVG-Vertrag".
- Vor UI-Arbeit: `../UI-STANDARD.md` und `../.claude/rules/ui-bausteine.md`.
- Vor einem Release: `../.claude/rules/release-und-store.md`, Skill `plugin-release-setup` (Release-Infra und GitHub-Mirror kommen erst mit dem ersten Release).
- Dach-Kontext: `../AGENTS.md` (Kit-first-Regel), `../REGISTRY.md`, `../KIT-MATRIX.md`.
