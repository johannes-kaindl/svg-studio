// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SseTransport } from "../../src/vendor/kit-obsidian/chat-client";

// Fake-Transport statt Netz: die ECHTE Verbindung aus main.ts läuft, nur der HTTP-Weg ist ersetzt.
const sent: Array<{ body: Record<string, unknown> }> = [];
const fakeTransport: SseTransport = {
  postStream: async (_url, body, _headers, onChunk) => {
    sent.push({ body: body as Record<string, unknown> });
    onChunk(`data: ${JSON.stringify({ choices: [{ delta: { content: SVG_OK }, finish_reason: "stop" }] })}\n\n`);
    onChunk("data: [DONE]\n\n");
    return 200;
  },
};
vi.mock("../../src/vendor/kit-obsidian/llm-connection", async (orig) => {
  const m = await orig<typeof import("../../src/vendor/kit-obsidian/llm-connection")>();
  return { ...m, createLlmConnection: (o: object) => m.createLlmConnection({ ...o, probe: async () => true, listModels: async () => ["qwen/qwen3.8-27b"], transports: { http: fakeTransport, fallback: "none" } } as never) };
});

import SvgStudioPlugin from "../../src/main";
import { answer, failure, fakeLlm, type Responder } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import { runSvgPrompt } from "../../src/obsidian/panel/run";
import { buildPanelShell, type PanelDeps, type PanelShell, type RunIo } from "../../src/obsidian/panel/shell";
import { freshSession, svgSlots } from "../../src/obsidian/panel/slots";
import type { SvgSession } from "../../src/core/session";
import type { Target } from "../../src/vendor/kit/panel-session";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

const SVG_OK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="mond" r="4"/></svg>`;
const WITH_COMMENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>/* x */ .a{}</style><circle id="mond" r="4"/></svg>`;
const BASE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="mond" r="40"/>\n  <rect id="haus" x="1"/>\n</svg>\n`;
const BASE_CHANGED = BASE.replace(`r="40"`, `r="60"`);
const FILE: Target = { kind: "file", path: "logo.svg", label: "logo.svg" };

beforeEach(() => { document.body.replaceChildren(); sent.length = 0; initStrings("en"); });

interface Setup { root: HTMLElement; shell: PanelShell<SvgSession>; complete: ReturnType<typeof fakeLlm>["complete"]; requests: ReturnType<typeof fakeLlm>["requests"]; read: ReturnType<typeof vi.fn> }

function setup(responders: Responder[], o: { target?: Target; text?: string | null; model?: string; family?: string | null; thinkingOn?: boolean } = {}): Setup {
  const { llm, complete, requests } = fakeLlm(responders, { model: o.model ?? "qwen/qwen3.8-27b", family: o.family ?? null });
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const read = vi.fn(async () => o.text ?? null);
  const slots = svgSlots({ llm, readTargetText: read, thinkingOn: () => o.thinkingOn === true });
  const deps: PanelDeps<SvgSession> = {
    app: {} as never, llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: read, accept: () => Promise.resolve({ ok: false, message: "x" }), openSettings: () => {},
    confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
  };
  const shell = buildPanelShell(root, deps, slots, freshSession(o.target ?? { kind: "new" }));
  return { root, shell, complete, requests, read };
}

const label = (root: HTMLElement): string => root.querySelector(".svg-studio-status .okit-status-label")?.textContent ?? "";
const tail = (root: HTMLElement): string => root.querySelector(".okit-stream-tail")?.textContent ?? "";
async function send(s: Setup, text: string): Promise<void> {
  const input = s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!;
  input.value = text;
  s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
  await s.shell.settled();
}

describe("Lauf: Erzeugen mit Rückfrage", () => {
  it("ungültig, dann gültig: eine Runde nach zwei Versuchen; der Status nannte Versuch 2 samt Grund, der Antwortbereich war leer", async () => {
    const seen: { start: string; attempt2: string; tail2: string } = { start: "", attempt2: "", tail2: "x" };
    const s = setup([
      (h, r) => { seen.start = label(s.root); return answer(WITH_COMMENT)(h, r); },
      (h, r) => { seen.attempt2 = label(s.root); seen.tail2 = tail(s.root); return answer(SVG_OK)(h, r); },
    ]);
    await send(s, "ein Mond");
    expect(s.complete).toHaveBeenCalledTimes(2);
    expect(s.shell.session().rounds.rounds).toHaveLength(1);
    const round = s.shell.session().rounds.rounds[0]!;
    expect(round.art).toBe("create");
    expect(round.result).toBe(SVG_OK);
    expect(seen.start).toBe("Asking qwen/qwen3.8-27b… This can take minutes with local models.");
    expect(seen.attempt2).toMatch(/^Attempt 2 of 3: answer invalid \(Der Bereiniger lehnt ab/);
    expect(seen.tail2).toBe("");
    expect(tail(s.root)).toBe(SVG_OK);
    expect(label(s.root)).toMatch(/^Done/);
    // Die Rückfrage trägt die schlechte Antwort und die Regeln.
    const second = s.requests[1]!.messages!.map((m) => m.content).join("\n");
    expect(second).toContain(WITH_COMMENT);
    expect(second).toContain("Nicht erlaubt sind Kommentare");
  });

  it("auf Deutsch lautet der Hinweis beim Start 'Das kann bei lokalen Modellen Minuten dauern.'", async () => {
    initStrings("de");
    let start = "";
    const s = setup([(h, r) => { start = label(s.root); return answer(SVG_OK)(h, r); }]);
    await send(s, "x");
    expect(start).toBe("Frage qwen/qwen3.8-27b … Das kann bei lokalen Modellen Minuten dauern.");
  });

  it("abgeschnitten UND ungültig: genau eine Anfrage, 'zu groß … abgeschnitten nach n Zeichen', keine Runde, der Rohtext bleibt (Review-Fokus 1)", async () => {
    const cut = SVG_OK.slice(0, 40);
    const s = setup([answer(cut, { truncated: true }), answer(SVG_OK)]);
    await send(s, "x");
    expect(s.complete).toHaveBeenCalledTimes(1);
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
    expect(label(s.root)).toBe(`Too big for one round with this model (cut off after ${String(cut.length)} characters). Nothing was added.`);
    expect(s.root.querySelector(".svg-studio-status")!.classList.contains("is-error")).toBe(true);
    expect(tail(s.root)).toBe(cut);
  });

  it("abgeschnitten, aber gültig: wird angenommen", async () => {
    const s = setup([answer(SVG_OK, { truncated: true })]);
    await send(s, "x");
    expect(s.complete).toHaveBeenCalledTimes(1);
    expect(s.shell.session().rounds.rounds).toHaveLength(1);
  });

  it("dreimal ungültig: drei Anfragen, Fehler mit Problem und Hinweis, keine Runde, der letzte Rohtext bleibt", async () => {
    const s = setup([answer(WITH_COMMENT), answer(WITH_COMMENT), answer("Tut mir leid.")]);
    await send(s, "x");
    expect(s.complete).toHaveBeenCalledTimes(3);
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
    expect(label(s.root)).toContain("The answer could not be used: Die Antwort enthält kein <svg>");
    expect(label(s.root)).toContain("The answer could not be turned into an SVG.");
    expect(tail(s.root)).toBe("Tut mir leid.");
  });

  it("Abbruch während der Rückfrage: keine Runde, Status 'Stopped.'", async () => {
    const hang: Responder = (h) => new Promise((res) => {
      h.signal?.addEventListener("abort", () => res({ ok: false, kind: "aborted", detail: "aborted", partial: "", reasoning: "", timing: { startedAt: 0, endedAt: 0 }, facts: null, deviations: [], source: { kind: "local" } }));
    });
    const s = setup([answer(WITH_COMMENT), hang]);
    const input = s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!;
    input.value = "x";
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
    await vi.waitFor(() => expect(s.complete).toHaveBeenCalledTimes(2));
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-stop")!.click();
    await s.shell.settled();
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
    expect(label(s.root)).toBe("Stopped.");
    expect(s.complete).toHaveBeenCalledTimes(2);
  });

  it("Fehler des Servers: Status mit der Meldung, keine Runde", async () => {
    const s = setup([failure("http", "HTTP 500: model crashed")]);
    await send(s, "x");
    expect(label(s.root)).toBe("Error: HTTP 500: model crashed");
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
  });

  it("kein Endpunkt: Empty-State mit Grund", async () => {
    const s = setup([() => ({ ok: false, kind: "no-endpoint", detail: "no url", partial: "", reasoning: "", timing: { startedAt: 0, endedAt: 0 }, facts: null, deviations: [], source: { kind: "local" } })]);
    await send(s, "x");
    expect(label(s.root)).toBe("No language model is set up yet.");
    expect(s.root.querySelector(".svg-studio-empty-endpoint")!.classList.contains("is-hidden")).toBe(false);
    expect(s.root.querySelector(".svg-studio-empty-detail")!.textContent).toBe("Reason: no url");
  });
});

describe("Lauf: Verfeinern", () => {
  it("liest den Text JETZT, schickt die gemessene Vorlage und legt eine Runde mit Einträgen an", async () => {
    const s = setup([answer(BASE_CHANGED)], { target: FILE, text: BASE });
    await send(s, "Mond größer");
    expect(s.read).toHaveBeenCalledWith(FILE);
    const user = s.requests[0]!.messages!.at(-1)!.content;
    expect(user).toBe(`Ausgangs-SVG:\n\n${BASE}\n\nAnweisung: Mond größer`);
    const round = s.shell.session().rounds.rounds[0]!;
    expect(round.art).toBe("prompt");
    expect(round.basedOn).toBeNull();
    expect(round.body.form).toBe("list");
    expect(round.result).toBe(BASE_CHANGED);
    expect(s.shell.session().startText).toBe(BASE);
    expect(label(s.root)).toMatch(/^Done/);
  });

  it("Elemente ohne id im Ausgang: keine Anfrage, Hinweis (Review-Fokus 5)", async () => {
    const s = setup([answer(BASE_CHANGED)], { target: FILE, text: BASE.replace(` id="haus"`, "") });
    await send(s, "x");
    expect(s.complete).not.toHaveBeenCalled();
    expect(label(s.root)).toBe("1 element(s) have no name (id). Changing needs a name on every element.");
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
  });

  it("das Ziel ist weg: keine Anfrage", async () => {
    const s = setup([answer(BASE_CHANGED)], { target: FILE, text: null });
    await send(s, "x");
    expect(s.complete).not.toHaveBeenCalled();
    expect(label(s.root)).toMatch(/gone/);
  });

  it("nach der ersten Runde baut Verfeinern auf dem Ergebnis der aktiven auf (ohne das Ziel zu lesen)", async () => {
    const s = setup([answer(SVG_OK), answer(SVG_OK.replace(`r="4"`, `r="5"`))]);
    await send(s, "Mond");
    await send(s, "größer");
    expect(s.complete).toHaveBeenCalledTimes(2);
    expect(s.requests[1]!.messages!.at(-1)!.content).toContain(`Ausgangs-SVG:\n\n${SVG_OK}`);
    const rounds = s.shell.session().rounds;
    expect(rounds.rounds).toHaveLength(2);
    expect(rounds.rounds[1]!.basedOn).toBe(0);
    expect(rounds.active).toBe(1);
  });
});

describe("Messzeile", () => {
  it("gemessenes Modell: Zahlen; mit Denken an der Vorbehalt 'gemessen mit Denken aus'", () => {
    const off = setup([answer(SVG_OK)]);
    expect(off.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).toMatch(/^Measured: 10 of 10 test descriptions/);
    expect(off.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).not.toContain("thinking off");
    const on = setup([answer(SVG_OK)], { thinkingOn: true });
    expect(on.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).toContain("Measured with thinking off; with thinking up to 50 times longer");
  });

  it("deutsch", () => {
    initStrings("de");
    const on = setup([answer(SVG_OK)], { thinkingOn: true });
    expect(on.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).toContain("Gemessen mit Denken aus; mit Denken bis 50-mal länger");
  });

  it("ungemessenes Modell: Hinweis auf nicht gemessen und das kleine Referenzmodell; Cloud-Familie: nur 'nicht gemessen'", () => {
    const other = setup([answer(SVG_OK)], { model: "mistral/xyz" });
    expect(other.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).toMatch(/^Not measured for this model; the small model gemma-4-e4b/);
    expect(other.root.querySelector(".svg-studio-quality")!.classList.contains("is-warning")).toBe(true);
    const cloud = setup([answer(SVG_OK)], { model: "claude-x", family: "claude" });
    expect(cloud.root.querySelector(".svg-studio-quality .okit-status-label")!.textContent).toBe("Not measured for this model.");
  });
});

describe("Anfrage der echten Verbindung (Sampling wie in der Messung)", () => {
  async function plugin(): Promise<SvgStudioPlugin> {
    const app = {
      workspace: { on: () => ({}), getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [], getRightLeaf: () => null },
      metadataCache: { getFirstLinkpathDest: () => null },
    };
    const p = new SvgStudioPlugin(app as never, { id: "svg-studio" } as never);
    p.loadData = vi.fn().mockResolvedValue({ llm: { endpoints: [{ url: "http://127.0.0.1:1234/v1", model: "qwen/qwen3.8-27b" }] } });
    await p.onload();
    return p;
  }
  const io: RunIo = { start() {}, clearAnswer() {}, onToken() {}, onReasoning() {}, onContentReset() {}, setStatus() {} };

  it("Temperatur 0,2, Denken aus, max_tokens 16384 für die qwen-Familie", async () => {
    const p = await plugin();
    const res = await runSvgPrompt({ session: freshSession({ kind: "new" }), instruction: "ein Mond", signal: new AbortController().signal, model: "qwen/qwen3.8-27b", io }, { llm: p.llm, readTargetText: async () => null });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(16384);
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.reasoning_effort).toBe("none"); // Denken aus, wie in der Messung (`effort none`)
    expect(body.stream).not.toBe(false);
  });
});
