import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/core/changes";
import { attr, scanElements, type SvgElement } from "../../src/core/elements";
import { fieldChange, fieldsFor, HAND_LABEL, parseTransform, writeTransform, type FieldSpec } from "../../src/core/fields";

const NS = `xmlns="http://www.w3.org/2000/svg"`;
const S = (inner: string): string => `<svg ${NS} viewBox="0 0 400 400">\n${inner}\n</svg>\n`;
const find = (text: string, id: string): SvgElement => scanElements(text).elements.find((e) => e.id === id)!;
const names = (specs: FieldSpec[]): string[] => specs.map((f) => f.name);
const CTX = { lang: "de" as const };
const change = (text: string, id: string, field: string, input: string, ctx: { center?: [number, number]; lang: "de" | "en" } = CTX) => fieldChange(find(text, id), text, field, input, ctx);
const okChanges = (r: ReturnType<typeof fieldChange>) => {
  if (!r.ok) throw new Error(`${r.problem.code} ${r.problem.params.join(",")}`);
  return r.changes;
};
/** Wendet die Felder-Eingabe an und liefert den neuen Text. */
const applied = (text: string, id: string, field: string, input: string, ctx?: { center?: [number, number]; lang: "de" | "en" }): string => {
  const r = applyChanges(text, okChanges(change(text, id, field, input, ctx)));
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.text;
};

const DOC = S([
  `  <!-- Kommentar bleibt -->`,
  `  <circle id="mond" cx="100" cy="100" r="40" fill="#fff"/>`,
  `  <ellipse id="ei" cx="1" cy="2" rx="3" ry="4"/>`,
  `  <rect id="tuer" x="80" y="10" width="20" height="30" rx="2" stroke="red" stroke-width="2"/>`,
  `  <line id="strich" x1="0" y1="0" x2="5" y2="5"/>`,
  `  <text id="titel" x="5" y="6" font-size="12">Hallo</text>`,
  `  <polygon id="dach" points="0,0 10,0 5,5"/>`,
  `  <polyline id="zug" points="0,0 10,0"/>`,
  `  <path id="bogen" d="M0 0L5 5"/>`,
  `  <g id="gruppe"><circle id="punkt" r="1"/></g>`,
].join("\n"));

describe("fieldsFor: Felder je Elementart (Spec § 7.5)", () => {
  it("circle, ellipse, rect, line, text: genau die Namen der Spec, dann fill, stroke, stroke-width, rotate", () => {
    const tail = ["fill", "stroke", "stroke-width", "rotate"];
    expect(names(fieldsFor(find(DOC, "mond"), DOC))).toEqual(["cx", "cy", "r", ...tail]);
    expect(names(fieldsFor(find(DOC, "ei"), DOC))).toEqual(["cx", "cy", "rx", "ry", ...tail]);
    expect(names(fieldsFor(find(DOC, "tuer"), DOC))).toEqual(["x", "y", "width", "height", "rx", ...tail]);
    expect(names(fieldsFor(find(DOC, "strich"), DOC))).toEqual(["x1", "y1", "x2", "y2", ...tail]);
    expect(names(fieldsFor(find(DOC, "titel"), DOC))).toEqual(["x", "y", "font-size", "text", ...tail]);
  });

  it("polygon, polyline, path, g: Verschieben (x, y) und Drehen statt Lage-Attributen", () => {
    const tail = ["translate-x", "translate-y", "fill", "stroke", "stroke-width", "rotate"];
    for (const id of ["dach", "zug", "bogen", "gruppe"]) expect(names(fieldsFor(find(DOC, id), DOC)), id).toEqual(tail);
  });

  it("Art, Wert und kein Schreibschutz bei einfachen Zahlen; ein fehlendes Attribut ist ein leeres Feld", () => {
    const f = fieldsFor(find(DOC, "mond"), DOC);
    expect(f.find((x) => x.name === "r")).toEqual({ name: "r", kind: "number", value: "40" });
    expect(f.find((x) => x.name === "fill")).toEqual({ name: "fill", kind: "color", value: "#fff" });
    expect(f.find((x) => x.name === "stroke")).toEqual({ name: "stroke", kind: "color", value: "" });
    expect(f.find((x) => x.name === "rotate")).toEqual({ name: "rotate", kind: "rotate", value: "0" });
    expect(fieldsFor(find(DOC, "titel"), DOC).find((x) => x.name === "text")).toEqual({ name: "text", kind: "text", value: "Hallo" });
    expect(fieldsFor(find(DOC, "gruppe"), DOC)[0]).toEqual({ name: "translate-x", kind: "translate", value: "0" });
  });

  it("Elemente, die die Spec nicht nennt, haben keine Felder", () => {
    const t = S(`  <defs id="d"/>\n  <use id="u" href="#d"/>`);
    expect(fieldsFor(find(t, "u"), t)).toEqual([]);
    expect(fieldsFor(find(t, "d"), t)).toEqual([]);
  });

  it("Wert mit Einheit oder Prozent: schreibgeschützt (unit); Liste oder Ausdruck: value", () => {
    const t = S(`  <circle id="c" cx="50%" cy="1.5em" r="4"/>\n  <text id="t" x="1 2 3" font-size="12px">a</text>`);
    const c = fieldsFor(find(t, "c"), t);
    expect(c.find((x) => x.name === "cx")).toMatchObject({ value: "50%", readonly: "unit" });
    expect(c.find((x) => x.name === "cy")).toMatchObject({ readonly: "unit" });
    expect(c.find((x) => x.name === "r")!.readonly).toBeUndefined();
    const x = fieldsFor(find(t, "t"), t);
    expect(x.find((f) => f.name === "x")).toMatchObject({ readonly: "value" });
    expect(x.find((f) => f.name === "font-size")).toMatchObject({ readonly: "unit" });
  });

  it("ein style-Attribut mit derselben Eigenschaft schützt das Feld (es gewänne gegen das Attribut)", () => {
    const t = S(`  <circle id="c" r="4" style="fill: red; stroke-width:2"/>`);
    const f = fieldsFor(find(t, "c"), t);
    expect(f.find((x) => x.name === "fill")!.readonly).toBe("style");
    expect(f.find((x) => x.name === "stroke-width")!.readonly).toBe("style");
    expect(f.find((x) => x.name === "stroke")!.readonly).toBeUndefined();
  });

  it("Text mit tspan, Zeilenumbruch oder Kommentar: schreibgeschützt (markup)", () => {
    const t = S(`  <text id="a">eins <tspan>zwei</tspan></text>\n  <text id="b">\n    zeile\n  </text>\n  <text id="c">x<!-- k --></text>`);
    for (const id of ["a", "b", "c"]) expect(fieldsFor(find(t, id), t).find((f) => f.name === "text")!.readonly, id).toBe("markup");
  });

  it("doppelte id: alle Felder schreibgeschützt (ambiguous); Element ohne id: unnamed", () => {
    const t = S(`  <circle id="c" r="1"/>\n  <circle id="c" r="2"/>\n  <circle r="3"/>`);
    const els = scanElements(t).elements;
    expect(fieldsFor(els[1]!, t).every((f) => f.readonly === "ambiguous")).toBe(true);
    expect(fieldsFor(els[3]!, t).every((f) => f.readonly === "unnamed")).toBe(true);
  });

  it("Text hinter einem Geschwister ohne id oder in einer Gruppe ohne id: schreibgeschützt (unnamed), weil kein fester Ort angesprochen werden kann", () => {
    const t = S(`  <rect x="1"/>\n  <text id="t">a</text>\n  <g>\n    <text id="u">b</text>\n  </g>`);
    expect(fieldsFor(find(t, "t"), t).find((f) => f.name === "text")!.readonly).toBe("unnamed");
    expect(fieldsFor(find(t, "u"), t).find((f) => f.name === "text")!.readonly).toBe("unnamed");
    expect(fieldsFor(find(t, "t"), t).find((f) => f.name === "x")!.readonly).toBeUndefined();
  });
});

describe("parseTransform / writeTransform", () => {
  it("kein Attribut, leer: keine Verschiebung, keine Drehung", () => {
    expect(parseTransform(null)).toEqual({ ok: true, translate: [0, 0], rotate: null });
    expect(parseTransform("  ")).toEqual({ ok: true, translate: [0, 0], rotate: null });
  });

  it("translate mit einem oder zwei Werten, rotate mit einem oder drei, Komma oder Leerraum", () => {
    expect(parseTransform("translate(10)")).toEqual({ ok: true, translate: [10, 0], rotate: null });
    expect(parseTransform("translate(10,5.5) rotate(30 210 192.5)")).toEqual({ ok: true, translate: [10, 5.5], rotate: { a: 30, cx: 210, cy: 192.5 } });
    expect(parseTransform("rotate(-45)")).toEqual({ ok: true, translate: [0, 0], rotate: { a: -45, cx: 0, cy: 0 } });
  });

  it("matrix, scale, skew: nicht abbildbar, mit Grund; andere Reihenfolge, doppelte Funktion, Unsinn: transform", () => {
    expect(parseTransform("matrix(1 0 0 1 5 5)")).toEqual({ ok: false, reason: "matrix" });
    expect(parseTransform("translate(1 1) scale(2)")).toEqual({ ok: false, reason: "scale" });
    expect(parseTransform("skewX(10)")).toEqual({ ok: false, reason: "skew" });
    expect(parseTransform("skewY(10)")).toEqual({ ok: false, reason: "skew" });
    expect(parseTransform("rotate(30) translate(1 1)")).toEqual({ ok: false, reason: "transform" });
    expect(parseTransform("translate(1) translate(2)")).toEqual({ ok: false, reason: "transform" });
    expect(parseTransform("rotate(1 2)")).toEqual({ ok: false, reason: "transform" });
    expect(parseTransform("translate(a b)")).toEqual({ ok: false, reason: "transform" });
    expect(parseTransform("translate(1 2")).toEqual({ ok: false, reason: "transform" });
  });

  it("Rundlauf: lesen und schreiben ergibt dieselbe Form", () => {
    for (const v of ["translate(10 5)", "rotate(30 210 192.5)", "translate(10 5) rotate(30 210 192.5)", "rotate(45)", "translate(-3.25 0)"]) {
      const t = parseTransform(v);
      if (!t.ok) throw new Error(v);
      expect(writeTransform(t), v).toBe(v);
    }
    expect(writeTransform({ ok: true, translate: [0, 0], rotate: null })).toBe("");
  });
});

describe("fieldChange: Zahlen", () => {
  it("60, 60.5 und 60,5 werden 60, 60.5 und 60.5; ein Feld ändert genau ein Attribut, alles andere byte-gleich", () => {
    for (const [input, written] of [["60", "60"], ["60.5", "60.5"], ["60,5", "60.5"], [" 60,5 ", "60.5"], [".5", "0.5"], ["+7", "7"], ["60.50", "60.5"]] as const) {
      const out = applied(DOC, "mond", "r", input);
      expect(out, input).toBe(DOC.replace(`r="40"`, `r="${written}"`));
    }
  });

  it("die Änderung ist ein change auf die id mit genau einem Attribut", () => {
    expect(okChanges(change(DOC, "mond", "cx", "7"))).toEqual([{ op: "change", id: "mond", attrs: { cx: "7" } }]);
  });

  it("ein fehlendes Attribut wird gesetzt; gleiche Zahl (auch anders geschrieben) ändert nichts", () => {
    expect(applied(DOC, "strich", "x1", "3")).toBe(DOC.replace(`x1="0"`, `x1="3"`));
    const t = S(`  <circle id="c" r="40.0"/>`);
    expect(okChanges(change(t, "c", "r", "40"))).toEqual([]);
    expect(okChanges(change(DOC, "mond", "r", "40,0"))).toEqual([]);
    const without = S(`  <circle id="c" r="4"/>`);
    expect(applied(without, "c", "cx", "0")).toBe(without.replace(`r="4"`, `r="4" cx="0"`));
  });

  it("keine Zahl: field-number mit Feld und Eingabe; Exponent, zwei Trenner, Einheit, Prozent sind keine Zahl", () => {
    for (const bad of ["abc", "1e3", "1,2,3", "1.2.3", "12px", "5%", "--1", "1 2", "٣"]) {
      expect(change(DOC, "mond", "r", bad), bad).toEqual({ ok: false, problem: { code: "field-number", params: ["r", bad] } });
    }
  });

  it("zu groß: Problem statt Exponent im Quelltext", () => {
    expect(change(DOC, "mond", "r", "1" + "0".repeat(20)).ok).toBe(false);
  });

  it("leeres Geometriefeld: Problem field-empty; dasselbe für x, y und cx", () => {
    for (const f of ["cx", "cy", "r"]) expect(change(DOC, "mond", f, "  "), f).toEqual({ ok: false, problem: { code: "field-empty", params: [f] } });
  });

  it("leeres Feld entfernt NUR fill, stroke, stroke-width, rx", () => {
    expect(applied(DOC, "mond", "fill", "")).toBe(DOC.replace(` fill="#fff"`, ""));
    expect(applied(DOC, "tuer", "stroke", "")).toBe(DOC.replace(` stroke="red"`, ""));
    expect(applied(DOC, "tuer", "stroke-width", "")).toBe(DOC.replace(` stroke-width="2"`, ""));
    expect(applied(DOC, "tuer", "rx", "")).toBe(DOC.replace(` rx="2"`, ""));
    for (const f of ["x", "y", "width", "height"]) expect(change(DOC, "tuer", f, ""), f).toMatchObject({ ok: false, problem: { code: "field-empty" } });
    expect(change(DOC, "titel", "font-size", "")).toMatchObject({ ok: false });
    expect(okChanges(change(DOC, "mond", "stroke", ""))).toEqual([]); // fehlt schon
  });

  it("negative Maße: Problem field-negative; negative Koordinaten sind erlaubt", () => {
    for (const f of ["r"]) expect(change(DOC, "mond", f, "-1")).toEqual({ ok: false, problem: { code: "field-negative", params: ["r"] } });
    expect(change(DOC, "tuer", "width", "-2")).toMatchObject({ problem: { code: "field-negative" } });
    expect(change(DOC, "tuer", "stroke-width", "-2")).toMatchObject({ problem: { code: "field-negative" } });
    expect(applied(DOC, "mond", "cx", "-5")).toBe(DOC.replace(`cx="100"`, `cx="-5"`));
  });

  it("schreibgeschütztes Feld (Einheit) und unbekanntes Feld liefern Problem, nichts geändert", () => {
    const t = S(`  <circle id="c" cx="50%" r="4"/>`);
    expect(change(t, "c", "cx", "5")).toEqual({ ok: false, problem: { code: "field-readonly", params: ["cx", "unit"] } });
    expect(change(t, "c", "gibtsnicht", "5")).toEqual({ ok: false, problem: { code: "field-unknown", params: ["gibtsnicht"] } });
    expect(change(t, "c", "x", "5")).toMatchObject({ problem: { code: "field-unknown" } });
  });

  it("der Rundentitel kommt aus dem Wort der Sprache", () => {
    expect(change(DOC, "mond", "r", "1", { lang: "de" })).toMatchObject({ label: "Von Hand" });
    expect(change(DOC, "mond", "r", "1", { lang: "en" })).toMatchObject({ label: "By hand" });
    expect(HAND_LABEL).toEqual({ de: "Von Hand", en: "By hand" });
  });
});

describe("fieldChange: Farben", () => {
  it("Hex, Name, none, currentColor, rgb(), url(#id) gehen durch; Unsinn nicht", () => {
    for (const ok of ["#f00", "#ff0000", "#ff000080", "red", "none", "currentColor", "rgb(1, 2, 3)", "hsl(120 50% 50%)", "url(#verlauf)"]) {
      expect(okChanges(change(DOC, "mond", "stroke", ok)), ok).toEqual([{ op: "change", id: "mond", attrs: { stroke: ok } }]);
    }
    for (const bad of ["#ff", "#12345", "red;fill:blue", "<x>", "1 2", "url(javascript:x)", "rgb(1,2,3)}"]) {
      expect(change(DOC, "mond", "stroke", bad), bad).toEqual({ ok: false, problem: { code: "field-color", params: ["stroke", bad] } });
    }
  });

  it("Wertform (Rest B2 Punkt 2): Leerraum und Zeilenumbruch in rgb( … ) werden ein Leerzeichen, nie &#10; im Quelltext", () => {
    const out = applied(DOC, "mond", "stroke", "rgb(1,\n  2,\t3)");
    expect(out).toContain(`stroke="rgb(1, 2, 3)"`);
    expect(out).not.toContain("&#");
    for (const bad of ["1\n2", "red\nblue"]) expect(change(DOC, "mond", "r", bad), bad).toMatchObject({ ok: false });
    expect(change(DOC, "mond", "stroke", "red\nblue")).toMatchObject({ ok: false });
  });

  it("gleicher Wert ändert nichts; das Anführungszeichen im Wert kann nicht entstehen", () => {
    expect(okChanges(change(DOC, "mond", "fill", "#fff"))).toEqual([]);
    expect(change(DOC, "mond", "fill", `red" onclick="x`)).toMatchObject({ ok: false });
  });
});

describe("fieldChange: Verschieben und Drehen", () => {
  const T = S(`  <path id="p" d="M0 0L5 5"/>\n  <rect id="r" x="1" y="2" width="3" height="4" transform="translate(10 5)"/>\n  <g id="m" transform="matrix(1 0 0 1 5 5)"/>`);

  it("Drehen ohne transform: rotate(a cx cy) um die übergebene Mitte (210, 192.5)", () => {
    expect(applied(T, "p", "rotate", "30", { lang: "de", center: [210, 192.5] })).toBe(T.replace(`d="M0 0L5 5"`, `d="M0 0L5 5" transform="rotate(30 210 192.5)"`));
    expect(okChanges(change(T, "p", "rotate", "30", { lang: "de", center: [210, 192.5] }))).toEqual([{ op: "change", id: "p", attrs: { transform: "rotate(30 210 192.5)" } }]);
  });

  it("Drehen mit vorhandenem translate: translate bleibt, rotate kommt dahinter", () => {
    expect(applied(T, "r", "rotate", "30", { lang: "de", center: [210, 192.5] })).toBe(T.replace(`translate(10 5)`, `translate(10 5) rotate(30 210 192.5)`));
  });

  it("die Mitte wird auf drei Stellen gerundet (Messrauschen)", () => {
    expect(okChanges(change(T, "p", "rotate", "30", { lang: "de", center: [210.00000004, 192.4999999] }))[0]).toMatchObject({ attrs: { transform: "rotate(30 210 192.5)" } });
  });

  it("Drehen ohne Mitte: field-no-center; mit Mitte NaN auch", () => {
    expect(change(T, "p", "rotate", "30")).toEqual({ ok: false, problem: { code: "field-no-center", params: [] } });
    expect(change(T, "p", "rotate", "30", { lang: "de", center: [Number.NaN, 1] })).toMatchObject({ problem: { code: "field-no-center" } });
  });

  it("bestehende Drehung: nur der Winkel ändert sich, die Drehmitte bleibt (auch gegen eine neue ctx.center)", () => {
    const t = S(`  <rect id="r" x="1" transform="translate(10 5) rotate(30 20 15)"/>`);
    expect(applied(t, "r", "rotate", "45", { lang: "de", center: [999, 999] })).toBe(t.replace(`rotate(30 20 15)`, `rotate(45 20 15)`));
  });

  it("Winkel 0 nimmt die Drehung heraus; ohne Rest entfällt das ganze transform-Attribut", () => {
    const t = S(`  <rect id="r" x="1" transform="rotate(30 20 15)"/>\n  <rect id="s" x="1" transform="translate(4 4) rotate(30 20 15)"/>`);
    expect(applied(t, "r", "rotate", "0")).toBe(t.replace(` transform="rotate(30 20 15)"`, ""));
    expect(applied(t, "s", "rotate", "0")).toBe(t.replace(`translate(4 4) rotate(30 20 15)`, `translate(4 4)`));
    expect(okChanges(change(T, "p", "rotate", "0"))).toEqual([]);
  });

  it("negativer Winkel ist erlaubt; Winkel mit Komma", () => {
    expect(okChanges(change(T, "p", "rotate", "-12,5", { lang: "de", center: [1, 2] }))[0]).toMatchObject({ attrs: { transform: "rotate(-12.5 1 2)" } });
  });

  it("Verschieben: translate-x und translate-y setzen translate, die Drehung dahinter bleibt", () => {
    const t = S(`  <g id="g" transform="translate(10 5) rotate(30 20 15)"/>\n  <g id="h"/>`);
    expect(applied(t, "g", "translate-x", "99")).toBe(t.replace(`translate(10 5)`, `translate(99 5)`));
    expect(applied(t, "g", "translate-y", "-2,5")).toBe(t.replace(`translate(10 5)`, `translate(10 -2.5)`));
    expect(applied(t, "h", "translate-x", "7")).toBe(t.replace(`<g id="h"/>`, `<g id="h" transform="translate(7 0)"/>`));
    const gone = S(`  <g id="g" transform="translate(10 0)"/>`);
    expect(applied(gone, "g", "translate-x", "0")).toBe(gone.replace(` transform="translate(10 0)"`, ""));
  });

  it("matrix: Drehen UND Verschieben sind schreibgeschützt, mit Grund; eine Eingabe liefert das Problem", () => {
    const f = fieldsFor(find(T, "m"), T);
    for (const n of ["translate-x", "translate-y", "rotate"]) expect(f.find((x) => x.name === n)!.readonly, n).toBe("matrix");
    expect(change(T, "m", "rotate", "30", { lang: "de", center: [1, 1] })).toEqual({ ok: false, problem: { code: "field-readonly", params: ["rotate", "matrix"] } });
    expect(change(T, "m", "translate-x", "3")).toMatchObject({ problem: { code: "field-readonly", params: ["translate-x", "matrix"] } });
    // Rechteck mit matrix: Drehen ist geschützt, die Lage-Felder nicht
    const r = S(`  <rect id="q" x="1" transform="scale(2)"/>`);
    const rf = fieldsFor(find(r, "q"), r);
    expect(rf.find((x) => x.name === "rotate")!.readonly).toBe("scale");
    expect(rf.find((x) => x.name === "x")!.readonly).toBeUndefined();
  });
});

describe("fieldChange: Text", () => {
  const T = S(`  <circle id="a" r="1"/>\n  <text id="t" x="5" fill="red">Hallo</text>\n  <text id="leer" x="1"/>\n  <g id="g">\n    <text id="u">eins</text>\n  </g>`);

  it("ersetzt das Element: remove mit expect (kanonische Form), add am selben Ort mit neuem Inhalt", () => {
    const c = okChanges(change(T, "t", "text", "Welt"));
    expect(c).toHaveLength(2);
    expect(c[0]).toEqual({ op: "remove", id: "t", expect: `<text fill="red" id="t" x="5">"Hallo"</text>` });
    expect(c[1]).toEqual({ op: "add", parent: null, after: "a", markup: `<text id="t" x="5" fill="red">Welt</text>` });
    expect(applied(T, "t", "text", "Welt")).toBe(T.replace("Hallo", "Welt"));
  });

  it("& und < werden escaped (auch >), der Text kommt dekodiert wieder heraus", () => {
    const out = applied(T, "t", "text", `a & b < c > d`);
    expect(out).toContain(`<text id="t" x="5" fill="red">a &amp; b &lt; c &gt; d</text>`);
    const f = fieldsFor(find(out, "t"), out).find((x) => x.name === "text")!;
    expect(f.value).toBe("a & b < c > d");
  });

  it("vorhandene Entities werden dekodiert angezeigt", () => {
    const t = S(`  <text id="t">a &amp; b &lt;c&gt;</text>`);
    expect(fieldsFor(find(t, "t"), t).find((f) => f.name === "text")!.value).toBe("a & b <c>");
  });

  it("selbstschließendes text bekommt Inhalt und eine Schließmarke; der Rest des Dokuments bleibt byte-gleich", () => {
    const out = applied(T, "leer", "text", "neu");
    expect(out).toBe(T.replace(`<text id="leer" x="1"/>`, `<text id="leer" x="1">neu</text>`));
  });

  it("in einer benannten Gruppe: parent ist die Gruppe, after fehlt (erstes Kind)", () => {
    const t = S(`  <g id="g">\n    <text id="u">eins</text>\n  </g>`);
    expect(okChanges(change(t, "u", "text", "zwei"))[1]).toMatchObject({ op: "add", parent: "g", after: null });
    expect(applied(t, "u", "text", "zwei")).toBe(t.replace("eins", "zwei"));
  });

  it("gleicher Text ändert nichts; Steuerzeichen und Zeilenumbruch: field-text-invalid", () => {
    expect(okChanges(change(T, "t", "text", "Hallo"))).toEqual([]);
    expect(change(T, "t", "text", "a\u0001b")).toEqual({ ok: false, problem: { code: "field-text-invalid", params: ["text"] } });
    expect(change(T, "t", "text", "a\nb")).toMatchObject({ problem: { code: "field-text-invalid" } });
  });

  it("text mit tspan: Problem field-readonly (markup)", () => {
    const t = S(`  <text id="t">eins <tspan>zwei</tspan></text>`);
    expect(change(t, "t", "text", "x")).toEqual({ ok: false, problem: { code: "field-readonly", params: ["text", "markup"] } });
  });

  it("ein Präfix im Tag-Namen bleibt (Start- und Schließmarke passen)", () => {
    const t = `<svg ${NS} xmlns:s="http://www.w3.org/2000/svg">\n  <s:text id="t">a</s:text>\n</svg>\n`;
    expect(applied(t, "t", "text", "b")).toBe(t.replace(">a<", ">b<"));
  });

  it("nach einer Änderung der Zahl bleibt der Text und umgekehrt (je Feld ein Attribut)", () => {
    const out = applied(T, "t", "x", "9");
    expect(out).toBe(T.replace(`x="5"`, `x="9"`));
    expect(attr(find(out, "t"), "x")).toBe("9");
  });
});
