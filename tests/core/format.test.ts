import { describe, expect, it } from "vitest";
import { assignMissingIds, ensureUnit } from "../../src/core/format";
import { scanElements } from "../../src/core/elements";

describe("assignMissingIds", () => {
  it("vergibt <tag>-<n> mit laufender Nummer je Tag und überspringt belegte Namen", () => {
    const t = `<svg viewBox="0 0 1 1">\n  <rect/>\n  <circle/>\n  <rect id="rect-2"/>\n  <rect/>\n</svg>`;
    const r = assignMissingIds(t);
    expect(r.assigned).toEqual(["rect-1", "circle-1", "rect-3"]);
    expect(r.text).toBe(`<svg viewBox="0 0 1 1">\n  <rect id="rect-1"/>\n  <circle id="circle-1"/>\n  <rect id="rect-2"/>\n  <rect id="rect-3"/>\n</svg>`);
    expect(scanElements(r.text).issues).toEqual([]);
  });

  it("gibt Wurzel, style, title und desc keine id", () => {
    const t = `<svg><title>T</title><desc>D</desc><style>a{}</style><path d="M0 0"/></svg>`;
    const r = assignMissingIds(t);
    expect(r.assigned).toEqual(["path-1"]);
    expect(r.text).toBe(`<svg><title>T</title><desc>D</desc><style>a{}</style><path d="M0 0" id="path-1"/></svg>`);
  });

  it("füllt eine leere id, statt ein zweites Attribut anzuhängen", () => {
    const r = assignMissingIds(`<svg><rect id=""/></svg>`);
    expect(r.text).toBe(`<svg><rect id="rect-1"/></svg>`);
  });

  it("lässt Text mit Scan-Befunden unverändert und meldet sie", () => {
    const t = `<svg><rect id=x/><circle/></svg>`;
    const r = assignMissingIds(t);
    expect(r.text).toBe(t);
    expect(r.assigned).toEqual([]);
    expect(r.issues?.length).toBeGreaterThan(0);
  });

  it("lässt vollständigen Text byte-gleich", () => {
    const t = `<svg>\r\n  <rect id="a"/>\r\n</svg>`;
    expect(assignMissingIds(t)).toEqual({ text: t, assigned: [] });
  });

  it("meidet auch belegte Schlüssel", () => {
    // `@1` ist als Schlüssel nie eine id-Folge `<tag>-<n>`; ein vorhandenes `rect-1` auf einem anderen Tag zählt nicht.
    const r = assignMissingIds(`<svg><circle id="rect-1"/><rect/></svg>`);
    expect(r.assigned).toEqual(["rect-2"]);
  });
});

describe("ensureUnit", () => {
  it("setzt data-unit an der Wurzel, wenn es fehlt, sonst nichts", () => {
    const t = `<svg viewBox="0 0 10 10">\n  <rect id="a"/>\n</svg>\n`;
    expect(ensureUnit(t, "cm")).toBe(`<svg viewBox="0 0 10 10" data-unit="cm">\n  <rect id="a"/>\n</svg>\n`);
    const had = `<svg data-unit="mm" viewBox="0 0 10 10"/>`;
    expect(ensureUnit(had, "cm")).toBe(had);
  });

  it("verändert Text ohne Wurzel nicht", () => {
    expect(ensureUnit("kein svg", "cm")).toBe("kein svg");
  });

});

describe("doppelte ids und Syntaxbefunde", () => {
  it("vergibt ids auch neben einer doppelten id anderswo (Spec § 6.2)", () => {
    const t = `<svg>\n  <rect id="a"/>\n  <rect id="a"/>\n  <circle/>\n</svg>`;
    const r = assignMissingIds(t);
    expect(r.issues).toBeUndefined();
    expect(r.assigned).toEqual(["circle-1"]);
    expect(r.text).toBe(`<svg>\n  <rect id="a"/>\n  <rect id="a"/>\n  <circle id="circle-1"/>\n</svg>`);
  });

  it("ensureUnit lässt Text mit Syntaxbefunden unverändert", () => {
    const t = `<svg data-unit=cm viewBox="0 0 1 1"></svg>`;
    expect(ensureUnit(t, "cm")).toBe(t);
    const dup = `<svg viewBox="0 0 1 1"><rect id="a"/><rect id="a"/></svg>`;
    expect(ensureUnit(dup, "cm")).toBe(`<svg viewBox="0 0 1 1" data-unit="cm"><rect id="a"/><rect id="a"/></svg>`);
  });
});

describe("ensureUnit: Einheit mit Steuerzeichen", () => {
  it("lässt den Text unverändert, statt zu werfen", () => {
    const t = `<svg viewBox="0 0 1 1"/>`;
    expect(ensureUnit(t, "c\u0001m")).toBe(t);
    expect(ensureUnit(t, "cm")).toBe(`<svg viewBox="0 0 1 1" data-unit="cm"/>`);
  });
});
