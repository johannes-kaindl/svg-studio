// Die SVG-gebundenen Teile des Panels (Slots für `buildPanelShell`): Sitzung, Beschriftung der Runden, Messzeile, Lauf, Vorschau.
// Vorschau und Prüfliste sind in C2 einfache Platzhalter: das Bild als `<img>` mit Data-URL (wie der Block), die Änderungen als Liste. Die Vorschau im
// Shadow Root mit Reglern kommt mit C3, die Prüfliste mit Einzelentscheidungen mit D1.
import { svgQualityLine } from "../../core/quality";
import type { SvgRound, SvgSession } from "../../core/session";
import { qualityTexts, t } from "../../i18n/strings";
import { binaryToDataUrl } from "../../vendor/kit/data-url";
import { EMPTY_ROUNDS } from "../../vendor/kit/rounds";
import { checkSvg } from "../../vendor/kit/svg-guard";
import type { Target } from "../../vendor/kit/panel-session";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { runSvgPrompt } from "./run";
import type { PanelSlots } from "./shell";

export interface SvgSlotDeps {
  llm: Pick<LlmConnection, "complete" | "source">;
  readTargetText: (target: Target) => Promise<string | null>;
  /** Denken an? Die Messzeile gilt für Denken aus und sagt es sonst dazu (Plan 2, Entscheidung 3). */
  thinkingOn: () => boolean;
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
  return {
    fresh: freshSession,
    roundLabel: (r) => r.instruction,
    roundMeta,
    roundText: (r) => r.result,
    quality: (model, task) => svgQualityLine(model, task, { family: d.llm.source().family, thinking: d.thinkingOn(), texts: qualityTexts() }),
    run: (call) => runSvgPrompt(call, { llm: d.llm, readTargetText: d.readTargetText }),
    renderPreview(host, _round, text) {
      if (text === null) return;
      if (!checkSvg(text).ok) {
        host.createDiv({ cls: "svg-studio-error", text: t("block.rejected") });
        return;
      }
      host.createEl("img", { cls: "svg-studio-img", attr: { src: binaryToDataUrl(new TextEncoder().encode(text), "svg"), alt: t("block.alt") } });
    },
    renderChanges(host, round) {
      if (round === null) return;
      const b = round.body;
      if (b.form !== "list") return;
      const list = host.createEl("ul", { cls: "svg-studio-change-list" });
      for (const e of b.entries) list.createEl("li", { text: `${e.kind} ${e.key}` });
    },
  };
}
