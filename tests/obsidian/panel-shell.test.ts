// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLlm } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import { buildPanelShell, type PanelDeps, type PanelSlots, type RunCall, type RunResult } from "../../src/obsidian/panel/shell";
import { EMPTY_ROUNDS, pushRound } from "../../src/vendor/kit/rounds";
import type { PanelSession, Target } from "../../src/vendor/kit/panel-session";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

// Eine Runde ohne Format: der Kern darf nichts über sie wissen.
interface Round { label: string; text: string }
type Session = PanelSession<Round>;

const fresh = (target: Target): Session => ({ target, rounds: EMPTY_ROUNDS });
const withRound = (s: Session, n = s.rounds.rounds.length + 1): Session => ({ ...s, rounds: pushRound(s.rounds, { label: `r${String(n)}`, text: n === 1 ? "T" : `T${String(n)}` }) });

interface Harness { root: HTMLElement; deps: PanelDeps<Session>; slots: PanelSlots<Round, Session>; calls: RunCall<Session>[]; release(r?: RunResult<Session>): void; confirm: ReturnType<typeof vi.fn>; shell: ReturnType<typeof buildPanelShell<Round, Session>> }

function harness(o: { rounds?: boolean | number; immediate?: boolean; confirmAnswer?: boolean } = {}): Harness {
  initStrings("en");
  const host = document.body.createDiv({ cls: "view-content" });
  const root = host.createDiv();
  const calls: RunCall<Session>[] = [];
  let release: (r: RunResult<Session>) => void = () => {};
  const confirm = vi.fn(async () => o.confirmAnswer ?? true);
  const slots: PanelSlots<Round, Session> = {
    fresh,
    renderPreview: (h, _r, text) => { if (text !== null) h.createDiv({ cls: "fake-preview", text }); },
    renderChanges: () => {},
    roundLabel: (r) => r.label,
    roundMeta: () => "meta",
    roundText: (r) => r.text,
    quality: () => ({ measured: true, text: "q" }),
    run: (call) => {
      calls.push(call);
      if (o.immediate === true) return Promise.resolve({ ok: true, session: withRound(call.session), message: "done" });
      return new Promise((res) => { release = res; });
    },
  };
  const deps: PanelDeps<Session> = {
    app: {} as never,
    llm: fakeLlm([]).llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: () => Promise.resolve(null),
    accept: () => Promise.resolve({ ok: false, message: "x" }),
    openSettings: () => {},
    confirm,
    managerPresent: () => false,
    strings: panelStrings(),
  };
  let initial: Session | undefined;
  for (let i = 0; i < (o.rounds === true ? 1 : (o.rounds === false ? 0 : (o.rounds ?? 0))); i++) initial = withRound(initial ?? fresh({ kind: "new" }));
  const shell = buildPanelShell(root, deps, slots, initial);
  return { root, deps, slots, calls, release: (r) => release(r ?? { ok: true, session: withRound(fresh({ kind: "new" })), message: "done" }), confirm, shell };
}

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (el === null) throw new Error(`kein Element ${sel}`);
  return el;
};
const type = (root: HTMLElement, text: string): HTMLTextAreaElement => {
  const input = q<HTMLTextAreaElement>(root, "textarea.svg-studio-input");
  input.value = text;
  return input;
};
const key = (el: HTMLElement, init: KeyboardEventInit): void => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); };
const hidden = (el: HTMLElement): boolean => el.classList.contains("is-hidden");

beforeEach(() => { document.body.replaceChildren(); });

describe("Panel-Kern: Senden", () => {
  it("Cmd+Enter und Strg+Enter senden, Enter allein nicht, ein leerer Prompt auch nicht", () => {
    const h = harness();
    const input = type(h.root, "ein Mond");
    key(input, { key: "Enter" });
    expect(h.calls).toHaveLength(0);
    key(input, { key: "Enter", metaKey: true });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.instruction).toBe("ein Mond");
    const h2 = harness();
    key(type(h2.root, "x"), { key: "Enter", ctrlKey: true });
    expect(h2.calls).toHaveLength(1);
    const h3 = harness();
    key(type(h3.root, "   "), { key: "Enter", metaKey: true });
    expect(h3.calls).toHaveLength(0);
  });

  it("während eines Laufs ist Senden gesperrt: genau ein Lauf (Review-Fokus 4)", () => {
    const h = harness();
    const input = type(h.root, "ein Mond");
    key(input, { key: "Enter", metaKey: true });
    key(input, { key: "Enter", metaKey: true });
    q<HTMLButtonElement>(h.root, "button.svg-studio-send").click();
    expect(h.calls).toHaveLength(1);
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-send").disabled).toBe(true);
  });

  it("der Knopf zeigt Erzeugen ohne und Ändern mit Runden", () => {
    expect(q(harness().root, "button.svg-studio-send").textContent).toBe("Create");
    expect(q(harness({ rounds: true }).root, "button.svg-studio-send").textContent).toBe("Change");
  });
});

describe("Panel-Kern: Abbruch", () => {
  it("Abbrechen ist nur während des Laufs sichtbar; es bricht das Signal ab, meldet es und gibt Senden frei", async () => {
    const h = harness();
    const stop = q<HTMLButtonElement>(h.root, "button.svg-studio-stop");
    expect(hidden(stop)).toBe(true);
    key(type(h.root, "x"), { key: "Enter", metaKey: true });
    expect(hidden(stop)).toBe(false);
    expect(stop.textContent).toBe("Stop");
    stop.click();
    expect(h.calls[0]!.signal.aborted).toBe(true);
    expect(q(h.root, ".svg-studio-status .okit-status-label").textContent).toBe("Stopped.");
    expect(hidden(stop)).toBe(true);
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-send").disabled).toBe(false);
    // Ein spätes Ergebnis des abgebrochenen Laufs ändert nichts mehr.
    h.release({ ok: true, session: withRound(fresh({ kind: "new" })), message: "zu spät" });
    await h.shell.settled();
    expect(h.shell.session().rounds.rounds).toHaveLength(0);
    expect(q(h.root, ".svg-studio-status .okit-status-label").textContent).toBe("Stopped.");
  });

  it("der Lauf meldet Erfolg: die Sitzung wird übernommen, Status und Runden zeigen es", async () => {
    const h = harness();
    key(type(h.root, "x"), { key: "Enter", metaKey: true });
    h.release();
    await h.shell.settled();
    expect(h.shell.session().rounds.rounds).toHaveLength(1);
    expect(q(h.root, ".svg-studio-status .okit-status-label").textContent).toBe("done");
    expect(hidden(q(h.root, "button.svg-studio-stop"))).toBe(true);
    expect(h.root.querySelector(".fake-preview")?.textContent).toBe("T");
  });

  it("ein Fehler des Laufs wird Status, kein Hängen", async () => {
    const h = harness();
    key(type(h.root, "x"), { key: "Enter", metaKey: true });
    h.release({ ok: false, kind: "error", message: "kaputt" });
    await h.shell.settled();
    expect(q(h.root, ".svg-studio-status").classList.contains("is-error")).toBe(true);
    expect(q(h.root, ".svg-studio-status .okit-status-label").textContent).toBe("kaputt");
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-send").disabled).toBe(false);
  });

  it("kein Endpunkt: der Empty-State mit dem Weg zu den Einstellungen erscheint, Senden bleibt möglich", async () => {
    const h = harness();
    const open = vi.fn();
    h.deps.openSettings = open;
    expect(hidden(q(h.root, ".svg-studio-empty-endpoint"))).toBe(true);
    key(type(h.root, "x"), { key: "Enter", metaKey: true });
    h.release({ ok: false, kind: "no-endpoint", detail: "Grund: weg" });
    await h.shell.settled();
    expect(hidden(q(h.root, ".svg-studio-empty-endpoint"))).toBe(false);
    expect(q(h.root, ".svg-studio-empty-detail").textContent).toBe("Grund: weg");
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-send").disabled).toBe(false);
  });
});

describe("Panel-Kern: Schließen und Verwerfen", () => {
  it("Schließen mit offener Runde fragt per Bestätigung; ohne Runde nicht", async () => {
    const h = harness({ rounds: true, confirmAnswer: false });
    await expect(h.shell.requestClose()).resolves.toBe(false);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0]![0]).toContain("1 unapplied round(s)");
    const h2 = harness({ rounds: true, confirmAnswer: true });
    await expect(h2.shell.requestClose()).resolves.toBe(true);
    const h3 = harness();
    await expect(h3.shell.requestClose()).resolves.toBe(true);
    expect(h3.confirm).not.toHaveBeenCalled();
  });

  it("Schließen bricht einen laufenden Lauf ab", async () => {
    const h = harness();
    key(type(h.root, "x"), { key: "Enter", metaKey: true });
    await h.shell.requestClose();
    expect(h.calls[0]!.signal.aborted).toBe(true);
  });

  it("Verwerfen fragt, leert die Runden und gilt dann das angebotene Ziel", async () => {
    const h = harness({ rounds: true });
    const file: Target = { kind: "file", path: "a.svg", label: "a.svg" };
    h.shell.setTarget(file);
    expect(h.shell.session().target).toEqual({ kind: "new" });
    expect(q(h.root, ".svg-studio-target").textContent).toBe("Target kept: New SVG — discard to switch");
    q<HTMLButtonElement>(h.root, "button.svg-studio-discard").click();
    await vi.waitFor(() => expect(h.shell.session().rounds.rounds).toHaveLength(0));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.shell.session().target).toEqual(file);
    expect(q(h.root, ".svg-studio-target").textContent).toBe("Edit: a.svg");
  });

  it("Verwerfen und Übernehmen sind ohne Runde gesperrt", () => {
    const h = harness();
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-discard").disabled).toBe(true);
    expect(q<HTMLButtonElement>(h.root, "button.svg-studio-accept").disabled).toBe(true);
    const h2 = harness({ rounds: true });
    expect(q<HTMLButtonElement>(h2.root, "button.svg-studio-accept").disabled).toBe(false);
  });

  it("Übernehmen läuft nur einmal, auch bei Doppelklick", async () => {
    const h = harness({ rounds: true });
    let finish: (v: { ok: false; message: string }) => void = () => {};
    const accept = vi.fn(() => new Promise<{ ok: false; message: string }>((res) => { finish = res; }));
    h.deps.accept = accept;
    const btn = q<HTMLButtonElement>(h.root, "button.svg-studio-accept");
    btn.click();
    // Auch ein Ereignis, das den gesperrten Knopf umgeht (zweiter Klick in derselben Zeitscheibe), schreibt nicht doppelt.
    expect(btn.disabled).toBe(true);
    btn.disabled = false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(accept).toHaveBeenCalledTimes(1);
    finish({ ok: false, message: "nicht geschrieben" });
    await h.shell.settled();
    expect(q(h.root, ".svg-studio-status .okit-status-label").textContent).toBe("nicht geschrieben");
    expect(btn.disabled).toBe(false);
  });
});

describe("Panel-Kern: Aufbau", () => {
  it("markChatHost setzt den view-content beim Öffnen und nimmt ihn beim Schließen zurück", () => {
    const h = harness();
    const host = h.root.closest(".view-content")!;
    expect(host.classList.contains("okit-chat-host")).toBe(true);
    h.shell.destroy();
    expect(host.classList.contains("okit-chat-host")).toBe(false);
    expect(h.root.querySelector(".svg-studio-shell")).toBeNull();
  });

  it("Kopf: Zielzeile, Neu, Modellzeile (Kit), Messzeile; Fuß: Übernehmen, Verwerfen", () => {
    const h = harness();
    expect(q(h.root, ".svg-studio-target").textContent).toBe("New SVG");
    expect(q(h.root, "button.svg-studio-new").textContent).toBe("New");
    expect(h.root.querySelector(".okit-model-bar")).not.toBeNull();
    expect(h.root.querySelector(".okit-model-bar-select")).not.toBeNull();
    expect(q(h.root, ".svg-studio-quality .okit-status-label").textContent).toBe("q");
    expect(q(h.root, "button.svg-studio-accept").textContent).toBe("Apply");
    expect(q(h.root, "button.svg-studio-discard").textContent).toBe("Discard");
  });

  it("noch nichts erzeugt: zwei Beispiel-Prompts füllen das Feld; mit einer Runde verschwinden sie", () => {
    const h = harness();
    const empty = q(h.root, ".svg-studio-empty");
    expect(hidden(empty)).toBe(false);
    const ex = [...h.root.querySelectorAll<HTMLButtonElement>("button.svg-studio-example")];
    expect(ex).toHaveLength(2);
    ex[1]!.click();
    expect(q<HTMLTextAreaElement>(h.root, "textarea.svg-studio-input").value).toContain("4.2 × 3.6 m");
    expect(hidden(q(harness({ rounds: true }).root, ".svg-studio-empty"))).toBe(true);
  });

  it("die Versionsliste zeigt die Runden mit Beschriftung und wählt die angeklickte; die Vorschau folgt", () => {
    const h = harness({ rounds: 2 });
    const rows = [...h.root.querySelectorAll<HTMLButtonElement>(".okit-vlist-row")];
    expect(rows.map((r) => r.querySelector(".okit-vlist-label")?.textContent)).toEqual(["r1", "r2"]);
    expect(h.shell.session().rounds.active).toBe(1);
    expect(h.root.querySelector(".fake-preview")?.textContent).toBe("T2");
    rows[0]!.click();
    expect(h.shell.session().rounds.active).toBe(0);
    expect(h.root.querySelector(".fake-preview")?.textContent).toBe("T");
    expect(h.root.querySelector(".svg-studio-preview-caption")?.textContent).toBe("Preview of round 1");
  });

  it("der Kern ist formatneutral: kein Import aus core/ und keine Kenntnis von SVG-Typen", () => {
    const src = readFileSync("src/obsidian/panel/shell.ts", "utf8");
    const imports = src.split("\n").filter((l) => l.startsWith("import"));
    expect(imports.some((l) => /\/core\//.test(l))).toBe(false);
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Svg|svg-guard|diffSvg|protocol/);
  });
});
