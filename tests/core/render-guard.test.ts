import { describe, expect, it } from "vitest";
import { addMark, isBlocked, markSlow, MAX_MARKS, parseMarks, removeMark } from "../../src/core/render-guard";

const fp = (n: number): string => n.toString(16).padStart(64, "0");

describe("render-guard: Liste der Absturzmarken", () => {
  it("setzen, finden (andere Sitzung), entfernen", () => {
    const m = addMark([], fp(1), 10, "s1");
    expect(isBlocked(m, fp(1), "s2")).toBe(true);
    expect(isBlocked(m, fp(2), "s2")).toBe(false);
    expect(removeMark(m, fp(1))).toEqual([]);
  });

  it("eine Marke der eigenen Sitzung ohne slow blockiert nicht (das Bild wird gerade gezeichnet); mit slow blockiert sie auch dort", () => {
    const m = addMark([], fp(1), 10, "s1");
    expect(isBlocked(m, fp(1), "s1")).toBe(false);
    expect(isBlocked(markSlow(m, fp(1), 20, "s1"), fp(1), "s1")).toBe(true);
  });

  it("dieselbe Marke zweimal ergibt einen Eintrag mit dem neueren Zeitpunkt; eine slow-Marke bleibt slow", () => {
    expect(addMark(addMark([], fp(1), 10, "s1"), fp(1), 20, "s1")).toEqual([{ fp: fp(1), at: 20, session: "s1" }]);
    expect(addMark(markSlow([], fp(1), 10, "s1"), fp(1), 20, "s2")).toEqual([{ fp: fp(1), at: 20, session: "s2", slow: true }]);
  });

  it("mehr als MAX_MARKS: die ältesten fallen heraus", () => {
    let m = parseMarks([]);
    for (let i = 0; i < MAX_MARKS + 5; i++) m = addMark(m, fp(i), i, "s");
    expect(m).toHaveLength(MAX_MARKS);
    expect(isBlocked(m, fp(0), "x")).toBe(false);
    expect(isBlocked(m, fp(MAX_MARKS + 4), "x")).toBe(true);
  });

  it("parseMarks: Unlesbares ergibt eine leere Liste, einzelne kaputte Einträge fallen weg, ein Eintrag ohne Sitzung gilt als fremde", () => {
    for (const bad of [null, undefined, 3, "x", {}, { fp: fp(1), at: 1 }]) expect(parseMarks(bad)).toEqual([]);
    expect(parseMarks([{ fp: fp(1), at: 5, session: "a", slow: true }, { fp: "kurz", at: 5 }, { fp: fp(2), at: "x" }, { fp: fp(3), at: Infinity }, null, 7, { fp: fp(4), at: 1 }])).toEqual([
      { fp: fp(1), at: 5, session: "a", slow: true },
      { fp: fp(4), at: 1, session: "" },
    ]);
    expect(isBlocked(parseMarks([{ fp: fp(4), at: 1 }]), fp(4), "jetzt")).toBe(true);
  });
});
