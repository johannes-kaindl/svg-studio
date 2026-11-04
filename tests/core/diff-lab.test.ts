import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonDocument } from "../../src/core/canon";
import { applyChanges } from "../../src/core/changes";
import { changesFor, diffSvg } from "../../src/core/diff";
import { extractSvg } from "../../scripts/lab/analyse";

interface Rec { case: string; form: string; model: string; raw: string; input?: string; finish?: string }
const load = (file: string): Rec[] =>
  readFileSync(new URL(`../fixtures/lab/${file}`, import.meta.url), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Rec);

// Aufgezeichnete Antworten der Messung 2026-11-02 (Messnote): Verfeinern in der SVG-Form.
const refine = (file: string): Array<{ name: string; base: string; answer: string }> =>
  load(file)
    .filter((r) => r.case.startsWith("V") && r.input !== undefined)
    .flatMap((r) => {
      const svg = extractSvg(r.raw).value;
      return svg === null ? [] : [{ name: r.case, base: r.input as string, answer: svg }];
    });

describe("diffSvg gegen die aufgezeichneten Verfeinerungen", () => {
  it("qwen: alle 8 zerlegbar, kein move", () => {
    const rs = refine("qwen-qwen3.8-27b-4bit-svg.jsonl");
    expect(rs).toHaveLength(8);
    for (const { name, base, answer } of rs) {
      const d = diffSvg(base, answer);
      expect(d.decomposable, `${name}: ${d.decomposable ? "" : d.why}`).toBe(true);
      if (d.decomposable) {
        expect(d.entries.filter((e) => e.kind === "move").map((e) => e.key), name).toEqual([]);
        const r = applyChanges(base, changesFor(d.entries, new Set(d.entries.keys())));
        expect(r.ok, name).toBe(true);
        if (r.ok) expect(canonDocument(r.text), name).toBe(canonDocument(answer));
      }
    }
  });
  it("gemma: die lesbaren Verfeinerungen sind zerlegbar", () => {
    const rs = refine("google-gemma-4-e4b-svg.jsonl");
    expect(rs.length).toBeGreaterThan(0);
    for (const { name, base, answer } of rs) {
      if (canonDocument(answer) === null || canonDocument(base) === null) continue;
      const d = diffSvg(base, answer);
      expect(d.decomposable, `${name}: ${d.decomposable ? "" : d.why}`).toBe(true);
    }
  });
});
