// Absturzmarke vor dem Rendern eines SVG (Kern: `src/core/render-guard.ts`). Der Speicher ist der App-lokale Speicher von Obsidian (`app.loadLocalStorage`):
// er gilt für alle Fenster (Popouts) derselben Installation und überlebt einen Neustart. Gelesen wird bei jedem Zugriff frisch, weil ein anderes Fenster
// inzwischen eine Marke gesetzt oder gelöscht haben kann.
import type { App } from "obsidian";
import { addMark, CALM_GAP_MS, CALM_MS, isBlocked, markSlow, MAX_WATCH_MS, parseMarks, removeMark, SLOW_GAP_MS, SLOW_MS, TICK_MS, type Mark } from "../core/render-guard";
import { sha256HexUtf8 } from "../vendor/kit/sha256";

export const MARKS_KEY = "svg-studio:render-marks";

export interface MarkStore {
  read(): unknown;
  write(marks: Mark[]): void;
}

/** Eine laufende Anzeige: `settle` nach `load` (der Wächter beginnt), `abort`, wenn das Bild gar nicht erst gezeichnet wird (Ladefehler) oder der Block abgebaut wird. */
export interface RenderTicket {
  settle(): void;
  abort(): void;
}

/** Was der Wächter vom Fenster braucht (ein echtes `Window` erfüllt es); ohne `setTimeout` fällt die Marke sofort. */
export type GuardWindow = Pick<Window, "setTimeout" | "clearTimeout"> & { document?: { visibilityState?: string } };

export interface RenderGuard {
  /** Steht für diesen SVG-Text eine Marke, die die Anzeige blockiert (frühere Sitzung oder `slow`)? */
  isMarked(text: string): boolean;
  /** Marke setzen, BEVOR das Bild eingesetzt wird; der Speicher schreibt synchron, die Marke steht, auch wenn der Hauptthread danach hängt. */
  begin(text: string, win: GuardWindow): RenderTicket;
  /** Marke löschen („Trotzdem anzeigen“). */
  clear(text: string): void;
}

export function createRenderGuard(store: MarkStore, clock: () => number = () => Date.now(), session: string = Math.random().toString(36).slice(2)): RenderGuard {
  const load = (): Mark[] => parseMarks(store.read());
  /** Gerade beobachtete Bilder dieser Sitzung je Fingerabdruck: die Marke fällt erst, wenn das letzte fertig ist. */
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
      let phase: "loading" | "watching" | "done" = "loading";
      let timer: number | null = null;
      const finish = (slow: boolean): void => {
        if (phase === "done") return;
        phase = "done";
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        const left = (inflight.get(fp) ?? 1) - 1;
        if (left > 0) inflight.set(fp, left);
        else inflight.delete(fp);
        const marks = load();
        if (slow) store.write(markSlow(marks, fp, clock(), session));
        // Eine `slow`-Marke bleibt auch, wenn ein anderes Bild mit demselben Text ruhig fertig wird; sonst fällt die Marke mit dem letzten Bild.
        else if (left === 0 && !marks.some((m) => m.fp === fp && m.slow === true)) store.write(removeMark(marks, fp));
      };
      return {
        // Abbruch ohne beobachteten Hänger (Ladefehler, Block abgebaut, Notizwechsel): die Marke fällt; war schon ein Hänger gesehen, ist `finish(true)` gelaufen und tut dies nicht mehr.
        abort() { finish(false); },
        settle() {
          if (phase !== "loading") return;
          // Kam `load` selbst spät, war der Hänger vor dem Laden (Stilkosten): sofort `slow`.
          if (clock() - started > SLOW_MS) { finish(true); return; }
          if (typeof win.setTimeout !== "function") { finish(false); return; }
          phase = "watching";
          const t0 = clock();
          let last = t0;
          let calmSince = t0;
          const tick = (): void => {
            if (phase !== "watching") return;
            const now = clock();
            const extra = now - last - TICK_MS;
            const hidden = win.document?.visibilityState === "hidden";
            last = now;
            // Ein verdecktes Fenster drosselt Timer: eine Verspätung dort ist kein Hänger des Bildes.
            if (!hidden) {
              if (extra > SLOW_GAP_MS) { finish(true); return; }
              if (extra > CALM_GAP_MS) calmSince = now;
            } else calmSince = now;
            if (now - calmSince >= CALM_MS || now - t0 >= MAX_WATCH_MS) { finish(false); return; }
            timer = win.setTimeout(tick, TICK_MS);
          };
          timer = win.setTimeout(tick, TICK_MS);
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
