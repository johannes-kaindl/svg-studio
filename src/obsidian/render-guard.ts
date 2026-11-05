// Absturzmarke vor dem Rendern eines SVG (Kern: `src/core/render-guard.ts`). Der Speicher ist der App-lokale Speicher von Obsidian (`app.loadLocalStorage`):
// er gilt für alle Fenster (Popouts) derselben Installation und überlebt einen Neustart. Gelesen wird bei jedem Zugriff frisch, weil ein anderes Fenster
// inzwischen eine Marke gesetzt oder gelöscht haben kann.
import type { App } from "obsidian";
import { addMark, isBlocked, markSlow, parseMarks, removeMark, SLOW_MS, type Mark } from "../core/render-guard";
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

export function createRenderGuard(store: MarkStore, clock: () => number = () => Date.now(), session: string = Math.random().toString(36).slice(2)): RenderGuard {
  const load = (): Mark[] => parseMarks(store.read());
  /** Gerade gezeichnete Bilder dieser Sitzung je Fingerabdruck: die Marke fällt erst, wenn das letzte fertig ist. */
  const inflight = new Map<string, number>();
  return {
    isMarked: (text) => isBlocked(load(), sha256HexUtf8(text), session),
    clear: (text) => {
      const fp = sha256HexUtf8(text);
      store.write(removeMark(load(), fp));
    },
    begin(text, win) {
      const fp = sha256HexUtf8(text);
      inflight.set(fp, (inflight.get(fp) ?? 0) + 1);
      store.write(addMark(load(), fp, clock(), session));
      const started = clock();
      let done = false;
      const finish = (slow: boolean): void => {
        const left = (inflight.get(fp) ?? 1) - 1;
        if (left > 0) inflight.set(fp, left);
        else inflight.delete(fp);
        const marks = load();
        if (slow) store.write(markSlow(marks, fp, clock(), session));
        // Eine `slow`-Marke bleibt auch, wenn ein anderes Bild mit demselben Text schnell fertig wird; sonst fällt die Marke mit dem letzten Bild.
        else if (left === 0 && !marks.some((m) => m.fp === fp && m.slow === true)) store.write(removeMark(marks, fp));
      };
      return {
        abort() {
          if (done) return;
          done = true;
          finish(false);
        },
        settle() {
          if (done) return;
          done = true;
          // `load` heißt: dekodiert. Gezeichnet ist das Bild erst nach dem nächsten Frame; hängt der Hauptthread dort, kommt dieser Rückruf nie, und die Marke bleibt.
          // Kommt er spät (Obsidian erholt sich nach Sekunden), wird sie zur `slow`-Marke: ein Bild, das so lange braucht, zeigt das Plugin nicht von selbst.
          const end = (): void => { finish(clock() - started > SLOW_MS); };
          if (typeof win.requestAnimationFrame !== "function") end();
          else win.requestAnimationFrame(() => { win.requestAnimationFrame(end); });
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
