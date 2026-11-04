import { getLanguage, Notice, Plugin, type TFile } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, type SvgStudioSettings } from "./core/settings";
import { initStrings, t } from "./i18n/strings";
import { installEmbedButtons } from "./obsidian/embed-button";
import { BLOCK_LANG, fileTarget, registerFileMenu, targetFromContext } from "./obsidian/entry";
import { SvgStudioView } from "./obsidian/panel-view";
import { renderSvgBlock, VIEW_TYPE_SVG_STUDIO } from "./obsidian/render-block";
import { SvgStudioSettingTab } from "./obsidian/settings-tab";
import type { Target } from "./vendor/kit/panel-session";
import { pickLang } from "./vendor/kit/i18n";
import { checkSvg } from "./vendor/kit/svg-guard";

export default class SvgStudioPlugin extends Plugin {
  settings: SvgStudioSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    // Sprache zuerst, vor dem ersten Befehl und Tab (UI-STANDARD § i18n).
    initStrings(pickLang(getLanguage()));
    const { settings } = loadSettings(await this.loadData());
    this.settings = settings;

    this.registerView(VIEW_TYPE_SVG_STUDIO, (leaf) => new SvgStudioView(leaf));
    this.addSettingTab(new SvgStudioSettingTab(this.app, this));

    this.addCommand({ id: "new-svg", name: t("cmd.new"), callback: () => { void this.openPanel({ kind: "new" }); } });
    this.addCommand({
      id: "edit-svg",
      name: t("cmd.edit"),
      checkCallback: (checking) => {
        const target = targetFromContext(this.app);
        if (target === null) return false;
        if (!checking) void this.openPanel(target);
        return true;
      },
    });

    // ```svg-studio-Block als Bild; Knopf und Reparatur öffnen das Panel auf dem Block.
    this.registerMarkdownCodeBlockProcessor(BLOCK_LANG, (source, el, ctx) => {
      const target = (): Target | null => {
        const info = ctx.getSectionInfo(el);
        if (info === null) return null;
        // Die Abschnitt-Zeilen sind die des Zauns (open bis close).
        return { kind: "block", path: ctx.sourcePath, lineStart: info.lineStart, lineEnd: info.lineEnd, label: `${ctx.sourcePath}:${String(info.lineStart + 1)}`, body: source };
      };
      const open = (): void => {
        const tg = target();
        if (tg === null) new Notice(t("notice.noTarget"));
        else void this.openPanel(tg);
      };
      renderSvgBlock(source, el, { guard: checkSvg, onEdit: open, onRepair: open, t });
    });

    installEmbedButtons(this, {
      resolve: (el) => {
        const src = el.getAttribute("src");
        if (src === null || !/\.svg(?:[#|?].*)?$/i.test(src)) return null;
        const file = this.app.metadataCache.getFirstLinkpathDest(src.replace(/[#|?].*$/, ""), this.app.workspace.getActiveFile()?.path ?? "");
        return file !== null && file.extension.toLowerCase() === "svg" ? file : null;
      },
      onEdit: (file: TFile) => { void this.openPanel(fileTarget(file)); },
      label: t("embed.edit"),
    });
    registerFileMenu(this, (file) => { void this.openPanel(fileTarget(file)); });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Das Panel öffnen (vorhandenes Blatt oder neues in der rechten Seitenleiste) und auf das Ziel setzen. */
  async openPanel(target: Target): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(VIEW_TYPE_SVG_STUDIO)[0] ?? workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_SVG_STUDIO, active: true });
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof SvgStudioView) leaf.view.setTarget(target);
  }
}
