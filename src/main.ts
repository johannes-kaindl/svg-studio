import { getLanguage, MarkdownRenderChild, MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, type SvgStudioSettings } from "./core/settings";
import { getLang, initStrings, t } from "./i18n/strings";
import type { SvgSession } from "./core/session";
import { acceptBlockReason, acceptSvgSession, buildAcceptEnv, firstPromptLineOf } from "./obsidian/accept";
import { installEmbedButtons } from "./obsidian/embed-button";
import { BLOCK_LANG, fileTarget, registerFileMenu, targetFromContext } from "./obsidian/entry";
import { SvgStudioView } from "./obsidian/panel/view";
import { readTargetText } from "./obsidian/read-target";
import { renderSvgBlock, VIEW_TYPE_SVG_STUDIO } from "./obsidian/render-block";
import { appMarkStore, createRenderGuard } from "./obsidian/render-guard";
import { SvgStudioSettingTab } from "./obsidian/settings-tab";
import type { Target } from "./vendor/kit/panel-session";
import { pickLang } from "./vendor/kit/i18n";
import { checkSvg } from "./vendor/kit/svg-guard";
import { onLevelFor, thinkingFor, withThinkingLevel, type ThinkingLevel } from "./vendor/kit/sampling-profiles";
import { findEndpointManager, onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { createLlmConnection, type LlmConnection } from "./vendor/kit-obsidian/llm-connection";
import { obsidianWritePorts } from "./vendor/kit-obsidian/write-ports";

export default class SvgStudioPlugin extends Plugin {
  settings: SvgStudioSettings = DEFAULT_SETTINGS;
  /** Die LLM-Anbindung (Endpunkt-Quelle, Modelle, Anfragen, Einstellungs-Abschnitt). */
  llm!: LlmConnection;
  /** Die Sitzung eines geschlossenen Panels, deren Runden der Nutzer behalten wollte. */
  private stashed: SvgSession | null = null;

  async onload(): Promise<void> {
    // Sprache zuerst, vor dem ersten Befehl und Tab (UI-STANDARD § i18n).
    initStrings(pickLang(getLanguage()));
    const { settings } = loadSettings(await this.loadData());
    this.settings = settings;

    // Sampling wie in der Messung (Plan 2, Entscheidung 2): Modus `transform` (Temperatur 0,2, Denken aus als Vorgabe), `max_tokens` 16384.
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: "svg-studio",
      capability: "chat",
      mode: "transform",
      maxTokens: 16384,
      lang: () => getLang(),
      getSettings: () => ({ endpoints: this.settings.llm.endpoints, choice: this.settings.llm.choice, request: this.settings.llm.request }),
      // Patch ZUERST übernehmen, dann speichern: die Verbindung prüft das (Kit MIGRATION 0.49.0).
      persist: (patch) => {
        if (patch.endpoints !== undefined) this.settings.llm.endpoints = patch.endpoints;
        if (patch.choice !== undefined) this.settings.llm.choice = patch.choice;
        if (patch.request !== undefined) this.settings.llm.request = patch.request;
        // Modell, Endpunkt oder Denkstufe haben sich geändert (auch im Einstellungen-Tab): die Modellzeile des Panels zieht nach.
        this.refreshPanels();
        return this.saveSettings();
      },
    });
    // Der Manager kommt, geht oder wechselt den Endpunkt: frisch auflösen, die Modellzeile eines offenen Panels lädt ihre Liste neu.
    this.register(onEndpointManagerChanged(this.app, () => {
      this.llm.invalidate();
      void this.llm.resolve().catch(() => undefined).then(() => { for (const v of this.panels()) v.reloadModels(); });
    }));

    this.registerView(VIEW_TYPE_SVG_STUDIO, (leaf) => new SvgStudioView(leaf, {
      app: this.app,
      llm: this.llm,
      thinking: {
        family: () => this.llm.source().family,
        backend: () => this.llm.source().backend,
        current: () => thinkingFor(this.settings.llm.request, "transform"),
        onLevel: () => onLevelFor(this.settings.llm.request, "transform"),
        levelPicker: () => this.settings.llm.request.levelPickerInChat,
        // Dieselbe Schreibregel wie die Einstellungen (Kit `withThinkingLevel`).
        setLevel: async (level: ThinkingLevel) => {
          this.settings.llm.request = withThinkingLevel(this.settings.llm.request, "transform", level);
          await this.saveSettings();
          this.refreshPanels();
        },
      },
      thinkingOn: () => thinkingFor(this.settings.llm.request, "transform") !== "off",
      // Die letzte Stellung bleibt gespeichert (Spec § 7.3); sie betrifft nur die Vorschau.
      background: { get: () => this.settings.background, set: (s) => { this.settings.background = s; void this.saveSettings(); } },
      renderGuard: this.renderGuard,
      readTargetText: (target) => readTargetText(this.app, target),
      // Übernehmen: Kit `panel-accept` und `block-writer`, davor ein Schnappschuss der Datei und `checkSvg` auf dem fertigen Text (Spec § 3 Punkt 4, § 7.6).
      accept: (session) => acceptSvgSession(this.acceptEnv(), session, { guard: checkSvg, firstPromptLine: firstPromptLineOf(session), pluginId: this.manifest.id }),
      acceptBlockedReason: (session) => acceptBlockReason(session, this.settings.acceptAs, this.lastEditor() !== null),
      openSettings: () => {
        // Interne API: fehlt sie, sagt eine Notice, wo die Einstellungen stehen, statt zu werfen.
        const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
        if (setting === undefined) {
          new Notice(t("panel.settingsFallback"));
          return;
        }
        setting.open();
        setting.openTabById(this.manifest.id);
      },
      confirm: (message, labels) => confirmAction(this.app, { message, confirmLabel: labels.confirm, cancelLabel: labels.cancel }),
      managerPresent: () => findEndpointManager(this.app) !== null,
      stash: { take: () => { const s = this.stashed; this.stashed = null; return s; }, put: (s) => { this.stashed = s; } },
    }));
    this.addSettingTab(new SvgStudioSettingTab(this.app, this));
    // Die zuletzt aktive Notiz bestimmt, ob ein Codeblock möglich ist: das Panel wertet die Sperre von Übernehmen neu aus, wenn das Blatt wechselt.
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file !== null) this.lastMarkdown = leaf.view;
      for (const v of this.panels()) v.refreshAccept();
    }));

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
      renderSvgBlock(source, el, { guard: checkSvg, onEdit: open, onRepair: open, t, marks: this.renderGuard, autoShow: () => this.settings.autoShow, onDispose: (cleanup) => { const child = new MarkdownRenderChild(el); child.onunload = cleanup; ctx.addChild(child); } });
    });

    installEmbedButtons(this, {
      resolve: (el) => {
        const src = el.getAttribute("src");
        if (src === null || !/\.svg(?:[#|?].*)?$/i.test(src)) return null;
        const file = this.app.metadataCache.getFirstLinkpathDest(src.replace(/[#|?].*$/, ""), this.sourcePathOf(el));
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

  /** Die zuletzt bediente Notiz: das zuletzt benutzte Blatt der Hauptfläche (`rootSplit`), nicht das aktive, denn beim Übernehmen hat das Panel den Fokus und liegt in der
   *  Seitenleiste (REGISTRY „Panel-Aktionen brauchen den Editor aus dem rootSplit“). Quell- und Lesemodus zählen beide. */
  private lastEditor(): MarkdownView | null {
    const { workspace } = this.app;
    // Zuerst die zuletzt aktive Notiz, in welchem Fenster auch immer (ein Popout liegt nicht im `rootSplit`); nur, solange ihre Ansicht noch offen ist.
    const seen = this.lastMarkdown;
    if (seen !== null && seen.file !== null) {
      let open = false;
      workspace.iterateAllLeaves((leaf) => { if (leaf.view === seen) open = true; });
      if (open) return seen;
    }
    const recent = workspace.getMostRecentLeaf(workspace.rootSplit)?.view;
    return recent instanceof MarkdownView && recent.file !== null ? recent : null;
  }

  /** Absturzmarken für Block und Panel-Vorschau (App-lokaler Speicher, für alle Fenster gemeinsam). */
  private readonly renderGuard = createRenderGuard(appMarkStore(this.app));

  /** Die zuletzt aktive Notiz-Ansicht, fensterübergreifend (das Panel selbst ist keine). */
  private lastMarkdown: MarkdownView | null = null;

  /** Die Notiz, in der die Einbettung steht (für relative Links): das Blatt, dessen Ansicht sie enthält; sonst die aktive Datei. Nicht die aktive Datei allein: eine Einbettung im zweiten Bereich, in einer Hover-Vorschau oder in einem Popout gehört einer anderen Notiz. */
  private sourcePathOf(el: HTMLElement): string {
    let found = "";
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (found === "" && view instanceof MarkdownView && view.file !== null && view.containerEl.contains(el)) found = view.file.path;
    });
    return found !== "" ? found : (this.app.workspace.getActiveFile()?.path ?? "");
  }

  private acceptEnv() {
    return buildAcceptEnv({ app: this.app, ports: obsidianWritePorts(this.app), settings: () => this.settings, lastEditor: () => this.lastEditor() });
  }

  private panels(): SvgStudioView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_SVG_STUDIO).flatMap((leaf) => (leaf.view instanceof SvgStudioView ? [leaf.view] : []));
  }

  private refreshPanels(): void {
    for (const v of this.panels()) v.refreshModelBar();
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
