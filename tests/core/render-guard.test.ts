import { describe, expect, it } from "vitest";
import { addMark, isBlocked, markSlow, MARK_MAX_AGE_MS, MAX_MARKS, parseMarks, removeMark } from "../../src/core/render-guard";

const fp = (n: number): string => n.toString(16).padStart(64, "0");

describe("render-guard: Liste der Absturzmarken", () => {
  it("setzen, finden (andere Sitzung), entfernen", () => {
    const m = addMark([], fp(1), 10, "s1");
    expect(isBlocked(m, fp(1), "s2", 20)).toBe(true);
    expect(isBlocked(m, fp(2), "s2", 20)).toBe(false);
    expect(removeMark(m, fp(1))).toEqual([]);
  });

  it("eine Marke der eigenen Sitzung ohne slow blockiert nicht (das Bild wird gerade gezeichnet); mit slow blockiert sie auch dort", () => {
    const m = addMark([], fp(1), 10, "s1");
    expect(isBlocked(m, fp(1), "s1", 20)).toBe(false);
    expect(isBlocked(markSlow(m, fp(1), 20, "s1"), fp(1), "s1", 30)).toBe(true);
  });

  it("eine Marke älter als eine Stunde sperrt nie mehr (auch slow); genau eine Stunde noch", () => {
    const m = markSlow([], fp(1), 0, "s1");
    expect(isBlocked(m, fp(1), "s2", MARK_MAX_AGE_MS)).toBe(true);
    expect(isBlocked(m, fp(1), "s2", MARK_MAX_AGE_MS + 1)).toBe(false);
  });

  it("eine Marke ohne bekannte Sitzung (kaputter Eintrag) sperrt nie", () => {
    expect(isBlocked(parseMarks([{ fp: fp(4), at: 1 }]), fp(4), "jetzt", 2)).toBe(false);
  });

  it("dieselbe Marke zweimal ergibt einen Eintrag mit dem neueren Zeitpunkt; eine slow-Marke bleibt slow", () => {
    expect(addMark(addMark([], fp(1), 10, "s1"), fp(1), 20, "s1")).toEqual([{ fp: fp(1), at: 20, session: "s1" }]);
    expect(addMark(markSlow([], fp(1), 10, "s1"), fp(1), 20, "s2")).toEqual([{ fp: fp(1), at: 20, session: "s2", slow: true }]);
  });

  it("mehr als MAX_MARKS: zuerst fallen eigene laufende Marken heraus; slow und fremde Sitzungen bleiben", () => {
    let m = markSlow([], fp(1000), 0, "alt"); // slow, fremde Sitzung
    m = addMark(m, fp(1001), 0, "fremd"); // nicht slow, andere Sitzung
    for (let i = 0; i < MAX_MARKS + 5; i++) m = addMark(m, fp(i), i + 1, "ich");
    expect(m).toHaveLength(MAX_MARKS);
    expect(m.some((x) => x.fp === fp(1000))).toBe(true);
    expect(m.some((x) => x.fp === fp(1001))).toBe(true);
    expect(m.some((x) => x.fp === fp(0))).toBe(false); // die älteste eigene laufende Marke ist gefallen
    expect(m.some((x) => x.fp === fp(MAX_MARKS + 4))).toBe(true);
  });

  it("sind alle Marken slow, fällt die älteste", () => {
    let m: ReturnType<typeof markSlow> = [];
    for (let i = 0; i < MAX_MARKS + 2; i++) m = markSlow(m, fp(i), i, "ich");
    expect(m).toHaveLength(MAX_MARKS);
    expect(m.some((x) => x.fp === fp(0))).toBe(false);
  });

  it("removeMark mit onlyOwn entfernt nur die eigene Marke ohne slow", () => {
    const eigen = addMark([], fp(1), 1, "s1");
    expect(removeMark(eigen, fp(1), "s1")).toEqual([]);
    expect(removeMark(eigen, fp(1), "s2")).toEqual(eigen);
    const slow = markSlow([], fp(1), 1, "s1");
    expect(removeMark(slow, fp(1), "s1")).toEqual(slow);
    expect(removeMark(slow, fp(1))).toEqual([]);
  });

  it("parseMarks: Unlesbares ergibt eine leere Liste, einzelne kaputte Einträge fallen weg", () => {
    for (const bad of [null, undefined, 3, "x", {}, { fp: fp(1), at: 1 }]) expect(parseMarks(bad)).toEqual([]);
    expect(parseMarks([{ fp: fp(1), at: 5, session: "a", slow: true }, { fp: "kurz", at: 5 }, { fp: fp(2), at: "x" }, { fp: fp(3), at: Infinity }, null, 7, { fp: fp(4), at: 1 }])).toEqual([
      { fp: fp(1), at: 5, session: "a", slow: true },
      { fp: fp(4), at: 1, session: "" },
    ]);
  });
});
