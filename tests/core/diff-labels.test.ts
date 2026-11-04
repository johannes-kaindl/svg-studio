import { beforeEach, describe, expect, it } from "vitest";
import { describeEntry } from "../../src/core/diff-labels";
import { diffSvg, type DiffEntry } from "../../src/core/diff";
import { initStrings, labelTexts } from "../../src/i18n/strings";

const S = (inner: string, root = ""): string => `<svg xmlns="http://www.w3.org/2000/svg"${root}>\n${inner}\n</svg>\n`;
const entries = (base: string, answer: string): DiffEntry[] => {
  const d = diffSvg(base, answer);
  if (!d.decomposable) throw new Error(d.why);
  return d.entries;
};
const title = (e: DiffEntry): string => describeEntry(e, labelTexts()).title;
const flat = (e: DiffEntry): string => describeEntry(e, labelTexts()).segments.map((s) => s.text).join("");
/** Der alte Text: gleiche und gelöschte Segmente; der neue: gleiche und eingefügte. */
const oldNew = (e: DiffEntry): { old: string; neu: string } => {
  const seg = describeEntry(e, labelTexts()).segments;
  return { old: seg.filter((s) => s.kind !== "ins").map((s) => s.text).join(""), neu: seg.filter((s) => s.kind !== "del").map((s) => s.text).join("") };
};

beforeEach(() => { initStrings("en"); });

describe("describeEntry: attr", () => {
  const BASE = S(`  <circle id="mond" r="40"/>\n  <path id="weg" d="M0 0 L10 10"/>`);

  it("Kreis mond: r 40 → 60, auf Englisch und Deutsch", () => {
    const e = entries(BASE, BASE.replace(`r="40"`, `r="60"`))[0]!;
    expect(title(e)).toBe("Circle mond: r 40 → 60");
    initStrings("de");
    expect(title(e)).toBe("Kreis mond: r 40 → 60");
  });

  it("die Segmente füttern das Redline: gleich, gelöscht 40, eingefügt 60; Art ‚geändert‘", () => {
    const e = entries(BASE, BASE.replace(`r="40"`, `r="60"`))[0]!;
    expect(describeEntry(e, labelTexts())).toMatchObject({
      segments: [{ kind: "same", text: "Circle mond: r " }, { kind: "del", text: "40" }, { kind: "ins", text: "60" }],
      changeKind: "substitution",
      jumpId: "mond",
    });
  });

  it("d und points: „Form geändert“, nie eine Zahl; die Vorschau springt zum Element", () => {
    const e = entries(BASE, BASE.replace(`M0 0 L10 10`, `M0 0 L99 98 L7 7`))[0]!;
    expect(title(e)).toBe("Path weg: shape changed");
    expect(flat(e)).toBe("Path weg: shape changed");
    expect(flat(e)).not.toMatch(/\d/);
    expect(describeEntry(e, labelTexts()).jumpId).toBe("weg");
    initStrings("de");
    expect(title(e)).toBe("Pfad weg: Form geändert");
    const poly = S(`  <polygon id="dach" points="0,0 5,5"/>`);
    const p = entries(poly, poly.replace("0,0 5,5", "1,1 6,6 9,9"))[0]!;
    expect(title(p)).toBe("Vieleck dach: Form geändert");
  });

  it("Wurzel: „Bildfläche: viewBox 0 0 460 425 → 0 0 700 425“, ohne Elementnamen und ohne Sprung", () => {
    const base = S(`  <circle id="mond" r="4"/>`, ` viewBox="0 0 460 425"`);
    const e = entries(base, base.replace("0 0 460 425", "0 0 700 425"))[0]!;
    expect(title(e)).toBe("Canvas: viewBox 0 0 460 425 → 0 0 700 425");
    expect(oldNew(e)).toEqual({ old: "Canvas: viewBox 0 0 460 425", neu: "Canvas: viewBox 0 0 700 425" });
    expect(describeEntry(e, labelTexts()).jumpId).toBeNull();
    initStrings("de");
    expect(title(e)).toBe("Bildfläche: viewBox 0 0 460 425 → 0 0 700 425");
  });

  it("neues Attribut ist eine Einfügung, entferntes eine Löschung; ‚nicht gesetzt‘ steht im Titel", () => {
    const base = S(`  <circle id="mond" r="4"/>`);
    const withFill = entries(base, base.replace(`r="4"`, `r="4" fill="red"`))[0]!;
    expect(describeEntry(withFill, labelTexts())).toMatchObject({ title: "Circle mond: fill not set → red", changeKind: "insertion" });
    const without = entries(base.replace(`r="4"`, `r="4" fill="red"`), base)[0]!;
    expect(describeEntry(without, labelTexts())).toMatchObject({ title: "Circle mond: fill red → not set", changeKind: "deletion" });
    initStrings("de");
    expect(title(withFill)).toBe("Kreis mond: fill nicht gesetzt → red");
  });

  it("ein unbekannter Elementname bleibt, wie er ist", () => {
    const e: DiffEntry = { kind: "attr", key: "x1", tag: "feTurbulence", attr: "baseFrequency", from: "1", to: "2", changes: [] };
    expect(title(e)).toBe("feTurbulence x1: baseFrequency 1 → 2");
  });
});

describe("describeEntry: add, remove, move", () => {
  it("Rechteck tür: hinzugefügt / entfernt", () => {
    const base = S(`  <circle id="mond" r="4"/>`);
    const add = entries(base, S(`  <circle id="mond" r="4"/>\n  <rect id="tuer" x="1"/>`))[0]!;
    expect(describeEntry(add, labelTexts())).toMatchObject({ title: "Rectangle tuer: added", changeKind: "insertion", segments: [{ kind: "ins", text: "Rectangle tuer: added" }] });
    const rem = entries(S(`  <circle id="mond" r="4"/>\n  <rect id="tuer" x="1"/>`), base)[0]!;
    expect(describeEntry(rem, labelTexts())).toMatchObject({ title: "Rectangle tuer: removed", changeKind: "deletion", segments: [{ kind: "del", text: "Rectangle tuer: removed" }] });
    initStrings("de");
    expect(title(add)).toBe("Rechteck tuer: hinzugefügt");
    expect(title(rem)).toBe("Rechteck tuer: entfernt");
  });

  it("move: nach vorn, nach hinten, in Gruppe …, auf die oberste Ebene, unbekannt", () => {
    const mv = (m: Partial<Extract<DiffEntry, { kind: "move" }>>): DiffEntry => ({ kind: "move", key: "mond", tag: "circle", parentKey: null, changes: [], ...m });
    expect(title(mv({ reparent: false, front: true }))).toBe("Circle mond: to the front");
    expect(title(mv({ reparent: false, front: false }))).toBe("Circle mond: to the back");
    expect(title(mv({ reparent: true, parentKey: "wand-nord" }))).toBe("Circle mond: into group wand-nord");
    expect(title(mv({ reparent: true, parentKey: null }))).toBe("Circle mond: to the top level");
    expect(title(mv({}))).toBe("Circle mond: order changed");
    // Der Elternwechsel gilt vor der Richtung (ein Wechsel in eine Gruppe ist nicht „nach vorn“).
    expect(title(mv({ reparent: true, front: true, parentKey: "wand-nord" }))).toBe("Circle mond: into group wand-nord");
    initStrings("de");
    expect(title(mv({ reparent: false, front: true }))).toBe("Kreis mond: nach vorn");
    expect(title(mv({ reparent: true, parentKey: "wand-nord" }))).toBe("Kreis mond: in Gruppe wand-nord");
  });

  it("diffSvg liefert für eine umsortierte Ebene die Richtung und für einen Elternwechsel den Wechsel", () => {
    const base = S(`  <g id="szene">\n    <circle id="mond" r="4"/>\n    <rect id="haus" x="1"/>\n    <rect id="tuer" x="2"/>\n  </g>\n  <g id="wand-nord">\n  </g>`);
    const front = S(`  <g id="szene">\n    <rect id="haus" x="1"/>\n    <rect id="tuer" x="2"/>\n    <circle id="mond" r="4"/>\n  </g>\n  <g id="wand-nord">\n  </g>`);
    const e = entries(base, front);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "move", reparent: false });
    // Je nachdem, welches Element der Diff als „bewegt“ nimmt, heißt es nach vorn oder nach hinten; die Richtung stimmt zum Element.
    const m = e[0] as Extract<DiffEntry, { kind: "move" }>;
    expect(m.front).toBe(m.key === "mond");
    const wand = S(`  <g id="szene">\n    <circle id="mond" r="4"/>\n    <rect id="haus" x="1"/>\n  </g>\n  <g id="wand-nord">\n    <rect id="tuer" x="2"/>\n  </g>`);
    const r = entries(base, wand)[0]!;
    expect(r).toMatchObject({ kind: "move", key: "tuer", reparent: true, parentKey: "wand-nord" });
    expect(title(r)).toBe("Rectangle tuer: into group wand-nord");
  });
});

describe("describeEntry: replace", () => {
  it("style, title und desc einzeln: „Stil geändert“, „Titel geändert“, „Beschreibung geändert“, ohne id und ohne Sprung", () => {
    const base = S(`  <title>Alt</title>\n  <circle id="mond" r="4"/>\n  <desc>Beschreibung</desc>\n  <rect id="haus" x="1"/>\n  <style>.a { fill: red }</style>`);
    const one = (from: string, to: string): DiffEntry => entries(base, base.replace(from, to))[0]!;
    expect(title(one("Alt", "Neu"))).toBe("Title changed");
    expect(title(one("Beschreibung<", "Mehr<"))).toBe("Description changed");
    expect(title(one("fill: red", "fill: blue"))).toBe("Style changed");
    expect(describeEntry(one("fill: red", "fill: blue"), labelTexts()).jumpId).toBeNull();
    initStrings("de");
    expect([title(one("Alt", "Neu")), title(one("Beschreibung<", "Mehr<")), title(one("fill: red", "fill: blue"))]).toEqual(["Titel geändert", "Beschreibung geändert", "Stil geändert"]);
  });

  it("legt der Diff Titel, Beschreibung und Stil in einen Eintrag, nennt der Titel alle drei (kein verstecktes Bündel)", () => {
    const base = S(`  <title>Alt</title>\n  <desc>Beschreibung</desc>\n  <style>.a { fill: red }</style>\n  <circle id="mond" r="4"/>`);
    const es = entries(base, base.replace("<title>Alt", "<title>Neu").replace("Beschreibung<", "Mehr<").replace("fill: red", "fill: blue"));
    expect(es).toHaveLength(1);
    expect(title(es[0]!)).toBe("Title, Description, Style changed");
    expect(oldNew(es[0]!).neu).toContain("fill: blue");
  });

  it("text, tag, moved-and-text: der Grund steht im Titel", () => {
    const rep = (reason: Extract<DiffEntry, { kind: "replace" }>["reason"]): DiffEntry => ({ kind: "replace", key: "label", tag: "text", reason, changes: [] });
    expect(title(rep("text"))).toBe("Text label: text changed");
    expect(title(rep("tag"))).toBe("Text label: element type changed");
    expect(title(rep("moved-and-text"))).toBe("Text label: moved, text changed");
    initStrings("de");
    expect(title(rep("text"))).toBe("Text label: Text geändert");
    expect(title(rep("moved-and-text"))).toBe("Text label: verschoben, Text geändert");
  });

  it("wrap: „in neue Gruppe g-neu“, unwrap: „Gruppe … aufgelöst“; beide zeigen das Eingefaltete als Redline", () => {
    const base = S(`  <rect id="haus" x="1"/>\n  <rect id="tuer" x="2"/>`);
    const wrapped = S(`  <g id="g-neu">\n    <rect id="haus" x="1"/>\n    <rect id="tuer" x="2"/>\n  </g>`);
    const w = entries(base, wrapped);
    expect(w).toHaveLength(1);
    expect(title(w[0]!)).toBe("Elements: into new group g-neu");
    const wd = oldNew(w[0]!);
    expect(wd.neu).toContain(`<g id="g-neu">`);
    expect(wd.old).not.toContain(`<g id="g-neu">`);
    initStrings("de");
    expect(title(w[0]!)).toBe("Elemente: in neue Gruppe g-neu");
    const u = entries(wrapped, base);
    expect(u).toHaveLength(1);
    expect(title(u[0]!)).toBe("Gruppe g-neu: Gruppe aufgelöst");
    expect(oldNew(u[0]!).old).toContain(`<g id="g-neu">`);
  });

  it("ein Ersatz zeigt die Attributänderung am Nachkommen (Rest B3, Punkt 1), nicht aber Pfaddaten", () => {
    const base = S(`  <text id="label" x="1" fill="red">Alt</text>\n  <g id="form"><path id="weg" d="M0 0 L12345 678"/></g>`);
    const answer = base.replace(`fill="red">Alt`, `fill="blue">Neu`);
    const e = entries(base, answer)[0]!;
    expect(title(e)).toBe("Text label: text changed");
    const d = oldNew(e);
    expect(d.old).toContain(`fill="red"`);
    expect(d.neu).toContain(`fill="blue"`);
    const g = entries(base, base.replace("L12345 678", "L99999 111").replace(`<g id="form">`, `<g id="form">Hallo`))[0]!;
    expect(flat(g)).not.toMatch(/12345|99999/);
  });

  it("zu große Ersatzstücke bleiben unter dem Maß, zeigen aber Gelöschtes und Eingefügtes (gekürzt, mit „…“)", () => {
    const big = "x".repeat(2000);
    const base = S(`  <text id="label">${big}</text>`);
    const e = entries(base, base.replace(big, `${big}y`))[0]!;
    const segs = describeEntry(e, labelTexts()).segments;
    expect(segs.some((x) => x.kind === "del")).toBe(true);
    expect(segs.some((x) => x.kind === "ins")).toBe(true);
    expect(segs.map((x) => x.text).join("").length).toBeLessThan(3000);
  });
});

// Opus-Gesamtreview 2026-11-05, Befund 2: über MAX_DETAIL blieb die Karte ohne Detail; eine nebenbei geänderte Farbe in einer großen Gruppe war unsichtbar (Spec § 3 Punkt 2).
describe("describeEntry: große Ersetzungen zeigen jede Abweichung", () => {
  const rects = (n: number, fill9?: string): string => Array.from({ length: n }, (_, i) => `    <rect id="fenster-${String(i)}" x="${String(i * 10)}" y="5" width="8" height="12" fill="${i === 9 && fill9 !== undefined ? fill9 : "#cccccc"}" stroke="#333333" stroke-width="1"/>`).join("\n");
  const base = S(rects(30));
  const wrapped = S(`  <g id="fenster">\n${rects(30, "#ff0000")}\n  </g>`);

  it("30 Fenster in eine Gruppe, nebenbei fenster-9 rot: die Karte nennt die Änderung", () => {
    const es = entries(base, wrapped);
    expect(es).toHaveLength(1);
    const d = oldNew(es[0]!);
    expect(d.neu).toContain("#ff0000");
    expect(d.old).toContain("#cccccc");
    const text = flat(es[0]!);
    expect(text.length).toBeLessThan(2500);
  });

  it("jede Seite bleibt unter dem Maß, auch wenn alles anders ist", () => {
    const other = S(`  <g id="fenster">\n${rects(30).replace(/#cccccc/g, "#123456").replace(/x="/g, 'x="1')}\n  </g>`);
    const es = entries(base, other);
    const text = flat(es[0]!);
    expect(text.length).toBeLessThan(2500);
    expect(text).toContain("…");
  });
});
