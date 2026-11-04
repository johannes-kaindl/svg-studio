import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/core/changes";
import { buildCanonTree, canonDocument, canonNode } from "../../src/core/canon";
import { changesFor, diffSvg, type DiffEntry } from "../../src/core/diff";

const BASE = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
  `  <g id="szene">`,
  `    <circle id="mond" cx="50" cy="50" r="40"/>`,
  `    <rect id="haus" x="1" y="1" width="9" height="9"/>`,
  `  </g>`,
  `  <rect id="boden" x="0" y="90" width="100" height="10"/>`,
  `</svg>`,
  ``,
].join("\n");

/** Zerlegung, die gelingen muss. */
const entries = (base: string, answer: string): DiffEntry[] => {
  const r = diffSvg(base, answer);
  if (!r.decomposable) throw new Error(`erwartet zerlegbar, bekam: ${r.why}`);
  return r.entries;
};
const why = (base: string, answer: string): string => {
  const r = diffSvg(base, answer);
  if (r.decomposable) throw new Error("erwartet nicht zerlegbar");
  return r.why;
};
const kinds = (es: DiffEntry[]): string[] => es.map((e) => `${e.kind}:${e.key}`);

describe("diffSvg: nichts geändert", () => {
  it("gleicher Text → keine Einträge, zerlegbar", () => {
    expect(entries(BASE, BASE)).toEqual([]);
  });
  it("nur Kommentar dazu → keine Einträge", () => {
    expect(entries(BASE, BASE.replace(`<g id="szene">`, `<!-- Szene --><g id="szene">`))).toEqual([]);
  });
  it("d neu umbrochen → keine Einträge", () => {
    const a = `<svg><path id="p" d="M0 0 L1 1 L2 2"/></svg>`;
    const b = `<svg><path id="p" d="M0 0\n     L1 1\n     L2 2"/></svg>`;
    expect(entries(a, b)).toEqual([]);
  });
});

describe("diffSvg: Attribute", () => {
  it("Kreis mond: r 40 → 60 ist genau ein Eintrag", () => {
    expect(entries(BASE, BASE.replace(`r="40"`, `r="60"`))).toEqual([
      { kind: "attr", key: "mond", tag: "circle", attr: "r", from: "40", to: "60", changes: [{ op: "change", id: "mond", attrs: { r: "60" } }] },
    ]);
  });
  it("Wurzel viewBox geändert → attr auf #wurzel", () => {
    const es = entries(BASE, BASE.replace(`viewBox="0 0 100 100"`, `viewBox="0 0 200 200"`));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "attr", key: "#wurzel", attr: "viewBox", from: "0 0 100 100", to: "0 0 200 200" });
  });
  it("data-role ist ein normales Attribut; ein entferntes Attribut hat to null", () => {
    const es = entries(BASE, BASE.replace(`<rect id="haus" x="1"`, `<rect id="haus" data-role="wand"`));
    expect(es.map((e) => (e.kind === "attr" ? `${e.attr}:${e.from}>${e.to}` : e.kind)).sort()).toEqual(["data-role:null>wand", "x:1>null"]);
  });
});

describe("diffSvg: Hinzufügen und Entfernen", () => {
  it("hinzugefügt hinter unbewegtem Anker", () => {
    const es = entries(BASE, BASE.replace(`    <rect id="haus"`, `    <rect id="tuer" x="2"/>\n    <rect id="haus"`));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "add", key: "tuer", tag: "rect" });
    expect(es[0].changes).toEqual([{ op: "add", parent: "szene", after: "mond", markup: `<rect id="tuer" x="2"/>` }]);
  });
  it("als erstes Kind hinzugefügt: after null", () => {
    const es = entries(BASE, BASE.replace(`  <g id="szene">`, `  <rect id="bg"/>\n  <g id="szene">`));
    expect(es[0].changes).toEqual([{ op: "add", parent: null, after: null, markup: `<rect id="bg"/>` }]);
  });
  it("zwei hinzugefügt hinter demselben Anker in Antwortreihenfolge", () => {
    const es = entries(BASE, BASE.replace(`    <rect id="haus"`, `    <rect id="a1"/>\n    <rect id="a2"/>\n    <rect id="haus"`));
    expect(kinds(es)).toEqual(["add:a1", "add:a2"]);
    expect(es.map((e) => (e.changes[0] as { after: string | null }).after)).toEqual(["mond", "mond"]);
  });
  it("entfernt samt Nachkommen: ein Eintrag, remove trägt expect", () => {
    const es = entries(BASE, BASE.replace(/  <g id="szene">[\s\S]*?<\/g>\n/, ""));
    expect(kinds(es)).toEqual(["remove:szene"]);
    const c = es[0].changes[0];
    expect(c).toMatchObject({ op: "remove", id: "szene" });
    expect((c as { expect?: string }).expect).toBe(canonOf(BASE, "szene"));
  });
});

function canonOf(text: string, key: string): string {
  const t = buildCanonTree(text)!;
  return canonNode(t, t.elements.findIndex((e) => e.key === key));
}

describe("diffSvg: Reihenfolge und Ebene", () => {
  it("Stapelreihenfolge → move mit Anker", () => {
    const swapped = BASE.replace(/    <circle[^\n]*\n    <rect id="haus"[^\n]*\n/, (m) => m.split("\n").slice(0, 2).reverse().join("\n") + "\n");
    const es = entries(BASE, swapped);
    expect(es).toHaveLength(1);
    expect(es[0].kind).toBe("move");
    expect(es[0].changes).toEqual([{ op: "move", id: es[0].key, parent: "szene", after: es[0].key === "mond" ? "haus" : null }]);
  });
  it("Elternwechsel → move mit parent", () => {
    const ans = BASE.replace(`    <rect id="haus" x="1" y="1" width="9" height="9"/>\n`, "").replace(`  <rect id="boden"`, `  <rect id="haus" x="1" y="1" width="9" height="9"/>\n  <rect id="boden"`);
    const es = entries(BASE, ans);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "move", key: "haus", parentKey: null });
    expect(es[0].changes).toEqual([{ op: "move", id: "haus", parent: null, after: "szene" }]);
  });
  it("Ebene umsortiert plus Wert geändert → move und attr, zerlegbar", () => {
    const ans = BASE.replace(`    <rect id="haus" x="1" y="1" width="9" height="9"/>\n`, "").replace(`  <rect id="boden"`, `  <rect id="haus" x="7" y="1" width="9" height="9"/>\n  <rect id="boden"`);
    expect(kinds(entries(BASE, ans)).sort()).toEqual(["attr:haus", "move:haus"]);
  });
});

describe("diffSvg: Text und Stil", () => {
  const T = `<svg><text id="t" x="1">Hallo</text><style>.a{fill:red}</style><rect id="r"/></svg>`;
  it("Text in <text> → replace text", () => {
    const es = entries(T, T.replace("Hallo", "Hi"));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "t", reason: "text" });
    expect(es[0].changes.map((c) => c.op)).toEqual(["remove", "add"]);
  });
  it("Text in <text> mit <tspan> → ein replace des text-Elements, keine Einträge für tspan", () => {
    const S = `<svg><text id="t">Hallo <tspan id="s" fill="red">Welt</tspan></text></svg>`;
    const es = entries(S, `<svg><text id="t">Hi <tspan id="s" fill="blue">Welt!</tspan></text></svg>`);
    expect(kinds(es)).toEqual(["replace:t"]);
  });
  it("Stil geändert → replace style", () => {
    const es = entries(T, T.replace("red", "blue"));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "#style-1", reason: "style" });
    expect((es[0].changes[0] as { expect?: string }).expect).toBeDefined();
  });
  it("verschoben und Text geändert → replace moved-and-text am neuen Ort", () => {
    const S = `<svg><text id="a">eins</text><text id="b">zwei</text><text id="c">drei</text></svg>`;
    const es = entries(S, `<svg><text id="b">zwei</text><text id="c">drei</text><text id="a">eins!</text></svg>`);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "a", reason: "moved-and-text" });
    expect(es[0].changes[1]).toMatchObject({ op: "add", parent: null, after: "c" });
  });
});

describe("diffSvg: Gruppen", () => {
  const G = `<svg><rect id="a"/><rect id="b"/><circle id="c"/></svg>`;
  it("in neue Gruppe gewickelt → ein Eintrag wrap", () => {
    const es = entries(G, `<svg><g id="neu"><rect id="a"/><rect id="b"/></g><circle id="c"/></svg>`);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "neu", reason: "wrap" });
    expect(es[0].changes.map((c) => c.op)).toEqual(["add", "remove", "remove"]);
    expect(es[0].changes.slice(1).every((c) => (c as { expect?: string }).expect !== undefined)).toBe(true);
  });
  it("Gruppe aufgelöst → ein Eintrag unwrap", () => {
    const W = `<svg><g id="gr"><rect id="a"/><rect id="b"/></g><circle id="c"/></svg>`;
    const es = entries(W, G);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "gr", reason: "unwrap" });
    expect(es[0].changes.map((c) => c.op)).toEqual(["remove", "add", "add"]);
  });
  it("Gruppe aufgelöst, eingepackte Kinder mit geänderten Werten: Markup trägt die Antwortwerte", () => {
    const W = `<svg><g id="gr"><rect id="a" x="1"/></g></svg>`;
    const es = entries(W, `<svg><rect id="a" x="2"/></svg>`);
    expect(es[0].changes[1]).toMatchObject({ op: "add", markup: `<rect id="a" x="2"/>` });
  });
});

describe("diffSvg: Anwendung", () => {
  const cases: Array<[string, string, string]> = [
    ["Attribut", BASE, BASE.replace(`r="40"`, `r="60"`)],
    ["Hinzufügen", BASE, BASE.replace(`    <rect id="haus"`, `    <rect id="tuer" x="2"/>\n    <rect id="haus"`)],
    ["Entfernen", BASE, BASE.replace(/  <g id="szene">[\s\S]*?<\/g>\n/, "")],
    ["Elternwechsel", BASE, BASE.replace(`    <rect id="haus" x="1" y="1" width="9" height="9"/>\n`, "").replace(`  <rect id="boden"`, `  <rect id="haus" x="1" y="1" width="9" height="9"/>\n  <rect id="boden"`)],
    ["Text", `<svg><text id="t">A</text></svg>`, `<svg><text id="t">B</text></svg>`],
    ["Wickeln", `<svg><rect id="a"/><rect id="b"/></svg>`, `<svg><g id="n"><rect id="a"/><rect id="b"/></g></svg>`],
    ["Auflösen", `<svg><g id="n"><rect id="a"/><rect id="b"/></g></svg>`, `<svg><rect id="a"/><rect id="b"/></svg>`],
  ];
  it.each(cases)("jeder Eintrag einzeln angewendet ergibt ein gültiges Ergebnis (%s)", (_n, base, answer) => {
    const es = entries(base, answer);
    expect(es.length).toBeGreaterThan(0);
    for (const e of es) {
      const r = applyChanges(base, e.changes);
      expect(r.ok, r.ok ? "" : r.problems.join("; ")).toBe(true);
    }
  });
  it.each(cases)("alle Einträge zusammen ergeben die Antwort (%s)", (_n, base, answer) => {
    const es = entries(base, answer);
    const r = applyChanges(base, changesFor(es, new Set(es.keys())));
    expect(r.ok).toBe(true);
    if (r.ok) expect(canonDocument(r.text)).toBe(canonDocument(answer));
  });
  it("changesFor nimmt nur angenommene Einträge, in Listenreihenfolge", () => {
    const es = entries(BASE, BASE.replace(`r="40"`, `r="60"`).replace(`x="0" y="90"`, `x="5" y="90"`));
    expect(es).toHaveLength(2);
    expect(changesFor(es, new Set([1]))).toEqual(es[1].changes);
    expect(changesFor(es, new Set())).toEqual([]);
    expect(changesFor(es, new Set([1, 0]))).toEqual([...es[0].changes, ...es[1].changes]);
  });
});

describe("diffSvg: nicht zerlegbar", () => {
  it("neues Element ohne id → why nennt 'ohne id'", () => {
    expect(why(BASE, BASE.replace(`    <rect id="haus"`, `    <rect x="2"/>\n    <rect id="haus"`))).toContain("ohne id");
  });
  it("Änderung an Element ohne id → why nennt 'ohne id'", () => {
    const a = `<svg><rect x="1"/></svg>`;
    expect(why(a, `<svg><rect x="2"/></svg>`)).toContain("ohne id");
  });
  it("Änderung an doppelter id → why nennt 'mehrdeutig'", () => {
    const a = `<svg><rect id="d" x="1"/><rect id="d" x="2"/></svg>`;
    expect(why(a, `<svg><rect id="d" x="5"/><rect id="d" x="2"/></svg>`)).toContain("mehrdeutig");
  });
  it("doppelte ids ohne Änderung daran blockieren nichts", () => {
    const a = `<svg><rect id="d" x="1"/><rect id="d" x="2"/><circle id="c" r="1"/></svg>`;
    const es = entries(a, a.replace(`r="1"`, `r="2"`));
    expect(kinds(es)).toEqual(["attr:c"]);
  });
  it("Ausgang mit Syntaxbefund → 'Ausgang nicht lesbar'", () => {
    expect(why(`<svg><rect id="a"></svg>`, BASE)).toBe("Ausgang nicht lesbar");
  });
  it("Antwort mit Syntaxbefund → why nennt die Antwort", () => {
    expect(why(BASE, `<svg><rect id="a"></svg>`)).toContain("Antwort nicht lesbar");
  });
  it("Element wandert in ein ersetztes Element → ein Eintrag, der es am alten Ort entfernt", () => {
    const a = `<svg><text id="t">A</text><rect id="r"/></svg>`;
    const es = entries(a, `<svg><text id="t">B<rect id="r"/></text></svg>`);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "replace", key: "t" });
    expect(es[0].changes.map((c) => c.op)).toEqual(["remove", "add", "remove"]);
  });
  it("Element wandert aus einem ersetzten Element heraus → nicht zerlegbar", () => {
    const a = `<svg><text id="t">A<rect id="r"/></text></svg>`;
    expect(why(a, `<svg><text id="t">B</text><rect id="r"/></svg>`)).toContain("ersetzt");
  });
  it("Text im Wurzelelement geändert: die Endprüfung findet, dass die Einträge die Antwort nicht ergeben", () => {
    expect(why(`<svg>hallo<rect id="a"/></svg>`, `<svg>tschüss<rect id="a"/></svg>`)).toBe("Die Einträge ergeben nicht die Antwort");
  });
  it("zwei neue Elemente mit derselben id: applyChanges scheitert, nicht zerlegbar mit Grund", () => {
    expect(why(`<svg><rect id="a"/></svg>`, `<svg><rect id="a"/><rect id="n"/><rect id="n"/></svg>`)).toContain("Die Einträge passen nicht zusammen");
  });
  it("eine Änderung nur im Leerraum eines Pfads neben einer echten Änderung bleibt aus den Einträgen", () => {
    const a = `<svg><path id="p" d="M0 0 L1 1" fill="red"/></svg>`;
    const es = entries(a, `<svg><path id="p" d="M0 0\n   L1 1" fill="blue"/></svg>`);
    expect(es.map((e) => (e.kind === "attr" ? e.attr : e.kind))).toEqual(["fill"]);
  });
});
