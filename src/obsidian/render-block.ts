// ```svg-studio-Block als Bild (Spec § 5.3): in der Notiz läuft nie ein Skript, und kein `<style>` wirkt auf Obsidian, weil das SVG als `<img>` mit Data-URL
// steht. Es kommt NIE Markup aus dem Quelltext in den DOM: bei Ablehnung steht eine Liste der Probleme, kein Bild.
import { setIcon } from "obsidian";
import { binaryToDataUrl } from "../vendor/kit/data-url";
import type { checkSvg } from "../vendor/kit/svg-guard";
import { distinctGuardProblems } from "../core/protocol";
import { CLICK_COST, COST_LIMIT } from "../core/render-guard";
import { guardProblemText, type T } from "../i18n/strings";
import type { RenderGuard } from "./render-guard";

export const VIEW_TYPE_SVG_STUDIO = "svg-studio-panel";

export interface RenderBlockOptions {
  guard: typeof checkSvg;
  onEdit: () => void;
  onRepair: () => void;
  t: T;
  /** Absturzmarke: ohne Wächter wird immer gezeichnet (Tests, Aufrufer ohne Speicher). */
  marks?: RenderGuard;
  /** Einstellung „SVG in Notizen automatisch anzeigen“ (Notausschalter); Vorgabe an. Aus: erst nach Klick. */
  autoShow?: () => boolean;
  /** Der Block meldet hier eine Aufräum-Funktion an, die beim Abbau des Blocks (Notizwechsel, erneutes Rendern) läuft: sie beendet den Wächter der Absturzmarke. */
  onDispose?: (cleanup: () => void) => void;
  /** Kostenwert ab dem der Block erst nach einem Klick gezeichnet wird; Vorgabe `CLICK_COST`. */
  clickCost?: number;
  /** Nach „Anzeigen“ oder „Trotzdem anzeigen“: Marke, Notausschalter und Kostenschwelle nicht erneut prüfen. */
  forced?: boolean;
}

/** Ein Knopf mit Icon und zugänglichem Namen; `createEl` am Elternknoten erzeugt ihn im Dokument des Elternknotens (auch in einem Popout-Fenster). */
function iconButton(parent: HTMLElement, cls: string, icon: string, label: string, onClick: () => void): HTMLElement {
  const b = parent.createEl("button", { cls: `clickable-icon ${cls}`, attr: { "aria-label": label, type: "button" } });
  setIcon(b, icon);
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return b;
}

function textButton(parent: HTMLElement, cls: string, label: string, onClick: () => void): HTMLElement {
  const b = parent.createEl("button", { cls, text: label, attr: { type: "button" } });
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    onClick();
  });
  return b;
}

/** Eine feste Länge (Zahl, mit oder ohne Einheit); Prozent und Unbrauchbares nicht. */
const FIXED_LENGTH = /^\s*\+?(?:\d+\.?\d*|\.\d+)(?:px|pt|pc|mm|cm|in|em|ex)?\s*$/i;

/** Die Breite der `viewBox` als Text, wenn das SVG keine feste Größe trägt (so schreiben Modelle: nur `viewBox`, oder `width="100%" height="100%"`): ein Bild ohne eigene Größe in einem `inline-block` mit
 *  `max-width: 100%` wird 0 px breit und ist unsichtbar (gemessen im Bild-Lauf 2026-11-05, 0 statt 272 px; Prozentangaben zählen für Chromium nicht als Größe des Bildes, gemessen 0 px). Eine feste `width` oder
 *  `height` genügt dagegen, das Seitenverhältnis der viewBox liefert den Rest. Die Breite der viewBox gilt als CSS-Pixel, `max-width: 100%` begrenzt sie. `null`, wenn nichts zu setzen ist. */
function viewBoxWidth(svg: Element): string | null {
  if (FIXED_LENGTH.test(svg.getAttribute("width") ?? "") || FIXED_LENGTH.test(svg.getAttribute("height") ?? "")) return null;
  const parts = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const w = parts[2];
  return parts.length === 4 && parts.every(Number.isFinite) && w !== undefined && w > 0 && (parts[3] ?? 0) > 0 ? String(w) : null;
}

export function renderSvgBlock(source: string, el: HTMLElement, o: RenderBlockOptions): "image" | "held" | "error" {
  el.empty();
  const wrap = el.createDiv({ cls: "svg-studio-block" });
  const win = el.ownerDocument.defaultView ?? window;
  /** Der Block nach einem Klick auf „Anzeigen“: ohne erneute Prüfung von Marke und Notausschalter, aber mit dem vollen Weg (Marke, Bereiniger, Bild). */
  const again = (): void => { renderSvgBlock(source, el, { ...o, forced: true }); };
  // Statt des Bildes ein Platzhalter mit einem Knopf: nach einer Absturzmarke oder bei ausgeschaltetem Notausschalter. Der Bereiniger läuft dann gar nicht erst: er ist selbst
  // ein Teil des Zeichnens, das hängen kann (verschachtelte Selektoren im DOMParser).
  const hold = (text: string, button: string, before: () => void): "held" => {
    const box = wrap.createDiv({ cls: "svg-studio-held" });
    box.createEl("p", { text });
    textButton(box, "svg-studio-show", button, () => { before(); again(); });
    iconButton(wrap, "svg-studio-edit", "pencil", o.t("block.edit"), o.onEdit);
    return "held";
  };
  if (o.forced !== true) {
    if (o.marks?.isMarked(source) === true) return hold(o.t("block.blocked"), o.t("block.showAnyway"), () => { o.marks?.clear(source); });
    if (o.autoShow !== undefined && !o.autoShow()) return hold(o.t("block.manual"), o.t("block.show"), () => undefined);
  }
  // Die Marke steht VOR dem Bereiniger und vor der `src` des Bildes: beides kann den Hauptthread blockieren, und eine danach gesetzte Marke käme zu spät.
  const ticket = o.marks?.begin(source, win);
  if (ticket !== undefined) o.onDispose?.(() => { ticket.abort(); });
  const checked = o.guard(source);
  if (checked.ok) {
    // Nahe der Kostengrenze erst nach einem Klick (der Kostenwert ist erst nach dem Bereiniger bekannt); die Marke fällt wieder, es wurde nichts gezeichnet.
    // Eine Freigabe im Panel oder in einem anderen Block mit demselben Text gilt auch hier (gleicher Zustand im Wächter).
    if (o.forced !== true && o.marks?.released(source) !== true && checked.cost >= (o.clickCost ?? CLICK_COST)) {
      ticket?.abort();
      return hold(o.t("block.costly", Math.round((checked.cost / COST_LIMIT) * 100)), o.t("block.show"), () => { o.marks?.release(source); });
    }
    const title = checked.svg.querySelector(":scope > title")?.textContent?.trim();
    const alt = title !== undefined && title !== "" ? title : o.t("block.alt");
    const img = wrap.createEl("img", { cls: "svg-studio-img", attr: { alt } });
    const natural = viewBoxWidth(checked.svg);
    if (natural !== null) img.setAttribute("width", natural);
    img.addEventListener("load", () => { ticket?.settle(); });
    img.addEventListener("error", () => { ticket?.abort(); });
    // Der Bereiniger hat ein führendes BOM abgetrennt (`bom`) und genau den Text ohne BOM geprüft: gezeichnet wird derselbe Text, nicht die Quelle mit BOM.
    img.setAttribute("src", binaryToDataUrl(new TextEncoder().encode(checked.bom === true ? source.slice(1) : source), "svg"));
    iconButton(wrap, "svg-studio-edit", "pencil", o.t("block.edit"), o.onEdit);
    return "image";
  }
  // Abgelehnt: es wird nichts gezeichnet, die Marke fällt (mit Lückenprüfung: hat der Bereiniger gehangen, bleibt sie).
  ticket?.abort();
  const box = wrap.createDiv({ cls: "svg-studio-error" });
  box.createEl("p", { cls: "svg-studio-error-head", text: o.t("block.rejected") });
  const list = box.createEl("ul");
  for (const p of distinctGuardProblems(checked.problems)) list.createEl("li", { text: guardProblemText(p, o.t) });
  const row = box.createDiv({ cls: "svg-studio-error-actions" });
  textButton(row, "svg-studio-repair mod-cta", o.t("block.repair"), o.onRepair);
  textButton(row, "svg-studio-edit-text", o.t("block.editShort"), o.onEdit);
  return "error";
}
