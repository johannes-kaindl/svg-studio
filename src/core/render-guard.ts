// Absturzmarken (Task „Laufzeit-Schutz im Plugin“, Befund Plan 2 C3): ein statischer Zähler im Bereiniger wird nie vollständig, und der Notiz-Weg (`<img>` mit Data-URL)
// blockiert den Hauptthread wie das Panel. Vor dem Rendern eines SVG steht eine Marke mit dem Fingerabdruck seines Textes; sie fällt, wenn das Bild gezeichnet ist.
// Steht sie beim nächsten Rendern noch (Obsidian eingefroren und beendet) oder dauerte das Zeichnen länger als `SLOW_MS`, zeigt das Plugin das Bild nicht von selbst.
// Pure: die Liste der Marken ist ein Wert; Lesen und Schreiben (App-lokaler Speicher) liegen in `src/obsidian/render-guard.ts`.

export interface Mark {
  /** Fingerabdruck des SVG-Textes (SHA-256, hex). */
  fp: string;
  /** Zeitpunkt der Marke (ms seit Epoche), nur zur Rotation. */
  at: number;
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
    if (isRecord(m) && typeof m.fp === "string" && /^[0-9a-f]{64}$/.test(m.fp) && typeof m.at === "number" && Number.isFinite(m.at)) out.push({ fp: m.fp, at: m.at });
  }
  return out.slice(-MAX_MARKS);
}

/** Setzt die Marke (eine vorhandene mit demselben Fingerabdruck wird ersetzt und rückt ans Ende). */
export function addMark(marks: readonly Mark[], fp: string, at: number): Mark[] {
  return [...marks.filter((m) => m.fp !== fp), { fp, at }].slice(-MAX_MARKS);
}

export function removeMark(marks: readonly Mark[], fp: string): Mark[] {
  return marks.filter((m) => m.fp !== fp);
}

export function isMarked(marks: readonly Mark[], fp: string): boolean {
  return marks.some((m) => m.fp === fp);
}
