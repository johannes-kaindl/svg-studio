// Absturzmarke vor dem Rendern eines SVG (Kern: `src/core/render-guard.ts`, dauerhafter Speicher: `mark-store.ts`).
//
// Ablauf eines Bildes: `begin` schreibt die Marke (der Speicher stößt das dauerhafte Schreiben an, bevor der Aufrufer `src` setzt); nach `load` ruft er `settle`, und ein
// Timer-Wächter misst die Verspätung seiner Ticks. Verspätung über `SLOW_GAP_MS` oder Dauerlast (Anteil verspäteter Zeit über `SLOW_LOAD_RATIO`) → die Marke wird `slow` und bleibt; `CALM_MS` Ruhe → sie fällt.
// Warum ein Wächter statt eines Ereignisses: `load` und zwei Frames liegen bei Raster-Kosten (Masken, Striche, Filter) VOR dem Hänger, gemessen im Opus-Review 2026-11-05.
//
// Was der Wächter nicht kann (so steht es im CHANGELOG): Hänger unter etwa einer Sekunde; Dauerlast unter etwa 35 % verspäteter Zeit; einen Hänger, der erst nach
// dem Wachfenster beginnt (CSS-Animation mit langer Verzögerung); ein Bild unterhalb des sichtbaren Bereichs, das erst beim Scrollen gezeichnet wird; gleichzeitig beobachtete
// Bilder trennen: eine Lücke trifft alle (ein teurer Block macht die harmlosen daneben zu `slow`, ein Klick auf „Trotzdem anzeigen“ löst das).
import { addMark, CALM_GAP_MS, CALM_MS, isBlocked, markSlow, MAX_WATCH_MS, removeMark, SLOW_GAP_MS, SLOW_LOAD_FROM_MS, SLOW_LOAD_RATIO, SLOW_MS, TICK_MS } from "../core/render-guard";
import { sha256HexUtf8 } from "../vendor/kit/sha256";
import type { MarkStore } from "./mark-store";

/** Eine laufende Anzeige: `settle` nach `load` (der Wächter beginnt), `abort`, wenn das Bild gar nicht erst gezeichnet wird (Ladefehler) oder der Block abgebaut wird. */
export interface RenderTicket {
  settle(): void;
  abort(): void;
}

/** Was der Wächter vom Fenster braucht (ein echtes `Window` erfüllt es); ohne `setTimeout` fällt die Marke sofort. */
export type GuardWindow = Pick<Window, "setTimeout" | "clearTimeout"> & {
  document?: { visibilityState?: string; addEventListener?: (type: string, cb: () => void) => void; removeEventListener?: (type: string, cb: () => void) => void };
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
  /** Alle laufenden Tickets beenden (Plugin wird entladen); ein offener Hänger macht die Marke `slow`, sonst fällt sie. */
  dispose(): void;
}

/** Fenster-Ereignisse, bei denen ein Ticket endet (Popout geschlossen, Obsidian beendet): mit Lückenprüfung, wie `abort`. */
const GONE_EVENTS = ["pagehide", "beforeunload", "unload"] as const;

/** Dauerlast: genug beobachtete Zeit und ein hoher Anteil verspäteter Zeit (jede Verspätung ist schon auf `CALM_GAP_MS` gedeckelt). */
const loadHigh = (visibleMs: number, lateMs: number): boolean => visibleMs >= SLOW_LOAD_FROM_MS && lateMs / visibleMs >= SLOW_LOAD_RATIO;

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
  /** Die Abbruchfunktionen der laufenden Tickets (für `dispose`). */
  const running = new Set<() => void>();
  return {
    dispose() { for (const end of [...running]) end(); },
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
      /** Seit wann das Fenster wieder sichtbar ist (Ereignis `visibilitychange`): ein Hänger beim Wechsel von verdeckt nach sichtbar beginnt dort, nicht beim letzten Tick. */
      let visibleSince = started;
      /** Beobachtete sichtbare Zeit und Summe der (gedeckelten) Verspätungen für die Dauerlast. */
      let visibleMs = 0;
      let lateMs = 0;
      const onVisibility = (): void => { if (win.document?.visibilityState !== "hidden") visibleSince = clock(); };

      const finish = (slow: boolean): void => {
        if (phase === "done") return;
        phase = "done";
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        for (const e of GONE_EVENTS) win.removeEventListener?.(e, gone);
        win.document?.removeEventListener?.("visibilitychange", onVisibility);
        running.delete(end);
        const left = (inflight.get(fp) ?? 1) - 1;
        if (left > 0) inflight.set(fp, left);
        else inflight.delete(fp);
        const marks = store.read();
        if (slow) store.write(markSlow(marks, fp, wall(), session));
        // Nur die eigene Marke ohne `slow` fällt, und erst mit dem letzten Bild desselben Textes: eine `slow`-Marke und die einer früheren Sitzung bleiben.
        else if (left === 0) store.write(removeMark(marks, fp, session));
      };

      /** Ende ohne regulären Abschluss (Block abgebaut, Fenster zu): war seit dem letzten Tick ein Hänger offen, den der überfällige Timer noch nicht melden konnte, oder hat die
       *  Dauerlast das Maß erreicht, ist das Bild `slow`. Dasselbe Maß wie der Tick. */
      const end = (): void => {
        if (phase === "done") return;
        let open: boolean;
        if (phase === "loading") {
          open = clock() - started > SLOW_MS;
        } else {
          const visibleNow = win.document?.visibilityState !== "hidden";
          const gap = clock() - Math.max(last, visibleSince) - TICK_MS;
          const counted = visibleNow ? Math.max(0, gap) : 0;
          open = visibleNow && (gap > SLOW_GAP_MS || loadHigh(visibleMs + Math.max(0, clock() - Math.max(last, visibleSince)), lateMs + Math.min(counted, CALM_GAP_MS)));
        }
        finish(open);
      };
      const gone = (): void => { end(); };
      for (const e of GONE_EVENTS) win.addEventListener?.(e, gone);
      win.document?.addEventListener?.("visibilitychange", onVisibility);
      running.add(end);

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
          let calmFrom = 0; // Stand von `visibleMs`, ab dem der Hauptthread ruhig war
          const tick = (): void => {
            if (phase !== "watching") return;
            const now = clock();
            // Der Hänger beginnt beim letzten Tick oder, wenn das Fenster inzwischen wieder sichtbar wurde, erst dort (ein verdecktes Fenster zeichnet nicht).
            const from = Math.max(last, visibleSince);
            const dt = now - from;
            const extra = dt - TICK_MS;
            last = now;
            const hidden = win.document?.visibilityState === "hidden";
            if (hidden) {
              calmFrom = visibleMs; // verdeckte Zeit zählt weder zur Ruhe noch zu `MAX_WATCH_MS`
            } else {
              visibleMs += dt;
              if (extra > 0) lateMs += Math.min(extra, CALM_GAP_MS);
              if (extra > SLOW_GAP_MS || loadHigh(visibleMs, lateMs)) { finish(true); return; }
              if (extra > CALM_GAP_MS) calmFrom = visibleMs;
            }
            if (visibleMs - calmFrom >= CALM_MS || visibleMs >= MAX_WATCH_MS) { finish(false); return; }
            timer = win.setTimeout(tick, TICK_MS);
          };
          timer = win.setTimeout(tick, TICK_MS);
        },
      };
    },
  };
}
