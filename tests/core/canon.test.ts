import { describe, expect, it } from "vitest";
import { buildCanonTree, canonDocument, canonNode, normalizeValue } from "../../src/core/canon";

const doc = (t: string): string => {
  const c = canonDocument(t);
  if (c === null) throw new Error("erwartet lesbar");
  return c;
};
const A = `<svg viewBox="0 0 9 9"><g id="g"><rect id="a" x="1" y="2"/><rect id="b"/></g></svg>`;

describe("normalizeValue", () => {
  it("kürzt und fasst Leerraum zusammen", () => {
    expect(normalizeValue("  M0 0 \n\t L1   1 ")).toBe("M0 0 L1 1");
    expect(normalizeValue("")).toBe("");
    expect(normalizeValue("   ")).toBe("");
  });
  it("kürzt nur XML-Leerraum, nicht NBSP oder andere Unicode-Leerzeichen", () => {
    expect(normalizeValue("\u00a0a\u00a0")).toBe("\u00a0a\u00a0");
    expect(normalizeValue(" \u000b5 ")).toBe("\u000b5");
  });
});

describe("canonDocument", () => {
  it("Attributreihenfolge ist egal", () => {
    expect(doc(A)).toBe(doc(A.replace(`x="1" y="2"`, `y="2" x="1"`)));
  });
  it("Leerraum zwischen Tags ist egal", () => {
    expect(doc(A)).toBe(doc(`<svg viewBox="0 0 9 9">\n  <g id="g">\n    <rect id="a" x="1" y="2"/>\n    <rect id="b"/>\n  </g>\n</svg>\n`));
  });
  it("Kommentare sind egal", () => {
    expect(doc(A)).toBe(doc(A.replace("<g", "<!-- hallo --><g").replace("</g>", "<!-- x --></g>")));
  });
  it("selbstschließend und leer geöffnet sind gleich", () => {
    expect(doc(A)).toBe(doc(A.replace(`<rect id="b"/>`, `<rect id="b"></rect>`)));
  });
  it("ein neu umbrochenes d ist gleich", () => {
    expect(doc(`<svg><path id="p" d="M0 0 L1 1"/></svg>`)).toBe(doc(`<svg><path id="p" d="M0 0\n   L1 1"/></svg>`));
  });
  it("ein geänderter Wert ist ungleich", () => {
    expect(doc(A)).not.toBe(doc(A.replace(`x="1"`, `x="2"`)));
  });
  it("ein anderes Kind, eine andere Reihenfolge, ein anderer Tag sind ungleich", () => {
    expect(doc(A)).not.toBe(doc(A.replace(`<rect id="b"/>`, `<circle id="b"/>`)));
    expect(doc(A)).not.toBe(doc(`<svg viewBox="0 0 9 9"><g id="g"><rect id="b"/><rect id="a" x="1" y="2"/></g></svg>`));
  });
  it("eigener Text ist kollabiert: 'a  b' gleich 'a b', 'a b' ungleich 'a c'", () => {
    expect(doc(`<svg><text id="t">a  b</text></svg>`)).toBe(doc(`<svg><text id="t">a b</text></svg>`));
    expect(doc(`<svg><text id="t">\n  a b\n</text></svg>`)).toBe(doc(`<svg><text id="t">a b</text></svg>`));
    expect(doc(`<svg><text id="t">a b</text></svg>`)).not.toBe(doc(`<svg><text id="t">a c</text></svg>`));
  });
  it("Text zwischen Kindern zählt mit seiner Stelle", () => {
    expect(doc(`<svg><text id="t">a<tspan id="s">b</tspan>c</text></svg>`)).not.toBe(doc(`<svg><text id="t">ac<tspan id="s">b</tspan></text></svg>`));
  });
  it("Leerraum zwischen zwei Kindern eines Textelements zählt (b c gegen bc)", () => {
    expect(doc(`<svg><text id="t">a<tspan id="s">b</tspan> <tspan id="u">c</tspan></text></svg>`)).not.toBe(
      doc(`<svg><text id="t">a<tspan id="s">b</tspan><tspan id="u">c</tspan></text></svg>`),
    );
    // außen ist er egal
    expect(doc(`<svg><text id="t"> <tspan id="s">b</tspan> </text></svg>`)).toBe(doc(`<svg><text id="t"><tspan id="s">b</tspan></text></svg>`));
  });
  it("xml:space=preserve behält Leerraum im Text", () => {
    expect(doc(`<svg><text id="t" xml:space="preserve">a  b</text></svg>`)).not.toBe(doc(`<svg><text id="t" xml:space="preserve">a b</text></svg>`));
  });
  it("Schreibweise des Tags und fremder Namensraum unterscheiden sich", () => {
    expect(doc(`<svg><rect id="a"/></svg>`)).not.toBe(doc(`<svg><RECT id="a"/></svg>`));
    expect(doc(`<svg><rect id="a"/></svg>`)).not.toBe(doc(`<svg><x:rect id="a"/></svg>`));
  });
  it("ein Syntaxbefund gibt null", () => {
    expect(canonDocument(`<svg><rect id="a"></svg>`)).toBeNull();
    expect(canonDocument(``)).toBeNull();
  });
  it("doppelte ids sind erlaubt", () => {
    expect(canonDocument(`<svg><rect id="d"/><rect id="d"/></svg>`)).not.toBeNull();
  });
});

describe("buildCanonTree und canonNode", () => {
  it("Eltern, Kinder und Knotenform", () => {
    const t = buildCanonTree(A)!;
    expect(t.elements.map((e) => e.key)).toEqual(["#wurzel", "g", "a", "b"]);
    expect(t.parent).toEqual([-1, 0, 1, 1]);
    expect(t.kids).toEqual([[1], [2, 3], [], []]);
    const a = t.elements.findIndex((e) => e.key === "a");
    expect(canonNode(t, a)).toBe(canonNode(buildCanonTree(`<svg><g><rect y="2"  x="1" id="a"/></g></svg>`)!, 2));
    expect(canonNode(t, 0)).toBe(canonDocument(A));
  });
  it("null bei Syntaxbefund", () => {
    expect(buildCanonTree(`<svg><a x=1/></svg>`)).toBeNull();
  });
});
