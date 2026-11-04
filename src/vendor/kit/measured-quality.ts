// vendored from code-kit@0.55.0, src/ts/pure/measured-quality.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `3d-codeblocks/src/core/shapes/quality.ts` (`findMeasurement`, `qualityLine`, `failureHint`, `smallReference`, `best`;
// the table `MEASUREMENTS` and the English sentences stay with the carrier), 2026-10; widened for svg-studio's table (model aliases, an extra
// field, any task and mode string).

import { sha256HexUtf8 } from "./sha256";

/** What this module says (nothing but the ranking and the lookup): the panel tells the user what was measured and does not guess. The table is
 *  the caller's; a row belongs to a model, a task (any string: "create", "refine", …) and the prompt it was measured with. Binding a row to its prompt
 *  (a fingerprint that retires the row when the prompt changes) is the caller's test: this module does not know the prompts. */
export interface Measurement {
  /** Exact model name as the endpoint reports it. */
  model: string;
  /** Other names that stand for the same model; compared like `model`. */
  aliases?: readonly string[];
  /** The sampling mode the numbers were measured with (the panel must send the same, or measure again). */
  mode: string;
  task: string;
  good: number;
  of: number;
  /** Free text the caller's sentence may add ("floor plans 1 of 3"). */
  extra?: string;
  /** Date of the recorded run. */
  measuredAt: string;
  /** Fingerprint of the measured prompt. */
  promptSha: string;
  /** Where the numbers come from (fixtures, run note). */
  source: string;
}

/** The sentences, in the caller's language and nouns ("test prompts gave a plausible model", "test change requests were applied correctly"). */
export interface QualityTexts {
  /** The line for a measured model. */
  measured(m: Measurement): string;
  /** The line when there is nothing to say, and for a family that is not measured at all. */
  notMeasured: string;
  /** The line for an unmeasured model that points to the one small model that was measured (`shortName`: the part of its name after the last "/"). */
  smallReference(ref: Measurement, shortName: string): string;
  /** The bare failure sentence for the task ("The answer could not be turned into a model."). */
  failureBase(task: string): string;
  /** Appended after `failureBase` when the failing model IS the best measured one ("In the test this model got … — try a simpler wording"). */
  failureOwn(m: Measurement): string;
  /** Appended after `failureBase` when another model measured better ("A larger model may do better — measured best: …"). */
  failureBest(top: Measurement): string;
  /** Appended to the measured line and to the reference line (never to `notMeasured`) when `QualityOptions.thinking` is on: the numbers were measured with thinking
   *  off ("measured with thinking off; with thinking up to 50 times longer"). Empty or missing: nothing is appended. */
  thinkingNote?: string;
}

export interface QualityOptions {
  texts: QualityTexts;
  /** Name of the one small model whose numbers serve as a reference for unmeasured models (no reference sentence without it). */
  smallModel?: string;
  /** The family of the model in question (the caller's classification, e.g. from the endpoint). */
  family?: string | null;
  /** Families the table says nothing about (cloud models): they get the plain sentences, with no pointer to a local model. The family wins over a model name that is in the table. */
  unmeasuredFamilies?: readonly string[];
  /** The panel runs with thinking ON while the table was measured with it off: `texts.thinkingNote` is appended to the measured and the reference line.
   *  A structure instead of a text comparison on the caller's side; the family rule still wins (`unmeasuredFamilies` gets the plain sentence). */
  thinking?: boolean;
}

const fold = (s: string): string => s.trim().toLowerCase();

const isUnmeasured = (o: QualityOptions): boolean => o.family != null && (o.unmeasuredFamilies ?? []).includes(o.family);

const withThinkingNote = (line: string, o: QualityOptions): string => (o.thinking === true && o.texts.thinkingNote ? `${line} ${o.texts.thinkingNote}` : line);

/** The row of a model for a task: by name or alias, ignoring case and surrounding blanks; never a guess from a similar name or another task. */
export function findMeasurement(model: string, task: string, table: readonly Measurement[]): Measurement | null {
  const wanted = fold(model);
  if (wanted === "") return null;
  return table.find((m) => m.task === task && (fold(m.model) === wanted || (m.aliases ?? []).some((a) => fold(a) === wanted))) ?? null;
}

/** The quality line for the panel. `measured` tells whether the numbers are the model's own. An unmeasured model gets the reference of the small
 *  model only from the SAME task (a number from creating says nothing about refining). */
export function qualityLine(model: string, task: string, table: readonly Measurement[], o: QualityOptions): { measured: boolean; text: string } {
  const none = { measured: false, text: o.texts.notMeasured };
  if (isUnmeasured(o)) return none;
  const m = findMeasurement(model, task, table);
  if (m !== null) return { measured: true, text: withThinkingNote(o.texts.measured(m), o) };
  if (o.smallModel === undefined) return none;
  const small = fold(o.smallModel);
  const ref = table.find((x) => x.task === task && fold(x.model) === small);
  if (ref === undefined) return none;
  return { measured: false, text: withThinkingNote(o.texts.smallReference(ref, ref.model.slice(ref.model.lastIndexOf("/") + 1)), o) };
}

/** The best measured row of a task: highest `good / of`, a tie goes to the name that sorts first (deterministic). Rows with `of <= 0` measured nothing. */
function best(task: string, table: readonly Measurement[]): Measurement | null {
  return table
    .filter((m) => m.task === task && m.of > 0)
    .sort((a, b) => b.good / b.of - a.good / a.of || a.model.localeCompare(b.model))[0] ?? null;
}

/** What to say when a model's answer failed: the bare sentence, plus — if the task has a measured best model — a pointer to it, or (for the best
 *  model itself) its own numbers. A family in `unmeasuredFamilies` gets the bare sentence only: "a larger model" is no advice for a cloud model. */
export function failureHint(model: string, task: string, table: readonly Measurement[], o: QualityOptions): string {
  const base = o.texts.failureBase(task);
  if (isUnmeasured(o)) return base;
  const top = best(task, table);
  if (top === null) return base;
  const own = findMeasurement(model, task, table);
  return own !== null && own.model === top.model ? `${base} ${o.texts.failureOwn(own)}` : `${base} ${o.texts.failureBest(top)}`;
}

/** Binds a measurement row to the prompt it was measured with: the first 16 hex characters of `sha256(system + NUL + template)`. `template` is the
 *  user-message template (or the user message of a FIXED input); a NUL separates the two, so `"ab" + "c"` and `"a" + "bc"` give different values.
 *  The caller keeps the row's `promptSha` equal to this value in a test: change one word of the prompt and the row is no longer covered. */
export function promptFingerprint(system: string, template: string): string {
  return sha256HexUtf8(`${system}\u0000${template}`).slice(0, 16);
}
