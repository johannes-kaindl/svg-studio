// Der Lauf des Panels (Spec § 8 „In der Runde“): Erzeugen und Verfeinern mit Rückfrage bei ungültiger Antwort, dann eine Runde im Rundenmodell.
// Formatgebunden (SVG); der Kern `shell.ts` ruft ihn über den Slot `run`. Sampling (Modus `transform`, Temperatur 0,2, Denken aus, `max_tokens` 16384) setzt
// die Verbindung in `main.ts`; hier steht nur, was zum Protokoll gehört.
import { buildCreateMessages, buildRefineMessages, RETRY_INSTRUCTION, validateCreate, validateRefine, type GuardFn } from "../../core/protocol";
import { svgFailureHint } from "../../core/quality";
import { addRound, canRefine, refineBaseText, type SvgRound, type SvgSession } from "../../core/session";
import { getLang, qualityTexts, t } from "../../i18n/strings";
import { askUntilValid, type AskUntilValidResult, type Verdict } from "../../vendor/kit/answer-retry";
import { taskKind, type Target } from "../../vendor/kit/panel-session";
import { checkSvg } from "../../vendor/kit/svg-guard";
import { isManagerErrorCode, noEndpointText, resolveLlmConnectionStrings } from "../../vendor/kit-obsidian/llm-connection-strings";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { askFor, LlmAskError } from "../llm-ask";
import type { RunCall, RunResult } from "./shell";

/** Wie oft gefragt wird: die erste Anfrage plus höchstens zwei Rückfragen (Spec § 8). */
export const MAX_RETRIES = 2;

/** Der Bereiniger als Prüfer des Protokolls; der Kern kennt kein DOM. */
export const svgGuard: GuardFn = (svg) => {
  const r = checkSvg(svg);
  return r.ok ? { ok: true } : { ok: false, problems: r.problems.map((p) => ({ code: p.code, detail: p.detail })) };
};

export interface SvgRunDeps {
  llm: Pick<LlmConnection, "complete" | "source">;
  readTargetText: (t: Target) => Promise<string | null>;
  guard?: GuardFn;
}

const error = (message: string): RunResult<SvgSession> => ({ ok: false, kind: "error", message });

/** Der Text zu einem fehlenden Endpunkt: bei einem Manager-Grund der Kit-Text, sonst der Grund als Satz. */
function noEndpointMessage(e: LlmAskError): string {
  if (e.sourceKind === "manager" && isManagerErrorCode(e.detail)) return noEndpointText(resolveLlmConnectionStrings({ lang: getLang() }), { kind: "manager" }, e.detail);
  return t("panel.noEndpointDetail", e.detail);
}

export async function runSvgPrompt(call: RunCall<SvgSession>, d: SvgRunDeps): Promise<RunResult<SvgSession>> {
  const { session, instruction, io } = call;
  const guard = d.guard ?? svgGuard;
  const task = taskKind(session);
  let start = session;
  let base = "";

  if (task === "refine") {
    // Der Text des Ziels wird nur beim ersten Verfeinern gebraucht; mit offenen Runden baut die Anfrage auf dem Ergebnis der aktiven auf.
    const current = session.rounds.rounds.length === 0 ? await d.readTargetText(session.target) : null;
    if (call.signal.aborted) return { ok: false, kind: "aborted" };
    const text = refineBaseText(session, current);
    if (text === null) return error(t("run.targetGone"));
    // Elemente ohne `id` kann keine Änderungsliste ansprechen (Review-Fokus 5): es geht keine Anfrage hinaus.
    const can = canRefine(text);
    if (!can.ok) return error(t("run.unnamed", can.unnamed));
    base = text;
    if (session.rounds.rounds.length === 0) start = { ...session, startText: text };
  }

  let lastProblem = "";
  const wrap = <V>(verdict: Verdict<V>): Verdict<V> => {
    if (!verdict.ok) lastProblem = verdict.problem;
    return verdict;
  };
  const ask = askFor(d.llm, {
    signal: call.signal,
    onToken: io.onToken,
    onReasoning: io.onReasoning,
    onContentReset: io.onContentReset,
    // Jeder Versuch leert den Antwortbereich; ab dem zweiten sagt der Status, warum gefragt wird.
    onAttempt: (n) => {
      if (n === 1) return;
      io.clearAnswer();
      io.setStatus("checking", t("run.attempt", n, MAX_RETRIES + 1, lastProblem));
    },
  });
  const opts = (messages: ReturnType<typeof buildCreateMessages>) => ({ messages, instruction: RETRY_INSTRUCTION, maxRetries: MAX_RETRIES, stopOnTruncated: true });

  io.start();
  try {
    if (task === "create") {
      const res = await askUntilValid(ask, (raw) => wrap(validateCreate(raw, { guard, prompt: instruction })), opts(buildCreateMessages(instruction)));
      if (!res.ok) return failed(res, call, task, d);
      const added = addRound(start, { art: "create", instruction, basedOn: null, body: { form: "whole", text: res.value.svg, decision: "accepted" } });
      return "problem" in added ? error(t("run.noRound", added.problem)) : { ok: true, session: added, message: t("run.doneCreate") };
    }
    const res = await askUntilValid(ask, (raw) => wrap(validateRefine(raw, { guard, base })), opts(buildRefineMessages(base, instruction)));
    if (!res.ok) return failed(res, call, task, d);
    const diff = res.value.diff;
    // Zerlegbar: die Einträge der Prüfliste; sonst ein Eintrag „Ganzes Bild ersetzt“ (Spec Nr. 12), nie still verloren.
    const body: SvgRound["body"] = diff.decomposable ? { form: "list", entries: diff.entries, decisions: [] } : { form: "whole", text: res.value.svg, decision: "accepted" };
    const added = addRound(start, { art: "prompt", instruction, basedOn: start.rounds.active >= 0 ? start.rounds.active : null, body });
    return "problem" in added ? error(t("run.noRound", added.problem)) : { ok: true, session: added, message: t("run.doneRefine") };
  } catch (e) {
    if (call.signal.aborted) return { ok: false, kind: "aborted" };
    if (e instanceof LlmAskError) {
      if (e.kind === "aborted") return { ok: false, kind: "aborted" };
      if (e.kind === "no-endpoint") return { ok: false, kind: "no-endpoint", detail: noEndpointMessage(e) };
      return error(t("run.error", e.detail));
    }
    return error(t("run.error", e instanceof Error ? e.message : String(e)));
  }
}

/** Die Antwort blieb ungültig. Abgeschnitten heißt: ein Budget, kein Modellfehler, und keine zweite Anfrage (Review-Fokus 1). Der Rohtext bleibt im Antwortbereich stehen. */
function failed(res: Extract<AskUntilValidResult<unknown>, { ok: false }>, call: RunCall<SvgSession>, task: "create" | "refine", d: SvgRunDeps): RunResult<SvgSession> {
  if (res.truncated) return error(t("run.tooBig", res.raw.length));
  const hint = svgFailureHint(call.model, task, { family: d.llm.source().family, texts: qualityTexts() });
  return error(`${t("run.failed", res.problem)} ${hint}`);
}
