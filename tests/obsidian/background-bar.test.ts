// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import type { BackgroundState } from "../../src/core/background";
import { buildBackgroundBar } from "../../src/obsidian/panel/background-bar";

installObsidianDom();

const texts = { toggle: (on: boolean) => (on ? "Background: on" : "Background: off"), toggleHint: "hint", toneLabel: "tone", light: "Light", dark: "Dark", custom: "Custom", hexLabel: "hex" };
const START: BackgroundState = { on: true, tone: "light", hex: "#ffffff" };

function make(state: BackgroundState = START) {
  const changes: BackgroundState[] = [];
  const root = buildBackgroundBar(document.body.createDiv(), { state, texts, onChange: (s) => changes.push(s) });
  const toggle = root.querySelector<HTMLButtonElement>(".svg-studio-bg-toggle")!;
  const hex = root.querySelector<HTMLInputElement>(".svg-studio-bg-hex")!;
  const seg = (v: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-value="${v}"]`)!;
  return { root, changes, toggle, hex, seg };
}
const type = (el: HTMLInputElement, v: string): void => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
const commit = (el: HTMLInputElement): void => { el.dispatchEvent(new Event("change", { bubbles: true })); };

beforeEach(() => { document.body.replaceChildren(); });

describe("buildBackgroundBar", () => {
  it("zeigt den Ist-Zustand: Schalter beschriftet, gewähltes Segment, Hex-Feld nur bei „eigene“ bedienbar", () => {
    const m = make();
    expect(m.toggle.textContent).toBe("Background: on");
    expect(m.toggle.getAttribute("aria-pressed")).toBe("true");
    expect(m.seg("light").getAttribute("aria-checked")).toBe("true");
    expect(m.hex.disabled).toBe(true);
    const c = make({ on: true, tone: "custom", hex: "#abc" });
    expect(c.hex.disabled).toBe(false);
    expect(c.hex.value).toBe("#abc");
  });

  it("Schalter: meldet den neuen Zustand und sperrt Segment und Hex-Feld bei aus", () => {
    const m = make({ on: true, tone: "custom", hex: "#abc" });
    m.toggle.click();
    expect(m.changes).toEqual([{ on: false, tone: "custom", hex: "#abc" }]);
    expect(m.toggle.textContent).toBe("Background: off");
    expect(m.toggle.getAttribute("aria-pressed")).toBe("false");
    expect(m.hex.disabled).toBe(true);
    expect(m.seg("dark").hasAttribute("disabled")).toBe(true);
    m.toggle.click();
    expect(m.changes.at(-1)).toEqual({ on: true, tone: "custom", hex: "#abc" });
    expect(m.hex.disabled).toBe(false);
  });

  it("Segment: dunkel und eigene melden den Ton; bei eigene wird das Hex-Feld bedienbar", () => {
    const m = make();
    m.seg("dark").click();
    expect(m.changes).toEqual([{ on: true, tone: "dark", hex: "#ffffff" }]);
    expect(m.hex.disabled).toBe(true);
    m.seg("custom").click();
    expect(m.changes.at(-1)).toEqual({ on: true, tone: "custom", hex: "#ffffff" });
    expect(m.hex.disabled).toBe(false);
  });

  it("Hex-Feld: ein gültiger Wert wird gemeldet (mit und ohne #), ein ungültiger wird zurückgesetzt und nie gemeldet", () => {
    const m = make({ on: true, tone: "custom", hex: "#ffffff" });
    type(m.hex, "#12345");
    expect(m.hex.classList.contains("is-invalid")).toBe(true);
    expect(m.hex.getAttribute("aria-invalid")).toBe("true");
    commit(m.hex);
    expect(m.changes).toEqual([]);
    expect(m.hex.value).toBe("#ffffff");
    expect(m.hex.classList.contains("is-invalid")).toBe(false);
    type(m.hex, "f4f0e8");
    expect(m.hex.classList.contains("is-invalid")).toBe(false);
    commit(m.hex);
    expect(m.changes).toEqual([{ on: true, tone: "custom", hex: "#f4f0e8" }]);
    type(m.hex, "#ABC");
    commit(m.hex);
    expect(m.changes.at(-1)!.hex).toBe("#ABC");
    // Text, der CSS einschleusen könnte, ist kein Hex.
    type(m.hex, "red; x:y");
    commit(m.hex);
    expect(m.changes).toHaveLength(2);
  });
});
