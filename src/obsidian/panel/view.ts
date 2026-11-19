// Das Panel als Seitenleisten-Ansicht (Spec § 7.2). Die Ansicht trägt nur, was Obsidian verlangt (Typ, Titel, Symbol, Auf- und Abbau); den Inhalt zeichnet der Rahmen
// des Kits (`buildPromptPanel`) mit den SVG-Slots aus `slots.ts`. Lauf, Sitzung und der halb getippte Auftrag liegen im Halter (`main.ts`, `createPromptPanelHost`) und
// überstehen das Schließen der Ansicht; jeder Zielwechsel geht an `host.offer`, auch bei geschlossener Ansicht.
import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import type { SvgSession } from "../../core/session";
import { getLang, panelStrings, t } from "../../i18n/strings";
import type { PanelHost } from "../../vendor/kit/panel-host";
import type { AcceptEnv } from "../../vendor/kit-obsidian/panel-accept";
import { buildPromptPanel, type PromptPanel, type PromptPanelDeps } from "../../vendor/kit-obsidian/prompt-panel";
import { VIEW_TYPE_SVG_STUDIO } from "../render-block";
import { commentDialog } from "./comment-dialog";
import { svgSlots, type SvgSlotDeps } from "./slots";

export interface SvgPanelDeps {
  app: App;
  host: PanelHost<SvgSession>;
  llm: PromptPanelDeps["llm"];
  thinking: PromptPanelDeps["thinking"];
  pluginId: string;
  /** Der Kit-`AcceptEnv` ohne `settings` und `choose`. */
  accept: Omit<AcceptEnv, "settings" | "choose">;
  readTargetText: PromptPanelDeps["readTargetText"];
  openSettings: PromptPanelDeps["openSettings"];
  thinkingOn: () => boolean;
  /** Hintergrund der Vorschau (Einstellung): lesen und speichern. */
  background: SvgSlotDeps["background"];
  /** Absturzmarken der Vorschau (Laufzeit-Schutz); ohne sie wird immer gezeichnet. */
  renderGuard?: SvgSlotDeps["renderGuard"];
  /** Der Kontext des Modells am Endpunkt (Token), `null` wenn er ihn nicht nennt: Verfeinern und Reparieren sperren eine Eingabe, die nicht passt. Ohne sie wird nicht geprüft. */
  contextLimit?: SvgSlotDeps["contextLimit"];
  acceptWays: NonNullable<SvgSlotDeps["acceptWays"]>;
}

export class SvgStudioView extends ItemView {
  private panel: PromptPanel | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly deps: SvgPanelDeps) {
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

  /** Testnaht und GUI-Smoke: die Sitzung, die der Halter hält (auch bei geschlossener Ansicht dieselbe). */
  state(): SvgSession {
    return this.deps.host.session();
  }

  /** Testnaht: wartet auf den laufenden Lauf, das Schreiben und eine laufende Vorschau. */
  settled(): Promise<void> {
    return this.panel?.settled() ?? Promise.resolve();
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("svg-studio-panel");
    const d = this.deps;
    const slots = svgSlots({
      llm: d.llm,
      readTargetText: d.readTargetText,
      thinkingOn: d.thinkingOn,
      background: d.background,
      acceptWays: d.acceptWays,
      ...(d.renderGuard === undefined ? {} : { renderGuard: d.renderGuard }),
      ...(d.contextLimit === undefined ? {} : { contextLimit: d.contextLimit }),
      comment: commentDialog(this.app),
    });
    this.panel = buildPromptPanel(this.contentEl, d.host, {
      app: d.app,
      lang: getLang(),
      llm: d.llm,
      thinking: d.thinking,
      readTargetText: d.readTargetText,
      openSettings: d.openSettings,
      pluginId: d.pluginId,
      accept: d.accept,
      strings: panelStrings(),
    }, slots);
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    const panel = this.panel;
    this.panel = null;
    if (panel === null) return Promise.resolve();
    // Obsidian wartet in `onClose` nicht auf eine Antwort und lässt sich das Schließen nicht verbieten. Läuft ein Lauf, bleibt alles beim Halter; sonst fragt der Rahmen bei
    // offenen Runden (Verwerfen oder Behalten), und der Dialog erreicht den Halter, nicht den schon abgebauten Rahmen. `destroy()` bricht keinen Lauf ab.
    void panel.requestClose();
    panel.destroy();
    return Promise.resolve();
  }

  /** Zeichnet die Modellzeile samt Denk-Steuerung aus dem Zustand neu (Modell, Endpunkt oder Stufe haben sich außerhalb geändert). */
  refreshModelBar(): void {
    this.panel?.refreshModelBar();
  }

  /** Wertet die Sperre von Übernehmen neu aus (die zuletzt aktive Notiz hat gewechselt). */
  refreshAccept(): void {
    this.panel?.refreshAccept();
  }

  /** Lädt die Modell-Liste der Zeile neu (der Endpunkt oder der Manager haben gewechselt). */
  reloadModels(): void {
    this.panel?.reloadModels();
  }
}
