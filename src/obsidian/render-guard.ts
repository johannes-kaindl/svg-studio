// Absturzmarke vor dem Rendern eines SVG (Kern: `src/core/render-guard.ts`). Der Speicher ist der App-lokale Speicher von Obsidian (`app.loadLocalStorage`):
// er gilt für alle Fenster (Popouts) derselben Installation und überlebt einen Neustart. Gelesen wird bei jedem Zugriff frisch, weil ein anderes Fenster
// inzwischen eine Marke gesetzt oder gelöscht haben kann.
import type { App } from "obsidian";
import { addMark, isMarked, parseMarks, removeMark, SLOW_MS, type Mark } from "../core/render-guard";
import { sha256HexUtf8 } from "../vendor/kit/sha256";

export const MARKS_KEY = "svg-studio:render-marks";

export interface MarkStore {
  read(): unknown;
  write(marks: Mark[]): void;
}

/** Eine laufende Anzeige: `settle` nach `load`, `abort`, wenn das Bild gar nicht erst gezeichnet wird (Ladefehler, Element entfernt). */
export interface RenderTicket {
  settle(): void;
  abort(): void;
}

export interface RenderGuard {
  /** Steht für diesen SVG-Text eine Marke? */
  isMarked(text: string): boolean;
  /** Marke setzen, BEVOR das Bild eingesetzt wird; der Speicher schreibt synchron, die Marke steht, auch wenn der Hauptthread danach hängt. */
  begin(text: string, win: Window): RenderTicket;
  /** Marke löschen („Trotzdem anzeigen“). */
  clear(text: string): void;
}

export function createRenderGuard(store: MarkStore, clock: () => number = () => Date.now()): RenderGuard {
  const load = (): Mark[] => parseMarks(store.read());
  return {
    isMarked: (text) => isMarked(load(), sha256HexUtf8(text)),
    clear: (text) => { store.write(removeMark(load(), sha256HexUtf8(text))); },
    begin(text, win) {
      const fp = sha256HexUtf8(text);
      store.write(addMark(load(), fp, clock()));
      const started = clock();
      let done = false;
      const drop = (): void => { store.write(removeMark(load(), fp)); };
      return {
        abort() {
          if (done) return;
          done = true;
          drop();
        },
        settle() {
          if (done) return;
          done = true;
          // `load` heißt: dekodiert. Gezeichnet ist das Bild erst nach dem nächsten Frame; hängt der Hauptthread dort, kommt dieser Rückruf nie, und die Marke bleibt.
          // Kommt er spät (Obsidian erholt sich nach Sekunden), bleibt sie auch: ein Bild, das so lange braucht, zeigt das Plugin nicht von selbst.
          const finish = (): void => { if (clock() - started <= SLOW_MS) drop(); };
          if (typeof win.requestAnimationFrame !== "function") finish();
          else win.requestAnimationFrame(() => { win.requestAnimationFrame(finish); });
        },
      };
    },
  };
}

/** Speicher auf `app.loadLocalStorage`/`saveLocalStorage`; Fehler des Speichers sind kein Grund, das Bild zu verweigern (Lesen: keine Marke, Schreiben: ohne Schutz). */
export function appMarkStore(app: App): MarkStore {
  return {
    read: (): unknown => { try { return app.loadLocalStorage(MARKS_KEY) as unknown; } catch { return null; } },
    write: (marks) => { try { app.saveLocalStorage(MARKS_KEY, marks.length === 0 ? null : marks); } catch { /* ohne Speicher kein Schutz, aber auch kein Absturz */ } },
  };
}
