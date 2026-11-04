import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findMeasurement, type QualityTexts } from "../../src/vendor/kit/measured-quality";
import { promptFingerprint } from "../../src/core/protocol";
import { MEASUREMENTS, SMALL_MODEL, svgFailureHint, svgQualityLine } from "../../src/core/quality";

interface Aus {
  summary: {
    erzeugen: Array<{ model: string; n: number; guard: number; grundrisseMasstreu: number }>;
    verfeinern: Array<{ model: string; form: string; n: number; erfuellt: number }>;
  };
}
const aus = JSON.parse(readFileSync(new URL("../fixtures/lab/auswertung-2026-11-02.json", import.meta.url), "utf8")) as Aus;

const NOTE = "Gemessen mit Denken aus; mit Denken bis 50-mal länger (n = 1).";
const texts: QualityTexts = {
  thinkingNote: NOTE,
  measured: (m) => `Gemessen: ${m.good} von ${m.of}${m.extra ? `, ${m.extra}` : ""} (${m.model}).`,
  notMeasured: "Für dieses Modell nicht gemessen.",
  smallReference: (ref, short) => `Nicht gemessen; das kleine Modell ${short} schaffte ${ref.good} von ${ref.of}.`,
  failureBase: (t) => `Die Antwort (${t}) war nicht brauchbar.`,
  failureOwn: (m) => `Im Test: ${m.good} von ${m.of}.`,
  failureBest: (m) => `Am besten gemessen: ${m.model}.`,
};
const o = { family: null, thinking: false, texts };

describe("MEASUREMENTS", () => {
  it("vier Zeilen im Modus transform, gemessen am 2026-11-02", () => {
    expect(MEASUREMENTS).toHaveLength(4);
    for (const m of MEASUREMENTS) {
      expect(m.mode).toBe("transform");
      expect(m.measuredAt).toBe("2026-11-02");
      expect(m.source).toContain("Messnote");
    }
  });

  it("Zeilen stimmen mit der archivierten Auswertung", () => {
    const e = (model: string) => aus.summary.erzeugen.find((r) => r.model.startsWith(model))!;
    const v = (model: string) => aus.summary.verfeinern.find((r) => r.model.startsWith(model) && r.form === "svg")!;
    const row = (model: string, task: string) => MEASUREMENTS.find((m) => m.model.startsWith(model) && m.task === task)!;
    for (const model of ["qwen/qwen3.8-27b", "google/gemma-4-e4b"]) {
      expect([row(model, "create").good, row(model, "create").of]).toEqual([e(model).guard, e(model).n]);
      expect(row(model, "create").extra?.split(";")[0]).toBe(`plans:${e(model).grundrisseMasstreu}/3`);
      expect([row(model, "refine").good, row(model, "refine").of]).toEqual([v(model).erfuellt, v(model).n]);
    }
    // Die Zahlen der Messnote nach der Korrektur der Auswertung vom 2026-11-04.
    expect(MEASUREMENTS.map((m) => `${m.model.split("/")[1]}:${m.task}:${m.good}/${m.of}`)).toEqual([
      "qwen3.8-27b:create:10/10", "gemma-4-e4b:create:9/10", "qwen3.8-27b:refine:8/8", "gemma-4-e4b:refine:6/8",
    ]);
  });

  it("promptSha jeder Zeile = promptFingerprint(task)", () => {
    for (const m of MEASUREMENTS) expect(m.promptSha, `${m.model} ${m.task}`).toBe(promptFingerprint(m.task as "create" | "refine"));
  });

  it("qwen wird auch unter @4bit gefunden", () => {
    expect(findMeasurement("qwen/qwen3.8-27b@4bit", "create", MEASUREMENTS)?.good).toBe(10);
    expect(svgQualityLine("qwen/qwen3.8-27b@4bit", "refine", o)).toEqual({ measured: true, text: "Gemessen: 8 von 8, no-top-p (qwen/qwen3.8-27b)." });
  });
});

describe("svgQualityLine", () => {
  it("gemessenes Modell mit Zusatz", () => {
    expect(svgQualityLine("google/gemma-4-e4b", "create", o)).toEqual({ measured: true, text: "Gemessen: 9 von 10, plans:2/3 (google/gemma-4-e4b)." });
  });
  it("ungemessenes Modell bekommt die Bezugszahl von gemma, nur für dieselbe Aufgabe", () => {
    expect(SMALL_MODEL).toBe("google/gemma-4-e4b");
    expect(svgQualityLine("meta/llama-9", "refine", o)).toEqual({ measured: false, text: "Nicht gemessen; das kleine Modell gemma-4-e4b schaffte 6 von 8." });
    expect(svgQualityLine("meta/llama-9", "create", o).text).toContain("9 von 10");
  });
  it("Familie claude → nicht gemessen, auch bei bekanntem Namen", () => {
    expect(svgQualityLine("qwen/qwen3.8-27b", "create", { ...o, family: "claude" })).toEqual({ measured: false, text: "Für dieses Modell nicht gemessen." });
  });
});

describe("svgQualityLine mit Denken", () => {
  it("thinking: true → Zusatz an gemessener und an Bezugszeile, nicht an 'nicht gemessen'", () => {
    const t = { ...o, thinking: true };
    expect(svgQualityLine("qwen/qwen3.8-27b", "create", t).text).toBe(`Gemessen: 10 von 10, plans:3/3;no-top-p (qwen/qwen3.8-27b). ${NOTE}`);
    expect(svgQualityLine("meta/llama-9", "create", t).text).toContain(NOTE);
    expect(svgQualityLine("x", "create", { ...t, family: "claude" }).text).toBe("Für dieses Modell nicht gemessen.");
  });
  it("ohne Denken kein Zusatz", () => {
    expect(svgQualityLine("qwen/qwen3.8-27b", "create", o).text).not.toContain(NOTE);
  });
});

describe("svgFailureHint", () => {
  it("das beste Modell verweist auf seine eigene Zahl, ein anderes auf das beste", () => {
    expect(svgFailureHint("qwen/qwen3.8-27b", "create", o)).toBe("Die Antwort (create) war nicht brauchbar. Im Test: 10 von 10.");
    expect(svgFailureHint("google/gemma-4-e4b", "create", o)).toBe("Die Antwort (create) war nicht brauchbar. Am besten gemessen: qwen/qwen3.8-27b.");
  });
  it("Familie claude → nur der Grundsatz", () => {
    expect(svgFailureHint("x", "refine", { family: "claude", texts })).toBe("Die Antwort (refine) war nicht brauchbar.");
  });
});
