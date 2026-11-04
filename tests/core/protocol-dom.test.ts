// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askUntilValid } from "../../src/vendor/kit/answer-retry";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import { extractSvg as labExtract } from "../../scripts/lab/analyse";
import { buildCreateMessages, extractSvg, RETRY_INSTRUCTION, validateCreate, type GuardFn } from "../../src/core/protocol";

/** Der Bereiniger als Prüfer des Protokolls (die Obsidian-Schicht baut dieselbe Hülle). */
const guard: GuardFn = (svg) => {
  const r = checkSvg(svg);
  return r.ok ? { ok: true } : { ok: false, problems: r.problems.map((p) => ({ code: p.code, detail: p.detail })) };
};

const VALID = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="c" r="4"/></svg>`;
const WITH_COMMENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>/* x */ .a{}</style><circle id="c" r="4"/></svg>`;

describe("askUntilValid mit validateCreate und dem echten Bereiniger", () => {
  it("erste Antwort mit /* in <style>, zweite gültig: ok nach zwei Anfragen, die Rückfrage trägt Grund und Regeln", async () => {
    const answers = [WITH_COMMENT, VALID];
    const seen: Array<Array<{ role: string; content: string }>> = [];
    let n = 0;
    const r = await askUntilValid(
      (messages) => {
        seen.push(messages.map((m) => ({ ...m })));
        return Promise.resolve({ content: answers[n++] ?? "" });
      },
      (raw) => validateCreate(raw, { guard, prompt: "Ein Kreis" }),
      { messages: buildCreateMessages("Ein Kreis"), instruction: RETRY_INSTRUCTION, maxRetries: 2, stopOnTruncated: true },
    );
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const retry = seen[1].map((m) => m.content).join("\n");
    expect(retry).toContain("Der Bereiniger lehnt ab");
    expect(retry).toContain(RETRY_INSTRUCTION);
  });
});

// Messnote 2026-11-02 und ihre Korrektur vom 2026-11-04: die Gemma-Rohantworten haben die Form „Entwurf im Zaun, `<channel|>`, Antwort“.
// Der Leser der Messung (`kanal: false`) nahm den Entwurf; der Leser des Plugins nimmt die Antwort (und, wo dahinter nichts steht, den Text davor).
// Beide Zahlen stehen hier, damit keine still die andere ersetzt. qwen ist die Kontrolle: es hat keinen Denkkanal und muss gleich bleiben.
describe("Rohantworten → Zahlen (Messnote, Korrektur der Auswertung 2026-11-04)", () => {
  const load = (file: string, kind: "E" | "V"): Array<{ case: string; raw: string }> =>
    readFileSync(join(process.cwd(), "tests", "fixtures", "lab", file), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as { case: string; raw: string })
      .filter((r) => r.case.startsWith(kind));
  const guarded = (svg: string | null): boolean => svg !== null && checkSvg(svg).ok;
  const alt = (rs: Array<{ raw: string }>): number => rs.filter((r) => guarded(labExtract(r.raw, { kanal: false }).value)).length;
  const neu = (rs: Array<{ raw: string }>): number => rs.filter((r) => guarded(labExtract(r.raw).value)).length;
  const protokoll = (rs: Array<{ raw: string }>): number => rs.filter((r) => guarded(extractSvg(r.raw))).length;

  it("qwen (Kontrolle): Erzeugen 10 von 10, Verfeinern 8 von 8, mit jedem Leser", () => {
    const e = load("qwen-qwen3.8-27b-4bit-svg.jsonl", "E");
    const v = load("qwen-qwen3.8-27b-4bit-svg.jsonl", "V");
    expect([alt(e), neu(e), protokoll(e)]).toEqual([10, 10, 10]);
    expect([alt(v), neu(v), protokoll(v)]).toEqual([8, 8, 8]);
  });

  it("gemma Erzeugen: alter Leser 7 von 10 (Messnote), Leser des Plugins 9 von 10; der Laborleser ist der des Plugins", () => {
    const e = load("google-gemma-4-e4b-svg.jsonl", "E");
    expect(e).toHaveLength(10);
    expect(alt(e)).toBe(7);
    expect(neu(e)).toBe(9);
    expect(protokoll(e)).toBe(9);
    expect(e.filter((r) => validateCreate(r.raw, { guard, prompt: "x" }).ok)).toHaveLength(9);
    expect(e.filter((r) => extractSvg(r.raw) !== null)).toHaveLength(10);
  });

  it("gemma Verfeinern (SVG-Form): alter Leser 5 von 8 (Messnote), Leser des Plugins 8 von 8", () => {
    const v = load("google-gemma-4-e4b-svg.jsonl", "V");
    expect(v).toHaveLength(8);
    expect(alt(v)).toBe(5);
    expect(neu(v)).toBe(8);
    expect(protokoll(v)).toBe(8);
  });

  it("steht hinter dem Kanal-Tag nichts (V1 in der SVG-Form), gilt der Text davor", () => {
    const v1 = load("google-gemma-4-e4b-svg.jsonl", "V").find((r) => r.case === "V1")!;
    expect(v1.raw.endsWith("<channel|>")).toBe(true);
    expect(extractSvg(v1.raw)).not.toBeNull();
  });
});
