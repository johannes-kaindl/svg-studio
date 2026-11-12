import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyChanges, roundTripProblems, type SvgChange } from "../../src/core/changes";
import { buildCanonTree, canonNode } from "../../src/core/canon";
import { scanElements } from "../../src/core/elements";
import { pruefeLinear } from "../vendor/kit/linear-probe";

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

describe("applyChanges: Wohlgeformtheit und Eltern (Abschlussreview)", () => {
  const BASE = `<svg xmlns="http://www.w3.org/2000/svg">\n  <g id="w">\n    <rect id="r" x="1"/>\n    <rect id="s"/>\n  </g>\n</svg>`;
  const add = (markup: string): SvgChange[] => [{ op: "add", parent: "w", after: "r", markup }];

  it("add-Markup mit doppeltem Attribut, fehlendem Leerraum, rohem <, Tag 1rect oder &nbsp; scheitert", () => {
    for (const m of [`<rect id="a" id="b"/>`, `<rect id="a"x="1"/>`, `<rect id="a" x="<"/>`, `<1rect id="a"/>`, `<text id="a">&nbsp;</text>`]) {
      expect(fail(BASE, add(m)).length, m).toBeGreaterThan(0);
    }
  });

  it("add-Markup mit Steuerzeichen scheitert", () => {
    expect(fail(BASE, add(`<rect id="a" data-x="a\u0001b"/>`)).join(" ")).toContain("Steuerzeichen");
  });

  it("add-Markup muss genau EIN Element sein, das den ganzen Text füllt", () => {
    expect(fail(BASE, add(`<rect id="p"/><rect id="q"/>`)).join(" ")).toContain("genau ein");
    expect(fail(BASE, add(`text<rect id="p"/>`)).join(" ")).toContain("genau ein");
    expect(fail(BASE, add(`<rect id="p"/>text`)).join(" ")).toContain("genau ein");
    expect(fail(BASE, add(`<g id="p">`)).length).toBeGreaterThan(0);
    expect(ok(BASE, add(`  <g id="p"><rect id="q"/></g>\n`))).toContain(`<g id="p"><rect id="q"/></g>`);
  });

  it("Markup, das den Elternknoten schließt und ein Geschwister umhängt, scheitert", () => {
    expect(fail(BASE, add(`<g id="x"/></g><g id="y">`)).length).toBeGreaterThan(0);
  });

  // Der Markup-Check fängt diesen Weg schon vor dem Wächter; der Wächter wird deshalb direkt mit einer erfundenen
  // Spanne gefahren (Mutationsprobe 1(b)): `s` wandert ohne `move` unter ein neues Element.
  it("Wächter: ein unbewegtes Original-Geschwister behält seinen Elternknoten", () => {
    const els = scanElements(BASE).elements;
    const r = els.find((e) => e.key === "r")!;
    const insert = `<g id="x"/></g><g id="y">`;
    const out = BASE.slice(0, r.end) + insert + BASE.slice(r.end);
    expect(scanElements(out).issues).toEqual([]);
    const map = (off: number): number | undefined => (off >= r.end ? off + insert.length : off);
    const problems = roundTripProblems(out, map, [], new Map(), els.length + 2, { elements: els, removed: new Set(), moved: new Set() });
    expect(problems.join(" ")).toContain("Elternknoten");
    expect(problems.join(" ")).toContain('"s"');
  });

  it("change-Wert mit Steuerzeichen scheitert, Tab/LF/CR werden als Zeichenreferenz geschrieben und kommen zurück", () => {
    expect(fail(BASE, [{ op: "change", id: "r", attrs: { "data-x": "a\u0001b" } }]).join(" ")).toContain("Steuerzeichen");
    expect(fail(BASE, [{ op: "change", id: "r", attrs: { "data-x": "a\u0000b" } }]).length).toBeGreaterThan(0);
    const out = ok(BASE, [{ op: "change", id: "r", attrs: { "aria-label": "a\tb\nc\rd" } }]);
    expect(out).toContain(`aria-label="a&#9;b&#10;c&#13;d"`);
    const el = scanElements(out).elements.find((e) => e.key === "r")!;
    expect(el.attrs.find((a) => a.name === "aria-label")!.value).toBe("a\tb\nc\rd");
  });

  it("Schreibweg-Vertrag steht im Kopfkommentar", () => {
    const src = readFileSync(new URL("../../src/core/changes.ts", import.meta.url), "utf8");
    expect(src).toContain("Der Schreibweg (Plan 2) prüft das Ergebnis vor dem Schreiben per DOMParser auf Wohlgeformtheit (nicht den ganzen svg-guard).");
    expect(src).toContain("`change`, `add`, `remove` und `move` auf einen Nachkommen eines verschobenen Elements gelten am neuen Ort");
    expect(src).toContain("Zwei `move`, die sich gegenseitig ineinanderschieben, scheitern");
    expect(src).toContain("`remove` mit `expect`");
  });
});

describe("applyChanges: doppelte ids (Spec § 6.2)", () => {
  const DUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <rect id="a"/>\n  <rect id="a"/>\n  <circle id="c" r="1"/>\n</svg>`;

  it("ändert ein unbeteiligtes Element, obwohl anderswo eine id doppelt vorkommt", () => {
    expect(ok(DUP, [{ op: "change", id: "c", attrs: { r: "2" } }])).toContain(`<circle id="c" r="2"/>`);
    expect(ok(DUP, [{ op: "add", parent: null, after: "c", markup: `<g id="n"/>` }])).toContain(`<g id="n"/>`);
  });

  it("ein Ziel auf die doppelte id bleibt mehrdeutig", () => {
    expect(fail(DUP, [{ op: "change", id: "a", attrs: { x: "1" } }]).join(" ")).toContain("mehrdeutig");
  });

  it("Wächter: nur NEUE doppelte ids scheitern", () => {
    expect(fail(DUP, [{ op: "add", parent: null, after: "c", markup: `<g id="c"/>` }]).join(" ")).toContain("doppelt");
    expect(fail(DUP, [{ op: "change", id: "c", attrs: { id: "a" } }]).join(" ")).toContain("doppelt");
    // eine dritte Kopie einer schon doppelten id ist neu
    expect(fail(DUP, [{ op: "add", parent: null, after: "c", markup: `<g id="a"/>` }]).join(" ")).toContain("doppelt");
  });

  it("Syntaxfehler im Eingabetext werden weiter abgelehnt", () => {
    expect(fail(`<svg><rect id="r" fill=red/></svg>`, [{ op: "change", id: "r", attrs: { x: "1" } }]).join(" ")).toContain("nicht sauber lesbar");
  });
});

// --- B2: verschobene Elemente tragen ihre Änderungen mit (Scheiben), remove mit expect --------------------------------
const canonOf = (text: string, key: string): string => {
  const t = buildCanonTree(text)!;
  return canonNode(t, t.elements.findIndex((e) => e.key === key));
};

describe("applyChanges: Nachkommen verschobener Elemente (Scheiben)", () => {
  const F = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">`,
    `  <g id="G">`,
    `    <rect id="a"/>`,
    `    <rect id="b" fill="red"/>`,
    `  </g>`,
    `  <circle id="c"/>`,
    `</svg>`,
    ``,
  ].join("\n");
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">\n  <circle id="c"/>\n`;

  it("change auf einem Nachkommen eines verschobenen Elements gilt am neuen Ort", () => {
    const out = ok(F, [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "change", id: "b", attrs: { fill: "blue" } },
    ]);
    expect(out).toBe(`${head}  <g id="G">\n    <rect id="a"/>\n    <rect id="b" fill="blue"/>\n  </g>\n</svg>\n`);
    expect(out.split(`id="b"`).length - 1).toBe(1);
  });

  it("dieselbe Liste in umgekehrter Reihenfolge ergibt dasselbe", () => {
    const l: SvgChange[] = [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "change", id: "b", attrs: { fill: "blue" } },
    ];
    expect(ok(F, [...l].reverse())).toBe(ok(F, l));
  });

  it("add in ein verschobenes Element", () => {
    const out = ok(F, [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "add", parent: "G", after: "b", markup: `<rect id="s"/>` },
    ]);
    expect(out).toBe(`${head}  <g id="G">\n    <rect id="a"/>\n    <rect id="b" fill="red"/>\n    <rect id="s"/>\n  </g>\n</svg>\n`);
  });

  it("remove eines Nachkommen eines verschobenen Elements", () => {
    const out = ok(F, [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "remove", id: "a" },
    ]);
    expect(out).toBe(`${head}  <g id="G">\n    <rect id="b" fill="red"/>\n  </g>\n</svg>\n`);
  });

  it("verschachtelte move: Kind im verschobenen Elternknoten umsortiert", () => {
    const out = ok(F, [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "move", id: "b", parent: "G", after: null },
    ]);
    expect(out).toBe(`${head}  <g id="G">\n    <rect id="b" fill="red"/>\n    <rect id="a"/>\n  </g>\n</svg>\n`);
  });

  it("verschachtelte move: Kind aus dem verschobenen Element heraus, Einfügungen hinter demselben Anker behalten die Listenreihenfolge", () => {
    const out = ok(F, [
      { op: "move", id: "G", parent: null, after: "c" },
      { op: "move", id: "a", parent: null, after: "c" },
    ]);
    const els = scanElements(out).elements;
    expect(scanElements(out).issues).toEqual([]);
    expect(els.map((e) => e.key)).toEqual(["#wurzel", "c", "G", "b", "a"]);
    expect(els.find((e) => e.key === "b")!.parentKey).toBe("G");
    expect(els.find((e) => e.key === "a")!.parentKey).toBe("#wurzel");
  });

  it("ein verschobener Nachkomme wandert innerhalb des verschobenen Elternknotens weiter und trägt seine Änderung mit", () => {
    const T = `<svg><g id="X"><g id="Y"><rect id="y1"/></g><rect id="x1"/></g><circle id="c"/></svg>`;
    const out = ok(T, [
      { op: "move", id: "X", parent: null, after: "c" },
      { op: "change", id: "y1", attrs: { fill: "red" } },
      { op: "move", id: "Y", parent: "X", after: "x1" },
    ]);
    const els = scanElements(out).elements;
    expect(scanElements(out).issues).toEqual([]);
    expect(els.map((e) => e.key)).toEqual(["#wurzel", "c", "X", "x1", "Y", "y1"]);
    expect(els.find((e) => e.key === "y1")!.attrs.find((a) => a.name === "fill")?.value).toBe("red");
  });

  it("gegenseitiges Ineinanderschieben scheitert und nennt beide Änderungen", () => {
    const AB = `<svg xmlns="http://www.w3.org/2000/svg">\n  <g id="A"><rect id="a"/></g>\n  <g id="B"><rect id="b"/></g>\n</svg>`;
    const problems = fail(AB, [
      { op: "move", id: "A", parent: "B", after: null },
      { op: "move", id: "B", parent: "A", after: null },
    ]);
    expect(problems.join(" ")).toContain("Änderung 1 und 2 verschieben sich gegenseitig ineinander");
  });

  it("move in ein verschobenes Element, das selbst in ein drittes wandert, verliert nichts", () => {
    const T = `<svg>\n  <g id="P"/>\n  <g id="Q"/>\n  <g id="R"/>\n</svg>`;
    const out = ok(T, [
      { op: "move", id: "P", parent: "Q", after: null },
      { op: "move", id: "Q", parent: "R", after: null },
    ]);
    const els = scanElements(out).elements;
    expect(scanElements(out).issues).toEqual([]);
    expect(els.map((e) => [e.key, e.parentKey])).toEqual([["#wurzel", null], ["R", "#wurzel"], ["Q", "R"], ["P", "Q"]]);
  });
});

describe("applyChanges: remove mit expect", () => {
  const T = `<svg xmlns="http://www.w3.org/2000/svg">\n  <g id="G">\n    <rect id="a" x="1" y="2"/>\n    <rect id="b"/>\n  </g>\n  <circle id="c"/>\n</svg>`;

  it("entfernt, wenn die kanonische Form passt", () => {
    expect(ok(T, [{ op: "remove", id: "c", expect: canonOf(T, "c") }])).toBe(T.replace(`  <circle id="c"/>\n`, ""));
  });

  it("die kanonische Form ignoriert Leerraum zwischen Tags, Attributreihenfolge und Kommentare", () => {
    const other = `<svg xmlns="http://www.w3.org/2000/svg"><g id="G"><!-- x --><rect y="2" x="1" id="a"/>\n\n<rect id="b"></rect></g></svg>`;
    expect(ok(T, [{ op: "remove", id: "G", expect: canonOf(other, "G") }])).toBe(T.replace(/  <g id="G">[\s\S]*?<\/g>\n/, ""));
  });

  it("weicht sie ab, scheitert alles mit 'hat sich seit der Runde geändert'", () => {
    const changed = T.replace(`x="1"`, `x="5"`);
    const problems = fail(T, [
      { op: "change", id: "c", attrs: { r: "3" } },
      { op: "remove", id: "G", expect: canonOf(changed, "G") },
    ]);
    expect(problems.join(" ")).toContain("hat sich seit der Runde geändert");
    expect(problems.join(" ")).toContain("Änderung 2");
  });

  it("remove ohne expect bleibt, wie es war", () => {
    expect(ok(T, [{ op: "remove", id: "c" }])).toBe(T.replace(`  <circle id="c"/>\n`, ""));
  });
});

describe("applyChanges: Laufzeit", () => {
  it("bleibt linear (n Kreise in einer Zeile, je ein change)", () => {
    const r = pruefeLinear(
      (x: { text: string; changes: SvgChange[] }) => {
        const res = applyChanges(x.text, x.changes);
        if (!res.ok) throw new Error(res.problems.join("; "));
      },
      (n) => {
        let text = `<svg xmlns="http://www.w3.org/2000/svg">`;
        const changes: SvgChange[] = [];
        for (let i = 0; i < n; i++) {
          text += `<circle id="c${i}" r="1"/>`;
          changes.push({ op: "change", id: `c${i}`, attrs: { r: "2" } });
        }
        return { text: text + `</svg>`, changes };
      },
    );
    expect(r.linear, r.message).toBe(true);
  });
});

// --- Befunde des Opus-Reviews zu B2 ---------------------------------------------------------------------------------------
describe("applyChanges: kompaktes SVG ohne Leerraum zwischen den Tags (Review B2, Befund 1)", () => {
  it("Einfügung vor dem verschobenen Element bleibt oben, ihr Anker ist ein anderes Element", () => {
    const T = `<svg><rect id="m"/><rect id="t"/></svg>`;
    const out = ok(T, [
      { op: "add", parent: null, after: "t", markup: `<rect id="y"/>` },
      { op: "move", id: "m", parent: null, after: "t" },
      { op: "add", parent: null, after: null, markup: `<rect id="x"/>` },
    ]);
    expect(out).toBe(`<svg><rect id="x"/><rect id="t"/><rect id="y"/><rect id="m"/></svg>`);
  });

  it("drei move in dieselbe Gruppe: z wird erstes Kind", () => {
    const T = `<svg><g id="G"><rect id="m"/><rect id="n"/> <rect id="w"/></g><rect id="z"/></svg>`;
    const out = ok(T, [
      { op: "move", id: "w", parent: "G", after: "n" },
      { op: "move", id: "m", parent: "G", after: "n" },
      { op: "move", id: "z", parent: "G", after: null },
    ]);
    const els = scanElements(out).elements;
    expect(els.filter((e) => e.parentKey === "G").map((e) => e.key)).toEqual(["z", "n", "w", "m"]);
  });

  it("move hinter den bisherigen Vorgänger (No-op) scheitert nicht", () => {
    const T = `<svg><rect id="a"/><rect id="b"/></svg>`;
    expect(ok(T, [{ op: "move", id: "b", parent: null, after: "a" }])).toBe(T);
  });

  it("add hinter a und move m in G, wenn m direkt hinter a steht", () => {
    const T = `<svg><rect id="a"/><rect id="m"/><g id="G"></g></svg>`;
    const out = ok(T, [
      { op: "add", parent: null, after: "a", markup: `<rect id="x"/>` },
      { op: "move", id: "m", parent: "G", after: null },
    ]);
    expect(out).toBe(`<svg><rect id="a"/><rect id="x"/><g id="G"><rect id="m"/></g></svg>`);
  });
});

describe("applyChanges: Wächter sieht Reihenfolge und Identität (Review B2, Befund 2)", () => {
  const T = `<svg><rect id="a"/><rect id="b"/><rect id="t"/></svg>`;
  const els = scanElements(T).elements;
  const el = (k: string) => els.find((e) => e.key === k)!;
  const orig = { elements: els, removed: new Set<never>(), moved: new Set([el("a"), el("b")]) };
  const insA = { parent: el("#wurzel"), after: el("t"), source: el("a"), tag: "rect", id: "a" };
  const insB = { parent: el("#wurzel"), after: el("t"), source: el("b"), tag: "rect", id: "b" };
  // Ergebnis `<svg><rect id="t"/>…</svg>`: t beginnt bei 5, a und b gehören dahinter.
  const mapT = (o: number): number | undefined => (o === el("t").start ? 5 : o === 0 ? 0 : undefined);
  const startAt = (out: string, id: string): number => out.indexOf(`<rect id="${id}"/>`);

  it("richtige Reihenfolge t a b ist in Ordnung", () => {
    const out = `<svg><rect id="t"/><rect id="a"/><rect id="b"/></svg>`;
    const p = roundTripProblems(out, mapT, [{ start: startAt(out, "a"), ins: insA }, { start: startAt(out, "b"), ins: insB }], new Map(), 4, orig);
    expect(p).toEqual([]);
  });

  it("vertauschte Reihenfolge t b a scheitert", () => {
    const out = `<svg><rect id="t"/><rect id="b"/><rect id="a"/></svg>`;
    const p = roundTripProblems(out, mapT, [{ start: startAt(out, "a"), ins: insA }, { start: startAt(out, "b"), ins: insB }], new Map(), 4, orig);
    expect(p.length).toBeGreaterThan(0);
  });

  it("ein fremdes Element an der Marke scheitert", () => {
    const out = `<svg><rect id="t"/><rect id="c"/><rect id="b"/></svg>`;
    const p = roundTripProblems(out, mapT, [{ start: startAt(out, "c"), ins: insA }, { start: startAt(out, "b"), ins: insB }], new Map(), 4, orig);
    expect(p.join(" ")).toContain("statt");
  });
});

describe("applyChanges: Zyklen und feste Schlüssel (Review B2)", () => {
  it("Kreis aus drei Elementen nennt alle drei", () => {
    const T = `<svg><g id="A"/><g id="B"/><g id="C"/></svg>`;
    const p = fail(T, [
      { op: "move", id: "A", parent: "B", after: null },
      { op: "move", id: "B", parent: "C", after: null },
      { op: "move", id: "C", parent: "A", after: null },
    ]);
    expect(p.join(" ")).toContain("Änderung 1, 2 und 3 verschieben sich gegenseitig ineinander");
  });

  it("ein unbeteiligtes Element im Zyklus-Umfeld wird nicht genannt", () => {
    const T = `<svg><g id="A"><g id="D"/></g><g id="B"/></svg>`;
    const p = fail(T, [
      { op: "move", id: "D", parent: "A", after: null },
      { op: "move", id: "A", parent: "B", after: null },
      { op: "move", id: "B", parent: "A", after: null },
    ]);
    expect(p.join(" ")).toContain("Änderung 2 und 3 verschieben sich gegenseitig ineinander");
    expect(p.join(" ")).not.toContain("1,");
  });

  it("move und remove desselben Elements: eigene Meldung ohne 'A samt A'", () => {
    const T = `<svg><g id="A"/><g id="B"/></svg>`;
    const p = fail(T, [{ op: "move", id: "A", parent: "B", after: null }, { op: "remove", id: "A" }]);
    expect(p.join(" ")).not.toContain('"A" samt "A"');
    expect(p.length).toBeGreaterThan(0);
  });

  it("remove von style, title und desc braucht expect", () => {
    const T = `<svg><title>T</title><desc>D</desc><style>a{}</style><rect id="r"/></svg>`;
    for (const key of ["#title", "#desc", "#style-1"]) {
      expect(fail(T, [{ op: "remove", id: key }]).join(" ")).toContain("expect");
    }
    expect(ok(T, [{ op: "remove", id: "#style-1", expect: canonOf(T, "#style-1") }])).toBe(`<svg><title>T</title><desc>D</desc><rect id="r"/></svg>`);
  });
});

describe("applyChanges: lange Zeilen (Review B2, Befund 3 und 7)", () => {
  const line = (n: number): string => `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: n }, (_, i) => `<circle id="c${i}" r="1"/>`).join("")}</svg>`;
  const linear = (make: (n: number) => SvgChange[]): void => {
    const r = pruefeLinear(
      (x: { text: string; changes: SvgChange[] }) => {
        const res = applyChanges(x.text, x.changes);
        if (!res.ok) throw new Error(res.problems.join("; "));
      },
      (n) => ({ text: line(n), changes: make(n) }),
    );
    expect(r.linear, r.message).toBe(true);
  };
  it("remove bleibt linear (alles in einer Zeile)", () => linear((n) => Array.from({ length: n }, (_, i) => ({ op: "remove", id: `c${i}` }) as SvgChange)));
  it("move bleibt linear", () => linear((n) => Array.from({ length: n }, (_, i) => ({ op: "move", id: `c${i}`, parent: null, after: null }) as SvgChange).slice(0, Math.min(n, 400))));
  it("add bleibt linear", () => linear((n) => Array.from({ length: n }, (_, i) => ({ op: "add", parent: null, after: `c${i}`, markup: `<rect id="n${i}"/>` }) as SvgChange)));

  it("5000 verschachtelte Verschiebungen werfen nicht, sondern liefern ein Ergebnis oder ein Problem", () => {
    const n = 5000;
    const T = `<svg>${Array.from({ length: n }, (_, i) => `<g id="p${i}"/>`).join("")}</svg>`;
    const changes: SvgChange[] = Array.from({ length: n - 1 }, (_, i) => ({ op: "move", id: `p${i}`, parent: `p${i + 1}`, after: null }));
    expect(() => applyChanges(T, changes)).not.toThrow();
  });
});

describe("applyChanges: Meldung bei unbekannter id bleibt klein (Reste Plan 2 B2, Punkt 3)", () => {
  const many = `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: 2000 }, (_, i) => `<g id="element-mit-langem-namen-${String(i)}"/>`).join("")}</svg>`;

  it("50 unbekannte ids auf 2000 Elementen: jede Meldung nennt höchstens 20 vorhandene Schlüssel und die Zahl der übrigen", () => {
    const changes: SvgChange[] = Array.from({ length: 50 }, (_, i) => ({ op: "change", id: `gibt-es-nicht-${String(i)}`, attrs: { fill: "red" } }));
    const r = applyChanges(many, changes);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toHaveLength(50);
    const first = r.problems[0]!;
    expect(first).toContain(`kein Element "gibt-es-nicht-0"`);
    expect(first).toContain("element-mit-langem-namen-18");
    expect(first).not.toContain("element-mit-langem-namen-21");
    expect(first).toContain("und 1981 weitere");
    expect(r.problems.join("").length).toBeLessThan(50 * 800);
  });

  it("wenige Elemente: alle Schlüssel stehen da, kein „weitere“", () => {
    const r = applyChanges(`<svg xmlns="http://www.w3.org/2000/svg"><g id="a"/><g id="b"/></svg>`, [{ op: "change", id: "x", attrs: { fill: "red" } }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]).toBe(`Änderung 1 (change): kein Element "x" (vorhanden: #wurzel, a, b)`);
  });
});
