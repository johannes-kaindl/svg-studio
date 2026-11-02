import { describe, expect, it } from "vitest";
import { attr, scanElements } from "../../src/core/elements";

const find = (els: ReturnType<typeof scanElements>["elements"], key: string) => {
  const el = els.find((e) => e.key === key);
  if (!el) throw new Error(`Element ${key} fehlt`);
  return el;
};

describe("scanElements", () => {
  it("findet Elemente mit Offsets", () => {
    const text = `<svg viewBox="0 0 10 10"><circle id="mond" cx="5" cy="5" r="4"/></svg>`;
    const { elements, issues } = scanElements(text);
    expect(issues).toEqual([]);
    const mond = find(elements, "mond");
    expect(text.slice(mond.start, mond.end)).toBe(`<circle id="mond" cx="5" cy="5" r="4"/>`);
    expect(mond.id).toBe("mond");
    expect(mond.tag).toBe("circle");
    expect(mond.parentKey).toBe("#wurzel");
    expect(mond.selfClosing).toBe(true);
    expect(mond.closeStart).toBe(mond.openEnd);
    expect(mond.attrs.map((a) => a.name)).toEqual(["id", "cx", "cy", "r"]);
    const r = mond.attrs[3]!;
    expect(text.slice(r.start, r.start + 1)).toBe("r");
    expect(text.slice(r.valueStart, r.valueEnd)).toBe("4");
    expect(text[r.valueEnd]).toBe('"');
    const root = find(elements, "#wurzel");
    expect(root.parentKey).toBeNull();
    expect(root.id).toBeNull();
    expect(text.slice(root.closeStart, root.end)).toBe("</svg>");
  });

  it("vergibt feste Schlüssel", () => {
    const text = `<svg><style>a{}</style><style>b{}</style><title>T</title><desc>D</desc></svg>`;
    const keys = scanElements(text).elements.map((e) => e.key);
    expect(keys).toEqual(["#wurzel", "#style-1", "#style-2", "#title", "#desc"]);
  });

  it("fester Schlüssel schlägt die id (Wurzel, style, title)", () => {
    const { elements } = scanElements(`<svg id="svg5"><style id="s">a{}</style><title id="t">x</title><rect id="r"/></svg>`);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel", "#style-1", "#title", "r"]);
    expect(elements[0]!.id).toBe("svg5");
    expect(elements[1]!.id).toBe("s");
    expect(elements[3]!.parentKey).toBe("#wurzel");
  });

  it("#title und #desc nur für direkte Kinder der Wurzel", () => {
    const { elements } = scanElements(`<svg><g id="g"><title>t</title></g><title>doc</title><desc>d</desc></svg>`);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel", "g", "@1", "#title", "#desc"]);
    expect(elements[2]!.parentKey).toBe("g");
  });

  it("vergibt @n ohne id", () => {
    const { elements } = scanElements(`<svg><rect/><rect/></svg>`);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel", "@1", "@2"]);
    expect(elements[1]!.id).toBeNull();
  });

  it("Kommentar und CDATA erzeugen nichts", () => {
    const text = `<svg><!-- <rect id="x"/> --><style><![CDATA[ a>b{} ]]></style></svg>`;
    const { elements, issues } = scanElements(text);
    expect(issues).toEqual([]);
    expect(elements.find((e) => e.id === "x")).toBeUndefined();
    const style = find(elements, "#style-1");
    expect(style.end).toBe(text.indexOf("]]></style>") + "]]></style>".length);
    expect(text.slice(style.closeStart, style.end)).toBe("</style>");
    expect(elements).toHaveLength(2);
  });

  it("Größer-Zeichen in Kommentar und CDATA beendet sie nicht vorzeitig", () => {
    const text = `<svg><!-- a > <rect id="x"/> --><style><![CDATA[ a>b{} <rect id="y"/> ]]></style><rect id="z"/></svg>`;
    const { elements, issues } = scanElements(text);
    expect(issues).toEqual([]);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel", "#style-1", "z"]);
  });

  it("Größer-Zeichen in Anführungszeichen beendet das Tag nicht", () => {
    const text = `<svg><text id="t" data-x="a>b">hallo</text><rect id="r"/></svg>`;
    const { elements } = scanElements(text);
    const t = find(elements, "t");
    expect(attr(t, "data-x")).toBe("a>b");
    expect(text.slice(t.start, t.openEnd)).toBe(`<text id="t" data-x="a>b">`);
    expect(find(elements, "r").parentKey).toBe("#wurzel");
  });

  it("löst Entities und einfache Quotes auf", () => {
    const text = `<svg><g id="g" title='Tür &quot;Nord&quot;'/></svg>`;
    const g = find(scanElements(text).elements, "g");
    const a = g.attrs.find((x) => x.name === "title")!;
    expect(a.raw).toBe("Tür &quot;Nord&quot;");
    expect(a.value).toBe('Tür "Nord"');
    expect(a.quote).toBe("'");
    expect(text.slice(a.valueStart, a.valueEnd)).toBe(a.raw);
    expect(text[a.valueStart - 1]).toBe("'");
  });

  it("dekodiert alle Entity-Formen", () => {
    const text = `<svg><g id="g" a="&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&unbekannt;&#xZZ;&valueOf;&toString;&__proto__;"/></svg>`;
    const g = find(scanElements(text).elements, "g");
    expect(attr(g, "a")).toBe(`&<>"'AB&unbekannt;&#xZZ;&valueOf;&toString;&__proto__;`);
    expect(attr(g, "fehlt")).toBeNull();
  });

  it("meldet doppelte id mit dem Offset des zweiten", () => {
    const text = `<svg><rect id="a"/><rect id="a"/></svg>`;
    const { issues } = scanElements(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("doppelt");
    expect(issues[0]!.offset).toBe(text.lastIndexOf("<rect"));
  });

  it("verschachtelt", () => {
    const text = `<svg><g id="w"><rect id="r"/></g></svg>`;
    const { elements } = scanElements(text);
    expect(find(elements, "r").parentKey).toBe("w");
    const w = find(elements, "w");
    expect(w.parentKey).toBe("#wurzel");
    expect(text.slice(w.closeStart, w.closeStart + 4)).toBe("</g>");
    expect(text.slice(w.openEnd, w.closeStart)).toBe(`<rect id="r"/>`);
    expect(w.selfClosing).toBe(false);
  });

  it("überspringt Prolog, Verarbeitungsanweisung und DOCTYPE mit Untermenge", () => {
    const text = `<?xml version="1.0"?>\n<!DOCTYPE svg [ <!ENTITY a "x>y"> ]>\n<svg><rect id="r"/></svg>`;
    const { elements, issues } = scanElements(text);
    expect(issues).toEqual([]);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel", "r"]);
  });

  it("Präfix: lokaler Name klein, Attributname mit Präfix", () => {
    const text = `<svg:SVG xmlns:svg="http://www.w3.org/2000/svg"><svg:rect id="r" xlink:href="#a"/></svg:SVG>`;
    const { elements, issues } = scanElements(text);
    expect(issues).toEqual([]);
    expect(elements[0]!.tag).toBe("svg");
    const r = find(elements, "r");
    expect(r.tag).toBe("rect");
    expect(attr(r, "xlink:href")).toBe("#a");
  });

  it("toleriert Müll, ohne Offsets zu verfälschen", () => {
    const text = `<svg><g id="a"><rect id="b"></g></svg></x>`;
    const { elements, issues } = scanElements(text);
    expect(issues.length).toBeGreaterThan(0);
    const b = find(elements, "b");
    expect(b.parentKey).toBe("a");
    expect(b.closeStart).toBe(b.end);
    expect(b.end).toBe(text.indexOf("</g>"));
    expect(find(elements, "a").end).toBe(text.indexOf("</g>") + 4);
  });

  it("bricht bei offenem Anführungszeichen ab", () => {
    const { issues, elements } = scanElements(`<svg><rect id="a/></svg>`);
    expect(issues.length).toBeGreaterThan(0);
    expect(elements.map((e) => e.key)).toEqual(["#wurzel"]);
  });

  it("bleibt bei pathologischen Eingaben schnell", () => {
    const n = 100_000;
    const t0 = Date.now();
    scanElements("<a>".repeat(n) + "</x>".repeat(n));
    scanElements('<a b="'.repeat(n));
    scanElements("<!--".repeat(n));
    scanElements("<a ".repeat(n));
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
