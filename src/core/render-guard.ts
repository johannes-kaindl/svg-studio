// Absturzmarken (Task „Laufzeit-Schutz im Plugin“, Befund Plan 2 C3): ein statischer Zähler im Bereiniger wird nie vollständig, und der Notiz-Weg (`<img>` mit Data-URL)
// blockiert den Hauptthread wie das Panel. Vor dem Rendern eines SVG steht eine Marke mit dem Fingerabdruck seines Textes. Sie fällt NICHT, wenn ein Ereignis feuert
// (`load` und zwei Frames liegen bei Raster-Kosten vor dem Hänger, gemessen), sondern wenn der Hauptthread nach dem Setzen belegt reaktionsfähig war: ein Wächter mit
// Timer-Takt misst die Lücken zwischen den Ticks. Eine Lücke über `SLOW_GAP_MS` macht die Marke zur `slow`-Marke; sie bleibt, auch wenn Obsidian sich erholt.
// Steht eine Marke in einer späteren Sitzung noch (Obsidian eingefroren und beendet) oder ist sie `slow`, zeigt das Plugin das Bild nicht von selbst.
// Geschützt: Hänger ab etwa 1 s, auf die ein Absturz oder hartes Beenden folgt (die Marke muss dann schon gespeichert sein: Chromium schreibt `localStorage` erst nach
// etwa 5 s fest) und, als `slow`, jeder Hänger ab 1 s im selben Fenster der ersten Sekunden. Nicht geschützt: Hänger unter der Speicherzeit, bei denen der Nutzer einfach
// wartet; ein Hänger, der erst nach `MAX_WATCH_MS` beginnt (CSS-Animation mit langer Verzögerung); das Neuzeichnen eines schon gezeigten Bildes. Eine Marke aus der LAUFENDEN Sitzung ohne `slow` ist nur ein Bild, das gerade gezeichnet wird: ein zweiter Block mit demselben Text darf nicht wegen ihr ausbleiben.
// Pure: die Liste der Marken ist ein Wert; Lesen und Schreiben (App-lokaler Speicher) liegen in `src/obsidian/render-guard.ts`.

export interface Mark {
  /** Fingerabdruck des SVG-Textes (SHA-256, hex). */
  fp: string;
  /** Zeitpunkt der Marke (ms seit Epoche), nur zur Rotation. */
  at: number;
  /** Sitzung des Plugins (zufällig je Laden), die die Marke gesetzt hat. */
  session: string;
  /** Das Zeichnen dauerte länger als `SLOW_MS`: die Marke bleibt, auch in der eigenen Sitzung. */
  slow?: true;
}

/** So viele Marken hält die Liste; die ältesten fallen heraus. */
export const MAX_MARKS = 50;
/** Kommt `load` später als so viele ms nach dem Setzen der Marke (Stilkosten vor dem Laden), ist das Bild sofort `slow`. */
export const SLOW_MS = 1500;
/** Takt des Wächters. */
export const TICK_MS = 250;
/** Ein Tick, der mehr als so viele ms später kommt als geplant, war ein Hänger: die Marke wird `slow`. */
export const SLOW_GAP_MS = 1000;
/** Eine Verspätung über dieser Grenze (aber unter `SLOW_GAP_MS`) ist keine Ruhe: das Ruhefenster beginnt neu. */
export const CALM_GAP_MS = 300;
/** So lange muss der Hauptthread ruhig bleiben, bevor die Marke fällt (die gemessenen Hänger beginnen innerhalb von 100 ms nach dem Setzen). */
export const CALM_MS = 2000;
/** Länger wird nicht gewartet: danach fällt die Marke auch ohne Ruhe (Obsidian war nur beschäftigt). */
export const MAX_WATCH_MS = 15000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Liest die gespeicherte Liste; jeder ungültige Eintrag fällt einzeln weg, alles Unlesbare ergibt eine leere Liste. */
export function parseMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const m of raw) {
    if (isRecord(m) && typeof m.fp === "string" && /^[0-9a-f]{64}$/.test(m.fp) && typeof m.at === "number" && Number.isFinite(m.at)) {
      out.push({ fp: m.fp, at: m.at, session: typeof m.session === "string" ? m.session : "", ...(m.slow === true ? { slow: true as const } : {}) });
    }
  }
  return out.slice(-MAX_MARKS);
}

/** Setzt die Marke (eine vorhandene mit demselben Fingerabdruck wird ersetzt und rückt ans Ende; eine `slow`-Marke bleibt `slow`). */
export function addMark(marks: readonly Mark[], fp: string, at: number, session: string): Mark[] {
  const slow = marks.some((m) => m.fp === fp && m.slow === true);
  return [...marks.filter((m) => m.fp !== fp), { fp, at, session, ...(slow ? { slow: true as const } : {}) }].slice(-MAX_MARKS);
}

/** Macht die Marke zur `slow`-Marke (sie bleibt stehen, bis der Nutzer „Trotzdem anzeigen“ wählt). Ohne Marke steht danach eine. */
export function markSlow(marks: readonly Mark[], fp: string, at: number, session: string): Mark[] {
  return [...marks.filter((m) => m.fp !== fp), { fp, at, session, slow: true as const }].slice(-MAX_MARKS);
}

export function removeMark(marks: readonly Mark[], fp: string): Mark[] {
  return marks.filter((m) => m.fp !== fp);
}

/**
 * Blockiert die Marke die Anzeige? Ja, wenn sie `slow` ist oder aus einer anderen Sitzung stammt (Obsidian ist danach beendet worden). Eine Marke der eigenen Sitzung
 * ohne `slow` gehört zu einem Bild, das gerade gezeichnet wird.
 */
export function isBlocked(marks: readonly Mark[], fp: string, session: string): boolean {
  return marks.some((m) => m.fp === fp && (m.slow === true || m.session !== session));
}
