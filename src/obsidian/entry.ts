// Einstiege (Spec § 7.1): welche Stelle meint der Nutzer, wenn er „SVG bearbeiten“ wählt? Die aktive `.svg`-Datei; sonst im Quellmodus der Block am
// Cursor oder die `![[….svg]]`-Einbettung am Cursor. Im Lesemodus gibt es keinen Cursor (und `view.editor` zeigt dort nicht den angezeigten Puffer):
// dort ist die Antwort `null`, der Weg läuft über den Knopf am Block bzw. an der Einbettung.
import { MarkdownView, TFile, type App, type Plugin } from "obsidian";
import type { Target } from "../vendor/kit/panel-session";
import { findFenceAt } from "../vendor/kit/fence-scan";
import { t } from "../i18n/strings";

export const BLOCK_LANG = "svg-studio";

const EMBED = /!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

function isSvg(file: unknown): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() === "svg";
}

export function fileTarget(file: TFile): Target {
  return { kind: "file", path: file.path, label: file.name };
}

export function targetFromContext(app: App): Target | null {
  const active = app.workspace.getActiveFile();
  if (isSvg(active)) return fileTarget(active);
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const note = view?.file;
  if (!view || !note || view.getMode() !== "source") return null;
  const editor = view.editor;
  const cursor = editor.getCursor();
  const fence = findFenceAt(editor.getValue(), cursor.line);
  if (fence !== null && fence.lang === BLOCK_LANG) {
    return { kind: "block", path: note.path, lineStart: fence.openLine, lineEnd: fence.closeLine, label: `${note.basename}:${String(fence.openLine + 1)}`, body: fence.body };
  }
  const line = editor.getLine(cursor.line);
  for (const m of line.matchAll(EMBED)) {
    const from = m.index;
    if (cursor.ch < from || cursor.ch > from + m[0].length) continue;
    const file = app.metadataCache.getFirstLinkpathDest(m[1]?.trim() ?? "", note.path);
    if (isSvg(file)) return fileTarget(file);
  }
  return null;
}

/** „SVG bearbeiten“ im Kontextmenü einer `.svg`-Datei (Dateiexplorer, Tab). */
export function registerFileMenu(plugin: Plugin, onEdit: (file: TFile) => void): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!isSvg(file)) return;
      menu.addItem((item) => item.setTitle(t("menu.edit")).setIcon("pencil").onClick(() => { onEdit(file); }));
    }),
  );
}
