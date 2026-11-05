// Absturzmarken (Task „Laufzeit-Schutz im Plugin“, Befund Plan 2 C3): ein statischer Zähler im Bereiniger wird nie vollständig, und der Notiz-Weg (`<img>` mit Data-URL)
// blockiert den Hauptthread wie das Panel. Vor dem Rendern eines SVG steht eine Marke mit dem Fingerabdruck seines Textes; sie fällt, wenn das Bild gezeichnet ist.
// Steht sie in einer späteren Sitzung noch (Obsidian eingefroren und beendet) oder dauerte das Zeichnen länger als `SLOW_MS` (Marke `slow`), zeigt das Plugin das Bild
// nicht von selbst. Eine Marke aus der LAUFENDEN Sitzung ohne `slow` ist nur ein Bild, das gerade gezeichnet wird: ein zweiter Block mit demselben Text darf nicht wegen ihr ausbleiben.
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
/** Dauert das Zeichnen länger, bleibt die Marke stehen, auch wenn Obsidian wieder reagiert: gemessene Last-Klassen des Bereinigers beginnen bei 1,5 s. */
export const SLOW_MS = 1500;

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
