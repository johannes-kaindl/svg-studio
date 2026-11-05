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

## Plan 2: was beim Bau entschieden wurde, und warum

- **Verschobene Elemente tragen ihre Änderungen mit (B2).** Besitzer einer Textspanne ist das innerste verschobene Element, das sie umschließt; die Scheibe eines verschobenen Elements ist sein Ausgangstext mit den Spannen, die es besitzt. Grund: sonst bleibt „change auf einen Nachkommen eines verschobenen Elements“ abgelehnt, und fast jede Runde mit Umsortieren würde als „ganzes Bild ersetzt“ enden. Der Opus-Review fand den Fehler, dass eine Einfügung genau an `m.start` mitwanderte (kompaktes SVG); Besitzer sind nur Elemente, die VOR der Spanne beginnen.
- **`remove` trägt `expect` (kanonische Form).** Für `#style-n`, `#title`, `#desc` Pflicht: ihr Schlüssel hängt an der Stelle, und ein von Hand eingefügtes `<style>` verschöbe ihn. Alle anderen `remove` dürfen `expect` tragen; der Diff setzt es immer.
- **Der Diff ist nur etwas wert, wenn er vollständig ist (B3).** Am Ende werden alle Einträge angewendet und kanonisch mit der Antwort verglichen. Einträge, die sich nicht einzeln annehmen lassen (Gruppe umbenannt, Kind aus einem ersetzten Element, Reihe aus Einfügungen und Ersetzung), sind EIN Eintrag (Union-Find); sonst verlöre eine Teilannahme still Elemente. Ein Text in gemischtem Inhalt ersetzt das Elternelement.
- **Prompts wortgleich mit der Messung (B4).** Die Messzeile gilt nur für den gemessenen Wortlaut; `promptFingerprint` (Kit `measured-quality`) bindet jede Zeile daran. `RETRY_INSTRUCTION` ist neu und ungemessen.
- **Der Leser der Antwort liest Gemmas Denkkanal (B4).** Die Messnote las den Entwurf; die Zahlen sind korrigiert (Abschnitt „Korrektur der Auswertung 2026-11-04“ in der Messnote), die alten bleiben sichtbar.
- **Messzeile mit Vorbehalten:** „gemessen mit Denken aus“ (Kit `thinking`), qwen „ohne top_p gemessen“ (die Verbindung sendet es, die Messung nicht; Nachmessung nach Phase D, Entscheidung Johannes 2026-11-04).
- **Rundenmodell gegen den Text von JETZT (B6/C4):** Übernehmen wendet die angenommenen Einträge aller Runden auf den Text an, der jetzt dasteht; ein seither geändertes Element oder Attribut bricht ab. Eine Runde „ganzes Bild“ oder „Namen vergeben“ mit Folgerunde greift nur, wenn der Text noch ihr Ausgang ist.
- **Vorschau nur aus dem geprüften Baum (C3).** `importNode` des Hostdokuments in einen offenen Shadow Root, nie Text per `innerHTML`; ein Wrapper mit `contain: paint` im Licht-DOM, weil ein SVG sonst per `:host{position:fixed}` das Panel überdecken und eine falsche Maßzeile malen kann (im echten Chromium belegt). Maße über `getScreenCTM`, nicht über einen Messfühler, den das CSS des SVG verfälschen kann.
- **Übernehmen als Datei oder Block (C4, E2, E3, E4):** Vorgabe Datei im Anhangordner (nie überschreiben), Lesemodus hängt ans Notizende an und sagt es, Prüfliste: Einträge zunächst angenommen, einzeln ablehnbar; Inkscape-Angaben werden durch eine sichtbare Regelrunde entfernt, der Bereiniger bleibt streng. Vor dem Überschreiben einer `.svg` sichert das Kit (`file-snapshot`, Großvater-Vater-Sohn), weil Obsidians Dateiwiederherstellung `.svg` nicht erfasst (gemessen 2026-11-04).
- **Kit-first hat dreimal gegriffen:** `promptFingerprint`, der Denken-Vorbehalt und `isHexColor` (jetzt `css-color`) wanderten auf Urteil des Gegenlesers ins Kit; `decodeEntities` blieb mit Folgeempfehlung (Kit-Modul `xml-entities`).
- **Bundle-Schranke 400 KB:** das Panel trägt die LLM-Verbindung und die Kit-Bausteine; die Schranke fängt unbeabsichtigte Abhängigkeiten, nicht gewollte Bausteine.

## Renderkosten: Schätzung, Klickschwelle und Absturzmarke (Plan 2, C3, 2026-11-05)

- **Zwei Schichten, keine ersetzt die andere.** Der Bereiniger (code-kit 0.58.0) schätzt die Zeichenkosten und lehnt Offensichtliches als `too-costly` ab; das Modell ist in Chromium 153 gemessen und lässt Klassen aus (CSS-gesetzte Formen, Text als Clip, Farb-Emoji, CSS-Animation …, Liste im Kit: `docs/internal/svg-guard-cost.md`). Was ihn passiert, fängt die Absturzmarke mit Wächter ab (`src/obsidian/render-guard.ts`). Beides sind Maßnahmen gegen ein eingefrorenes Fenster, kein Sicherheitsschutz.
- **Klickschwelle `CLICK_COST` = 250 000** (`src/core/render-guard.ts`, Herkunft im Kommentar): ein Viertel der Grenze 1 Mio. Der Kostenwert ist etwa eine Mikrosekunde Zeichenzeit bei 600 px Breite und Gerätepixelverhältnis 1 auf dem Messrechner; die Randfälle des Kits liegen bei 0,3 bis 0,65 s für 550 000 bis 820 000 (bis 0,81 ms je 1000, ein Weichzeichner in riesiger Region 1,37), die teuerste von 38 echten Dateien bei 38 794 (3,9 %). 250 000 ist so mehr als das Sechsfache des Teuersten, was ein Icon, Logo oder Diagramm in der Praxis kostet; der Opus-Delta-Check maß knapp darüber 0,15 bis 0,4 s (DPR 1, 600 px, Chromium 148 bis 153). **Grenzen:** bei DPR 2 (Retina) mit GPU-Raster wuchsen dieselben Fälle auf 0,7 bis 1,2 s (Kit-Randfälle 1,5 und 3,4 s), und die Zeit ist Raster-Zeit außerhalb des Hauptthreads (Frame-Lücken bis 1,35 s, Timer-Lücken höchstens 29 ms): ein spätes Bild und Ruckeln, kein eingefrorenes Fenster, und der timerbasierte Wächter sieht sie nicht. Die Schwelle gilt je Block. Ob sie mit `cost × devicePixelRatio²` skaliert werden soll, ist ungemessen (Task im Cockpit, Messung am Gerät und auf dem Retina-Bildschirm).
- **Die Schwelle gilt für Blöcke in Notizen, nicht für das Panel.** Ein Block erscheint ungefragt (Notiz öffnen, scrollen), die Vorschau im Panel nach einer Handlung des Nutzers (Datei öffnen, Lauf senden). Das Panel braucht die Zeichnung, um Elemente zu wählen; es steht unter der Absturzmarke, nicht unter der Klickschwelle. Wer das ändern will, ergänzt `show()` in `preview.ts` um denselben Grund wie die Marke (`blocked`).
- **Reihenfolge im Block:** Absturzmarke und Notausschalter zuerst (ohne Bereiniger), dann `begin`, dann der Bereiniger, dann die Kostenschwelle (der Kostenwert ist erst nach ihm bekannt); der Platzhalter ruft `abort`, die Marke fällt, weil nichts gezeichnet wurde. „Anzeigen“ setzt `forced` und überspringt Marke, Schalter und Schwelle für diesen Block, nicht den Bereiniger.
- **Führendes BOM:** der Bereiniger schneidet es ab und meldet `bom: true`; der Block zeichnet den geprüften Text ohne BOM. Beim Schreiben stellt `acceptText` es wieder voran, wenn die Datei damit begann (Spannen-Runden fassen es nicht an, „ganzes Bild“ und Reparatur ersetzen den Text). Gemessen 2026-11-05: Obsidians Electron (Chrome 142) lässt `DOMParser` ein einzelnes führendes U+FEFF durch, Chrome 153 nicht; ein Text mit zwei BOM wird deshalb in Obsidian angenommen und vom Kit-Test (153) abgelehnt. Gezeichnet wird in beiden Fällen der Text, den der Bereiniger geprüft hat.
- **Meldetext:** `guardProblemText` (Oberfläche, `src/i18n/strings.ts`) und `guardProblemsLine` (Satz für das Modell, `src/core/protocol.ts`) für `too-costly`; jeder andere Code bleibt „code: detail“.

