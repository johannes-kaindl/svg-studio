import { describe, expect, it } from "vitest";
import { canonDocument } from "../../src/core/canon";
import { applyChanges } from "../../src/core/changes";
import { changesFor, diffSvg, type DiffEntry } from "../../src/core/diff";
import { scanElements } from "../../src/core/elements";

// Der Nutzer nimmt jeden Eintrag einzeln an oder lehnt ihn ab (Spec § 3 Punkt 2): JEDE Teilmenge muss sich anwenden lassen und darf kein
// Element verlieren, das Ausgang und Antwort beide tragen. Fälle aus dem Opus-Review zu B3 (T = Teilmengen-Befund, W = Leerraum, F/R = Form).
const S = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const CASES: Array<[string, string, string]> = [
  ["T1 Gruppe umbenannt", S(`<g id="r"><rect id="x"/></g>`), S(`<g id="n"><rect id="x"/></g>`)],
  ["T2 Textänderung und Auflösen in einem Eltern", S(`<g id="P">hallo<g id="G"><rect id="x"/></g></g>`), S(`<g id="P">tschüss</g><rect id="x"/>`)],
  ["T3 Gruppe in neue Gruppe, alte aufgelöst", S(`<g id="W"><g id="G"><rect id="x"/></g></g>`), S(`<g id="N"><g id="W"/></g><rect id="x"/>`)],
  ["T5 Einfügen hinter ersetztem Geschwister", S(`<rect id="a"/><text id="t">A</text><rect id="b"/>`), S(`<rect id="a"/><text id="t">B</text><rect id="n"/><rect id="b"/>`)],
  ["T19 mehrere Ersetzungen und eine Einfügung", S(`<text id="t1">A</text><text id="t2">B</text>`), S(`<text id="t1">A2</text><rect id="n"/><text id="t2">B2</text>`)],
  ["T6 Auflösen mit neuem Geschwister dazwischen", S(`<g id="gr"><rect id="a"/><rect id="b"/></g><circle id="c"/>`), S(`<rect id="a"/><rect id="n"/><rect id="b"/><circle id="c"/>`)],
  ["R3 Wickeln und Text am eingepackten Element", S(`<rect id="a"/><text id="t">A</text>`), S(`<g id="n"><rect id="a"/><text id="t">B</text></g>`)],
  ["R1 Text im tspan geändert", S(`<text id="t">Hallo <tspan id="s">Welt</tspan></text>`), S(`<text id="t">Hallo <tspan id="s">Erde</tspan></text>`)],
  ["F7 Tagwechsel bei gleicher id", S(`<rect id="a" x="1"/><circle id="c"/>`), S(`<circle id="a" cx="1"/><circle id="c"/>`)],
  ["Element wandert in ersetztes Element", S(`<text id="t">A</text><rect id="r"/>`), S(`<text id="t">B<rect id="r"/></text>`)],
  ["Umbenennen eines tspan im Text", S(`<text id="t">x<tspan id="s">B</tspan></text>`), S(`<text id="t">x<tspan id="s2">B</tspan></text>`)],
  ["Verschieben neben Ersetzen", S(`<text id="e1">A<tspan id="e2">B</tspan></text><circle id="e3"/><rect id="e4"/>`), S(`<text id="e1">A<tspan id="e2">B!</tspan></text><rect id="e4"/><circle id="e3"/>`)],
  ["Attribute, Hinzufügen und Entfernen gemischt", S(`<g id="g"><rect id="a" x="1"/><rect id="b"/></g><circle id="c" r="1"/>`), S(`<g id="g"><rect id="a" x="2"/><rect id="n"/></g><circle id="c" r="2"/><rect id="z"/>`)],
];

const idsOf = (text: string): Set<string> => new Set(scanElements(text).elements.flatMap((e) => (e.id === null ? [] : [e.id])));

describe("diffSvg: jede Teilmenge der Einträge lässt sich anwenden", () => {
  it.each(CASES)("%s", (_name, base, answer) => {
    const d = diffSvg(base, answer);
    if (!d.decomposable) throw new Error(`erwartet zerlegbar: ${d.why}`);
    const es: DiffEntry[] = d.entries;
    expect(es.length).toBeGreaterThan(0);
    expect(es.length).toBeLessThanOrEqual(10);
    const keep = [...idsOf(base)].filter((id) => idsOf(answer).has(id));
    for (let mask = 0; mask < 1 << es.length; mask++) {
      const accepted = new Set(es.flatMap((_, i) => ((mask >> i) & 1 ? [i] : [])));
      const r = applyChanges(base, changesFor(es, accepted));
      expect(r.ok, `Teilmenge ${[...accepted].join(",")}: ${r.ok ? "" : r.problems.join("; ")}`).toBe(true);
      if (!r.ok) continue;
      // Kein Element verlieren, das beide Seiten tragen.
      const got = idsOf(r.text);
      for (const id of keep) expect(got.has(id), `Teilmenge ${[...accepted].join(",")} verliert "${id}"`).toBe(true);
    }
    // Alle zusammen ergeben die Antwort.
    const all = applyChanges(base, changesFor(es, new Set(es.keys())));
    expect(all.ok && canonDocument(all.text)).toBe(canonDocument(answer));
  });
});

describe("diffSvg: Befunde des Reviews einzeln", () => {
  it("T1: Umbenennen einer Gruppe ist EIN Eintrag", () => {
    const d = diffSvg(CASES[0][1], CASES[0][2]);
    expect(d.decomposable && d.entries.length).toBe(1);
  });
  it("T2: Textänderung und Auflösen am selben Elternknoten sind EIN Eintrag, P wird nur einmal entfernt", () => {
    const d = diffSvg(CASES[1][1], CASES[1][2]);
    expect(d.decomposable && d.entries.length).toBe(1);
    expect(d.decomposable && d.entries[0].changes.filter((c) => c.op === "remove" && c.id === "P")).toHaveLength(1);
  });
  it("T6: neues Element zwischen herausgelösten Kindern steht an seiner Stelle", () => {
    const d = diffSvg(CASES[5][1], CASES[5][2]);
    expect(d.decomposable).toBe(true);
  });
  it("R3: Wickeln mit Textänderung am eingepackten Element ist zerlegbar", () => {
    expect(diffSvg(CASES[6][1], CASES[6][2]).decomposable).toBe(true);
  });
  it("R1: Text im tspan geändert → das Textelement wird ersetzt", () => {
    const d = diffSvg(CASES[7][1], CASES[7][2]);
    expect(d.decomposable && d.entries.map((e) => `${e.kind}:${e.key}`)).toEqual(["replace:t"]);
  });
  it("F7: Tagwechsel → replace mit Grund tag", () => {
    const d = diffSvg(CASES[8][1], CASES[8][2]);
    expect(d.decomposable && d.entries[0]).toMatchObject({ kind: "replace", key: "a", reason: "tag" });
  });
  it("W1: ein Leerzeichen am Rand eines tspan ist eine Änderung", () => {
    const a = S(`<text id="t">A<tspan id="s">B</tspan></text>`);
    const d = diffSvg(a, S(`<text id="t">A<tspan id="s"> B</tspan></text>`));
    expect(d.decomposable && d.entries.length).toBe(1);
  });
  it("F1: ein zweites Wurzelelement macht die Antwort nicht lesbar", () => {
    const a = S(`<rect id="a"/>`);
    const d = diffSvg(a, `${a}<svg id="z"><rect id="evil"/></svg>`);
    expect(d).toEqual({ decomposable: false, why: "Antwort nicht lesbar: mehr als ein Wurzelelement" });
  });
});
