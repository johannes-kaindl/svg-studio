// Die SVG-gebundenen Teile des Panels (Slots für `buildPanelShell`): Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau.
// Die Vorschau (Shadow Root, Hintergrund-Regler, Maßzeile, Auswahl) steht in `preview-view.ts`, der Bestand beim Öffnen (Reparieren, Namen vergeben, Editor-Angaben
// entfernen) in `bestand.ts`, die Prüfliste mit den Einzelentscheidungen in `review.ts`.
import { svgQualityLine } from "../../core/quality";
import { addHandChange, addRound, type SvgRound, type SvgSession } from "../../core/session";
import { problemText, qualityTexts, t } from "../../i18n/strings";
import { activeRound, EMPTY_ROUNDS } from "../../vendor/kit/rounds";
import type { Target } from "../../vendor/kit/panel-session";
import { checkSvg } from "../../vendor/kit/svg-guard";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { renderPreviewView, type PreviewView, type PreviewViewDeps, type Selection } from "./preview-view";
import { bestandProblems, renderBestandNotice, repairProblem } from "./bestand";
import { renderFields } from "./fields-view";
import { renderReview, type ReviewDeps } from "./review";
import { runSvgPrompt, runSvgRepair } from "./run";
import type { NoticeCtx, PanelSlots } from "./shell";

export interface SvgSlotDeps {
  llm: Pick<LlmConnection, "complete" | "source">;
  readTargetText: (target: Target) => Promise<string | null>;
  /** Denken an? Die Messzeile gilt für Denken aus und sagt es sonst dazu (Plan 2, Entscheidung 3). */
  thinkingOn: () => boolean;
  /** Hintergrund der Vorschau: lesen und speichern (nur die Vorschau, nie das SVG). */
  background: PreviewViewDeps["background"];
  /** Absturzmarken (Laufzeit-Schutz): Vorschau und Vergleich zeichnen erst nach der Marke und nicht, solange eine steht. */
  renderGuard?: PreviewViewDeps["renderGuard"];
  /** Der Kontext des Modells am Endpunkt (Token) für die Prüfung der Eingabe im Lauf; `null`: der Endpunkt nennt ihn nicht. */
  contextLimit?: () => Promise<number | null>;
  /** Der Kommentar-Dialog der Prüfliste (`promptText` des Kits, vom Panel mit der App verdrahtet); ohne ihn gibt es keine Kommentar-Taste. */
  comment?: ReviewDeps["comment"];
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
  /** Das Feld, in dem Enter kam: nach dem Neuzeichnen bekommt es den Fokus zurück. */
  const focus: { name: string | null } = { name: null };
  /** Zeichnet die Zahlenfelder des gewählten Elements neu (eine Auswahl im Bild ändert nur sie, nicht das Panel). */
  let paintFields: (() => void) | null = null;
  /** Abbau-Funktionen der kleinen Vorschauen (Vergleich Vorher/Nachher) der letzten Zeichnung der Prüfliste. */
  const comparePreviews: Array<() => void> = [];
  return {
    fresh: freshSession,
    roundLabel: (r) => r.instruction,
    roundMeta,
    roundText: (r) => r.result,
    quality: (model, task) => svgQualityLine(model, task, { family: d.llm.source().family, thinking: d.thinkingOn(), texts: qualityTexts() }),
    run: (call) => runSvgPrompt(call, { llm: d.llm, readTargetText: d.readTargetText, ...(d.contextLimit === undefined ? {} : { contextLimit: d.contextLimit }) }),
    renderPreview(host, _round, text) {
      view?.dispose();
      view = null;
      if (text === null) return;
      view = renderPreviewView(host, text, { background: d.background, ...(d.renderGuard === undefined ? {} : { renderGuard: d.renderGuard }), onSelectionChange: () => { paintFields?.(); } }, selection);
    },
    canPreviewBase(text) {
      const b = bestandProblems(text, checkSvg);
      return b.parse === null && b.guard.length === 0;
    },
    renderFields(host, text, _session, ctx) {
      paintFields = () => {
        host.empty();
        if (text === null) return;
        if (selection.id === null || view === null) {
          host.createDiv({ cls: "svg-studio-fields-hint", text: t("fields.hint") });
          return;
        }
        const id = selection.id;
        renderFields(host, {
          text,
          id,
          center: () => {
            const box = view?.localBoxOf(id) ?? null;
            return box === null ? null : [box.x + box.width / 2, box.y + box.height / 2];
          },
          busy: ctx.busy,
          focus,
          commit: (changes, label) => {
            if (ctx.busy()) return null;
            // Ein Bestand ohne Runde: die erste Handänderung ist die erste Runde und setzt auf dem Text auf, den die Vorschau zeigte.
            const now = ctx.session();
            const from = now.rounds.rounds.length === 0 && now.startText === null ? { ...now, startText: text } : now;
            const next = addHandChange(from, changes, label);
            if ("problem" in next) return next.problem;
            ctx.setSession(next);
            return null;
          },
        });
      };
      paintFields();
    },
    renderChanges(host, round, session, ctx) {
      // Die kleinen Vorschauen der letzten Zeichnung abbauen (ihre Wächter der Absturzmarke enden dabei), dann neu.
      for (const destroy of comparePreviews.splice(0)) destroy();
      renderReview(host, round, session, ctx, { background: d.background, track: (destroy) => { comparePreviews.push(destroy); }, ...(d.renderGuard === undefined ? {} : { renderGuard: d.renderGuard }), jump: (id) => { view?.select(id); }, ...(d.comment === undefined ? {} : { comment: d.comment }) });
    },
    notices(host, ctx) {
      void renderNotices(host, ctx, d);
    },
    dispose() {
      view?.dispose();
      view = null;
      paintFields = null;
      for (const destroy of comparePreviews.splice(0)) destroy();
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
      ctx.run(instruction, (call) => runSvgRepair(call, { llm: d.llm, readTargetText: d.readTargetText, ...(d.contextLimit === undefined ? {} : { contextLimit: d.contextLimit }) }, { text, problem: repairProblem(b), instruction }));
    },
    names: () => { rule("names", "assign-ids", t("round.names"), t("bestand.doneNames")); },
    cleanup: () => { rule("cleanup", "strip-editor-metadata", t("round.cleanup"), t("bestand.doneCleanup")); },
  }, ctx.busy());
}
