// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import type { BackgroundState } from "../../src/core/background";
import { initStrings } from "../../src/i18n/strings";
import { renderPreviewView, type Selection } from "../../src/obsidian/panel/preview-view";

installObsidianDom();
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const SVG = `<svg ${NS} viewBox="0 0 460 425" data-unit="cm"><rect id="wand-nord" x="20" y="20" width="420" height="12"/></svg>`;

function make(text = SVG, bg: BackgroundState = { on: true, tone: "light", hex: "#ffffff" }, selection: Selection = { id: null, text: null }) {
  const host = document.body.createDiv();
  const saved: BackgroundState[] = [];
  const view = renderPreviewView(host, text, { background: { get: () => bg, set: (s) => { bg = s; saved.push(s); } } }, selection);
  const stage = host.querySelector<HTMLElement>(".svg-studio-stage")!;
  return { host, saved, view, stage, selection, measure: () => host.querySelector(".svg-studio-measure")?.textContent ?? "" };
}

beforeEach(() => { document.body.replaceChildren(); initStrings("en"); vi.restoreAllMocks(); });

describe("renderPreviewView", () => {
  it("Reihenfolge: Regler, Bild, Maßzeile; die Maßzeile nennt die Fläche aus dem Text (Browsermaße fehlen hier)", () => {
    const m = make();
    const kids = [...m.host.children].map((c) => c.className.split(" ")[0]);
    expect(kids).toEqual(["svg-studio-preview-head", "svg-studio-stage-wrap", "svg-studio-measure"]);
    expect(m.measure()).toContain("Area 460 × 425 cm");
    expect(m.stage.shadowRoot?.querySelector("svg")).not.toBeNull();
  });

  it("der gespeicherte Hintergrund färbt die Vorschaufläche; ein Regler speichert und färbt neu", () => {
    const m = make(SVG, { on: true, tone: "dark", hex: "#ffffff" });
    expect(m.stage.style.backgroundColor).not.toBe("");
    m.host.querySelector<HTMLButtonElement>(".svg-studio-bg-toggle")!.click();
    expect(m.saved).toEqual([{ on: false, tone: "dark", hex: "#ffffff" }]);
    expect(m.stage.style.backgroundColor).toBe("");
  });

  it("Hintergrund aus: Vorschaufläche ohne eigene Farbe", () => {
    expect(make(SVG, { on: false, tone: "light", hex: "#ffffff" }).stage.style.backgroundColor).toBe("");
  });

  it("ein Klick wählt ein Element und die Maßzeile nennt es; die Auswahl überlebt ein Neuzeichnen mit demselben Text, nicht mit einem anderen", () => {
    const m = make();
    m.stage.shadowRoot!.querySelector("#wand-nord")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(m.selection.id).toBe("wand-nord");
    const again = make(SVG, undefined, m.selection);
    expect(again.selection.id).toBe("wand-nord");
    const attr = /\[(data-m[a-z0-9]+)\]/.exec(again.stage.shadowRoot!.querySelector("style")!.textContent ?? "")![1]!;
    expect(again.stage.shadowRoot!.querySelector(`[${attr}]`)?.id).toBe("wand-nord");
    const other = make(SVG.replace("wand-nord", "x"), undefined, m.selection);
    expect(other.selection.id).toBeNull();
  });

  it("abgelehnter Text: Fehlerblock mit Gründen, kein Bild", () => {
    const m = make(`<svg ${NS}><script>x</script></svg>`);
    expect(m.host.querySelector(".svg-studio-error")).not.toBeNull();
    expect(m.host.querySelector(".svg-studio-stage")).toBeNull();
    expect(m.host.querySelectorAll(".svg-studio-error li").length).toBeGreaterThan(0);
  });

  it("dispose entfernt die Vorschau", () => {
    const m = make();
    m.view.dispose();
    expect(m.stage.isConnected).toBe(false);
  });

  it("S3: die Maßzeile weist bei einer doppelten id darauf hin und misst das geklickte Element", () => {
    const m = make(`<svg ${NS} viewBox="0 0 460 425" data-unit="cm"><rect id="dup" width="20" height="20"/><rect id="dup" width="80" height="80"/></svg>`);
    const rects = m.stage.shadowRoot!.querySelectorAll("rect");
    let p: object | null = Object.getPrototypeOf(rects[0]!);
    while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
    vi.spyOn(p as { getBBox: () => unknown }, "getBBox").mockImplementation(function (this: Element) { return { x: 0, y: 0, width: Number(this.getAttribute("width")), height: Number(this.getAttribute("height")) }; });
    rects[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(m.measure()).toContain("dup: 80 × 80 cm");
    expect(m.measure()).toContain("(ambiguous id)");
  });
});

describe("renderPreviewView: Größenbeobachter (das Panel misst nach, wenn der Kasten sichtbar wird)", () => {
  interface FakeRo { cb: () => void; observed: Element[]; disconnected: number }
  const made: FakeRo[] = [];
  class FakeResizeObserver {
    readonly rec: FakeRo;
    constructor(cb: () => void) { this.rec = { cb, observed: [], disconnected: 0 }; made.push(this.rec); }
    observe(el: Element): void { this.rec.observed.push(el); }
    disconnect(): void { this.rec.disconnected++; }
  }
  const win = (): Record<string, unknown> => document.defaultView as unknown as Record<string, unknown>;
  let saved: unknown;
  beforeEach(() => { made.length = 0; saved = win().ResizeObserver; win().ResizeObserver = FakeResizeObserver; });
  afterEach(() => { win().ResizeObserver = saved; });

  it("beobachtet den Kasten des Aufrufers (host), nur einmal; dispose trennt ihn", () => {
    const m = make();
    expect(made).toHaveLength(1);
    expect(made[0]!.observed).toEqual([m.host]);
    expect(made[0]!.disconnected).toBe(0);
    m.view.dispose();
    expect(made[0]!.disconnected).toBe(1);
  });

  it("der Beobachter kommt aus dem Fenster des Hosts (Popout), nicht aus dem globalen Namensraum", () => {
    const other = document.implementation.createHTMLDocument("popout");
    // Ein Dokument ohne Fenster (defaultView null) hat keinen Beobachter: nichts wird gebaut, nichts wirft.
    expect(other.defaultView).toBeNull();
    const host = other.body.appendChild(other.createElement("div")) as HTMLElement;
    expect(() => renderPreviewView(host, SVG, { background: { get: () => ({ on: true, tone: "light", hex: "#ffffff" }), set: () => {} } }, { id: null, text: null })).not.toThrow();
    expect(made).toHaveLength(0);
  });

  it("ändert sich die Größe, wird neu gemessen", () => {
    const m = make();
    let p: object | null = Object.getPrototypeOf(m.stage.shadowRoot!.querySelector("rect")!);
    while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
    // Erst nichts messbar (verborgen): nur die Fläche steht da.
    expect(m.measure()).toBe("Area 460 × 425 cm");
    vi.spyOn(p as { getBBox: () => unknown }, "getBBox").mockImplementation(() => ({ x: 1, y: 2, width: 30, height: 40 }));
    made[0]!.cb();
    expect(m.measure()).toBe("Area 460 × 425 cm · Drawing 30 × 40 cm");
  });
});
