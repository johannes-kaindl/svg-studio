import { describe, expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import SvgStudioPlugin from "../src/main";

describe("Geruest", () => {
  it("laedt die Plugin-Klasse mit onload und onunload", () => {
    const plugin = new SvgStudioPlugin({} as App, {} as PluginManifest);
    expect(() => plugin.onload()).not.toThrow();
    expect(() => plugin.onunload()).not.toThrow();
  });
});
