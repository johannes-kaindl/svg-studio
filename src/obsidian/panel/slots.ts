// Die SVG-gebundenen Teile des Panels (Slots für `buildPanelShell`): Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau.
// Die Vorschau (Shadow Root, Hintergrund-Regler, Maßzeile, Auswahl) steht in `preview-view.ts`, der Bestand beim Öffnen (Reparieren, Namen vergeben, Editor-Angaben
// entfernen) in `bestand.ts`, die Prüfliste mit den Einzelentscheidungen in `review.ts`.
import { svgQualityLine } from "../../core/quality";
import { addRound, type SvgRound, type SvgSession } from "../../core/session";
import { problemText, qualityTexts, t } from "../../i18n/strings";
import { activeRound, EMPTY_ROUNDS } from "../../vendor/kit/rounds";
import type { Target } from "../../vendor/kit/panel-session";
import { checkSvg } from "../../vendor/kit/svg-guard";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { renderPreviewView, type PreviewView, type PreviewViewDeps, type Selection } from "./preview-view";
import { bestandProblems, renderBestandNotice, repairProblem } from "./bestand";
import { renderReview } from "./review";
import { runSvgPrompt, runSvgRepair } from "./run";
import type { NoticeCtx, PanelSlots } from "./shell";

export interface SvgSlotDeps {
  llm: Pick<LlmConnection, "complete" | "source">;
  readTargetText: (target: Target) => Promise<string | null>;
  /** Denken an? Die Messzeile gilt für Denken aus und sagt es sonst dazu (Plan 2, Entscheidung 3). */
  thinkingOn: () => boolean;
  /** Hintergrund der Vorschau: lesen und speichern (nur die Vorschau, nie das SVG). */
  background: PreviewViewDeps["background"];
}

export function freshSession(target: Target): SvgSession {
  return { target, rounds: EMPTY_ROUNDS, startText: null };
}

export function roundMeta(r: SvgRound): string {
  const b = r.body;
  if (r.art === "create") return t("panel.roundNew");
  if (r.art === "hand") return t("panel.roundHand");
  if (r.art === "repair") return b.form === "whole" ? t("panel.roundRepairWhole") : t("panel.roundRepair");
  if (b.form === "rule") return t("panel.roundRule");
  if (b.form === "whole") return t("panel.roundWhole");
  return t("panel.roundChanges", b.entries.length);
}

export function svgSlots(d: SvgSlotDeps): PanelSlots<SvgRound, SvgSession> {
  let view: PreviewView | null = null;
  const selection: Selection = { id: null, text: null };
  return {
    fresh: freshSession,
    roundLabel: (r) => r.instruction,
    roundMeta,
    roundText: (r) => r.result,
    quality: (model, task) => svgQualityLine(model, task, { family: d.llm.source().family, thinking: d.thinkingOn(), texts: qualityTexts() }),
    run: (call) => runSvgPrompt(call, { llm: d.llm, readTargetText: d.readTargetText }),
    renderPreview(host, _round, text) {
      view?.dispose();
      view = null;
      if (text === null) return;
      view = renderPreviewView(host, text, { background: d.background }, selection);
    },
    renderChanges(host, round, session, ctx) {
      renderReview(host, round, session, ctx, { background: d.background, jump: (id) => { view?.select(id); } });
    },
    notices(host, ctx) {
      void renderNotices(host, ctx, d);
    },
    dispose() {
      view?.dispose();
      view = null;
    },
  };
}

/** Der Bestand: Text der aktiven Runde (sonst des Ziels JETZT) messen und die Karten zeichnen. Ein neues SVG ohne Runden hat nichts zu messen. */
async function renderNotices(host: HTMLElement, ctx: NoticeCtx<SvgSession>, d: SvgSlotDeps): Promise<void> {
  const session = ctx.session();
  const active = activeRound(session.rounds);
  const text = active !== null ? active.result : await d.readTargetText(session.target);
  if (text === null || !ctx.current()) return;
  const b = bestandProblems(text, checkSvg);
  const rule = (art: "names" | "cleanup", rule: "assign-ids" | "strip-editor-metadata", instruction: string, done: string): void => {
    const s = ctx.session();
    const start = s.rounds.rounds.length === 0 ? { ...s, startText: text } : s;
    const added = addRound(start, { art, instruction, basedOn: start.rounds.active >= 0 ? start.rounds.active : null, body: { form: "rule", rule } });
    if ("problem" in added) {
      ctx.setStatus("error", t("bestand.failed", problemText(added.problem)));
      return;
    }
    ctx.setSession(added);
    ctx.setStatus("ok", done);
  };
  renderBestandNotice(host, b, {
    repair: () => {
      const instruction = t("round.repair");
      ctx.run(instruction, (call) => runSvgRepair(call, { llm: d.llm, readTargetText: d.readTargetText }, { text, problem: repairProblem(b), instruction }));
    },
    names: () => { rule("names", "assign-ids", t("round.names"), t("bestand.doneNames")); },
    cleanup: () => { rule("cleanup", "strip-editor-metadata", t("round.cleanup"), t("bestand.doneCleanup")); },
  }, ctx.busy());
}
