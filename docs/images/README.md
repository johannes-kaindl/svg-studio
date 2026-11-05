# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist der Vertrag dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es steht und wie man sie reproduzierbar neu aufnimmt. Geprüft wird er von `readme_lint.py` (Workspace-Werkzeug, `npm run shots:check`), das Vertrag, Dateien und Einbettungen abgleicht.

## Status

Stand 2026-11-05: alle fünf Bilder stehen, aufgenommen in einer Zweitinstanz (Obsidian 1.15.1, Oberfläche Englisch, helles Theme), jedes angesehen. Nicht aufgenommen: nichts. Die Einbettung in `README.md` und `README.de.md` ist Sache der README-Arbeit (`svgr-p2`), nicht dieses Vertrags.

**Das LLM in allen Bildern ist ein Stub.** Ein lokaler Server hinter einem Fake-Manager (`llm-endpoint-manager`) antwortet mit Zeichnungen, die das Rezept vorgibt: die Grundrisszeichnung steht im Fixture (`notes/Living room.md`), die Änderungsrunde ist eine Textersetzung darauf (Tür 20 cm nach links, Nordwand `stroke-width` 2 → 6, Südwand `stroke` `black` → `#1d4e89`). Die Zeichnung ist an den Messfall E8 aus `tests/fixtures/lab/` angelehnt (Raum mit Tür in der Nordwand), aber mit englischen ids, Titel und Beschreibung und mit Möbeln, Beschriftung und Raumfüllung, damit das Bild etwas zeigt; sie ist keine Modellausgabe. Die Bilder belegen die Oberfläche, nicht die Qualität einer Modellantwort; die Messung dazu steht in `docs/internal/LAB.md`. Der Endpunkt heißt „Demo endpoint“, das Modell `demo-model`; die Zeile „Not measured for this model; the small model gemma-4-e4b managed 6 of 8 on the same task, bigger models usually do better.“ ist der echte Text des Plugins für ein ungemessenes Modell und steht deshalb in jedem Panel-Bild.

**Zwei Abweichungen vom Auslieferungszustand, beide ehrlich benannt:** (1) Die Statusleiste von Obsidian ist ausgeblendet (ihr Sync-Symbol schwebt sonst in der Ecke jedes Ausschnitts), das Plugin ist davon nicht berührt. (2) Der Block in `Living room.md` trägt `width` und `height`, weil ein Block mit einem SVG, das nur `viewBox` hat, in der Notiz heute 0 px breit ist (Befund beim Aufnehmen, Task im Cockpit „Block ohne width und height ist in der Notiz unsichtbar (0 px breit)“); Modelle schreiben häufig keine Größe, das Hero-Bild zeigt also den Fall, in dem das Modell sie schreibt. Fällt der Befund weg, kann die Größe aus dem Fixture.

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard in `readme-spec.json` (Block `images`). Kurzfassung:

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width="820"` | H/B ≤ 1,6 |
| `detail` | Vorschaubild `width="380"` aus `thumbs/`, verlinkt auf die Vollauflösung | keine Höhengrenze |

- Aufnahme bei 1200 px Breite (Fenster 1200 × 940 CSS-Pixel, Dichte 2, Ausschnitte unter 1200 CSS-Pixel Breite bleiben unskaliert; die Panel-Bilder sind 600 CSS-Pixel breit und damit genau 1200 px).
- Einbettung immer per `<img width="…">` mit absoluter Raw-URL und Alt-Text.
- Budget: PNG ≤ 400 KB, Ordner ≤ 5 MB. Theme: helles Standard-Theme.
- Farben: Johannes hat eine Rot-Grün-Schwäche. Kein Bild trägt einen Unterschied allein über Rot und Grün: Zustände der Prüfliste stehen als Text („Accepted“, „Rejected“), als Rand (durchgezogen, gestrichelt) und als Durchstreichung; die Redline nutzt Orange und Blau. Die Südwand ist dunkelblau statt rot, weil dunkles Rot neben Schwarz schlecht zu unterscheiden ist. Geprüft mit einer Simulation von Deuteranopie und Protanopie (Machado, Stärke 1,0) an `review.png`, `hero.png` und `repair.png`.

## Die Bilder

| Datei | Klasse | Referenziert von | Muss zeigen |
|---|---|---|---|
| `hero.png` | hero | `README.md`, `README.de.md` (Kopf) | Links die Notiz **Living room** im Lesemodus mit dem Grundriss-Block (Raum mit Tür in der Nordwand, Sofa, Tisch, Beschriftung), rechts das Panel nach einer Änderungsrunde: **Preview of round 1** mit den geänderten Wänden und darunter die Prüfliste mit den drei Karten (**Accept** / **Reject** / **Comment**) und **Apply** / **Discard**. Der Block links zeigt noch den alten Stand, die Vorschau rechts den vorgeschlagenen: das ist die Aussage. Das Panel ist so gerollt, dass Vorschau und Prüfliste zusammen stehen; Modellzeile und Eingabe sind oben herausgerollt. |
| `create.png` | feature | `README.md` (Usage, Erzeugen) | Das Panel **New SVG** nach dem Senden eines Prompts („A floor plan of a room, 5.6 × 3.0 m, …“): Modellzeile, Eingabe, Status **Done — check the preview …**, **Preview of round 1** mit dem Grundriss, die Maßzeile **Area 580 × 320 cm · Drawing 562 × 302 cm**, der Hinweis **Click an element in the preview to change its values by hand.** und **Apply** / **Discard**. |
| `review.png` | feature | `README.md` (Usage, Prüfliste) | Drei Karten einer Änderungsrunde mit Redline (**Line wall-north: stroke-width 2 → 6**, **Line wall-south: stroke black → #1d4e89**, **Rectangle door: x 235 → 215**): zwei **Accepted**, die Tür-Karte **Rejected** (gestrichelter Rand). Darüber die Vorschau mit dicker Nordwand und blauer Südwand, die Tür unverschoben (abgelehnt), darunter **Apply**. Aufgenommen mit hohem virtuellen Viewport, weil das Panel höher ist als der Bildschirm. |
| `fields.png` | feature | `README.md` (Usage, Zahlenfelder) | Das Panel am Bestand (**Current state**), ein Element in der Vorschau angeklickt (das Sofa, mit violettem Auswahlrand), darunter **Values of Rectangle sofa** mit den Feldern x, y, width, height, rx, fill, stroke, stroke-width und **Rotate (°)**, in der Maßzeile **sofa: 210 × 75 cm at 30, 190**. Nichts geändert: **Apply** ist gesperrt. |
| `repair.png` | feature | `README.md` (Bestand, Reparatur) | Die Notiz **Garden icon** mit einem Block, den der Bereiniger ablehnt: **This SVG cannot be shown: the sanitizer rejected it.**, der Grund (`unsafe-css: <style> contains "/*"`) und die Knöpfe **Repair** und **Edit**. Eng auf Überschrift, Satz und Karte beschnitten (kein Weißraum). |

## Reproduktion

Aufnahme nur in einer Zweitinstanz mit eigenem Profil und eigenem Port; die reguläre Instanz wird nie beendet. Der Lock des Dachs gehört davor (`--exclusive focus`, Bildaufnahme), Regeln in `.claude/rules/cdp-lock.md` und `.claude/rules/obsidian-instanz.md` des Dachs.

```bash
# 1. gebautes Plugin und Vault aus dem Fixture
npm run build && npm run shots -- --setup

# 2. Zweitinstanz mit eigenem Profil starten (Profil, obsidian.json mit dem Vault, .asar der regulären Instanz, --lang=en-US):
#    der Startweg steht im Kopf von tools/obsidian-cdp/messlauf.sh im Dach

# 3. aufnehmen (ein Bild: --only <datei>)
npm run shots -- --port <port>

# 4. Vertrag, Dateien und README abgleichen
npm run shots:check
```

Der Vault entsteht unter `$STAGING_VAULTS_DIR/svg-studio` (die Variable ist Pflicht; ein absoluter Pfad darf nicht ins Repo, `scripts/check-no-abs-paths.mjs` erzwingt das) und ist Wegwerfware. `npm run shots` baut und deployt nicht selbst: `--setup` kopiert das gebaute `main.js`, `ladePluginNeu` prüft es gegen `src/`. Das Rezept schaltet das Panel je Bild auf eine Breite von 600 CSS-Pixel (Hero 560), blendet die linke Seitenleiste aus und räumt vor jedem Bild auf (Panel zu, Notizen zu, Stub leer).

## UI-Strings (verbatim aus `src/i18n/strings.ts`)

- Panel: **New SVG** · **Edit: {Datei}:{Zeile}** · **New** · **Change** · **Apply** · **Discard** · **Preview of round {n}** · **Current state** · **Background: on** · **Light** / **Dark** / **Custom**
- Status: **Done — check the preview, then apply or change further, or press New to start another image.** · **Done — check the result, then apply or change further.**
- Prüfliste: **{n} change(s)** · **Accept all** · **Reject all** · **Accept** · **Reject** · **Comment** · **Accepted** · **Rejected**
- Felder: **Values of {Art} {id}** · **Click an element in the preview to change its values by hand.** · **Rotate (°)**
- Block: **This SVG cannot be shown: the sanitizer rejected it.** · **Repair** · **Edit** · **Edit in SVG Studio**

## Fixture

`fixture/` ist die getrackte Quelle des Aufnahme-Vaults (`tests/fixtures/vault/` ist das Fixture des GUI-Smokes mit deutschen Namen und taugt nicht für englische Bilder):

- `notes/Living room.md` — der Grundriss-Block (englische ids: `room`, `wall-north`, `wall-east`, `wall-south`, `wall-west`, `sofa`, `table`, `label`, `door`, `window`); aus ihm entstehen auch die Stub-Antworten.
- `notes/Broken block.md` — der abgelehnte Block (CSS-Kommentar im `<style>`, Kit-Vertrag von `svg-guard`).
- `obsidian/` — Vault-Konfiguration: nur dieses Plugin aktiv, ruhiger Kern-Plugin-Satz.

Nichts Privates: generische Beispiele auf Englisch.
