// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import SvgStudioPlugin from "../../src/main";
import { VIEW_TYPE_SVG_STUDIO } from "../../src/obsidian/render-block";
import { installObsidianDom } from "../helpers/obsidian-dom";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

function app() {
  return {
    workspace: { on: () => ({}), getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [], getRightLeaf: () => null },
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
});
