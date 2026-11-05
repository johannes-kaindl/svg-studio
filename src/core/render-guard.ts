// Absturzmarken (Task „Laufzeit-Schutz im Plugin“, Befund Plan 2 C3): ein statischer Zähler im Bereiniger wird nie vollständig, und der Notiz-Weg (`<img>` mit Data-URL)
// blockiert den Hauptthread wie das Panel. Vor dem Rendern eines SVG steht eine Marke mit dem Fingerabdruck seines Textes. Sie fällt NICHT, wenn ein Ereignis feuert
// (`load` und zwei Frames liegen bei Raster-Kosten vor dem Hänger, gemessen), sondern wenn der Hauptthread nach dem Setzen belegt reaktionsfähig war: ein Wächter mit
// Timer-Takt misst die Lücken zwischen den Ticks. Eine Lücke über `SLOW_GAP_MS` macht die Marke zur `slow`-Marke; sie bleibt, auch wenn Obsidian sich erholt.
// Steht eine Marke in einer späteren Sitzung noch (Obsidian eingefroren und beendet) oder ist sie `slow`, zeigt das Plugin das Bild nicht von selbst.
// Geschützt: Hänger ab etwa 1 s und Dauerlast (Frames über etwa 450 ms), auf die ein Absturz oder hartes Beenden folgt; die Marke steht dann schon dauerhaft (IndexedDB,
// `src/obsidian/mark-store.ts`). Nicht geschützt: Hänger unter etwa einer Sekunde, bei denen der Nutzer einfach wartet; ein Hänger, der erst nach dem Wachfenster beginnt (CSS-Animation
// mit langer Verzögerung); ein Bild unterhalb des sichtbaren Bereichs, das erst beim Scrollen gezeichnet wird; gleichzeitig beobachtete Bilder teilen jede Lücke. Eine Marke aus der
// LAUFENDEN Sitzung ohne `slow` ist nur ein Bild, das gerade gezeichnet wird: ein zweiter Block mit demselben Text darf nicht wegen ihr ausbleiben.
// Pure: die Liste der Marken ist ein Wert; der Wächter liegt in `src/obsidian/render-guard.ts`, der dauerhafte Speicher in `src/obsidian/mark-store.ts`.

export interface Mark {
  /** Fingerabdruck des SVG-Textes (SHA-256, hex). */
  fp: string;
  /** Zeitpunkt der Marke (Wanduhr, ms seit Epoche): Alter und Reihenfolge. */
  at: number;
  /** Sitzung des Plugins (zufällig je Laden), die die Marke gesetzt hat. */
  session: string;
  /** Das Zeichnen dauerte länger als `SLOW_MS`: die Marke bleibt, auch in der eigenen Sitzung. */
  slow?: true;
}

/** So viele Marken hält die Liste; es fallen zuerst eigene laufende Marken heraus, `slow`-Marken und die einer früheren Sitzung bleiben am längsten. */
export const MAX_MARKS = 50;
/** Kommt `load` später als so viele ms nach dem Setzen der Marke (Stilkosten vor dem Laden), ist das Bild sofort `slow`. */
export const SLOW_MS = 1500;
/** Takt des Wächters. */
export const TICK_MS = 250;
/** Ein Tick, der mehr als so viele ms später kommt als geplant, war ein Hänger: die Marke wird `slow`. */
export const SLOW_GAP_MS = 1000;
/** Eine Verspätung über dieser Grenze (aber unter `SLOW_GAP_MS`) ist keine Ruhe: das Ruhefenster beginnt neu. */
export const CALM_GAP_MS = 300;
/**
 * Dauerlast: der Anteil verspäteter Zeit an der beobachteten Zeit. Jede einzelne Verspätung zählt höchstens `CALM_GAP_MS` (eine Spitze unter dem Hänger macht noch keine Dauerlast),
 * ab `SLOW_LOAD_FROM_MS` beobachteter Zeit gilt ein Anteil von `SLOW_LOAD_RATIO` als Dauerlast und die Marke wird `slow`. Gemessen (Opus-Review 2026-11-05): Frames von 450 bis
 * 530 ms ergeben rund 45 %, von 600 bis 700 ms rund 46 %; eine absolute Summe kippte schon bei einer einzelnen Lücke von 0,8 s.
 */
export const SLOW_LOAD_RATIO = 0.35;
export const SLOW_LOAD_FROM_MS = 1000;
/** So lange muss der Hauptthread ruhig bleiben, bevor die Marke fällt (die gemessenen Hänger beginnen innerhalb von 100 ms nach dem Setzen). */
export const CALM_MS = 2000;
/** Länger wird nicht gewartet: danach fällt die Marke auch ohne Ruhe (Obsidian war nur beschäftigt). */
export const MAX_WATCH_MS = 15000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Hält die Liste auf `MAX_MARKS`: erst fallen eigene laufende Marken heraus (die älteste zuerst), dann die ältesten überhaupt. */
function rotate(marks: Mark[], session: string): Mark[] {
  const out = [...marks];
  while (out.length > MAX_MARKS) {
    const i = out.findIndex((m) => m.session === session && m.slow !== true);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}

/** Liest die gespeicherte Liste; jeder ungültige Eintrag fällt einzeln weg, alles Unlesbare ergibt eine leere Liste. */
export function parseMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const m of raw) {
    if (isRecord(m) && typeof m.fp === "string" && /^[0-9a-f]{64}$/.test(m.fp) && typeof m.at === "number" && Number.isFinite(m.at)) {
      out.push({ fp: m.fp, at: m.at, session: typeof m.session === "string" ? m.session : "", ...(m.slow === true ? { slow: true as const } : {}) });
    }
  }
  return rotate(out, "");
}

/** Setzt die Marke (eine vorhandene mit demselben Fingerabdruck wird ersetzt und rückt ans Ende; eine `slow`-Marke bleibt `slow`). */
export function addMark(marks: readonly Mark[], fp: string, at: number, session: string): Mark[] {
  // Eine abgelaufene slow-Marke wird nicht erneuert: sonst sperrte sie nach jedem freien Zeichnen wieder.
  const slow = marks.some((m) => m.fp === fp && m.slow === true && at - m.at <= MARK_MAX_AGE_MS);
  return rotate([...marks.filter((m) => m.fp !== fp), { fp, at, session, ...(slow ? { slow: true as const } : {}) }], session);
}

/** Macht die Marke zur `slow`-Marke (sie bleibt stehen, bis der Nutzer „Trotzdem anzeigen“ wählt). Ohne Marke steht danach eine. */
export function markSlow(marks: readonly Mark[], fp: string, at: number, session: string): Mark[] {
  return rotate([...marks.filter((m) => m.fp !== fp), { fp, at, session, slow: true as const }], session);
}

/** Entfernt die Marke dieses Fingerabdrucks. Mit `onlyOwn` (die eigene Sitzung) nur eine eigene Marke ohne `slow`: die einer früheren Sitzung und die `slow`-Marke bleiben. */
export function removeMark(marks: readonly Mark[], fp: string, onlyOwn?: string): Mark[] {
  return marks.filter((m) => m.fp !== fp || (onlyOwn !== undefined && (m.session !== onlyOwn || m.slow === true)));
}

/** Eine Marke älter als das verhindert nie mehr ein Rendern (eine hängengebliebene Marke darf einen Block nicht dauerhaft sperren); „Trotzdem anzeigen“ löscht sie ohnehin.
 *  Eine Woche, nicht eine Stunde: Obsidian friert ein, wird hart beendet und am nächsten Morgen wieder geöffnet. */
export const MARK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Blockiert die Marke die Anzeige? Ja, wenn sie `slow` ist oder aus einer anderen Sitzung stammt (Obsidian ist danach beendet worden). Eine Marke der eigenen Sitzung
 * ohne `slow` gehört zu einem Bild, das gerade gezeichnet wird. Nie blockieren: eine Marke ohne bekannte Sitzung (kaputter Eintrag) und eine, die älter als
 * `MARK_MAX_AGE_MS` ist (`now` ist die Wanduhr wie `Mark.at`).
 */
export function isBlocked(marks: readonly Mark[], fp: string, session: string, now: number): boolean {
  return marks.some((m) => m.fp === fp && m.session !== "" && now - m.at <= MARK_MAX_AGE_MS && (m.slow === true || m.session !== session));
}
