// Das Panel als Seitenleisten-Ansicht (Spec § 7.2). Die Ansicht trägt nur, was Obsidian verlangt (Typ, Titel, Symbol, Auf- und Abbau);
// der Inhalt kommt vom formatneutralen Kern `shell.ts` mit den SVG-Slots aus `slots.ts`.
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { SvgSession } from "../../core/session";
import { panelStrings, t } from "../../i18n/strings";
import type { Target } from "../../vendor/kit/panel-session";
import { VIEW_TYPE_SVG_STUDIO } from "../render-block";
import { commentDialog } from "./comment-dialog";
import { buildPanelShell, type PanelDeps, type PanelShell } from "./shell";
import { svgSlots, type SvgSlotDeps } from "./slots";

export type SvgPanelDeps = Omit<PanelDeps<SvgSession>, "strings"> & {
  thinkingOn: () => boolean;
  /** Hintergrund der Vorschau (Einstellung): lesen und speichern. */
  background: SvgSlotDeps["background"];
  /** Absturzmarken der Vorschau (Laufzeit-Schutz); ohne sie wird immer gezeichnet. */
  renderGuard?: SvgSlotDeps["renderGuard"];
  /** Hält die Sitzung eines geschlossenen Panels, wenn der Nutzer die Runden behalten wollte; das nächste Panel nimmt sie wieder auf. */
  stash: { take: () => SvgSession | null; put: (s: SvgSession | null) => void };
};

export class SvgStudioView extends ItemView {
  private shell: PanelShell<SvgSession> | null = null;
  /** Ein Ziel, das vor dem Aufbau kam (`openPanel` setzt es, sobald das Blatt da ist). */
  private target: Target | null = null;

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

  /** Das Ziel anbieten (siehe `PanelShell.setTarget`). */
  setTarget(target: Target): void {
    if (this.shell === null) this.target = target;
    else this.shell.setTarget(target);
  }

  getTarget(): Target {
    return this.shell?.session().target ?? this.target ?? { kind: "new" };
  }

  state(): SvgSession | null {
    return this.shell?.session() ?? null;
  }

  /** Testnaht: wartet auf den laufenden Lauf. */
  settled(): Promise<void> {
    return this.shell?.settled() ?? Promise.resolve();
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("svg-studio-panel");
    const { thinkingOn, background, stash, renderGuard, ...rest } = this.deps;
    const slots = svgSlots({ llm: this.deps.llm, readTargetText: this.deps.readTargetText, thinkingOn, background, ...(renderGuard === undefined ? {} : { renderGuard }), comment: commentDialog(this.app) });
    this.shell = buildPanelShell(this.contentEl, { ...rest, strings: panelStrings() }, slots, stash.take() ?? undefined);
    if (this.target !== null) this.shell.setTarget(this.target);
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    const shell = this.shell;
    this.shell = null;
    if (shell === null) return;
    // Obsidian wartet in `onClose` nicht auf eine Antwort und lässt sich das Schließen nicht verbieten: „Behalten“ merkt die Sitzung im Plugin,
    // das nächste Panel nimmt sie wieder auf (Spec § 7.2: Schließen mit offenen Runden fragt per Bestätigung).
    const drop = await shell.requestClose();
    this.deps.stash.put(drop ? null : shell.session());
    shell.destroy();
  }

  /** Zeichnet die Modellzeile samt Denk-Steuerung aus dem Zustand neu (Modell, Endpunkt oder Stufe haben sich außerhalb geändert). */
  refreshModelBar(): void {
    this.shell?.refreshModelBar();
  }

  /** Wertet die Sperre von Übernehmen neu aus (die zuletzt aktive Notiz hat gewechselt). */
  refreshAccept(): void {
    this.shell?.refreshAccept();
  }

  /** Lädt die Modell-Liste der Zeile neu (der Endpunkt oder der Manager haben gewechselt). */
  reloadModels(): void {
    this.shell?.reloadModels();
  }
}
