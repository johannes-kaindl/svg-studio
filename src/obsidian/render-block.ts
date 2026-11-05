// ```svg-studio-Block als Bild (Spec § 5.3): in der Notiz läuft nie ein Skript, und kein `<style>` wirkt auf Obsidian, weil das SVG als `<img>` mit Data-URL
// steht. Es kommt NIE Markup aus dem Quelltext in den DOM: bei Ablehnung steht eine Liste der Probleme, kein Bild.
import { setIcon } from "obsidian";
import { binaryToDataUrl } from "../vendor/kit/data-url";
import type { checkSvg } from "../vendor/kit/svg-guard";
import type { T } from "../i18n/strings";
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

export function renderSvgBlock(source: string, el: HTMLElement, o: RenderBlockOptions): "image" | "held" | "error" {
  el.empty();
  const wrap = el.createDiv({ cls: "svg-studio-block" });
  const checked = o.guard(source);
  if (checked.ok) {
    const title = checked.svg.querySelector(":scope > title")?.textContent?.trim();
    const alt = title !== undefined && title !== "" ? title : o.t("block.alt");
    const win = el.ownerDocument.defaultView ?? window;
    // Die Marke steht, BEVOR das Bild eine `src` hat: das Zeichnen kann den Hauptthread blockieren, und eine danach gesetzte Marke käme zu spät.
    const mount = (): void => {
      wrap.empty();
      const img = wrap.createEl("img", { cls: "svg-studio-img", attr: { alt } });
      const ticket = o.marks?.begin(source, win);
      img.addEventListener("load", () => { ticket?.settle(); });
      img.addEventListener("error", () => { ticket?.abort(); });
      img.setAttribute("src", binaryToDataUrl(new TextEncoder().encode(source), "svg"));
      iconButton(wrap, "svg-studio-edit", "pencil", o.t("block.edit"), o.onEdit);
    };
    // Statt des Bildes ein Platzhalter mit einem Knopf: nach einer Absturzmarke oder bei ausgeschaltetem Notausschalter.
    const hold = (text: string, button: string, before: () => void): "held" => {
      const box = wrap.createDiv({ cls: "svg-studio-held" });
      box.createEl("p", { text });
      textButton(box, "svg-studio-show", button, () => { before(); mount(); });
      iconButton(wrap, "svg-studio-edit", "pencil", o.t("block.edit"), o.onEdit);
      return "held";
    };
    if (o.marks?.isMarked(source) === true) return hold(o.t("block.blocked"), o.t("block.showAnyway"), () => { o.marks?.clear(source); });
    if (o.autoShow !== undefined && !o.autoShow()) return hold(o.t("block.manual"), o.t("block.show"), () => undefined);
    mount();
    return "image";
  }
  const box = wrap.createDiv({ cls: "svg-studio-error" });
  box.createEl("p", { cls: "svg-studio-error-head", text: o.t("block.rejected") });
  const list = box.createEl("ul");
  for (const p of checked.problems) list.createEl("li", { text: o.t("block.problem", p.code, p.detail) });
  const row = box.createDiv({ cls: "svg-studio-error-actions" });
  textButton(row, "svg-studio-repair mod-cta", o.t("block.repair"), o.onRepair);
  textButton(row, "svg-studio-edit-text", o.t("block.editShort"), o.onEdit);
  return "error";
}
