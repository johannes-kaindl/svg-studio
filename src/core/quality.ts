// Messzeile (Spec § 7.3, § 10): das Panel sagt nur, was gemessen ist. Pure.
// Die Tabelle gilt für GENAU die gemessenen Prompts (`promptSha` je Zeile = `promptFingerprint` aus `protocol.ts`, ein Test hält beides gleich)
// und für Sampling `transform` (Temperatur 0,2, Denken aus, `max_tokens` 16384). Neue Zeilen kommen nur aus einem Messlauf (`docs/internal/LAB.md`).
// Die Zahlen leitet `quality.test.ts` aus der archivierten Auswertung (`tests/fixtures/lab/auswertung-2026-11-02.json`) ab. Sie sind die der
// Messnote nach der Korrektur der Auswertung vom 2026-11-04 (Leser des Plugins statt des Entwurfs im Denkkanal von Gemma).
// `extra` ist sprachneutral (`plans:2/3` = Grundrisse maßtreu 2 von 3); den Satz baut `qualityTexts()` aus `src/i18n/strings.ts`.
// „Erzeugen“ zählt die vom Bereiniger (`svg-guard`) angenommenen Antworten, „Verfeinern“ die Fälle, in denen die Anweisung erfüllt ist (vollständiges SVG).
import { failureHint, qualityLine, type Measurement, type QualityTexts } from "../vendor/kit/measured-quality";
import { promptFingerprint } from "./protocol";

const QWEN_ALIASES = ["qwen/qwen3.8-27b@4bit"] as const;
const SOURCE = "tests/fixtures/lab/*-svg.jsonl, Auswertung tests/fixtures/lab/auswertung-2026-11-02.json, Messnote 2026-11-02 (Korrektur der Auswertung 2026-11-04)";
const CREATE_SHA = promptFingerprint("create");
const REFINE_SHA = promptFingerprint("refine");

export const MEASUREMENTS: readonly Measurement[] = [
  { model: "qwen/qwen3.8-27b", aliases: QWEN_ALIASES, mode: "transform", task: "create", good: 10, of: 10, extra: "plans:3/3", measuredAt: "2026-11-02", promptSha: CREATE_SHA, source: SOURCE },
  { model: "google/gemma-4-e4b", mode: "transform", task: "create", good: 9, of: 10, extra: "plans:2/3", measuredAt: "2026-11-02", promptSha: CREATE_SHA, source: SOURCE },
  { model: "qwen/qwen3.8-27b", aliases: QWEN_ALIASES, mode: "transform", task: "refine", good: 8, of: 8, measuredAt: "2026-11-02", promptSha: REFINE_SHA, source: SOURCE },
  { model: "google/gemma-4-e4b", mode: "transform", task: "refine", good: 6, of: 8, measuredAt: "2026-11-02", promptSha: REFINE_SHA, source: SOURCE },
];

/** Das eine gemessene kleine Modell: seine Zahl dient als Bezug für ungemessene Modelle (nie als deren eigenes Ergebnis). */
export const SMALL_MODEL = "google/gemma-4-e4b";

/** Familien, über die die Tabelle nichts sagt (Cloud-Modelle). */
const UNMEASURED_FAMILIES = ["claude"] as const;

export function svgQualityLine(model: string, task: "create" | "refine", o: { family: string | null; thinking: boolean; texts: QualityTexts }): { measured: boolean; text: string } {
  // Gemessen wurde mit Denken aus: ist es an, hängt der Kit-Baustein `texts.thinkingNote` an (Plan 2, Entscheidung 3).
  return qualityLine(model, task, MEASUREMENTS, { texts: o.texts, smallModel: SMALL_MODEL, family: o.family, thinking: o.thinking, unmeasuredFamilies: UNMEASURED_FAMILIES });
}

export function svgFailureHint(model: string, task: "create" | "refine", o: { family: string | null; texts: QualityTexts }): string {
  return failureHint(model, task, MEASUREMENTS, { texts: o.texts, smallModel: SMALL_MODEL, family: o.family, unmeasuredFamilies: UNMEASURED_FAMILIES });
}
