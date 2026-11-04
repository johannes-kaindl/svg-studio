// Maßzeile des Panels (Spec § 7.4): „Fläche 460 × 425 cm · Zeichnung 420 × 385 cm“, bei gewähltem Element „wand-nord: 420 × 12 cm bei 20, 20“. Pure.
// Die Zahlen kommen aus `Canvas` (`measureCanvas`, aus dem Text) und `Box` (`getBBox()` am gerenderten SVG, also vom Browser); keine Zahl stammt aus
// der Modellantwort. Die Texte kommen als Parameter (`MeasureTexts`), die Funktion kennt keine Sprache.
import type { Canvas } from "./measure";

/** Ausdehnung im Benutzerraum der Zeichnung. */
export interface Box { x: number; y: number; width: number; height: number }

export interface MeasureTexts {
  /** Dezimaltrennzeichen der Sprache. */
  decimal: "." | ",";
  area: string;
  drawing: string;
  /** „bei“ vor der Lage eines gewählten Elements. */
  at: string;
  /** Statt der Einheit, wenn die Wurzel kein (bekanntes) `data-unit` trägt. */
  units: string;
  /** Hinweis hinter einem gewählten Element, dessen `id` mehrfach vorkommt. */
  ambiguous: string;
}

export interface MeasureInput {
  canvas: Canvas | null;
  drawing: Box | null;
  selected: { id: string; box: Box; ambiguous?: boolean } | null;
}

/** Größer als das ist kein Maß einer Zeichnung mehr; die Zahl bliebe auch nicht lesbar (`toFixed` schriebe Exponenten). */
const LIMIT = 1e12;
const sane = (n: number): boolean => Number.isFinite(n) && Math.abs(n) <= LIMIT;
/** Eine Box zählt als gemessen, wenn alle Werte vernünftig sind und sie Fläche hat (die Null-Box meldet Chromium für ein verborgenes oder leeres Element). */
const measured = (b: Box): boolean => [b.x, b.y, b.width, b.height].every(sane) && !(b.width === 0 && b.height === 0);

/** Einheiten, die in der Zeile stehen dürfen. `data-unit` kommt aus dem SVG, also vom Modell: freier Text könnte die Zeile umkehren (Bidi), eine falsche Zeile einschieben oder sie
 *  beliebig lang machen. Alles andere heißt „Einheiten“. */
const UNITS: ReadonlySet<string> = new Set(["mm", "cm", "m", "km", "in", "ft", "yd", "pt", "pc", "px"]);
/** Steuer- (Cc), Format- (Cf: Bidi-Marken und -Isolate, Zero-Width, BOM) und Zeilentrenner-Zeichen (Zl, Zp). */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MAX_ID = 40;

/** Die `id` für die Zeile: ohne Steuer- und Bidi-Zeichen, auf `MAX_ID` Zeichen gekürzt. */
function shownId(id: string): string {
  const clean = id.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  return chars.length > MAX_ID ? `${chars.slice(0, MAX_ID - 1).join("")}…` : clean;
}

/** Höchstens zwei Stellen, keine Nullen am Ende, kein „-0“. */
function num(n: number, decimal: "." | ","): string {
  let s = (Math.round(n * 100) / 100).toFixed(2);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return decimal === "," ? s.replace(".", ",") : s;
}

export function formatMeasureLine(o: MeasureInput, t: MeasureTexts): string {
  const given = o.canvas?.unit?.toLowerCase() ?? null;
  const unit = given !== null && UNITS.has(given) ? given : t.units;
  const size = (w: number, h: number): string => `${num(w, t.decimal)} × ${num(h, t.decimal)} ${unit}`;
  const parts: string[] = [];
  if (o.canvas !== null && sane(o.canvas.width) && sane(o.canvas.height)) parts.push(`${t.area} ${size(o.canvas.width, o.canvas.height)}`);
  if (o.selected !== null && measured(o.selected.box)) {
    const b = o.selected.box;
    const warn = o.selected.ambiguous === true ? ` (${t.ambiguous})` : "";
    parts.push(`${shownId(o.selected.id)}: ${size(b.width, b.height)} ${t.at} ${num(b.x, t.decimal)}, ${num(b.y, t.decimal)}${warn}`);
  } else if (o.drawing !== null && measured(o.drawing)) {
    parts.push(`${t.drawing} ${size(o.drawing.width, o.drawing.height)}`);
  }
  return parts.join(" · ");
}
