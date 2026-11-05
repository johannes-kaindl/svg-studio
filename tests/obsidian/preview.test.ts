// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { buildPreview, type PreviewHandle } from "../../src/obsidian/panel/preview";
import { checkSvg } from "../../src/vendor/kit/svg-guard";

installObsidianDom();

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const SVG = `<svg ${NS} viewBox="0 0 100 100"><g id="haus"><rect id="wand" x="0" y="0" width="50" height="10"/><circle cx="5" cy="5" r="2"/></g><circle cx="80" cy="80" r="5"/></svg>`;

interface Made { wrap: HTMLElement; host: HTMLElement; handle: PreviewHandle; selected: Array<string | null>; shadow: ShadowRoot; parent: HTMLElement }
function make(doc: Document = document, guard: typeof checkSvg = checkSvg): Made {
  const parent = doc.body.appendChild(doc.createElement("div"));
  const selected: Array<string | null> = [];
  const handle = buildPreview(parent, { guard, onSelect: (id) => selected.push(id) });
  const wrap = parent.firstElementChild as HTMLElement;
  const host = wrap.firstElementChild as HTMLElement;
  return { wrap, host, handle, selected, shadow: host.shadowRoot as ShadowRoot, parent };
}
const svgIn = (m: Made): Element | null => m.shadow.querySelector("svg");
/** Klick auf `el` wie ihn der Browser meldet: das Ereignis entsteht am Knoten im Shadow Root und steigt bis zum Host. */
const click = (el: Element): void => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true })); };
/** Der Name des Marken-Attributs steht im Stil des Shadow Root (er ist zufällig, das SVG kennt ihn nicht). */
const markAttr = (m: Made): string => {
  const css = [...m.shadow.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  const name = /\[(data-m[a-z0-9]+)\]/.exec(css)?.[1];
  expect(name, "Marken-Attribut im Stil").toBeDefined();
  return name!;
};
const markedIds = (m: Made): string[] => [...m.shadow.querySelectorAll(`[${markAttr(m)}]`)].map((e) => e.getAttribute("id") ?? "");

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("buildPreview: Einfügen des geprüften Baums", () => {
  it("der Shadow Root ist offen, die Vorschau zeigt den geprüften Baum", () => {
    const m = make();
    expect(m.shadow).not.toBeNull();
    expect(m.handle.show(SVG)).toEqual({ ok: true });
    expect(svgIn(m)?.querySelectorAll("circle")).toHaveLength(2);
    expect(m.host.querySelector("svg")).toBeNull(); // nichts im Licht-DOM
  });

  it("B1: der Host steht in einem Wrapper im Licht-DOM (Containment), der Wrapper unmittelbar unter dem Elternknoten", () => {
    const m = make();
    expect(m.wrap.className).toBe("svg-studio-stage-wrap");
    expect(m.host.className).toBe("svg-studio-stage");
    expect(m.host.parentElement).toBe(m.wrap);
    expect(m.wrap.parentElement).toBe(m.parent);
    expect(m.wrap.children).toHaveLength(1);
    m.handle.destroy();
    expect(m.wrap.isConnected).toBe(false);
  });

  it("importNode des Host-Dokuments wird gerufen und der geprüfte Baum übergeben; kein innerHTML, outerHTML, insertAdjacentHTML", () => {
    // Spione auf die Setter, wo sie in der Prototypenkette liegen (Shadow Root, Fragment, Element).
    const setterOf = (start: object, name: string): object => {
      let proto: object | null = start;
      while (proto !== null && !Object.getOwnPropertyDescriptor(proto, name)) proto = Object.getPrototypeOf(proto);
      expect(proto, `${name} gefunden`).not.toBeNull();
      return proto!;
    };
    const shadowProbe = document.createElement("div").attachShadow({ mode: "open" });
    const elProbe = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const spies = [
      vi.spyOn(setterOf(Object.getPrototypeOf(shadowProbe), "innerHTML") as { innerHTML: string }, "innerHTML", "set"),
      vi.spyOn(setterOf(Object.getPrototypeOf(elProbe), "innerHTML") as { innerHTML: string }, "innerHTML", "set"),
      vi.spyOn(setterOf(Object.getPrototypeOf(elProbe), "outerHTML") as { outerHTML: string }, "outerHTML", "set"),
      vi.spyOn(setterOf(Object.getPrototypeOf(elProbe), "insertAdjacentHTML") as { insertAdjacentHTML: () => void }, "insertAdjacentHTML"),
    ];
    const imp = vi.spyOn(document, "importNode");
    const checked: Element[] = [];
    const guard: typeof checkSvg = (text) => { const r = checkSvg(text); if (r.ok) checked.push(r.svg); return r; };
    const m = make(document, guard);
    m.handle.show(SVG);
    m.handle.select("wand");
    m.handle.setBackground("#123456");
    m.handle.show(SVG);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(imp.mock.calls.map((c) => c[0])).toEqual(checked); // genau die geprüften Bäume, nichts anderes
    expect(imp.mock.calls.every((c, i) => c[0] === checked[i] && c[1] === true)).toBe(true);
    expect(checked.includes(svgIn(m)!)).toBe(false); // eine tiefe Kopie des geprüften Baums im Shadow Root
    // Im Shadow Root steht GENAU das, was importNode geliefert hat (kein per Text neu erzeugter Baum).
    expect(svgIn(m)).toBe(imp.mock.results.at(-1)!.value);
    expect(m.shadow.querySelectorAll("svg")).toHaveLength(1);
  });

  it("abgelehnter Text: nichts gezeigt, Probleme zurück, ein früheres Bild ist weg", () => {
    const m = make();
    m.handle.show(SVG);
    const r = m.handle.show(`<svg ${NS}><script>alert(1)</script></svg>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
    expect(svgIn(m)).toBeNull();
    expect(m.shadow.querySelector("script")).toBeNull();
  });

  it("kein Text → nichts gezeigt, Probleme zurück", () => {
    const m = make();
    const r = m.handle.show("kein svg");
    expect(r.ok).toBe(false);
    expect(svgIn(m)).toBeNull();
  });

  it("Host in einem zweiten Dokument (Popout): importNode dieses Dokuments, nicht das des Hauptfensters", () => {
    const pop = document.implementation.createHTMLDocument("popout");
    const impMain = vi.spyOn(document, "importNode");
    const impPop = vi.spyOn(pop, "importNode");
    const m = make(pop);
    expect(m.handle.show(SVG)).toEqual({ ok: true });
    expect(impPop).toHaveBeenCalledTimes(1);
    expect(impMain).not.toHaveBeenCalled();
    expect(svgIn(m)?.ownerDocument).toBe(pop);
  });

  it("zeigt ein neuer Text, ersetzt er das alte Bild (kein zweites)", () => {
    const m = make();
    m.handle.show(SVG);
    m.handle.show(SVG.replace("haus", "anders"));
    expect(m.shadow.querySelectorAll("svg")).toHaveLength(1);
  });
});

describe("buildPreview: Isolation", () => {
  it("ein <style> im SVG wirkt nur im Shadow Root, nicht auf Knoten des Dokuments", () => {
    const outside = document.body.appendChild(document.createElement("p"));
    const m = make();
    m.handle.show(`<svg ${NS} viewBox="0 0 10 10"><style>* { color: red }</style><circle id="c" r="2"/></svg>`);
    expect(m.shadow.querySelector("style")).not.toBeNull();
    // Das SVG-<style> liegt im Shadow Root; im Dokument gibt es keins.
    expect(document.querySelectorAll("style")).toHaveLength(0);
    expect(document.head.querySelector("style")).toBeNull();
    expect(getComputedStyle(outside).color).not.toBe("red");
    expect(m.host.querySelector("style")).toBeNull();
  });

  it("S4: der Basis-Stil setzt den Host zurück (all: initial), Obsidians Schrift und Farbe erben nicht ins Bild", () => {
    const m = make();
    const base = [...m.shadow.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(base).toMatch(/:host\s*\{[^}]*all:\s*initial/);
    expect(base).toMatch(/:host\s*\{[^}]*display:\s*block/);
    expect(base).toMatch(/:host\s*\{[^}]*overflow:\s*auto/);
  });
});

describe("buildPreview: Auswahl", () => {
  it("Klick auf ein Kind ohne id wählt den nächsten Vorfahren mit id unter der Wurzel", () => {
    const m = make();
    m.handle.show(SVG);
    click(svgIn(m)!.querySelector("circle")!); // der Kreis in der Gruppe 'haus'
    expect(m.selected).toEqual(["haus"]);
  });

  it("Klick auf ein Element mit eigener id wählt es", () => {
    const m = make();
    m.handle.show(SVG);
    click(svgIn(m)!.querySelector("#wand")!);
    expect(m.selected).toEqual(["wand"]);
  });

  it("Klick auf ein Element ohne id und ohne Vorfahren mit id, auf die Wurzel und neben das Bild → null", () => {
    const m = make();
    m.handle.show(SVG);
    click(svgIn(m)!.querySelector(":scope > circle")!); // der Kreis ganz außen, ohne id
    click(svgIn(m)!);
    click(m.host);
    expect(m.selected).toEqual([null, null, null]);
  });

  it("die Wurzel selbst zählt nicht, auch wenn sie eine id trägt", () => {
    const m = make();
    m.handle.show(`<svg ${NS} id="wurzel" viewBox="0 0 10 10"><circle r="2"/></svg>`);
    click(svgIn(m)!.querySelector("circle")!);
    expect(m.selected).toEqual([null]);
  });

  it("S6b: der Ursprung des Klicks kommt aus composedPath()[0], nicht aus target (am Host ist target der Host selbst)", () => {
    const m = make();
    m.handle.show(SVG);
    const rect = svgIn(m)!.querySelector("#wand")!;
    // Wie im Browser: das Ereignis wird am Host gesehen, `target` ist dort der Host (Retargeting), der Pfad beginnt im Shadow Root.
    // happy-dom retargetiert nicht; so ist der Unterschied sichtbar.
    const ev = new MouseEvent("click", { bubbles: true, composed: true });
    Object.defineProperty(ev, "composedPath", { value: () => [rect, svgIn(m), m.shadow, m.host] });
    m.host.dispatchEvent(ev);
    expect(ev.target).toBe(m.host);
    expect(m.selected.length).toBeGreaterThan(0);
    expect(new Set(m.selected)).toEqual(new Set(["wand"])); // happy-dom ruft den Host-Zuhörer je nach Weg mehrfach; entscheidend ist, dass es nie `null` ist
    expect(markedIds(m)).toEqual(["wand"]);
  });

  it("die Auswahlmarke ist ein Attribut mit zufälligem Namen am Element der Vorschau plus <style> im Shadow Root; der Quelltext bleibt unberührt", () => {
    const m = make();
    m.handle.show(SVG);
    m.handle.select("wand");
    expect(markedIds(m)).toEqual(["wand"]);
    const marker = [...m.shadow.querySelectorAll("style")].find((s) => (s.textContent ?? "").includes(markAttr(m)));
    expect(marker).toBeDefined();
    expect(marker!.parentNode).toBe(m.shadow);
    // Inhalt: der Schein in der Akzentfarbe des Themes, gegen ein `filter: none` im SVG mit !important gesichert.
    expect(marker!.textContent).toMatch(/\[data-m[a-z0-9]+\]\s*\{[^}]*filter:[^}]*drop-shadow\([^)]*var\(--interactive-accent\)[^}]*!important/);
    // Es gibt keine feste Klasse, die das SVG kennen oder fälschen könnte.
    expect(marker!.textContent).not.toContain("svg-studio-selected");
    expect(svgIn(m)!.querySelector(".svg-studio-selected")).toBeNull();
    // Wechsel: die alte Marke fällt weg.
    m.handle.select("haus");
    expect(markedIds(m)).toEqual(["haus"]);
    m.handle.select(null);
    expect(markedIds(m)).toEqual([]);
    // Eine id, die es nicht gibt, markiert nichts.
    m.handle.select("gibt-es-nicht");
    expect(markedIds(m)).toEqual([]);
  });

  it("N4: der Markenname ist je Vorschau verschieden; ein SVG mit der Klasse oder einem geratenen Attribut hat keine Auswahl und löst keine aus", () => {
    const a = make();
    const b = make();
    expect(markAttr(a)).not.toBe(markAttr(b));
    a.handle.show(`<svg ${NS} viewBox="0 0 10 10"><rect id="x" class="svg-studio-selected" data-selected="" data-m12345678="" width="1" height="1"/></svg>`);
    expect(markedIds(a)).toEqual([]);
    expect(a.shadow.querySelector(`[${markAttr(a)}]`)).toBeNull();
    a.handle.select("x");
    expect(markedIds(a)).toEqual(["x"]);
  });

  it("N4: ein Element, das schon den Markennamen trägt, verliert ihn beim Zeigen (vor dem Einfügen entfernt)", () => {
    let name = "";
    const guard: typeof checkSvg = (text) => {
      const r = checkSvg(text);
      if (r.ok && name !== "") r.svg.querySelector("rect")!.setAttribute(name, "");
      return r;
    };
    const m = make(document, guard);
    name = markAttr(m);
    m.handle.show(`<svg ${NS} viewBox="0 0 10 10"><rect id="r" width="1" height="1"/></svg>`);
    expect(svgIn(m)!.querySelector("rect")!.hasAttribute(name)).toBe(false);
    expect(markedIds(m)).toEqual([]);
  });

  it("ein Klick markiert in der Vorschau und meldet die id", () => {
    const m = make();
    m.handle.show(SVG);
    click(svgIn(m)!.querySelector("#wand")!);
    expect(markedIds(m)).toEqual(["wand"]);
    click(m.host);
    expect(markedIds(m)).toEqual([]);
  });

  it("show() setzt die Auswahl zurück", () => {
    const m = make();
    m.handle.show(SVG);
    m.handle.select("wand");
    m.handle.show(SVG);
    expect(markedIds(m)).toEqual([]);
  });

  it("S6e: eine id mit Anführungszeichen, Klammern, Raute und Leerzeichen trifft genau ihr Element", () => {
    const ids = ['a"b', "a]b", "a[b", "a#b", "a b", "a'b", "a\\b", "1x", "a.b"];
    const m = make();
    const body = ids.map((id, i) => `<rect id="${id.replace(/"/g, "&quot;")}" x="${String(i * 10)}" width="5" height="5"/>`).join("");
    expect(m.handle.show(`<svg ${NS} viewBox="0 0 100 10">${body}</svg>`)).toMatchObject({ ok: expect.any(Boolean) });
    // `\` verbietet der Bereiniger in Attributen; was durchkam, wird geprüft, der Rest ist ein Ablehnungsfall.
    const shown = svgIn(m) !== null;
    const ok = shown ? ids : ids.filter((id) => !id.includes("\\"));
    if (!shown) {
      expect(m.handle.show(`<svg ${NS} viewBox="0 0 100 10">${ok.map((id, i) => `<rect id="${id.replace(/"/g, "&quot;")}" x="${String(i * 10)}" width="5" height="5"/>`).join("")}</svg>`)).toEqual({ ok: true });
    }
    for (const id of ok) {
      m.handle.select(id);
      expect(markedIds(m), JSON.stringify(id)).toEqual([id]);
    }
    expect(() => { m.handle.select('a"]x'); }).not.toThrow();
    expect(markedIds(m)).toEqual([]);
  });

  it("S3: doppelte ids: der geklickte Zweite bleibt der gewählte, gemessen wird er, nicht der Erste", () => {
    const stub = (): void => {
      let p: object | null = Object.getPrototypeOf(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
      while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
      vi.spyOn(p as { getBBox: () => unknown }, "getBBox").mockImplementation(function (this: Element) {
        return { x: 0, y: 0, width: Number(this.getAttribute("width") ?? 0), height: Number(this.getAttribute("height") ?? 0) };
      });
    };
    stub();
    const m = make();
    m.handle.show(`<svg ${NS} viewBox="0 0 100 100"><rect id="dup" width="20" height="20"/><rect id="dup" x="30" width="80" height="80"/><rect id="eins" width="5" height="5"/></svg>`);
    expect(m.handle.isAmbiguous("dup")).toBe(true);
    expect(m.handle.isAmbiguous("eins")).toBe(false);
    expect(m.handle.isAmbiguous("gibt-es-nicht")).toBe(false);
    const second = svgIn(m)!.querySelectorAll("rect")[1]!;
    click(second);
    expect(m.selected).toEqual(["dup"]);
    expect([...m.shadow.querySelectorAll(`[${markAttr(m)}]`)]).toEqual([second]);
    expect(m.handle.boxOf("dup")).toMatchObject({ width: 80, height: 80 });
    // Ohne Klick (select per id) gilt das erste Element.
    m.handle.select("dup");
    expect(m.handle.boxOf("dup")).toMatchObject({ width: 20, height: 20 });
    // Ein Klick auf ein anderes Element ändert die Gewählte; boxOf folgt.
    click(svgIn(m)!.querySelectorAll("rect")[2]!);
    expect(m.handle.boxOf("eins")).toMatchObject({ width: 5, height: 5 });
  });
});

describe("buildPreview: Hintergrund und Abbau", () => {
  it("setBackground setzt und löscht die Farbe am Host", () => {
    const m = make();
    m.handle.setBackground("#1e1e1e");
    expect(m.host.style.backgroundColor).not.toBe("");
    m.handle.setBackground(null);
    expect(m.host.style.backgroundColor).toBe("");
  });

  it("S6c: die Farbe geht nur als Wert von background-color ins CSS; fremder Text im Wert erzeugt keine weitere Deklaration", () => {
    const m = make();
    m.handle.setBackground("#abc; position: fixed; inset: 0");
    expect(m.host.getAttribute("style") ?? "").not.toMatch(/position|inset/);
    expect(m.host.style.position).toBe("");
    m.handle.setBackground("#123456");
    expect(m.host.getAttribute("style")).toMatch(/^background-color:\s*[^;]+;?$/);
  });

  it("destroy entfernt den Wrapper samt Host, hängt den Klick ab; Klicks danach melden nichts mehr", () => {
    const m = make();
    m.handle.show(SVG);
    const rect = svgIn(m)!.querySelector("#wand")!;
    const remove = vi.spyOn(m.host, "removeEventListener");
    m.handle.destroy();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
    expect(m.wrap.isConnected).toBe(false);
    expect(m.host.isConnected).toBe(false);
    click(rect);
    expect(m.selected).toEqual([]);
  });
});

describe("buildPreview: Maße", () => {
  // happy-dom liefert ein Null-Maß und die Einheitsmatrix; hier stehen Zahlen wie vom Browser.
  const proto = (): { getBBox: () => unknown; getScreenCTM: () => unknown } => {
    let p: object | null = Object.getPrototypeOf(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
    while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
    return p as { getBBox: () => unknown; getScreenCTM: () => unknown };
  };
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    wand: { x: 1, y: 2, width: 3, height: 4 },
    haus: { x: 0, y: 0, width: 50, height: 10 },
    aussen: { x: 80, y: 70, width: 20, height: 30 },
  };
  function browser(): void {
    const P = proto();
    vi.spyOn(P, "getBBox").mockImplementation(function (this: Element) {
      return boxes[this.getAttribute("id") ?? ""] ?? { x: 0, y: 0, width: 0, height: 0 };
    });
    // Bildschirm-Matrix: die Wurzel skaliert um 2 (viewBox auf Panelbreite); jedes andere Element liegt zusätzlich um (10, 0) verschoben.
    vi.spyOn(P, "getScreenCTM").mockImplementation(function (this: Element) {
      return this.localName === "svg" ? new DOMMatrix([2, 0, 0, 2, 0, 0]) : new DOMMatrix([2, 0, 0, 2, 20, 0]);
    });
  }

  it("boxOf misst im Benutzerraum der Wurzel: getBBox mit der Matrix von Wurzel und Element (getScreenCTM)", () => {
    browser();
    const m = make();
    m.handle.show(SVG);
    expect(m.handle.boxOf("wand")).toEqual({ x: 11, y: 2, width: 3, height: 4 });
  });

  it("boxOf(null) ist die Vereinigung der gezeichneten Kinder der Wurzel, ohne defs und style", () => {
    browser();
    const m = make();
    m.handle.show(`<svg ${NS} viewBox="0 0 100 100"><defs><rect id="wand"/></defs><style>.x{}</style><g id="haus"/><circle id="aussen"/></svg>`);
    // haus: 10..60 x 0..10, aussen: 90..110 x 70..100; wand in defs zählt nicht
    expect(m.handle.boxOf(null)).toEqual({ x: 10, y: 0, width: 100, height: 100 });
  });

  it("B2: Null-Boxen (leere Gruppe, display:none) und Vorlagen (symbol, marker, pattern, Verläufe, clipPath, mask, filter) gehen nicht in die Zeichnung ein", () => {
    browser();
    const m = make();
    m.handle.show(`<svg ${NS} viewBox="0 0 400 400"><symbol id="haus"/><marker id="aussen"/><g id="leer" transform="translate(350,350)"/><g id="haus2"/></svg>`);
    // `haus` und `aussen` tragen Boxen in der Tabelle, sind aber Vorlagen; die leere Gruppe hat eine Null-Box; `haus2` hat keine Tabellenbox (Null) und fällt auch weg.
    expect(m.handle.boxOf(null)).toBeNull();
    for (const tag of ["pattern", "linearGradient", "radialGradient", "clipPath", "mask", "filter", "view"]) {
      const n = make();
      n.handle.show(`<svg ${NS} viewBox="0 0 100 100"><${tag} id="haus"/><circle id="aussen"/></svg>`);
      expect(n.handle.boxOf(null), tag).toEqual({ x: 90, y: 70, width: 20, height: 30 });
    }
  });

  it("B2: das Messen verändert den Baum nicht (kein Messfühler)", () => {
    browser();
    const m = make();
    m.handle.show(SVG);
    const before = svgIn(m)!.outerHTML;
    m.handle.boxOf("wand");
    m.handle.boxOf(null);
    expect(svgIn(m)!.outerHTML).toBe(before);
  });

  it("B2: die Wurzel-Matrix wird je Zeichnung einmal gelesen (linear, nicht quadratisch)", () => {
    browser();
    const m = make();
    m.handle.show(`<svg ${NS} viewBox="0 0 100 100">${'<rect id="haus"/>'.repeat(50)}</svg>`);
    const P = proto();
    const spy = vi.spyOn(P, "getScreenCTM");
    spy.mockClear();
    m.handle.boxOf(null);
    const roots = spy.mock.contexts.filter((c) => (c as Element).localName === "svg");
    expect(roots).toHaveLength(1);
    expect(spy.mock.calls).toHaveLength(51);
  });

  it("localBoxOf: getBBox im EIGENEN Raum des Elements, ohne Matrix von Wurzel und Element (die Drehmitte der Zahlenfelder); null ohne Maß, ohne Layout, bei unbekannter id", () => {
    browser();
    const m = make();
    m.handle.show(SVG);
    expect(m.handle.localBoxOf("wand")).toEqual({ x: 1, y: 2, width: 3, height: 4 }); // boxOf gäbe { x: 11, … }
    expect(m.handle.boxOf("wand")).toEqual({ x: 11, y: 2, width: 3, height: 4 });
    expect(m.handle.localBoxOf("gibtsnicht")).toBeNull();
    expect(m.handle.localBoxOf("haus")).toEqual({ x: 0, y: 0, width: 50, height: 10 });
    vi.spyOn(proto(), "getBBox").mockImplementation(() => ({ x: 0, y: 0, width: 0, height: 0 }));
    expect(m.handle.localBoxOf("wand")).toBeNull();
    vi.spyOn(proto(), "getBBox").mockImplementation(() => { throw new Error("kein Layout"); });
    expect(m.handle.localBoxOf("wand")).toBeNull();
  });

  it("wo der Browser nicht messen kann (Ausnahme, keine Matrix), kommt null und es wird nicht geworfen", () => {
    const m = make();
    m.handle.show(SVG);
    vi.spyOn(proto(), "getBBox").mockImplementation(() => { throw new Error("kein Layout"); });
    expect(m.handle.boxOf("wand")).toBeNull();
    expect(m.handle.boxOf(null)).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(proto(), "getScreenCTM").mockImplementation(() => null);
    expect(m.handle.boxOf("wand")).toBeNull();
    expect(m.handle.boxOf(null)).toBeNull();
  });

  it("N3: das verborgene Panel liefert eine Null-Box: boxOf ergibt null, nie {0,0,0,0}", () => {
    const m = make();
    m.handle.show(SVG);
    expect(m.handle.boxOf("wand")).toBeNull(); // happy-dom: getBBox ist 0×0, Matrix die Einheit
    expect(m.handle.boxOf(null)).toBeNull();
  });

  it("eine unbekannte id oder ein leerer Shadow Root ergibt null", () => {
    const m = make();
    expect(m.handle.boxOf(null)).toBeNull();
    m.handle.show(SVG);
    expect(m.handle.boxOf("gibt-es-nicht")).toBeNull();
  });
});

// Laufzeit-Schutz: die Vorschau setzt die Marke VOR dem Einsetzen des Baums und zeichnet nichts, solange eine Marke steht.
describe("buildPreview: Absturzmarke", () => {
  const fake = (marked: boolean) => {
    const log: string[] = [];
    let isMarked = marked;
    return {
      log,
      guard: {
        isMarked: () => isMarked,
        clear: () => { isMarked = false; log.push("clear"); },
        begin: () => { log.push("begin"); return { settle: () => { log.push("settle"); }, abort: () => { log.push("abort"); } }; },
      },
    };
  };
  const build = (renderGuard: ReturnType<typeof fake>["guard"] | undefined) => {
    const parent = document.body.appendChild(document.createElement("div"));
    const handle = buildPreview(parent, { guard: checkSvg, onSelect: () => undefined, ...(renderGuard === undefined ? {} : { renderGuard }) });
    return { parent, handle, shadow: parent.querySelector<HTMLElement>(".svg-studio-stage")!.shadowRoot! };
  };

  it("ohne Marke: begin vor dem Einsetzen (im Shadow Root steht beim begin noch kein svg), danach settle", () => {
    const f = fake(false);
    const m = build(f.guard);
    let svgAtBegin: boolean | null = null;
    const begin = f.guard.begin;
    f.guard.begin = () => { svgAtBegin = m.shadow.querySelector("svg") !== null; return begin(); };
    expect(m.handle.show(SVG)).toEqual({ ok: true });
    expect(svgAtBegin).toBe(false);
    expect(m.shadow.querySelector("svg")).not.toBeNull();
    expect(f.log).toEqual(["begin", "settle"]);
  });

  it("mit Marke: nichts gezeichnet, kein begin; das Ergebnis meldet blocked", () => {
    const f = fake(true);
    const m = build(f.guard);
    const r = m.handle.show(SVG);
    expect(r).toMatchObject({ ok: false, blocked: true });
    expect(m.shadow.querySelector("svg")).toBeNull();
    expect(f.log).toEqual([]);
  });

  it("ein abgelehntes SVG meldet Probleme (nicht blocked), auch wenn eine Marke steht", () => {
    const m = build(fake(true).guard);
    const r = m.handle.show(`<svg ${NS}><script>x</script></svg>`);
    expect(r).toMatchObject({ ok: false });
    expect("blocked" in r).toBe(false);
  });

  it("ohne Wächter wie bisher", () => {
    expect(build(undefined).handle.show(SVG)).toEqual({ ok: true });
  });
});
