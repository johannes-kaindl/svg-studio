// Die SVG-gebundenen Teile des Panels (Slots für `buildPanelShell`): Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau.
// Die Vorschau (Shadow Root, Hintergrund-Regler, Maßzeile, Auswahl) steht in `preview-view.ts`, der Bestand beim Öffnen (Reparieren, Namen vergeben, Editor-Angaben
// entfernen) in `bestand.ts`. Die Prüfliste ist noch ein einfacher Platzhalter (die Änderungen als Liste); die Prüfliste mit Einzelentscheidungen kommt mit D1.
import { diffSvg, type DiffEntry } from "../../core/diff";
import { svgQualityLine } from "../../core/quality";
import { addRound, type SvgRound, type SvgSession } from "../../core/session";
import { qualityTexts, t } from "../../i18n/strings";
import { activeRound, EMPTY_ROUNDS } from "../../vendor/kit/rounds";
import type { Target } from "../../vendor/kit/panel-session";
import { checkSvg } from "../../vendor/kit/svg-guard";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { renderPreviewView, type PreviewView, type PreviewViewDeps, type Selection } from "./preview-view";
import { bestandProblems, renderBestandNotice, repairProblem } from "./bestand";
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

/** Platzhalter der Prüfliste (bis D1): ein Eintrag je Zeile. */
function renderEntries(host: HTMLElement, entries: readonly DiffEntry[]): void {
  const list = host.createEl("ul", { cls: "svg-studio-change-list" });
  for (const e of entries) list.createEl("li", { text: `${e.kind} ${e.key}` });
}

/** Der Text, auf dem eine Runde aufsetzt: das Ergebnis der Vorgängerin, sonst der Text beim Öffnen. */
function beforeOf(s: SvgSession, r: SvgRound): string | null {
  return r.basedOn === null ? s.startText : (s.rounds.rounds[r.basedOn]?.result ?? null);
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
    renderChanges(host, round, session) {
      if (round === null) return;
      const b = round.body;
      if (b.form === "list") {
        renderEntries(host, b.entries);
      } else if (b.form === "whole") {
        // Das ganze Bild ersetzt den Ausgang (Reparatur eines unlesbaren Bestands, „nicht zerlegbar“): ohne Einzelheiten, nur nicht stumm (die Prüfliste mit Entscheidung folgt mit D1).
        if (round.art !== "create") host.createDiv({ cls: "svg-studio-change-whole", text: t("bestand.changesWhole") });
      } else if (b.form === "rule") {
        // Eine Regelrunde hat keine Einträge; gezeigt wird das Diff vom Ausgang zum Ergebnis.
        const before = beforeOf(session, round);
        if (before === null) return;
        const diff = diffSvg(before, round.result);
        if (diff.decomposable) renderEntries(host, diff.entries);
        else host.createDiv({ cls: "svg-studio-change-whole", text: t("bestand.changesWhole") });
      }
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
      ctx.setStatus("error", t("bestand.failed", added.problem));
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
