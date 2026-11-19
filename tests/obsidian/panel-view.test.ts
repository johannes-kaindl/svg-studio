// @vitest-environment happy-dom
// Die Ansicht (SvgStudioView) auf dem Halter: der Lauf gehört dem Halter und überlebt das Schließen und Wiederöffnen der Ansicht (K9, Welle 36).
import { describe, expect, it, vi } from "vitest";
import type { SvgSession } from "../../src/core/session";
import { getLang, initStrings } from "../../src/i18n/strings";
import { freshSession } from "../../src/obsidian/panel/slots";
import { SvgStudioView, type SvgPanelDeps } from "../../src/obsidian/panel/view";
import { createPromptPanelHost } from "../../src/vendor/kit-obsidian/prompt-panel-host";
import { fakeLlm } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { acceptSetup } from "../helpers/fake-accept";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

function setup() {
  initStrings("en");
  const { llm } = fakeLlm([]);
  let signal: AbortSignal | null = null;
  let starts = 0;
  const host = createPromptPanelHost<SvgSession>({
    plugin: { addStatusBarItem: () => document.createElement("div") } as never,
    name: "SVG Studio",
    open: () => undefined,
    statusBar: () => false,
    lang: getLang(),
    fresh: freshSession,
    // Ein Lauf, der nie endet: so lange offen, bis der Test ihn abbricht.
    run: (call) => { starts++; signal = call.signal; return new Promise(() => undefined); },
    model: () => "qwen/qwen3.8-27b",
  });
  const deps: SvgPanelDeps = {
    app: {} as never,
    host,
    llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    pluginId: "svg-studio",
    accept: acceptSetup({ "n.md": "" }).env,
    readTargetText: () => Promise.resolve(null),
    openSettings: () => undefined,
    thinkingOn: () => false,
    background: { get: () => ({ on: true, tone: "light", hex: "#ffffff" }), set: () => undefined },
    acceptWays: () => [],
  };
  const open = async (): Promise<{ view: SvgStudioView; root: HTMLElement }> => {
    const view = new SvgStudioView({} as never, deps);
    const root = document.body.createDiv();
    (view as unknown as { contentEl: HTMLElement }).contentEl = root;
    await view.onOpen();
    return { view, root };
  };
  return { host, open, signal: () => signal, starts: () => starts };
}

describe("Ansicht und Halter", () => {
  it("der Lauf überlebt das Schließen der Ansicht; die neue Ansicht zeigt den Auftrag und den Abbrechen-Knopf, der Lauf ist derselbe", async () => {
    const s = setup();
    const a = await s.open();
    a.root.querySelector<HTMLTextAreaElement>("textarea.okit-prompt-panel-input")!.value = "ein Mond";
    a.root.querySelector<HTMLButtonElement>("button.okit-prompt-panel-send")!.click();
    await vi.waitFor(() => { expect(s.host.running()).toBe(true); });

    await a.view.onClose();
    expect(s.host.running()).toBe(true);
    expect(s.signal()!.aborted).toBe(false);
    expect(s.host.listeners()).toBe(0);

    const b = await s.open();
    expect(b.root.querySelector<HTMLTextAreaElement>("textarea.okit-prompt-panel-input")!.value).toBe("ein Mond");
    expect(b.root.querySelector("button.okit-prompt-panel-stop")!.classList.contains("is-hidden")).toBe(false);
    expect(s.starts()).toBe(1);
    b.root.querySelector<HTMLButtonElement>("button.okit-prompt-panel-stop")!.click();
    expect(s.signal()!.aborted).toBe(true);
    await b.view.onClose();
    s.host.destroy();
  });

  it("state() zeigt auch bei geschlossener Ansicht die Sitzung des Halters", async () => {
    const s = setup();
    const a = await s.open();
    s.host.offer({ kind: "file", path: "a.svg", label: "a.svg" });
    await a.view.onClose();
    s.host.offer({ kind: "file", path: "b.svg", label: "b.svg" });
    expect(a.view.state().target).toMatchObject({ path: "b.svg" });
    s.host.destroy();
  });
});
