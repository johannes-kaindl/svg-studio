// Der Bestand beim Öffnen (Plan 2, C4): ist das SVG, auf dem das Panel steht, unlesbar, vom Bereiniger abgelehnt, ohne Namen oder voller Editor-Angaben?
// `bestandProblems` misst es, `renderBestandNotice` zeigt je Befund eine Karte mit dem Knopf, der ihn behebt: „Reparieren“ (Modell, Runde `repair`), „Namen vergeben“
// und „Editor-Angaben entfernen“ (Regelrunden ohne Modell, Entscheidung 13 und E4 a). Die Knöpfe setzen nur Runden; geschrieben wird erst mit Übernehmen.
import { applyChanges } from "../../core/changes";
import { stripEditorMetadata } from "../../core/editor-metadata";
import { scanElements } from "../../core/elements";
import { canRefine } from "../../core/session";
import { problemText, t } from "../../i18n/strings";
import type { SvgProblem, checkSvg } from "../../vendor/kit/svg-guard";

export interface BestandProblems {
  /** Das Parserproblem, wenn der Text nicht wohlgeformt ist, sonst `null`. Als Wert: der Satz für den Nutzer entsteht in der Oberfläche (`problemText`), der für das Modell in `repairProblem`. */
  parse: { message: string; offset: number } | null;
  /** Die Befunde des Bereinigers (leer, wenn er annimmt oder der Text nicht wohlgeformt ist). */
  guard: SvgProblem[];
  /** Elemente ohne `id`, gezählt auf dem Text, der nach „Editor-Angaben entfernen“ gälte (deren Kinder gehen mit). */
  unnamed: number;
  /** Editor-Angaben (Inkscape: `sodipodi:`, `inkscape:`, RDF-`metadata`) sind im Text. */
  editorMetadata: boolean;
}

export function bestandProblems(text: string, guard: typeof checkSvg): BestandProblems {
  const syntax = scanElements(text).issues.find((i) => i.kind === "syntax");
  if (syntax !== undefined) {
    return { parse: { message: syntax.message, offset: syntax.offset }, guard: [], unnamed: 0, editorMetadata: false };
  }
  const g = guard(text);
  // `stripEditorMetadata` scheitert bei lesbarem Text nur, wenn Elemente ohne id Editor-Angaben tragen: auch das sind Editor-Angaben.
  const strip = stripEditorMetadata(text);
  const editorMetadata = !strip.ok || strip.changes.length > 0;
  let counted = text;
  if (strip.ok && strip.changes.length > 0) {
    const out = applyChanges(text, strip.changes);
    if (out.ok) counted = out.text;
  }
  const can = canRefine(counted);
  return { parse: null, guard: g.ok ? [] : g.problems, unnamed: can.ok ? 0 : can.unnamed, editorMetadata };
}

/** Der Befund, mit dem die Reparatur ans Modell geht: das Parserproblem, sonst die Befunde des Bereinigers (Wortlaut wie in `protocol.ts`). */
export function repairProblem(b: BestandProblems): string {
  if (b.parse !== null) return `Das SVG ist nicht wohlgeformt: ${b.parse.message} (Offset ${String(b.parse.offset)}).`;
  return `Der Bereiniger lehnt ab: ${b.guard.map((p) => `${p.code}: ${p.detail}`).join("; ")}.`;
}

export interface BestandActions {
  repair: () => void;
  names: () => void;
  cleanup: () => void;
}

/** Wie viele Befunde des Bereinigers die Karte einzeln nennt; der Rest steht als „… und n weitere“ (eine Inkscape-Datei hat leicht ein Dutzend, das drückte den Knopf an den Rand). */
const LISTED = 5;

/** Je Befund eine Karte mit Text und Knopf (der Knopf in eigener Zeile unter dem Text). Ohne Befund bleibt der Host leer. */
export function renderBestandNotice(host: HTMLElement, b: BestandProblems, a: BestandActions, busy: boolean): void {
  const card = (fill: (box: HTMLElement) => void, label: string, hint: string, onClick: () => void): void => {
    const el = host.createDiv({ cls: "svg-studio-notice", attr: { role: "group" } });
    fill(el.createDiv({ cls: "svg-studio-notice-text" }));
    const btn = el.createEl("button", { cls: "svg-studio-notice-button", text: label, attr: { type: "button", title: hint } });
    btn.disabled = busy;
    btn.addEventListener("click", onClick);
  };
  const plain = (text: string) => (box: HTMLElement): void => { box.setText(text); };
  // In der Reihenfolge, in der die Schritte gehen: Namen zuerst („Editor-Angaben entfernen“ scheitert an Elementen ohne id), dann die Editor-Angaben, dann die Reparatur.
  if (b.unnamed > 0) card(plain(t("bestand.unnamed", b.unnamed)), t("bestand.names"), t("bestand.names.hint"), a.names);
  if (b.editorMetadata) card(plain(t("bestand.editor")), t("bestand.cleanup"), t("bestand.cleanup.hint"), a.cleanup);
  if (b.parse !== null) {
    card(plain(t("bestand.unusable", problemText({ code: "text-unreadable", params: [b.parse.message, b.parse.offset] }))), t("bestand.repair"), t("bestand.repair.hint"), a.repair);
  } else if (b.guard.length > 0) {
    card((box) => {
      box.createDiv({ text: t("bestand.unusableHead") });
      const list = box.createEl("ul", { cls: "svg-studio-notice-list" });
      for (const p of b.guard.slice(0, LISTED)) list.createEl("li", { text: `${p.code}: ${p.detail}` });
      if (b.guard.length > LISTED) list.createEl("li", { text: t("bestand.more", b.guard.length - LISTED) });
    }, t("bestand.repair"), t("bestand.repair.hint"), a.repair);
  }
}
