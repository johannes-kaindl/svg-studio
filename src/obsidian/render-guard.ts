// Absturzmarke vor dem Rendern eines SVG (Kern: `src/core/render-guard.ts`, dauerhafter Speicher: `mark-store.ts`).
//
// Ablauf eines Bildes: `begin` schreibt die Marke (der Speicher stößt das dauerhafte Schreiben an, bevor der Aufrufer `src` setzt); nach `load` ruft er `settle`, und ein
// Timer-Wächter misst die Verspätung seiner Ticks. Verspätung über `SLOW_GAP_MS` oder Summe über `SLOW_SUM_MS` → die Marke wird `slow` und bleibt; `CALM_MS` Ruhe → sie fällt.
// Warum ein Wächter statt eines Ereignisses: `load` und zwei Frames liegen bei Raster-Kosten (Masken, Striche, Filter) VOR dem Hänger, gemessen im Opus-Review 2026-11-05.
//
// Was der Wächter nicht kann (so steht es im CHANGELOG): Hänger unter etwa einer Sekunde; Dauerlast, die in der Summe unter `SLOW_SUM_MS` bleibt; einen Hänger, der erst nach
// dem Wachfenster beginnt (CSS-Animation mit langer Verzögerung); ein Bild unterhalb des sichtbaren Bereichs, das erst beim Scrollen gezeichnet wird; gleichzeitig beobachtete
// Bilder trennen: eine Lücke trifft alle (ein teurer Block macht die harmlosen daneben zu `slow`, ein Klick auf „Trotzdem anzeigen“ löst das).
import { addMark, CALM_GAP_MS, CALM_MS, isBlocked, markSlow, MAX_WATCH_MS, removeMark, SLOW_GAP_MS, SLOW_MS, SLOW_SUM_MS, TICK_MS } from "../core/render-guard";
import { sha256HexUtf8 } from "../vendor/kit/sha256";
import type { MarkStore } from "./mark-store";

/** Eine laufende Anzeige: `settle` nach `load` (der Wächter beginnt), `abort`, wenn das Bild gar nicht erst gezeichnet wird (Ladefehler) oder der Block abgebaut wird. */
export interface RenderTicket {
  settle(): void;
  abort(): void;
}

/** Was der Wächter vom Fenster braucht (ein echtes `Window` erfüllt es); ohne `setTimeout` fällt die Marke sofort. */
export type GuardWindow = Pick<Window, "setTimeout" | "clearTimeout"> & {
  document?: { visibilityState?: string };
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
};

export interface RenderGuard {
  /** Steht für diesen SVG-Text eine Marke, die die Anzeige blockiert (frühere Sitzung oder `slow`)? */
  isMarked(text: string): boolean;
  /** Marke setzen, BEVOR das Bild eingesetzt wird; der Speicher stößt das dauerhafte Schreiben sofort an, die Marke steht, auch wenn der Hauptthread danach hängt. */
  begin(text: string, win: GuardWindow): RenderTicket;
  /** Marke löschen („Trotzdem anzeigen“). */
  clear(text: string): void;
}

/** Fenster-Ereignisse, bei denen ein Ticket endet (Popout geschlossen, Obsidian beendet): mit Lückenprüfung, wie `abort`. */
const GONE_EVENTS = ["pagehide", "beforeunload", "unload"] as const;

/** Monotone Uhr für die Lücken: `Date.now` springt (NTP, Standby, Handänderung) und machte jedes beobachtete Bild `slow`. */
const monotonic = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createRenderGuard(
  store: MarkStore,
  clock: () => number = monotonic,
  session: string = Math.random().toString(36).slice(2),
  wall: () => number = () => Date.now(),
): RenderGuard {
  /** Gerade beobachtete Bilder dieser Sitzung je Fingerabdruck: die Marke fällt erst, wenn das letzte fertig ist. */
  const inflight = new Map<string, number>();
  return {
    isMarked: (text) => isBlocked(store.read(), sha256HexUtf8(text), session, wall()),
    clear: (text) => { store.write(removeMark(store.read(), sha256HexUtf8(text))); },
    begin(text, win) {
      const fp = sha256HexUtf8(text);
      inflight.set(fp, (inflight.get(fp) ?? 0) + 1);
      store.write(addMark(store.read(), fp, wall(), session));
      const started = clock();
      let phase: "loading" | "watching" | "done" = "loading";
      let timer: number | null = null;
      /** Uhrzeit des letzten Ticks; die offene Lücke seither ist `clock() - last - TICK_MS`. */
      let last = started;
      let wasHidden = false;

      const finish = (slow: boolean): void => {
        if (phase === "done") return;
        phase = "done";
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        for (const e of GONE_EVENTS) win.removeEventListener?.(e, gone);
        const left = (inflight.get(fp) ?? 1) - 1;
        if (left > 0) inflight.set(fp, left);
        else inflight.delete(fp);
        const marks = store.read();
        if (slow) store.write(markSlow(marks, fp, wall(), session));
        // Nur die eigene Marke ohne `slow` fällt, und erst mit dem letzten Bild desselben Textes: eine `slow`-Marke und die einer früheren Sitzung bleiben.
        else if (left === 0) store.write(removeMark(marks, fp, session));
      };

      /** Ende ohne regulären Abschluss (Block abgebaut, Fenster zu): war seit dem letzten Tick ein Hänger offen, den der überfällige Timer noch nicht melden konnte, ist das Bild `slow`. */
      const end = (): void => {
        if (phase === "done") return;
        const open = phase === "loading" ? clock() - started > SLOW_MS : clock() - last - TICK_MS > SLOW_GAP_MS && !wasHidden && win.document?.visibilityState !== "hidden";
        finish(open);
      };
      const gone = (): void => { end(); };
      for (const e of GONE_EVENTS) win.addEventListener?.(e, gone);

      return {
        // Eingaben laufen nach einem Hänger VOR dem überfälligen Timer: der Abbau (Notizwechsel, Tab zu) ist die typische Reaktion auf ein eingefrorenes Fenster.
        abort: end,
        settle() {
          if (phase !== "loading") return;
          // Kam `load` selbst spät, war der Hänger vor dem Laden (Stilkosten): sofort `slow`.
          if (clock() - started > SLOW_MS) { finish(true); return; }
          if (typeof win.setTimeout !== "function") { finish(false); return; }
          phase = "watching";
          last = clock();
          let visibleMs = 0; // beobachtete Zeit bei sichtbarem Fenster: verdeckte Zeit zählt weder zur Ruhe noch zu `MAX_WATCH_MS`
          let calmFrom = 0; // Stand von `visibleMs`, ab dem der Hauptthread ruhig war
          let late = 0; // Summe der Verspätungen
          const tick = (): void => {
            if (phase !== "watching") return;
            const now = clock();
            const dt = now - last;
            const extra = dt - TICK_MS;
            last = now;
            const hidden = win.document?.visibilityState === "hidden";
            // Eine Lücke, die bei verdecktem Fenster begann, ist kein Hänger des Bildes (ein verdecktes Fenster zeichnet nicht).
            if (!hidden && !wasHidden) {
              visibleMs += dt;
              if (extra > 0) late += extra;
              if (extra > SLOW_GAP_MS || late >= SLOW_SUM_MS) { finish(true); return; }
              if (extra > CALM_GAP_MS) calmFrom = visibleMs;
            } else {
              calmFrom = visibleMs;
            }
            wasHidden = hidden;
            if (visibleMs - calmFrom >= CALM_MS || visibleMs >= MAX_WATCH_MS) { finish(false); return; }
            timer = win.setTimeout(tick, TICK_MS);
          };
          timer = win.setTimeout(tick, TICK_MS);
        },
      };
    },
  };
}
