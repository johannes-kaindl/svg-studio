// Das Panel als Seitenleisten-Ansicht. Heute die Hülle: Ziel halten und anzeigen; Inhalt (Modellzeile, Vorschau, Prompt, Prüfliste) kommt mit C2.
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Target } from "../vendor/kit/panel-session";
import { t } from "../i18n/strings";
import { VIEW_TYPE_SVG_STUDIO } from "./render-block";

export class SvgStudioView extends ItemView {
  private target: Target = { kind: "new" };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SVG_STUDIO;
  }

  getDisplayText(): string {
    return t("panel.title");
  }

  getIcon(): string {
    return "image";
  }

  getTarget(): Target {
    return this.target;
  }

  setTarget(target: Target): void {
    this.target = target;
    this.render();
  }

  onOpen(): Promise<void> {
    this.render();
    return Promise.resolve();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("svg-studio-panel");
    const label = this.target.kind === "new" ? t("panel.targetNew") : t("panel.targetEdit", this.target.label);
    root.createDiv({ cls: "svg-studio-target", text: label });
    root.createEl("p", { cls: "svg-studio-soon", text: t("panel.soon") });
  }
}
