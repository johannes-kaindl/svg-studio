// @vitest-environment happy-dom
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { installEmbedButtons } from "../../src/obsidian/embed-button";
import { Plugin, TFile } from "../__mocks__/obsidian";

installObsidianDom();
// Obsidian stellt `activeDocument` als Global bereit.
(globalThis as { activeDocument?: Document }).activeDocument = document;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function embed(doc: Document, src: string): HTMLElement {
  const el = doc.createElement("div");
  el.className = "internal-embed image-embed";
  el.setAttribute("src", src);
  return el;
}

function setup() {
  const plugin = new Plugin() as Plugin & { cleanups: Array<() => void>; unload(): void };
  const handlers: Record<string, Array<(win: unknown, window: { document: Document }) => void>> = {};
  (plugin as { app: unknown }).app = {
    workspace: { on: (name: string, cb: (win: unknown, window: { document: Document }) => void) => { (handlers[name] ??= []).push(cb); return { name }; } },
  };
  const edits: string[] = [];
  installEmbedButtons(plugin as never, {
    resolve: (el) => {
      const src = el.getAttribute("src") ?? "";
      if (!src.toLowerCase().endsWith(".svg")) return null;
      const f = new TFile();
      f.path = src;
      return f;
    },
    onEdit: (f) => edits.push(f.path),
    label: "Edit in SVG Studio",
  });
  return { plugin, handlers, edits };
}

describe("installEmbedButtons", () => {
  it("eine hinzugefügte .svg-Einbettung bekommt genau einen Knopf; eine erneute Mutation hängt keinen zweiten an", async () => {
    const { plugin } = setup();
    const e = embed(document, "logo.svg");
    document.body.appendChild(e);
    await flush();
    expect(e.querySelectorAll("[data-svg-studio-button]")).toHaveLength(1);
    e.setAttribute("src", "logo.svg");
    e.appendChild(document.createElement("span"));
    await flush();
    expect(e.querySelectorAll("[data-svg-studio-button]")).toHaveLength(1);
    plugin.unload();
    e.remove();
  });

  it("der Knopf hat den zugänglichen Namen und ruft onEdit mit der Datei", async () => {
    const { plugin, edits } = setup();
    const e = embed(document, "a/logo.svg");
    document.body.appendChild(e);
    await flush();
    const b = e.querySelector("[data-svg-studio-button]") as HTMLElement;
    expect(b.getAttribute("aria-label")).toBe("Edit in SVG Studio");
    b.click();
    expect(edits).toEqual(["a/logo.svg"]);
    plugin.unload();
    e.remove();
  });

  it("eine .png-Einbettung bekommt keinen Knopf", async () => {
    const { plugin } = setup();
    const e = embed(document, "bild.png");
    document.body.appendChild(e);
    await flush();
    expect(e.querySelector("[data-svg-studio-button]")).toBeNull();
    plugin.unload();
    e.remove();
  });

  it("eine Einbettung, deren src erst nach dem Einfügen gesetzt wird, bekommt den Knopf", async () => {
    const { plugin } = setup();
    const e = document.createElement("div");
    e.className = "internal-embed image-embed";
    document.body.appendChild(e);
    await flush();
    expect(e.querySelector("[data-svg-studio-button]")).toBeNull();
    e.setAttribute("src", "spaet.svg");
    await flush();
    expect(e.querySelectorAll("[data-svg-studio-button]")).toHaveLength(1);
    plugin.unload();
    e.remove();
  });

  it("Ereignis window-open: der Beobachter hängt auch am neuen Fenster (Review-Fokus 3)", async () => {
    const { plugin, handlers } = setup();
    const win = new Window();
    installObsidianDom(win);
    handlers["window-open"]![0]!(null, { document: win.document as unknown as Document });
    const e = embed(win.document as unknown as Document, "pop.svg");
    win.document.body.appendChild(e as never);
    await flush();
    expect(e.querySelectorAll("[data-svg-studio-button]")).toHaveLength(1);
    plugin.unload();
  });

  it("window-open und window-close werden über registerEvent angemeldet (Obsidian löst sie beim Entladen)", () => {
    const { plugin } = setup();
    expect((plugin as unknown as { registeredEvents: unknown[] }).registeredEvents).toHaveLength(2);
    plugin.unload();
  });

  it("onunload trennt alle Beobachter", async () => {
    const { plugin } = setup();
    plugin.unload();
    const e = embed(document, "nach.svg");
    document.body.appendChild(e);
    await flush();
    expect(e.querySelector("[data-svg-studio-button]")).toBeNull();
    e.remove();
  });

  it("window-close trennt den Beobachter dieses Fensters", async () => {
    const { plugin, handlers } = setup();
    const win = new Window();
    installObsidianDom(win);
    const doc = win.document as unknown as Document;
    handlers["window-open"]![0]!(null, { document: doc });
    handlers["window-close"]![0]!(null, { document: doc });
    const e = embed(doc, "zu.svg");
    win.document.body.appendChild(e as never);
    await flush();
    expect(e.querySelector("[data-svg-studio-button]")).toBeNull();
    plugin.unload();
  });
});
