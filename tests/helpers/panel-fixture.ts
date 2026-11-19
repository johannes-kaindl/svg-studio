// Baut das Panel wie `main.ts`: ein Halter (Kit `createPromptPanelHost`) und darauf der Rahmen (Kit `buildPromptPanel`) mit den SVG-Slots.
// Ersetzt `buildPanelShell` aus der Zeit vor dem Umzug auf den Rahmen (K9, Welle 36): dieselben Tests prüfen jetzt den echten Weg.
import { vi } from "vitest";
import type { SvgSession } from "../../src/core/session";
import { mkFile } from "./fake-accept";
import type { AcceptAs } from "../../src/core/settings";
import { getLang, panelStrings } from "../../src/i18n/strings";
import { runSvgPrompt } from "../../src/obsidian/panel/run";
import { svgAcceptWays } from "../../src/obsidian/accept";
import { freshSession } from "../../src/obsidian/panel/slots";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import type { PanelHost } from "../../src/vendor/kit/panel-host";
import type { Target } from "../../src/vendor/kit/panel-session";
import type { LlmConnection } from "../../src/vendor/kit-obsidian/llm-connection";
import type { AcceptEnv } from "../../src/vendor/kit-obsidian/panel-accept";
import { buildPromptPanel, type PromptPanel, type PromptPanelSlots } from "../../src/vendor/kit-obsidian/prompt-panel";
import { createPromptPanelHost } from "../../src/vendor/kit-obsidian/prompt-panel-host";
import type { SvgRound } from "../../src/core/session";

export interface FixtureDeps {
  llm: LlmConnection;
  readTargetText: (t: Target) => Promise<string | null>;
  /** Der `AcceptEnv` für Übernehmen (aus `acceptSetup`); ohne ihn schreibt der Rahmen gegen eine Attrappe, die alles ablehnt. */
  accept?: Omit<AcceptEnv, "settings" | "choose">;
  confirm?: (message: string, labels: { confirm: string; cancel: string }) => Promise<boolean>;
  model?: () => string;
  /** Der Hauptknopf eines neuen SVG (Einstellung `acceptAs`); Vorgabe `file`. */
  acceptAs?: AcceptAs;
  /** Ist eine Notiz offen (sonst ist „Als Block“ gesperrt)? Vorgabe: ja. */
  hasNote?: () => boolean;
  /** Das Schreiben hängt (der Schreibvorgang kehrt nie zurück); `writes()` zählt, wie oft der Rahmen schreiben wollte. */
  hangWrite?: boolean;
}

export interface PanelFixture {
  host: PanelHost<SvgSession>;
  panel: PromptPanel;
  session(): SvgSession;
  /** Wie früher `shell.setTarget`: ein Angebot an den Halter. */
  setTarget(t: Target): void;
  running(): boolean;
  settled(): Promise<void>;
  requestClose(): Promise<void>;
  refreshAccept(): void;
  /** Wie oft der Rahmen einen Schreibvorgang begonnen hat (nur mit `hangWrite`). */
  writes(): number;
  /** Das hängende Schreiben scheitert jetzt (der Rahmen gibt frei). */
  releaseWrite(): void;
  destroy(): void;
}

const NO_WRITE: Omit<AcceptEnv, "settings" | "choose"> = {
  app: {} as never,
  ports: { editorFor: () => null, vault: { read: () => Promise.reject(new Error("keine Attrappe")), process: () => Promise.reject(new Error("keine Attrappe")) } } as never,
  lastEditor: () => null,
  strings: new Proxy({}, { get: () => () => "x" }) as never,
  readingMode: "append",
};

/** Der Teil von Obsidian, den Übernehmen auf eine bestehende Datei vor dem Schreiben anfasst (Datei finden, Schnappschuss-Ordner): alles da, nichts schlägt fehl; nur das Schreiben hängt. */
const HANG_APP = {
  vault: {
    configDir: ".config-x",
    getAbstractFileByPath: (p: string) => mkFile(p),
    adapter: { exists: () => Promise.resolve(true), mkdir: () => Promise.resolve(), write: () => Promise.resolve(), list: () => Promise.resolve({ files: [], folders: [] }), rmdir: () => Promise.resolve() },
  },
} as never;

export function buildPanelFixture(root: HTMLElement, deps: FixtureDeps, slots: PromptPanelSlots<SvgRound, SvgSession>, initial?: SvgSession): PanelFixture {
  let writes = 0;
  let releaseWrite: () => void = () => undefined;
  const accept = deps.accept ?? (deps.hangWrite === true
    ? { ...NO_WRITE, app: HANG_APP, ports: { editorFor: () => null, vault: { read: (p: string) => deps.readTargetText({ kind: "file", path: p, label: p }).then((t) => t ?? ""), process: () => { writes++; return new Promise<never>((_res, rej) => { releaseWrite = () => { rej(new Error("Schreiben abgebrochen")); }; }); } } } as never }
    : NO_WRITE);
  // Ein Slot ohne eigene Wege bekommt die SVG-Wege (Datei als Hauptknopf, Notiz offen), wie `main.ts` sie verdrahtet.
  const wayed: PromptPanelSlots<SvgRound, SvgSession> = { ...slots, acceptWays: (sess) => { const own = slots.acceptWays(sess); return own.length > 0 ? own : svgAcceptWays(sess, { guard: checkSvg, acceptAs: deps.acceptAs ?? "file", hasNote: deps.hasNote ?? (() => true) }); } };
  const host = createPromptPanelHost<SvgSession>({
    plugin: { addStatusBarItem: () => document.createElement("div") } as never,
    name: "SVG Studio",
    open: () => undefined,
    statusBar: () => false,
    lang: getLang(),
    fresh: freshSession,
    run: (call) => runSvgPrompt(call, { llm: deps.llm, readTargetText: deps.readTargetText }),
    model: deps.model ?? (() => "qwen/qwen3.8-27b"),
  }, initial);
  const panel = buildPromptPanel(root, host, {
    app: (accept as unknown as { app: never }).app,
    lang: getLang(),
    llm: deps.llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: deps.readTargetText,
    openSettings: () => undefined,
    pluginId: "svg-studio",
    accept,
    strings: panelStrings(),
    confirm: deps.confirm ?? vi.fn(() => Promise.resolve(true)),
  }, wayed);
  return {
    host,
    panel,
    session: () => host.session(),
    setTarget: (t) => { host.offer(t); },
    running: () => host.running(),
    settled: () => panel.settled(),
    requestClose: () => panel.requestClose(),
    refreshAccept: () => { panel.refreshAccept(); },
    writes: () => writes,
    releaseWrite: () => { releaseWrite(); },
    destroy: () => { panel.destroy(); host.destroy(); },
  };
}
