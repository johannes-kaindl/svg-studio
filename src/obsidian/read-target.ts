// Der Text des Ziels JETZT (Spec § 6.3: jede Runde setzt auf dem aktuellen Text auf, nicht auf einem gespeicherten).
import { TFile, type App } from "obsidian";
import type { Target } from "../vendor/kit/panel-session";
import { readBlockText } from "../vendor/kit-obsidian/panel-accept";
import { obsidianWritePorts } from "../vendor/kit-obsidian/write-ports";
import { BLOCK_LANG } from "./entry";

/** `null`: das Ziel hat keinen Text (neues SVG, Anzeige ohne Änderung) oder ist weg bzw. verändert (Block verschoben, Datei gelöscht). Wirft nie. */
export async function readTargetText(app: App, target: Target): Promise<string | null> {
  try {
    switch (target.kind) {
      case "file": {
        const file = app.vault.getAbstractFileByPath(target.path);
        return file instanceof TFile ? await app.vault.read(file) : null;
      }
      case "block":
        return await readBlockText(obsidianWritePorts(app), target, BLOCK_LANG);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
