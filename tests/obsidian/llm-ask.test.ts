import { describe, expect, it, vi } from "vitest";
import { askFor, LlmAskError } from "../../src/obsidian/llm-ask";
import type { LlmConnection } from "../../src/vendor/kit-obsidian/llm-connection";

type Handlers = { onToken?: (t: string) => void; onReasoning?: (t: string) => void; onContentReset?: () => void; signal?: AbortSignal };
type Script = (h: Handlers) => unknown | Promise<unknown>;

const TIMING = { startedAt: 0, endedAt: 0 };
const okResult = (content: string, truncated = false) => ({ ok: true, content, reasoning: "", toolCalls: [], truncated, streamed: true, timing: TIMING, facts: null, deviations: [], source: { kind: "local" } });

function fakeLlm(script: Script): { llm: LlmConnection; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async (_req: unknown, h: Handlers) => script(h));
  return { llm: { complete } as unknown as LlmConnection, complete };
}

function hooks(signal = new AbortController().signal) {
  const log = { tokens: [] as string[], reasoning: [] as string[], resets: 0, attempts: [] as number[] };
  return {
    log,
    o: {
      signal,
      onToken: (t: string) => log.tokens.push(t),
      onReasoning: (t: string) => log.reasoning.push(t),
      onContentReset: () => { log.resets++; },
      onAttempt: (n: number) => log.attempts.push(n),
    },
  };
}

const MSG = [{ role: "user" as const, content: "x" }];

describe("askFor", () => {
  it("ok: liefert den Inhalt der Antwort und ihr truncated-Zeichen", async () => {
    const { llm } = fakeLlm(() => okResult("<svg/>", true));
    const { o } = hooks();
    await expect(askFor(llm, o)(MSG)).resolves.toEqual({ content: "<svg/>", truncated: true });
    const { llm: llm2 } = fakeLlm(() => okResult("<svg/>"));
    await expect(askFor(llm2, o)(MSG)).resolves.toEqual({ content: "<svg/>", truncated: false });
  });

  it("ok mit leerem Inhalt: der gestreamte Text gilt", async () => {
    const { llm } = fakeLlm((h) => {
      h.onToken?.("<svg>");
      h.onToken?.("</svg>");
      return okResult("");
    });
    const { o } = hooks();
    await expect(askFor(llm, o)(MSG)).resolves.toEqual({ content: "<svg></svg>", truncated: false });
  });

  it("onContentReset nimmt den bisherigen Text zurück (Gemma schrieb Denken in den Inhalt)", async () => {
    const { llm } = fakeLlm((h) => {
      h.onToken?.("Entwurf …");
      h.onContentReset?.();
      h.onToken?.("<svg/>");
      return okResult("");
    });
    const { o, log } = hooks();
    await expect(askFor(llm, o)(MSG)).resolves.toEqual({ content: "<svg/>", truncated: false });
    expect(log.resets).toBe(1);
  });

  it("reicht Tokens, Denken und Rücknahme durch und schickt Nachrichten und Signal mit", async () => {
    const ctrl = new AbortController();
    const { llm, complete } = fakeLlm((h) => {
      h.onReasoning?.("hm");
      h.onToken?.("a");
      return okResult("a");
    });
    const { o, log } = hooks(ctrl.signal);
    await askFor(llm, o)(MSG);
    expect(log.tokens).toEqual(["a"]);
    expect(log.reasoning).toEqual(["hm"]);
    const [req, h] = complete.mock.calls[0] as [{ messages: unknown }, Handlers];
    expect(req.messages).toEqual(MSG);
    expect(h.signal).toBe(ctrl.signal);
  });

  it("zählt die Versuche: onAttempt(1), onAttempt(2) — vor der Anfrage", async () => {
    const order: string[] = [];
    const { llm } = fakeLlm(() => { order.push("complete"); return okResult("x"); });
    const { o, log } = hooks();
    const ask = askFor(llm, { ...o, onAttempt: (n) => { order.push(`attempt ${String(n)}`); log.attempts.push(n); } });
    await ask(MSG);
    await ask(MSG);
    expect(log.attempts).toEqual([1, 2]);
    expect(order).toEqual(["attempt 1", "complete", "attempt 2", "complete"]);
  });

  it("kein Endpunkt → LlmAskError(no-endpoint) mit Grund und Art der Quelle", async () => {
    const { llm } = fakeLlm(() => ({ ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "manager" } }));
    const { o } = hooks();
    const err = await askFor(llm, o)(MSG).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(LlmAskError);
    expect(err).toMatchObject({ kind: "no-endpoint", detail: "disabled", sourceKind: "manager" });
  });

  it("Abbruch → LlmAskError(aborted); auch ein ok-Ergebnis nach dem Abbruch zählt als abgebrochen", async () => {
    const { llm } = fakeLlm(() => ({ ok: false, kind: "aborted", detail: "aborted", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "local" } }));
    const { o } = hooks();
    await expect(askFor(llm, o)(MSG)).rejects.toMatchObject({ name: "LlmAskError", kind: "aborted" });
    const ctrl = new AbortController();
    const { llm: llm2 } = fakeLlm(() => { ctrl.abort(); return okResult("<svg/>"); });
    await expect(askFor(llm2, hooks(ctrl.signal).o)(MSG)).rejects.toMatchObject({ kind: "aborted" });
  });

  it("sonstiger Fehler → LlmAskError(error) mit der Meldung des Servers", async () => {
    const { llm } = fakeLlm(() => ({ ok: false, kind: "http", detail: "HTTP 500: model crashed", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "local" } }));
    const { o } = hooks();
    const err = await askFor(llm, o)(MSG).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(LlmAskError);
    expect(err).toMatchObject({ kind: "error", detail: "HTTP 500: model crashed", message: "HTTP 500: model crashed" });
  });
});
