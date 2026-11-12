// @vitest-environment happy-dom
// Befund 9 des Gesamtreviews: Verfeinern und Reparieren prüfen die Eingabe gegen den Kontext des Modells, bevor etwas hinausgeht.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStrings } from "../../src/i18n/strings";
import { runSvgPrompt, runSvgRepair } from "../../src/obsidian/panel/run";
import type { RunIo } from "../../src/obsidian/panel/shell";
import { freshSession } from "../../src/obsidian/panel/slots";
import { answer, fakeLlm } from "../helpers/fake-llm";

const io: RunIo = { start: () => undefined, clearAnswer: () => undefined, onToken: () => undefined, onReasoning: () => undefined, onContentReset: () => undefined, setStatus: () => undefined };
const FILE = { kind: "file" as const, path: "logo.svg", label: "logo.svg" };
const small = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="mond" r="40"/>\n</svg>\n`;
const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${Array.from({ length: 300 }, (_, i) => `  <circle id="c${i}" cx="${i % 100}.123456" cy="${i % 90}.654321" r="1" fill="#336699" stroke="#112233" stroke-width="0.5"/>`).join("\n")}\n</svg>\n`;
const smallChanged = small.replace(`r="40"`, `r="50"`);
const bigChanged = big.replace(`id="c0" cx="0.123456" cy="0.654321" r="1"`, `id="c0" cx="0.123456" cy="0.654321" r="2"`);
const call = (instruction = "größer") => ({ session: freshSession(FILE), instruction, signal: new AbortController().signal, model: "m", io });

beforeEach(() => { initStrings("en"); });

describe("Eingabe gegen den Kontext des Modells", () => {
  it("Verfeinern: zu groß für den geladenen Kontext → Meldung mit Schätzung und Grenze, es geht nichts hinaus", async () => {
    const { llm, requests } = fakeLlm([answer(bigChanged)]);
    const contextLimit = vi.fn(async () => 2000);
    const res = await runSvgPrompt(call(), { llm, readTargetText: async () => big, contextLimit });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ kind: "error" });
    const message = (res as { message: string }).message;
    expect(message).toContain("2000");
    expect(message).toMatch(/\d{4,}/);
    expect(requests).toHaveLength(0);
  });

  it("Verfeinern: passt es, geht die Anfrage hinaus", async () => {
    const { llm, requests } = fakeLlm([answer(bigChanged)]);
    const res = await runSvgPrompt(call(), { llm, readTargetText: async () => big, contextLimit: async () => 1_000_000 });
    expect(res.ok).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("Verfeinern: nennt der Endpunkt keine Grenze (null) oder wirft die Abfrage, wird trotzdem gefragt", async () => {
    for (const contextLimit of [async () => null, async () => { throw new Error("offline"); }]) {
      const { llm, requests } = fakeLlm([answer(bigChanged)]);
      const res = await runSvgPrompt(call(), { llm, readTargetText: async () => big, contextLimit });
      expect(res.ok).toBe(true);
      expect(requests).toHaveLength(1);
    }
  });

  it("ohne die Abhängigkeit bleibt alles wie vorher", async () => {
    const { llm, requests } = fakeLlm([answer(bigChanged)]);
    const res = await runSvgPrompt(call(), { llm, readTargetText: async () => big });
    expect(res.ok).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("eine kleine Eingabe fragt den Endpunkt gar nicht erst nach dem Kontext", async () => {
    const { llm } = fakeLlm([answer(smallChanged)]);
    const contextLimit = vi.fn(async () => 4);
    const res = await runSvgPrompt(call(), { llm, readTargetText: async () => small, contextLimit });
    expect(res.ok).toBe(true);
    expect(contextLimit).not.toHaveBeenCalled();
  });

  it("Erzeugen schickt nur die Beschreibung: keine Abfrage", async () => {
    const { llm } = fakeLlm([answer(small)]);
    const contextLimit = vi.fn(async () => 4);
    const res = await runSvgPrompt({ ...call("ein Mond"), session: freshSession({ kind: "new" }) }, { llm, readTargetText: async () => null, contextLimit });
    expect(res.ok).toBe(true);
    expect(contextLimit).not.toHaveBeenCalled();
  });

  it("Reparieren: dieselbe Prüfung", async () => {
    const { llm, requests } = fakeLlm([answer(bigChanged)]);
    const res = await runSvgRepair(call(), { llm, readTargetText: async () => big, contextLimit: async () => 2000 }, { text: big, problem: "kaputt", instruction: "reparieren" });
    expect(res.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("Abbruch während der Abfrage: Abbruch, keine Anfrage", async () => {
    const { llm, requests } = fakeLlm([answer(bigChanged)]);
    const ac = new AbortController();
    const res = await runSvgPrompt({ ...call(), signal: ac.signal }, { llm, readTargetText: async () => big, contextLimit: async () => { ac.abort(); return 1_000_000; } });
    expect(res).toMatchObject({ ok: false, kind: "aborted" });
    expect(requests).toHaveLength(0);
  });
});
