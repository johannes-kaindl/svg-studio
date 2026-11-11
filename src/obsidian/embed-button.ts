// Knopf „In SVG Studio bearbeiten“ an eingebetteten `.svg`-Dateien (Spec § 7.1). Obsidian zeigt die Einbettung selbst; das Plugin hängt nur einen Knopf an.
// Ein Beobachter je Fenster (Hauptfenster und Popouts, Review-Fokus 3 des Plans): die Einbettung entsteht erst beim Rendern, und im Live Preview baut Obsidian
// sie bei jeder Zeilenänderung neu. Der Knopf trägt `data-svg-studio-button`, damit eine erneute Mutation keinen zweiten anhängt.
import { setIcon, type Plugin, type TFile, type Workspace } from "obsidian";

export interface EmbedButtonOptions {
  /** Die Datei, auf die die Einbettung zeigt, wenn sie eine `.svg` ist; sonst `null`. */
  resolve(el: HTMLElement): TFile | null;
  onEdit(file: TFile): void;
  /** Zugänglicher Name des Knopfs. */
  label: string;
  /** Die Dokumente, die schon offen sind (Standard: `openDocuments`, Hauptfenster und Popouts mit offenen Blättern). Neue Fenster melden sich über `window-open`. */
  documents?: () => Document[];
}

const EMBED_SELECTOR = ".internal-embed.image-embed";
const MARK = "data-svg-studio-button";

function decorate(embed: HTMLElement, o: EmbedButtonOptions): void {
  if (embed.querySelector(`[${MARK}]`) !== null) return;
  if (o.resolve(embed) === null) return;
  const b = embed.createEl("button", { cls: "clickable-icon svg-studio-embed-button", attr: { [MARK]: "1", type: "button", "aria-label": o.label } });
  setIcon(b, "pencil");
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // Beim Klick neu auflösen: Obsidian setzt `src` an einem schon dekorierten Element um, und die Datei von vorhin wäre die falsche.
    const file = o.resolve(embed);
    if (file !== null) o.onEdit(file);
  });
}

function scan(root: HTMLElement, o: EmbedButtonOptions): void {
  if (root.instanceOf(HTMLElement) && root.matches(EMBED_SELECTOR)) decorate(root, o);
  root.querySelectorAll<HTMLElement>(EMBED_SELECTOR).forEach((e) => { decorate(e, o); });
}

/** Beobachter an einem Dokument; die Rücknahme trennt ihn. */
function watch(doc: Document, o: EmbedButtonOptions): () => void {
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => { if (n.instanceOf(HTMLElement)) scan(n, o); });
      // Obsidian setzt `src` erst nach dem Einfügen der Einbettung.
      if (r.type === "attributes" && r.target.instanceOf(HTMLElement)) scan(r.target, o);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  scan(doc.body, o);
  return () => { observer.disconnect(); };
}

/** Hauptfenster und jedes Fenster, in dem ein Blatt offen ist (Popouts); ohne `iterateAllLeaves` nur das aktive Dokument. Ohne diese Liste fehlten die Knöpfe in einem Popout, das beim Einschalten des Plugins schon offen war. */
export function openDocuments(workspace: Workspace): Document[] {
  const docs = new Set<Document>([activeDocument]);
  if (typeof workspace.iterateAllLeaves === "function") {
    workspace.iterateAllLeaves((leaf) => {
      // Ein Blatt, dessen Ansicht noch nicht geladen ist, hat nicht in jedem Zustand ein Wurzelelement.
      const doc = (leaf.view as { containerEl?: { ownerDocument?: Document } } | undefined)?.containerEl?.ownerDocument;
      if (doc !== undefined) docs.add(doc);
    });
  }
  return [...docs];
}

export function installEmbedButtons(plugin: Plugin, o: EmbedButtonOptions): void {
  const stops = new Map<Document, () => void>();
  const add = (doc: Document): void => {
    if (!stops.has(doc)) stops.set(doc, watch(doc, o));
  };
  for (const d of (o.documents ?? (() => openDocuments(plugin.app.workspace)))()) add(d);
  // Popout-Fenster: der Beobachter des Hauptfensters sieht ihre Einbettungen nicht.
  plugin.registerEvent(plugin.app.workspace.on("window-open", (_win, window) => { add(window.document); }));
  plugin.registerEvent(plugin.app.workspace.on("window-close", (_win, window) => {
    stops.get(window.document)?.();
    stops.delete(window.document);
  }));
  plugin.register(() => {
    for (const stop of stops.values()) stop();
    stops.clear();
  });
}
