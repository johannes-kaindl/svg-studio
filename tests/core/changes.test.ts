import { describe, expect, it } from "vitest";
import { applyChanges, type SvgChange } from "../../src/core/changes";
import { scanElements } from "../../src/core/elements";

// Ein Grundriss mit Kommentar, Leerzeile und Einrückung: alles, was nicht angefasst wird, muss byte-gleich bleiben.
const PLAN = [
  `<?xml version="1.0"?>`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" data-unit="cm">`,
  `  <!-- Wände -->`,
  `  <g id="w">`,
  `    <rect id="r" x="0" y="0" width="10" height="20" stroke="black"/>`,
  ``,
  `    <circle id="mond" cx="50" cy="50" r="40"/>`,
  `  </g>`,
  `  <g id="leer"/>`,
  `</svg>`,
  ``,
].join("\n");

const ok = (text: string, changes: SvgChange[]): string => {
  const r = applyChanges(text, changes);
  if (!r.ok) throw new Error(`erwartet ok, bekam: ${r.problems.join("; ")}`);
  return r.text;
};
const fail = (text: string, changes: SvgChange[]): string[] => {
  const r = applyChanges(text, changes);
  if (r.ok) throw new Error("erwartet ok:false");
  return r.problems;
};

describe("applyChanges: Attribute", () => {
  it("ändert genau ein Attribut", () => {
    const out = ok(PLAN, [{ op: "change", id: "mond", attrs: { r: "60" } }]);
    const at = PLAN.indexOf(`r="40"`);
    expect(out).toBe(PLAN.slice(0, at) + `r="60"` + PLAN.slice(at + `r="40"`.length));
  });

  it("lässt den Text unberührt, wenn der Wert schon so steht", () => {
    expect(ok(PLAN, [{ op: "change", id: "mond", attrs: { r: "40" } }])).toBe(PLAN);
  });

  it("entfernt ein Attribut samt führendem Leerzeichen", () => {
    const out = ok(PLAN, [{ op: "change", id: "r", attrs: { stroke: null } }]);
    expect(out).toBe(PLAN.replace(` stroke="black"`, ""));
  });

  it("hängt ein neues Attribut mit dem Quote-Stil des Elements an", () => {
    const out = ok(PLAN, [{ op: "change", id: "r", attrs: { "data-role": "wall" } }]);
    expect(out).toBe(PLAN.replace(`stroke="black"/>`, `stroke="black" data-role="wall"/>`));
    const single = `<svg viewBox='0 0 1 1'><rect id='a' x='1'/></svg>`;
    expect(ok(single, [{ op: "change", id: "a", attrs: { y: "2" } }])).toBe(`<svg viewBox='0 0 1 1'><rect id='a' x='1' y='2'/></svg>`);
  });

  it("hängt ein Attribut an ein Element ohne Attribute", () => {
    const t = `<svg><style></style></svg>`;
    expect(ok(t, [{ op: "change", id: "#style-1", attrs: { type: "text/css" } }])).toBe(`<svg><style type="text/css"></style></svg>`);
  });

  it("lehnt Positionsschlüssel (@N) ab, weil sie nicht stabil sind", () => {
    const t = `<svg><g></g></svg>`;
    expect(fail(t, [{ op: "change", id: "@1", attrs: { id: "x" } }]).join(" ")).toContain("@1");
    expect(fail(PLAN, [{ op: "add", parent: "w", after: "@2", markup: `<rect id="t"/>` }]).join(" ")).toContain("@2");
  });

  it("escaped Werte, bei einfachen Anführungszeichen mit &apos;", () => {
    expect(ok(PLAN, [{ op: "change", id: "r", attrs: { "data-x": `a"b&c<d` } }])).toContain(`data-x="a&quot;b&amp;c&lt;d"`);
    const single = `<svg><rect id='a' x='1'/></svg>`;
    expect(ok(single, [{ op: "change", id: "a", attrs: { x: `a'b&c<d` } }])).toContain(`x='a&apos;b&amp;c&lt;d'`);
  });

  it("fasst mehrere change auf dasselbe Element zusammen, der spätere gewinnt", () => {
    const out = ok(PLAN, [
      { op: "change", id: "mond", attrs: { r: "1", cx: "2" } },
      { op: "change", id: "mond", attrs: { r: "3" } },
    ]);
    expect(out).toContain(`<circle id="mond" cx="2" cy="50" r="3"/>`);
  });

  it("ändert Wurzelattribute über #wurzel", () => {
    const out = ok(PLAN, [{ op: "change", id: "#wurzel", attrs: { viewBox: "0 0 300 100" } }]);
    expect(out).toBe(PLAN.replace(`viewBox="0 0 200 100"`, `viewBox="0 0 300 100"`));
  });

  it("weist einen ungültigen Attributnamen ab", () => {
    expect(fail(PLAN, [{ op: "change", id: "r", attrs: { 'x" onload="1': "a" } }]).join(" ")).toContain("Attributname");
  });
});

describe("applyChanges: Zeilenenden", () => {
  it("BOM und CRLF bleiben, eingefügtes Markup bekommt CRLF", () => {
    const crlf = "﻿" + PLAN.replace(/\n/g, "\r\n");
    const out = ok(crlf, [{ op: "add", parent: "w", after: "r", markup: `<rect id="t"\n  x="1"/>` }]);
    expect(out.startsWith("﻿<?xml")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain(`<rect id="t"\r\n      x="1"/>`);
    expect(out.length).toBe(crlf.length + `\r\n    <rect id="t"\r\n      x="1"/>`.length);
  });
});

describe("applyChanges: add", () => {
  it("fügt nach einem Element ein, mit dessen Einrückung", () => {
    const out = ok(PLAN, [{ op: "add", parent: "w", after: "r", markup: `<rect id="t"/>` }]);
    expect(out).toBe(PLAN.replace(`stroke="black"/>\n`, `stroke="black"/>\n    <rect id="t"/>\n`));
  });

  it("fügt mit after null als erstes Kind ein", () => {
    const out = ok(PLAN, [{ op: "add", parent: "w", after: null, markup: `<rect id="t"/>` }]);
    expect(out).toContain(`<g id="w">\n    <rect id="t"/>\n    <rect id="r"`);
  });

  it("parent null heißt Wurzel", () => {
    const out = ok(PLAN, [{ op: "add", parent: null, after: "leer", markup: `<rect id="t"/>` }]);
    expect(out).toContain(`<g id="leer"/>\n  <rect id="t"/>\n</svg>`);
  });

  it("fügt in einen selbstschließenden Elternknoten ein", () => {
    const out = ok(PLAN, [{ op: "add", parent: "leer", after: null, markup: `<rect id="t"/>` }]);
    expect(out).toContain(`<g id="leer"><rect id="t"/></g>`);
    expect(scanElements(out).issues).toEqual([]);
  });

  it("fügt zwei Kinder in einen selbstschließenden Elternknoten ein, in Listenreihenfolge", () => {
    const out = ok(PLAN, [
      { op: "add", parent: "leer", after: null, markup: `<rect id="t1"/>` },
      { op: "add", parent: "leer", after: null, markup: `<rect id="t2"/>` },
    ]);
    expect(out).toContain(`<g id="leer"><rect id="t1"/><rect id="t2"/></g>`);
  });

  it("hält die Listenreihenfolge bei zwei add an derselben Stelle", () => {
    const out = ok(PLAN, [
      { op: "add", parent: "w", after: "r", markup: `<rect id="a1"/>` },
      { op: "add", parent: "w", after: "r", markup: `<rect id="a2"/>` },
    ]);
    expect(out.indexOf(`id="a1"`)).toBeLessThan(out.indexOf(`id="a2"`));
    expect(out.indexOf(`id="a2"`)).toBeLessThan(out.indexOf(`id="mond"`));
  });

  it("meldet unbekannten Elternknoten und fremdes after", () => {
    expect(fail(PLAN, [{ op: "add", parent: "nix", after: null, markup: `<rect id="t"/>` }]).join(" ")).toContain("nix");
    expect(fail(PLAN, [{ op: "add", parent: "w", after: "leer", markup: `<rect id="t"/>` }]).join(" ")).toContain("leer");
  });
});

describe("applyChanges: remove und move", () => {
  it("entfernt die ganze Zeile, wenn das Element allein darauf steht", () => {
    const out = ok(PLAN, [{ op: "remove", id: "mond" }]);
    expect(out).toBe(PLAN.replace(`    <circle id="mond" cx="50" cy="50" r="40"/>\n`, ""));
  });

  it("entfernt nur die Spanne, wenn Nachbarn auf der Zeile stehen", () => {
    const t = `<svg>\n  <rect id="a"/> <rect id="b"/>\n</svg>`;
    expect(ok(t, [{ op: "remove", id: "b" }])).toBe(`<svg>\n  <rect id="a"/> \n</svg>`);
  });

  it("verweigert das Entfernen der Wurzel", () => {
    expect(fail(PLAN, [{ op: "remove", id: "#wurzel" }]).join(" ")).toContain("#wurzel");
  });

  it("zieht ein Element in der Stapelreihenfolge vor", () => {
    const out = ok(PLAN, [{ op: "move", id: "mond", parent: "w", after: null }]);
    expect(out).toContain(`<g id="w">\n    <circle id="mond" cx="50" cy="50" r="40"/>\n    <rect id="r"`);
    expect(out.split(`id="mond"`).length - 1).toBe(1);
    expect(scanElements(out).issues).toEqual([]);
  });

  it("wechselt mit move den Elternknoten, das Element steht genau einmal", () => {
    const out = ok(PLAN, [{ op: "move", id: "mond", parent: null, after: "w" }]);
    const { elements } = scanElements(out);
    expect(elements.filter((e) => e.key === "mond")).toHaveLength(1);
    expect(elements.find((e) => e.key === "mond")!.parentKey).toBe("#wurzel");
    expect(out).toContain(`  </g>\n  <circle id="mond" cx="50" cy="50" r="40"/>\n  <g id="leer"/>`);
  });

  it("verweigert move in das Element selbst", () => {
    expect(fail(PLAN, [{ op: "move", id: "w", parent: "r", after: null }]).join(" ")).toContain("Ziel liegt im verschobenen Element");
    expect(fail(PLAN, [{ op: "move", id: "w", parent: "w", after: null }]).join(" ")).toContain("Ziel liegt im verschobenen Element");
    expect(fail(PLAN, [{ op: "move", id: "mond", parent: "w", after: "mond" }]).join(" ")).toContain("mond");
  });
});

describe("applyChanges: Schutz", () => {
  it("alles oder nichts: ein unbekannter id verwirft die ganze Liste", () => {
    const problems = fail(PLAN, [
      { op: "change", id: "mond", attrs: { r: "60" } },
      { op: "change", id: "gibtsnicht", attrs: { r: "1" } },
    ]);
    expect(problems.join(" ")).toContain("gibtsnicht");
  });

  it("doppelte id ist mehrdeutig", () => {
    const t = `<svg><rect id="d"/><rect id="d"/></svg>`;
    expect(fail(t, [{ op: "change", id: "d", attrs: { x: "1" } }]).length).toBeGreaterThan(0);
  });

  it("Round-Trip-Wächter: Markup, das selbst nicht parst, scheitert", () => {
    const problems = fail(PLAN, [{ op: "add", parent: "w", after: "r", markup: `<rect id="x">` }]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("Round-Trip-Wächter: Markup mit doppelter id scheitert", () => {
    expect(fail(PLAN, [{ op: "add", parent: "w", after: "r", markup: `<rect id="mond"/>` }]).length).toBeGreaterThan(0);
  });

  it("überlappende Änderungen scheitern", () => {
    const problems = fail(PLAN, [
      { op: "remove", id: "mond" },
      { op: "change", id: "mond", attrs: { r: "1" } },
    ]);
    expect(problems.join(" ")).toContain("Änderung 1 und 2 überlappen");
  });

  it("lehnt Eingabetext mit Scan-Befunden ab (unquotiertes Attribut)", () => {
    const t = `<svg><rect id="r" fill=red/></svg>`;
    const problems = fail(t, [{ op: "change", id: "r", attrs: { fill: "blue" } }]);
    expect(problems.join(" ")).toContain("fill");
  });
});

describe("applyChanges: change zusammen mit move, verschachtelte Entfernungen, Anker", () => {
  const TREE = [`<svg viewBox="0 0 9 9">`, `  <g id="G">`, `    <rect id="a" x="1"/>`, `    <rect id="b" x="1"/>`, `  </g>`, `  <rect id="c" x="1"/>`, `</svg>`, ``].join("\n");

  it("change und move auf dieselbe id: die Attribute gelten am neuen Ort", () => {
    const out = ok(TREE, [
      { op: "change", id: "c", attrs: { x: "2", "data-n": "k" } },
      { op: "move", id: "c", parent: "G", after: "b" },
    ]);
    expect(out).toContain(`    <rect id="b" x="1"/>\n    <rect id="c" x="2" data-n="k"/>\n  </g>`);
    expect(out.split(`id="c"`).length - 1).toBe(1);
    expect(out.endsWith(`</g>\n</svg>\n`)).toBe(true);
    expect(scanElements(out).issues).toEqual([]);
  });

  it("change und move: auch in umgekehrter Reihenfolge der Liste", () => {
    const out = ok(TREE, [
      { op: "move", id: "c", parent: "G", after: null },
      { op: "change", id: "c", attrs: { x: "2" } },
    ]);
    expect(out).toContain(`<g id="G">\n    <rect id="c" x="2"/>\n    <rect id="a"`);
  });

  it("change auf einen Nachkommen eines verschobenen Elements bleibt abgelehnt", () => {
    expect(fail(TREE, [
      { op: "change", id: "a", attrs: { x: "2" } },
      { op: "move", id: "G", parent: null, after: "c" },
    ]).join(" ")).toContain("überlappen");
  });

  it("remove G und remove a (Kind von G) zählt einmal", () => {
    const out = ok(TREE, [
      { op: "remove", id: "G" },
      { op: "remove", id: "a" },
    ]);
    expect(out).toBe(TREE.replace(/  <g id="G">[\s\S]*?<\/g>\n/, ""));
    expect(ok(TREE, [{ op: "remove", id: "a" }, { op: "remove", id: "G" }])).toBe(out);
  });

  it("dasselbe Element zweimal entfernen ist harmlos", () => {
    expect(ok(TREE, [{ op: "remove", id: "c" }, { op: "remove", id: "c" }])).toBe(TREE.replace(`  <rect id="c" x="1"/>\n`, ""));
  });

  it("remove G und move a aus G heraus: eigene Meldung mit beiden Änderungen", () => {
    const p = fail(TREE, [
      { op: "remove", id: "G" },
      { op: "move", id: "a", parent: null, after: "c" },
    ]).join(" ");
    expect(p).toContain("Änderung 1");
    expect(p).toContain("Änderung 2");
    expect(p).toContain("entfernt");
    expect(p).not.toContain("überlappen");
  });

  it("remove X und add hinter X scheitert, ob X allein auf der Zeile steht oder inline", () => {
    expect(fail(TREE, [
      { op: "remove", id: "c" },
      { op: "add", parent: null, after: "c", markup: `<rect id="n"/>` },
    ]).join(" ")).toContain("Änderung 1 und 2");
    const inline = `<svg><rect id="a"/><rect id="b"/></svg>`;
    expect(fail(inline, [
      { op: "remove", id: "a" },
      { op: "add", parent: null, after: "a", markup: `<rect id="n"/>` },
    ]).join(" ")).toContain("Änderung 1 und 2");
  });

  it("ein verschobenes Element taugt nicht als Anker", () => {
    expect(fail(TREE, [
      { op: "move", id: "b", parent: null, after: "c" },
      { op: "add", parent: "G", after: "b", markup: `<rect id="n"/>` },
    ]).join(" ")).toContain("Änderung 1 und 2");
  });

  it("move hinter einen Anker wiederholt: Listenreihenfolge bleibt", () => {
    const out = ok(TREE, [
      { op: "move", id: "a", parent: null, after: "c" },
      { op: "move", id: "b", parent: null, after: "c" },
    ]);
    expect(out.indexOf(`id="a"`)).toBeGreaterThan(out.indexOf(`id="c"`));
    expect(out.indexOf(`id="b"`)).toBeGreaterThan(out.indexOf(`id="a"`));
  });

  it("rückt mehrzeiliges Markup an der Einrückung des Ankers ein", () => {
    const markup = `<g id="n">\n  <rect id="n1"/>\n</g>`;
    const out = ok(TREE, [{ op: "add", parent: "G", after: "a", markup }]);
    expect(out).toContain(`    <rect id="a" x="1"/>\n    <g id="n">\n      <rect id="n1"/>\n    </g>\n    <rect id="b"`);
    const crlf = TREE.replace(/\n/g, "\r\n");
    expect(ok(crlf, [{ op: "add", parent: "G", after: "a", markup }])).toContain(`    <g id="n">\r\n      <rect id="n1"/>\r\n    </g>\r\n`);
  });
});
