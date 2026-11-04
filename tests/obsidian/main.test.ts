// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import SvgStudioPlugin from "../../src/main";
import { VIEW_TYPE_SVG_STUDIO } from "../../src/obsidian/render-block";
import { MarkdownView, TFile } from "../__mocks__/obsidian";
import { installObsidianDom } from "../helpers/obsidian-dom";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

function app() {
  return {
    workspace: { on: () => ({}), getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [], getRightLeaf: () => null, iterateAllLeaves: () => {} },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
}

describe("SvgStudioPlugin.onload", () => {
  it("registriert Ansicht, Befehle (ohne Plugin-Namen), Codeblock und Einstellungen", async () => {
    const p = new SvgStudioPlugin(app() as never, { id: "svg-studio" } as never) as unknown as SvgStudioPlugin & { views: Record<string, unknown>; commands: Array<{ id: string; name: string }>; postprocessors: Record<string, unknown>; settingTabs: unknown[] };
    await p.onload();
    expect(Object.keys(p.views)).toEqual([VIEW_TYPE_SVG_STUDIO]);
    expect(p.commands.map((c) => c.id).sort()).toEqual(["edit-svg", "new-svg"]);
    expect(p.commands.map((c) => c.name).sort()).toEqual(["Edit SVG", "New SVG"]);
    expect(Object.keys(p.postprocessors)).toEqual(["svg-studio"]);
    expect(p.settingTabs).toHaveLength(1);
  });

  it("registerExtensions wird nie gerufen (Spec § 5.3: Obsidian öffnet .svg selbst)", async () => {
    const p = new SvgStudioPlugin(app() as never, { id: "svg-studio" } as never) as unknown as SvgStudioPlugin & { registerExtensions: (e: string[], v: string) => void };
    let called = 0;
    p.registerExtensions = () => { called++; };
    await p.onload();
    expect(called).toBe(0);
    expect(readFileSync("src/main.ts", "utf8")).not.toContain("registerExtensions");
  });

  // Opus-Gesamtreview 2026-11-05, Befund 5: relative Links einer Einbettung werden gegen die Notiz aufgelöst, die sie enthält, nicht gegen die aktive Datei.
  it("der Einbettungsknopf löst den Link gegen die Notiz auf, deren Ansicht die Einbettung enthält", async () => {
    const asked: string[] = [];
    const view = new (MarkdownView as unknown as new (leaf: unknown) => { file: unknown; containerEl: HTMLElement })({});
    const note = new TFile();
    note.path = "zweiter/notiz.md";
    view.file = note;
    view.containerEl = document.createElement("div");
    const embed = document.createElement("div");
    embed.className = "internal-embed image-embed";
    embed.setAttribute("src", "./logo.svg");
    view.containerEl.appendChild(embed);
    document.body.appendChild(view.containerEl);
    const a = app();
    const active = new TFile();
    active.path = "aktiv/andere.md";
    (a.workspace as Record<string, unknown>).getActiveFile = () => active;
    (a.workspace as Record<string, unknown>).iterateAllLeaves = (cb: (leaf: unknown) => void) => { cb({ view }); };
    const logo = new TFile();
    logo.path = "zweiter/logo.svg";
    (logo as { extension: string }).extension = "svg";
    (a.metadataCache as Record<string, unknown>).getFirstLinkpathDest = (_link: string, from: string) => { asked.push(from); return logo; };
    const p = new SvgStudioPlugin(a as never, { id: "svg-studio" } as never);
    await p.onload();
    await new Promise((r) => setTimeout(r, 0));
    expect(embed.querySelector("[data-svg-studio-button]")).not.toBeNull();
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set(["zweiter/notiz.md"]));
    view.containerEl.remove();
  });

  // Opus-Gesamtreview 2026-11-05, Befund 4: die zuletzt bediente Notiz kann in einem Popout stehen; `rootSplit` sieht sie nicht.
  it("die zuletzt bediente Notiz ist auch eine in einem Popout (active-leaf-change, fensterübergreifend)", async () => {
    const handlers: Record<string, Array<(leaf: unknown) => void>> = {};
    const a = app();
    const popoutView = new (MarkdownView as unknown as new (leaf: unknown) => { file: unknown })({});
    const note = new TFile();
    note.path = "popout.md";
    popoutView.file = note;
    const mainView = new (MarkdownView as unknown as new (leaf: unknown) => { file: unknown })({});
    const mainNote = new TFile();
    mainNote.path = "haupt.md";
    mainView.file = mainNote;
    Object.assign(a.workspace, {
      on: (name: string, cb: (leaf: unknown) => void) => { (handlers[name] ??= []).push(cb); return {}; },
      getMostRecentLeaf: () => ({ view: mainView }),
      rootSplit: {},
      iterateAllLeaves: (cb: (leaf: unknown) => void) => { cb({ view: mainView }); cb({ view: popoutView }); },
    });
    const p = new SvgStudioPlugin(a as never, { id: "svg-studio" } as never) as unknown as { onload(): Promise<void>; lastEditor(): { file: { path: string } } | null };
    await p.onload();
    expect(p.lastEditor()?.file.path).toBe("haupt.md");
    for (const cb of handlers["active-leaf-change"] ?? []) cb({ view: popoutView });
    expect(p.lastEditor()?.file.path).toBe("popout.md");
    // Das Panel selbst (kein MarkdownView) ändert nichts.
    for (const cb of handlers["active-leaf-change"] ?? []) cb({ view: {} });
    expect(p.lastEditor()?.file.path).toBe("popout.md");
    // Ist die Ansicht geschlossen (kein Blatt mehr), gilt wieder das Hauptfenster.
    (a.workspace as Record<string, unknown>).iterateAllLeaves = (cb: (leaf: unknown) => void) => { cb({ view: mainView }); };
    expect(p.lastEditor()?.file.path).toBe("haupt.md");
  });
});
