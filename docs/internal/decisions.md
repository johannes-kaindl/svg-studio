# Entscheidungen — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Die vollständige Begründung steht in der Spec im Cockpit des Maintainers (`25_Coding/svg-studio/_SDD/2026-11-02-svg-studio-design.md`, § 2 mit den Entscheidungen Nr. 1 bis 16). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt.

## Echtes SVG statt eigener 2D-Sprache (Nr. 1, Johannes, 2026-11-02)

Logos und Icons brauchen Kurven, und SVG trägt exakte Zahlen selbst. Der Vorbehalt war, ob lokale Modelle brauchbares SVG schreiben. Die Messung vom 2026-11-02 (Messnote `_SDD/2026-11-02-svg-studio-messung.md`) bestätigt es: qwen3.8-27b schrieb 10 von 10 SVGs parsebar und bereinigt, alle drei Grundrisse maßtreu. Die Rückfrage „eigene Sprache für Maßzeichnungen“ ist damit entfallen. Ein kleines Modell (gemma-4-e4b, 7 von 10, Grundrisse 1 von 3) bekommt die Warnung in der Messzeile.

## Beim Verfeinern schreibt das Modell das vollständige SVG (Nr. 11)

Der Code bildet die Änderungsliste selbst per `id`-Paarung. Gemessen gegen eine JSON-Änderungsliste: vollständiges SVG 8 von 8 erfüllt, JSON 6 von 8 — die zwei Fehlschläge setzten ein in derselben Liste erst hinzugefügtes Element als Anker ein. Was sich nicht zerlegen lässt, erscheint als Eintrag „Ganzes Bild ersetzt“, nie still verloren (Nr. 12).

## Diff auf Element- und Attributebene (Nr. 6)

„Kreis mond: r 40 → 60“ statt eines Text-Diffs über den Code. Dafür trägt jedes Element unter der Wurzel eine `id` (Nr. 5); fehlende vergibt `assignMissingIds` beim ersten Erzeugen. Feste Schlüssel: `#wurzel` für die Wurzel, `#style-n`, `#title`/`#desc` nur als direkte Kinder der Wurzel.

## Byte-treue Änderungen gegen den aktuellen Text

Eine Runde oder ein Übernehmen setzt auf dem Text auf, der gerade in der Notiz steht, nicht auf einem gespeicherten. Deshalb arbeitet `applyChanges` mit Spannen gegen den Originaltext, alles oder nichts, und ein Round-Trip-Wächter prüft, dass nicht betroffene Elemente samt Eltern unverändert bleiben und keine doppelten `id`s entstehen. Grund: Spec § 3, Punkt 2 und 3 („Eine Runde macht kaputt, was vorher gut war“, „Eine Handänderung geht verloren“).

## Der Bereiniger lehnt ab und liegt im code-kit

`svg-guard` entfernt nichts still, sondern lehnt ab; die Reparatur (Rückfrage ans Modell mit Fehlergrund) macht daraus eine neue Antwort. Er liegt im code-kit, weil jedes Plugin, das fremdes SVG zeigt, ihn braucht (Bibliothek ab Eins). Zwei Opus-Reviews mit Messung im echten Chromium fanden drei kritische Lücken, die Sonnet-Reviews und happy-dom nicht zeigten (innerHTML-Differenz, CSS-Escapes, `<?xml-stylesheet?>`); seitdem gibt der Prüfer den geprüften Baum zurück, und der Konsument fügt genau diesen ein.

## Ablage: Datei und Codeblock, Vorgabe Datei (Nr. 2, Nr. 9, Nr. 16)

Ein SVG als Datei bleibt ohne Plugin sichtbar (Handy, Publish, andere Apps). Neue Dateien landen im Anhang-Ordner und werden nie überschrieben. Der Codeblock heißt ` ```svg-studio `, nicht ` ```svg `, damit er nicht mit Store-Plugins kollidiert, die ` ```svg ` rendern (Nr. 10).

## Einheit im SVG (Nr. 13)

`data-unit="cm"` an der Wurzel, gesetzt beim Erzeugen mit realen Maßen (1 Einheit = 1 cm). Die Maßzeile liest Werte per Code aus dem SVG, nie aus der Behauptung des Modells.

## Denken aus als Vorgabe

Sampling-Modus `transform` aus code-kit `sampling-profiles` mit Temperatur 0,2 und Denken aus. Ein Pilot mit Denken brauchte 640 s statt 12,7 s für ein Icon (n = 1). Ob ein Schalter „gründlich“ das wert ist, ist ungemessen.

## Spezifikationen und Befunde außerhalb des Repos

Spec, Pläne, Extraktionsprüfung, Messnote und Task-Reports liegen im Coding-Cockpit des Maintainers (CORE-META-14); das Repo behält die Design-Essenz in diesen Dateien und die Rohdaten der Messung unter `tests/fixtures/lab/`.
