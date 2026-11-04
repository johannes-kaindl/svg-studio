import { describe, expect, it } from "vitest";
import { formatMeasureLine, type MeasureTexts } from "../../src/core/measure-line";
import type { Canvas } from "../../src/core/measure";

const EN: MeasureTexts = { decimal: ".", area: "Area", drawing: "Drawing", at: "at", units: "units", ambiguous: "ambiguous" };
const DE: MeasureTexts = { decimal: ",", area: "Fläche", drawing: "Zeichnung", at: "bei", units: "Einheiten", ambiguous: "mehrdeutig" };
const canvas = (over: Partial<Canvas> = {}): Canvas => ({ width: 460, height: 425, unit: "cm", source: "viewBox", ...over });
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("formatMeasureLine", () => {
  it("Fläche und Zeichnung", () => {
    expect(formatMeasureLine({ canvas: canvas(), drawing: box(20, 20, 420, 385), selected: null }, DE)).toBe("Fläche 460 × 425 cm · Zeichnung 420 × 385 cm");
    expect(formatMeasureLine({ canvas: canvas(), drawing: box(20, 20, 420, 385), selected: null }, EN)).toBe("Area 460 × 425 cm · Drawing 420 × 385 cm");
  });

  it("ein gewähltes Element ersetzt die Zeichnung: Größe und Lage", () => {
    const o = { canvas: canvas(), drawing: box(20, 20, 420, 385), selected: { id: "wand-nord", box: box(20, 20, 420, 12) } };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 460 × 425 cm · wand-nord: 420 × 12 cm bei 20, 20");
    expect(formatMeasureLine(o, EN)).toBe("Area 460 × 425 cm · wand-nord: 420 × 12 cm at 20, 20");
  });

  it("ohne Einheit steht „Einheiten“ bzw. „units“", () => {
    const o = { canvas: canvas({ unit: null }), drawing: box(0, 0, 10, 20), selected: null };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 460 × 425 Einheiten · Zeichnung 10 × 20 Einheiten");
    expect(formatMeasureLine(o, EN)).toBe("Area 460 × 425 units · Drawing 10 × 20 units");
  });

  it("Dezimaltrennzeichen: deutsch Komma, englisch Punkt; höchstens zwei Stellen, keine Nullen am Ende", () => {
    const o = { canvas: canvas({ width: 4.2, height: 3.6 }), drawing: box(0.5, 1.255, 3.10, 2.004), selected: null };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 4,2 × 3,6 cm · Zeichnung 3,1 × 2 cm");
    expect(formatMeasureLine(o, EN)).toBe("Area 4.2 × 3.6 cm · Drawing 3.1 × 2 cm");
    const s = { canvas: canvas(), drawing: null, selected: { id: "a", box: box(0.5, 1.25, 3, 2) } };
    expect(formatMeasureLine(s, DE)).toContain("a: 3 × 2 cm bei 0,5, 1,25");
    expect(formatMeasureLine(s, EN)).toContain("a: 3 × 2 cm at 0.5, 1.25");
  });

  it("negative Lage und Minus-Null", () => {
    const s = { canvas: canvas(), drawing: null, selected: { id: "a", box: box(-5, -0.001, 3, 2) } };
    expect(formatMeasureLine(s, EN)).toContain("at -5, 0");
  });

  it("fehlt etwas, fehlt nur dieser Teil", () => {
    expect(formatMeasureLine({ canvas: canvas(), drawing: null, selected: null }, DE)).toBe("Fläche 460 × 425 cm");
    expect(formatMeasureLine({ canvas: null, drawing: box(0, 0, 5, 6), selected: null }, DE)).toBe("Zeichnung 5 × 6 Einheiten");
    expect(formatMeasureLine({ canvas: null, drawing: null, selected: null }, DE)).toBe("");
  });

  it("eine Box mit NaN oder unendlichen Werten zählt als nicht gemessen", () => {
    expect(formatMeasureLine({ canvas: canvas(), drawing: box(0, 0, Number.NaN, 5), selected: null }, DE)).toBe("Fläche 460 × 425 cm");
    expect(formatMeasureLine({ canvas: canvas(), drawing: null, selected: { id: "a", box: box(0, 0, Infinity, 5) } }, DE)).toBe("Fläche 460 × 425 cm");
  });

  it("Quelle: nur Canvas und Box; die Einheit stammt aus data-unit (Canvas), nie aus einer Zahl der Modellantwort", () => {
    // Eine Box mit Zusatzfeldern (etwa aus einer Antwort) ändert die Zeile nicht.
    const o = { canvas: canvas(), drawing: { ...box(0, 0, 1, 2), label: "999 × 999" }, selected: null };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 460 × 425 cm · Zeichnung 1 × 2 cm");
  });

  it("N1: nur bekannte Einheiten stehen in der Zeile; alles andere heißt „Einheiten“", () => {
    for (const unit of ["mm", "cm", "m", "km", "in", "ft", "yd", "pt", "pc", "px"]) {
      expect(formatMeasureLine({ canvas: canvas({ unit }), drawing: null, selected: null }, EN), unit).toBe(`Area 460 × 425 ${unit}`);
    }
    expect(formatMeasureLine({ canvas: canvas({ unit: "CM" }), drawing: null, selected: null }, EN)).toBe("Area 460 × 425 cm");
    for (const unit of ["cm \u202E", "\u202Ecm", "cm\n· Fläche 1 × 1 m", "5 cm", "meter", "x".repeat(500), "", "c\u200Bm"]) {
      const line = formatMeasureLine({ canvas: canvas({ unit }), drawing: box(0, 0, 1, 1), selected: null }, EN);
      expect(line, JSON.stringify(unit)).toBe("Area 460 × 425 units · Drawing 1 × 1 units");
    }
  });

  it("N1: die id in der Zeile ohne Steuer- und Bidi-Zeichen, lange ids gekürzt", () => {
    const sel = (id: string) => ({ canvas: canvas(), drawing: null, selected: { id, box: box(1, 2, 3, 4) } });
    expect(formatMeasureLine(sel("wand\u202E-nord\u2066\u200B\u0000\n"), EN)).toBe("Area 460 × 425 cm · wand-nord: 3 × 4 cm at 1, 2");
    const long = formatMeasureLine(sel("a".repeat(500)), EN);
    expect(long).toBe(`Area 460 × 425 cm · ${"a".repeat(39)}…: 3 × 4 cm at 1, 2`);
    expect(formatMeasureLine(sel("ä".repeat(40)), EN)).toContain(`${"ä".repeat(40)}:`);
    // Auch ein Zeichen jenseits der BMP wird nicht mitten im Paar geschnitten.
    expect(formatMeasureLine(sel("😀".repeat(60)), EN)).toBe(`Area 460 × 425 cm · ${"😀".repeat(39)}…: 3 × 4 cm at 1, 2`);
  });

  it("N2: Extremwerte werden nie als „1e+3“ oder „Infinity“ gezeigt; der Teil fällt weg", () => {
    const line = (c: Partial<Canvas>, b: ReturnType<typeof box> | null) => formatMeasureLine({ canvas: canvas(c), drawing: b, selected: null }, EN);
    expect(line({ width: 1e30 }, null)).toBe("");
    expect(line({ width: Infinity }, null)).toBe("");
    expect(line({ height: Number.NaN }, box(0, 0, 3, 4))).toBe("Drawing 3 × 4 cm");
    expect(line({}, box(0, 0, 5e40, 4))).toBe("Area 460 × 425 cm");
    expect(line({}, box(1e13, 0, 4, 4))).toBe("Area 460 × 425 cm");
    expect(line({ width: 1e12, height: 999999999999.5 }, null)).toBe("Area 1000000000000 × 999999999999.5 cm");
    expect(line({}, null)).not.toMatch(/e\+|Infinity|NaN/);
  });

  it("N3: eine Null-Box (verborgenes Panel, leeres Element) zählt als nicht gemessen", () => {
    expect(formatMeasureLine({ canvas: canvas(), drawing: box(0, 0, 0, 0), selected: null }, DE)).toBe("Fläche 460 × 425 cm");
    const o = { canvas: canvas(), drawing: box(0, 0, 9, 9), selected: { id: "a", box: box(0, 0, 0, 0) } };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 460 × 425 cm · Zeichnung 9 × 9 cm");
    // Eine Linie (Höhe 0, Breite > 0) ist gemessen.
    expect(formatMeasureLine({ canvas: null, drawing: box(0, 0, 5, 0), selected: null }, DE)).toBe("Zeichnung 5 × 0 Einheiten");
  });

  it("S3: eine mehrdeutige id trägt den Hinweis", () => {
    const o = { canvas: canvas(), drawing: null, selected: { id: "dup", box: box(0, 0, 80, 80), ambiguous: true } };
    expect(formatMeasureLine(o, DE)).toBe("Fläche 460 × 425 cm · dup: 80 × 80 cm bei 0, 0 (mehrdeutig)");
    expect(formatMeasureLine(o, EN)).toContain("(ambiguous)");
    expect(formatMeasureLine({ ...o, selected: { ...o.selected, ambiguous: false } }, DE)).not.toContain("mehrdeutig");
  });
});
