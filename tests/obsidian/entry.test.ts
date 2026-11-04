import { describe, expect, it } from "vitest";
import { Menu, MarkdownView, Plugin, TFile } from "../__mocks__/obsidian";
import { initStrings } from "../../src/i18n/strings";
import { registerFileMenu, targetFromContext } from "../../src/obsidian/entry";

initStrings("de");

const NOTE = ["# Titel", "", "```svg-studio", '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>', "```", "", "![[logo.svg]] und ![[foto.png]]", "", "```js", "x", "```"].join("\n");

/** Eine App mit einer Notiz im gewünschten Modus und Cursor. */
function appWith(o: { active?: TFile | null; mode?: "source" | "preview"; line?: number; ch?: number; files?: Record<string, TFile> }) {
  const note = new TFile("Notizen/n.md");
  const lines = NOTE.split("\n");
  const view = Object.assign(new MarkdownView(), {
    file: note,
    getMode: () => o.mode ?? "source",
    editor: { getValue: () => NOTE, getCursor: () => ({ line: o.line ?? 0, ch: o.ch ?? 0 }), getLine: (n: number) => lines[n] ?? "" },
  });
  return {
    workspace: { getActiveFile: () => o.active ?? note, getActiveViewOfType: () => view },
    metadataCache: { getFirstLinkpathDest: (link: string) => o.files?.[link] ?? null },
  } as never;
}

describe("targetFromContext", () => {
  it("aktive .svg → Datei", () => {
    const f = new TFile("a/logo.svg");
    expect(targetFromContext(appWith({ active: f }))).toEqual({ kind: "file", path: "a/logo.svg", label: "logo.svg" });
  });

  it("Cursor in einem svg-studio-Block (Quellmodus) → Block mit Zeilen und Rumpf", () => {
    const t = targetFromContext(appWith({ line: 3 }));
    expect(t).toMatchObject({ kind: "block", path: "Notizen/n.md", lineStart: 2, lineEnd: 4 });
    expect(t?.kind === "block" && t.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>');
  });

  it("Cursor in einem Block anderer Sprache → null", () => {
    expect(targetFromContext(appWith({ line: 9 }))).toBeNull();
  });

  it("Cursor auf ![[x.svg]] → Datei", () => {
    const f = new TFile("logo.svg");
    expect(targetFromContext(appWith({ line: 6, ch: 3, files: { "logo.svg": f } }))).toEqual({ kind: "file", path: "logo.svg", label: "logo.svg" });
  });

  it("Cursor auf einer PNG-Einbettung oder neben der Einbettung → null", () => {
    const png = new TFile("foto.png");
    expect(targetFromContext(appWith({ line: 6, ch: 25, files: { "foto.png": png } }))).toBeNull();
    expect(targetFromContext(appWith({ line: 1 }))).toBeNull();
  });

  it("Lesemodus ohne .svg-Datei → null", () => {
    expect(targetFromContext(appWith({ mode: "preview", line: 3 }))).toBeNull();
  });
});

describe("registerFileMenu", () => {
  it("das Kontextmenü einer .svg-Datei enthält 'SVG bearbeiten', das einer .md-Datei nichts", () => {
    const plugin = new Plugin();
    let handler: (menu: Menu, file: TFile) => void = () => {};
    (plugin as { app: unknown }).app = { workspace: { on: (_n: string, cb: typeof handler) => { handler = cb; return {}; } } };
    const edited: string[] = [];
    registerFileMenu(plugin as never, (f) => edited.push(f.path));
    const m = new Menu();
    handler(m, new TFile("a.svg"));
    expect(m.items.map((i) => i.titleText)).toEqual(["SVG bearbeiten"]);
    m.items[0]!.clickHandler?.();
    expect(edited).toEqual(["a.svg"]);
    const m2 = new Menu();
    handler(m2, new TFile("a.md"));
    expect(m2.items).toHaveLength(0);
  });
});
