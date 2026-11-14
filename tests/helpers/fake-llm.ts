// Eine Attrappe der Kit-Verbindung für Panel-Tests: `complete` antwortet nach Skript, die Modellzeile findet ihre Liste.
import { vi } from "vitest";
import type { LlmConnection } from "../../src/vendor/kit-obsidian/llm-connection";

export interface Handlers { onToken?: (t: string) => void; onReasoning?: (t: string) => void; onContentReset?: () => void; signal?: AbortSignal }
export interface Request { messages?: Array<{ role: string; content: string }> }
export type Responder = (h: Handlers, req: Request) => unknown | Promise<unknown>;

const TIMING = { startedAt: 0, endedAt: 0 };
export const SOURCE = { kind: "local" };

/** Ein ok-Ergebnis wie die Verbindung es liefert: Text stückweise über `onToken`, dann das Ergebnis. */
export function answer(content: string, o: { truncated?: boolean; chunk?: number } = {}): Responder {
  return (h) => {
    const n = o.chunk ?? 13;
    for (let i = 0; i < content.length; i += n) h.onToken?.(content.slice(i, i + n));
    return { ok: true, content, reasoning: "", toolCalls: [], truncated: o.truncated === true, streamed: true, timing: TIMING, facts: null, deviations: [], source: SOURCE };
  };
}

export function failure(kind: string, detail: string): Responder {
  return () => ({ ok: false, kind, detail, partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: SOURCE });
}

/** Antwortet der Reihe nach mit den Respondern; die letzte gilt für jede weitere Anfrage. */
export function fakeLlm(responders: Responder[], o: { model?: string; family?: string | null } = {}) {
  const model = o.model ?? "qwen/qwen3.8-27b";
  let n = 0;
  const requests: Request[] = [];
  const complete = vi.fn(async (req: Request, h: Handlers) => {
    requests.push(req);
    const r = responders[Math.min(n++, responders.length - 1)];
    if (r === undefined) throw new Error("kein Responder");
    return r(h, req);
  });
  const llm = {
    complete,
    models: vi.fn(async () => ({ models: [model], reachable: true })),
    invalidate: vi.fn(),
    resolve: vi.fn(),
    setModel: vi.fn(async () => undefined),
    modelInUse: vi.fn(() => model),
    // Seit Kit 0.87.0 Pflicht der Modellzeile: ein Endpunkt ohne Gruppen (leere Liste = keine optgroup), keine gespeicherte Wahl.
    endpoints: vi.fn(() => []),
    activeEndpointId: vi.fn(() => undefined),
    modelsOf: vi.fn(async () => ({ models: [model], reachable: true })),
    choice: vi.fn(() => ({})),
    setChoice: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    source: vi.fn(() => ({ family: o.family ?? null, familySource: "none", backend: "unknown", backendSource: "none", model, sentModel: model })),
  } as unknown as LlmConnection;
  return { llm, complete, requests };
}
