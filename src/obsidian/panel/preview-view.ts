// Die Vorschau des Panels als Ganzes: Regler im Kopf, Vorschau im Shadow Root, Maßzeile darunter (Spec § 7.2 bis § 7.4). Die Teile sind formatgebunden und
// gehören deshalb nicht in `shell.ts`; `slots.ts` ruft diese Funktion aus dem Slot `renderPreview`.
import { backgroundColor, type BackgroundState } from "../../core/background";
import { measureCanvas } from "../../core/measure";
import { formatMeasureLine } from "../../core/measure-line";
import { measureTexts, t } from "../../i18n/strings";
import { checkSvg } from "../../vendor/kit/svg-guard";
import { buildBackgroundBar } from "./background-bar";
import { buildPreview } from "./preview";

export interface PreviewViewDeps {
  background: { get: () => BackgroundState; set: (s: BackgroundState) => void };
}

/** Die Auswahl überlebt ein Neuzeichnen mit demselben Text (Status-Wechsel zeichnen das Panel neu), nicht aber einen anderen Text. */
export interface Selection { id: string | null; text: string | null }

export interface PreviewView {
  dispose: () => void;
  /** Das Element mit dieser `id` markieren und messen (die Prüfliste springt hierher); `null` hebt die Marke auf. */
  select: (id: string | null) => void;
}

/** Wie viele Probleme der Bereiniger in der Anzeige genannt werden; alle stehen im Block-Fehler der Notiz. */
const SHOWN_PROBLEMS = 3;

export function renderPreviewView(host: HTMLElement, text: string, d: PreviewViewDeps, selection: Selection): PreviewView {
  if (selection.text !== text) selection.id = null;
  selection.text = text;

  // Reihenfolge im DOM: Regler (Kopf), Bild, Maßzeile.
  const head = host.createDiv({ cls: "svg-studio-preview-head" });
  const preview = buildPreview(host, {
    guard: checkSvg,
    onSelect: (id) => { selection.id = id; paintMeasure(); },
  });
  const measureEl = host.createDiv({ cls: "svg-studio-measure", attr: { "aria-live": "polite" } });
  buildBackgroundBar(head, {
    state: d.background.get(),
    texts: {
      toggle: (on) => t(on ? "preview.bgOn" : "preview.bgOff"),
      toggleHint: t("preview.bgToggle"),
      toneLabel: t("preview.tone"),
      light: t("preview.tone.light"),
      dark: t("preview.tone.dark"),
      custom: t("preview.tone.custom"),
      hexLabel: t("preview.hex"),
    },
    onChange: (s) => {
      d.background.set(s);
      preview.setBackground(backgroundColor(s));
    },
  });
  preview.setBackground(backgroundColor(d.background.get()));

  function paintMeasure(): void {
    const box = selection.id === null ? null : preview.boxOf(selection.id);
    measureEl.setText(formatMeasureLine({
      canvas: measureCanvas(text),
      drawing: preview.boxOf(null),
      selected: selection.id !== null && box !== null ? { id: selection.id, box, ambiguous: preview.isAmbiguous(selection.id) } : null,
    }, measureTexts()));
  }

  const shown = preview.show(text);
  if (!shown.ok) {
    preview.destroy();
    host.empty();
    const err = host.createDiv({ cls: "svg-studio-error" });
    err.createEl("p", { cls: "svg-studio-error-head", text: t("block.rejected") });
    const list = err.createEl("ul");
    for (const p of shown.problems.slice(0, SHOWN_PROBLEMS)) list.createEl("li", { text: t("block.problem", p.code, p.detail) });
    return { dispose: () => undefined, select: () => undefined };
  }
  preview.select(selection.id);
  paintMeasure();

  // Das Panel zeichnet die Vorschau, bevor es sie zeigt (Kasten noch verborgen, `getBBox` ohne Layout): ändert sich die Größe des Kastens, wird neu gemessen.
  const RO = host.ownerDocument.defaultView?.ResizeObserver;
  const observer = RO === undefined ? null : new RO(() => { paintMeasure(); });
  observer?.observe(host);
  return {
    dispose: () => { observer?.disconnect(); preview.destroy(); },
    select: (id) => { selection.id = id; preview.select(id); paintMeasure(); },
  };
}
