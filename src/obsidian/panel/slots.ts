// Die SVG-gebundenen Teile des Panels (Slots für `buildPanelShell`): Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau.
// Die Vorschau (Shadow Root, Hintergrund-Regler, Maßzeile, Auswahl) steht in `preview-view.ts`. Die Prüfliste ist noch ein einfacher Platzhalter (die Änderungen
// als Liste); die Prüfliste mit Einzelentscheidungen kommt mit D1.
import { svgQualityLine } from "../../core/quality";
import type { SvgRound, SvgSession } from "../../core/session";
import { qualityTexts, t } from "../../i18n/strings";
import { EMPTY_ROUNDS } from "../../vendor/kit/rounds";
import type { Target } from "../../vendor/kit/panel-session";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { renderPreviewView, type PreviewView, type PreviewViewDeps, type Selection } from "./preview-view";
import { runSvgPrompt } from "./run";
import type { PanelSlots } from "./shell";

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
  if (r.art === "repair") return t("panel.roundRepair");
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
    renderChanges(host, round) {
      if (round === null) return;
      const b = round.body;
      if (b.form !== "list") return;
      const list = host.createEl("ul", { cls: "svg-studio-change-list" });
      for (const e of b.entries) list.createEl("li", { text: `${e.kind} ${e.key}` });
    },
    dispose() {
      view?.dispose();
      view = null;
    },
  };
}
