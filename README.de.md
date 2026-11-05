# SVG Studio

> [🇬🇧 English](README.md) · 🇩🇪 Deutsch

**Beschreibe ein Icon, Logo, Schema oder einen Grundriss in Worten und bekomme ein exaktes, bearbeitbares SVG in deine Notiz — verbessere es dann in Runden, per Prompt oder an einzelnen Zahlen, und nimm jede Änderung eines Elements einzeln an oder lehne sie ab.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/svg-studio?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/svg-studio/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.11.4%2B%20·%20desktop%20%26%20mobile-7c3aed)

Ein Sprachmodell schreibt das SVG, SVG Studio hält es exakt. Das SVG selbst ist die Quelle (keine eigene Zeichensprache), jede Änderung ersetzt eine Textspanne gegen den aktuellen Text, und was du nicht ändern wolltest, bleibt Byte für Byte gleich. Es arbeitet mit einem lokalen oder beliebigen OpenAI-kompatiblen Modell und trägt keine eigenen Schlüssel.

## Features

- **Aus Worten erzeugen** — beschreibe ein Icon, ein Schema oder einen Grundriss mit Maßen und bekomme ein bereinigtes SVG mit Vorschau und Maßzeile.
- **In Runden verbessern** — jede Antwort ist eine Runde; jedes geänderte Element ist eine Karte, die du einzeln annimmst oder ablehnst, mit Kommentar, der bei deiner nächsten Anfrage zum Modell geht.
- **Zahlen von Hand ändern** — klicke ein Element in der Vorschau an und ändere Koordinaten, Größe, Farben, Text, Position oder Drehung ohne Modell.
- **Exakt und byte-treu** — Änderungen gelten ganz oder gar nicht gegen den aktuellen Text und werden zurückgelesen; eine Handänderung geht nie verloren.
- **Sicher gebaut** — fremdes SVG wird vor dem Zeichnen geparst und bereinigt; der Bereiniger lehnt ab, statt Teile still zu entfernen.
- **Arbeitet am Bestand** — öffne eine `.svg`-Datei, einen `svg-studio`-Codeblock oder ein eingebettetes `![[name.svg]]`; repariere ein SVG aus Inkscape oder gib jedem Element einen Namen, mit oder ohne Modell.
- **Übernehmen als Datei oder Block** — ein neues SVG wird zur Datei im Anhangordner (mit Link am Cursor) oder zum Codeblock in der Notiz.

## Voraussetzungen

- **Obsidian 1.11.4+** (Desktop und Mobil).
- **Ein Sprachmodell**: ein OpenAI-kompatibler Endpunkt (etwa ein lokaler Server), eingerichtet im Plugin [LLM Endpoint Manager](https://github.com/johannes-kaindl/llm-endpoint-manager) oder in den Einstellungen dieses Plugins. Kleine Modelle funktionieren, größere sind verlässlicher; das Panel zeigt gemessene Ergebnisse für Modelle, die getestet wurden.

## Installation

### Community-Plugins

> Noch nicht im Community-Verzeichnis. Bis die Prüfung durch ist, nimm einen der anderen Wege; danach: Einstellungen → Community-Plugins → Durchsuchen → „SVG Studio“.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://git.jkaindl.de/jkaindl/svg-studio/releases) nach `<Vault>/.obsidian/plugins/svg-studio/` legen und das Plugin aktivieren.

### BRAT (Beta)

Den GitHub-Mirror `johannes-kaindl/svg-studio` in [BRAT](https://github.com/TfTHacker/obsidian42-brat) eintragen.

### Aus dem Quelltext

```bash
git clone https://git.jkaindl.de/jkaindl/svg-studio
cd svg-studio && npm install && npm run build
# main.js manifest.json styles.css → <Vault>/.obsidian/plugins/svg-studio/
```

## Benutzung

1. Richte ein Sprachmodell ein (siehe Voraussetzungen).
2. Führe den Befehl **SVG Studio: Neues SVG** aus; das Panel öffnet sich in der rechten Seitenleiste.
3. Beschreibe das Bild („A moon icon, 48 × 48, flat, one colour.“) und drücke **Erzeugen**.
4. Prüfe die Vorschau, ändere sie mit einer weiteren Anfrage oder von Hand und drücke dann **Übernehmen**.

Um ein SVG später zu ändern, setze den Cursor in einen `svg-studio`-Block oder auf ein eingebettetes `.svg` und führe **SVG Studio: SVG bearbeiten** aus, oder nimm den Knopf **Bearbeiten** am Block oder an der Einbettung. Mehr unter [Getting started](https://github.com/johannes-kaindl/svg-studio/blob/main/docs/README.md#getting-started) (englisch).

### Einstellungen

| Einstellung | Wirkung | Standard |
|---|---|---|
| Neues SVG übernehmen als | Wohin **Übernehmen** ein neu erzeugtes SVG legt: Datei im Anhangordner, Codeblock am Cursor oder jedes Mal fragen. | Datei im Anhangordner |
| SVG in Notizen automatisch anzeigen | Aus: statt des Bildes ein Knopf, damit sich ein Bild, das Obsidian einfriert, bearbeiten oder entfernen lässt, ohne es zu öffnen. | An |
| Sprachmodell | Endpunkt, Modell und Anfrageeinstellungen (aus LLM Endpoint Manager, wenn installiert). | — |

## So funktioniert es

Das Modell antwortet mit einem SVG oder mit einer Liste von Änderungen, geschlüsselt nach der `id` des Elements. SVG Studio prüft die Antwort (wohlgeformt, vom Bereiniger angenommen), zeigt sie als Runde und schreibt nur, was du annimmst — über einen Weg, der den Text des Ziels vorher neu liest und nicht schreibt, wenn er sich inzwischen geändert hat. Im Panel wird nur der geprüfte Baum eingefügt, in einen isolierten Shadow Root; in einer Notiz erscheint das geprüfte SVG als Bild. Aufbau und Entscheidungen: [`docs/internal/architecture.md`](https://github.com/johannes-kaindl/svg-studio/blob/main/docs/internal/architecture.md).

### Bekannte Grenzen

- **Die Zeichenkosten sind eine Schätzung, kein Schutz.** Der Bereiniger schätzt, wie lange ein SVG zum Zeichnen braucht, und lehnt ab, was deutlich zu viel ist (`too-costly`); ein Block, der ein Viertel der Grenze oder mehr kostet, wird erst nach einem Klick gezeichnet. Die Schätzung wurde in Chromium gemessen und übersieht ganze Klassen (per CSS gesetzte Formen und Clips, große Farb-Emoji, Verläufe mit Tausenden Stopps, CSS-Animationen); WebKit (iOS) und Firefox wurden nicht gemessen, und ein Telefon ist wahrscheinlich um ein Mehrfaches langsamer als der Messrechner. Was Obsidian tatsächlich schützt, ist das Sicherheitsnetz: vor dem Zeichnen wird eine Marke geschrieben, ein Wächter bemerkt ein eingefrorenes Fenster, und ein Block, der Obsidian eingefroren hat, wartet beim nächsten Mal auf einen Klick. Es fängt kein Einfrieren unter etwa einer Sekunde und keines, das spät beginnt; ein Schalter in den Einstellungen schaltet das automatische Zeichnen in Notizen ab. Mit `![[name.svg]]` eingebettete SVGs zeichnet Obsidian selbst, sie sind nicht abgedeckt.
- **Die Modellqualität schwankt.** Das Panel nennt, was für ein Modell gemessen wurde; bei nicht gemessenen Modellen steht das dort.

## Dokumentation

- [Dokumentation](https://github.com/johannes-kaindl/svg-studio/blob/main/docs/README.md) — hier anfangen, nach Diátaxis gegliedert (englisch).
- [Getting started](https://github.com/johannes-kaindl/svg-studio/blob/main/docs/README.md#getting-started) — von der Installation bis zum ersten SVG.
- [Troubleshooting](https://github.com/johannes-kaindl/svg-studio/blob/main/docs/README.md#troubleshooting) — etwas klappt nicht? Hier anfangen; am Ende steht, wo es Hilfe gibt.

## Mitwirken

Issues und Pull Requests auf [git.jkaindl.de](https://git.jkaindl.de/jkaindl/svg-studio). Testgetrieben (`npm run gate`: Lint, Typprüfung, Tests, Reinheits- und Bundle-Prüfung). Siehe [`AGENTS.md`](AGENTS.md).

## Lizenz

- **Code:** AGPL-3.0-or-later ([`LICENSE`](LICENSE); Dual-License-Option in [`LICENSING.md`](LICENSING.md)).
- **Doku/Text:** CC BY-SA 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
