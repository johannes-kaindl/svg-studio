import { describe, expect, it } from "vitest";
import { addMark, isMarked, MAX_MARKS, parseMarks, removeMark } from "../../src/core/render-guard";

const fp = (n: number): string => n.toString(16).padStart(64, "0");

describe("render-guard: Liste der Absturzmarken", () => {
  it("setzen, finden, entfernen", () => {
    const m = addMark([], fp(1), 10);
    expect(isMarked(m, fp(1))).toBe(true);
    expect(isMarked(m, fp(2))).toBe(false);
    expect(removeMark(m, fp(1))).toEqual([]);
  });

  it("dieselbe Marke zweimal ergibt einen Eintrag mit dem neueren Zeitpunkt", () => {
    const m = addMark(addMark([], fp(1), 10), fp(1), 20);
    expect(m).toEqual([{ fp: fp(1), at: 20 }]);
  });

  it("mehr als MAX_MARKS: die ältesten fallen heraus", () => {
    let m = parseMarks([]);
    for (let i = 0; i < MAX_MARKS + 5; i++) m = addMark(m, fp(i), i);
    expect(m).toHaveLength(MAX_MARKS);
    expect(isMarked(m, fp(0))).toBe(false);
    expect(isMarked(m, fp(MAX_MARKS + 4))).toBe(true);
  });

  it("parseMarks: Unlesbares ergibt eine leere Liste, einzelne kaputte Einträge fallen weg", () => {
    for (const bad of [null, undefined, 3, "x", {}, { fp: fp(1), at: 1 }]) expect(parseMarks(bad)).toEqual([]);
    expect(parseMarks([{ fp: fp(1), at: 5 }, { fp: "kurz", at: 5 }, { fp: fp(2), at: "x" }, { fp: fp(3), at: Infinity }, null, 7])).toEqual([{ fp: fp(1), at: 5 }]);
  });
});
