import { describe, expect, it, vi } from "vitest";
import { CALM_MS, MARK_MAX_AGE_MS, MAX_MARKS, MAX_WATCH_MS, SLOW_GAP_MS, SLOW_MS, TICK_MS, type Mark } from "../../src/core/render-guard";
import type { MarkStore } from "../../src/obsidian/mark-store";
import { createRenderGuard } from "../../src/obsidian/render-guard";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="a" r="1"/></svg>`;
const OTHER = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="b" r="2"/></svg>`;

function memStore(): MarkStore & { marks: Mark[] } {
  const s = { marks: [] as Mark[], read: () => s.marks, write: (m: Mark[]) => { s.marks = m; }, close: () => undefined };
  return s;
}

/** Ein Fenster mit eigener Zeit: `advance` lässt Zeit vergehen und ruft fällige Timer pünktlich, `block` lässt Zeit vergehen, ohne dass Timer laufen (der Hauptthread hängt);
 *  `blockAndRun` führt danach die überfälligen Timer aus, `emit` löst ein Fenster-Ereignis aus (läuft in der Wirklichkeit VOR dem überfälligen Timer). */
function fakeWin() {
  let now = 0;
  let nextId = 1;
  let visibility = "visible";
  const timers: Array<{ id: number; at: number; cb: () => void }> = [];
  const listeners = new Map<string, Array<() => void>>();
  const docListeners = new Map<string, Array<() => void>>();
  const win = {
    setTimeout: (cb: () => void, ms: number) => { const id = nextId++; timers.push({ id, at: now + ms, cb }); return id; },
    clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener: (type: string, cb: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), cb]); },
    removeEventListener: (type: string, cb: () => void) => { listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== cb)); },
    document: {
      get visibilityState() { return visibility; },
      addEventListener: (type: string, cb: () => void) => { docListeners.set(type, [...(docListeners.get(type) ?? []), cb]); },
      removeEventListener: (type: string, cb: () => void) => { docListeners.set(type, (docListeners.get(type) ?? []).filter((x) => x !== cb)); },
    },
  } as unknown as Window;
  const runDue = (until: number): void => {
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((x, y) => x.at - y.at)[0];
      if (!due) return;
      timers.splice(timers.indexOf(due), 1);
      now = Math.max(now, due.at);
      due.cb();
    }
  };
  return {
    win,
    clock: () => now,
    advance(ms: number) { const target = now + ms; runDue(target); now = target; },
    /** Hauptthread hängt `ms`; die fälligen Timer laufen danach verspätet. */
    blockAndRun(ms: number) { now += ms; runDue(now); },
    /** Hauptthread hängt `ms`; es läuft noch nichts (ein Ereignis überholt die Timer). */
    hang(ms: number) { now += ms; },
    emit(type: string) { for (const cb of listeners.get(type) ?? []) cb(); },
    pending: () => timers.length,
    listenerCount: () => [...listeners.values(), ...docListeners.values()].reduce((n, l) => n + l.length, 0),
    /** Wie das Fenster: Zustand ändern und `visibilitychange` melden. */
    setVisibility(v: string) { visibility = v; for (const cb of docListeners.get("visibilitychange") ?? []) cb(); },
  };
}

describe("createRenderGuard: Wächter nach dem Setzen der Marke", () => {
  const setup = () => {
    const store = memStore();
    const w = fakeWin();
    const g = createRenderGuard(store, w.clock, "s1", () => 1_000_000);
    return { store, w, g };
  };

  it("begin schreibt die Marke SOFORT in den Speicher; in derselben Sitzung blockiert sie nichts, nach einem Neustart (neue Sitzung) schon", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win);
    expect(store.marks).toHaveLength(1);
    expect(g.isMarked(SVG)).toBe(false);
    const nachNeustart = createRenderGuard(store, w.clock, "s2", () => 1_000_000);
    expect(nachNeustart.isMarked(SVG)).toBe(true);
    expect(nachNeustart.isMarked(OTHER)).toBe(false);
  });

  it("ruhiger Hauptthread: die Marke fällt erst nach dem Ruhefenster, nicht schon nach load", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(CALM_MS - TICK_MS);
    expect(store.marks).toHaveLength(1);
    w.advance(2 * TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("Hänger nach load (Raster-Kosten): die Marke wird slow und bleibt, auch wenn Obsidian sich erholt und lange ruhig bleibt", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(60);
    w.blockAndRun(2700);
    expect(g.isMarked(SVG)).toBe(true);
    expect(store.marks[0]).toMatchObject({ slow: true });
    w.advance(60000);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("Hänger, der nie endet (Obsidian wird beendet): die Marke steht, es kommt kein Tick", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(60);
    expect(store.marks).toHaveLength(1);
    expect(w.pending()).toBe(1);
    expect(createRenderGuard(store, w.clock, "s2", () => 1_000_000).isMarked(SVG)).toBe(true);
  });

  it("eine Verspätung zwischen Ruhe- und Hängergrenze verlängert das Ruhefenster, macht aber nicht slow", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(1000);
    w.blockAndRun(TICK_MS + 400); // Verspätung 400 ms: über der Ruhegrenze, unter dem Hänger, unter der Summengrenze
    expect(store.marks).toHaveLength(1);
    expect(store.marks[0]!.slow).toBeUndefined();
    w.advance(CALM_MS - TICK_MS); // von der verspäteten Stelle noch nicht ruhig genug
    expect(store.marks).toHaveLength(1);
    w.advance(3 * TICK_MS);
    expect(store.marks).toEqual([]);
  });

  // Opus-Review 2026-11-05: Dauerlast knapp unter der Ruhegrenze galt als Ruhe (Marke fiel nach 2,3 s); eine absolute Summe kippte schon bei EINER Lücke von 0,8 s.
  it("Dauerlast (Frames von etwa 450 ms): der Anteil verspäteter Zeit macht die Marke slow", () => {
    const { w, g } = setup();
    g.begin(SVG, w.win).settle();
    for (let i = 0; i < 6; i++) w.blockAndRun(TICK_MS + 220);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("eine einzelne Spitze unter der Hängergrenze (0,85 s) macht ein ruhiges Bild nicht slow", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(240);
    w.blockAndRun(850);
    w.advance(CALM_MS + 2 * TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("zwei Spitzen von 0,6 s im Abstand sind keine Dauerlast", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(500);
    w.blockAndRun(600);
    w.advance(1200);
    w.blockAndRun(600);
    w.advance(CALM_MS + 2 * TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("kleine Verspätungen (viele Blöcke, GC) bleiben Ruhe", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    for (let i = 0; i < 7; i++) w.blockAndRun(TICK_MS + 60);
    w.advance(CALM_MS + TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("kommt load selbst spät (Stilkosten vor dem Laden), ist das Bild sofort slow", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    w.hang(SLOW_MS + 1);
    t.settle();
    expect(g.isMarked(SVG)).toBe(true);
    expect(store.marks[0]).toMatchObject({ slow: true });
    expect(w.pending()).toBe(0);
  });

  it("genau SLOW_MS bis load ist noch schnell genug", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    w.hang(SLOW_MS);
    t.settle();
    w.advance(CALM_MS + TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("abort während der Beobachtung ohne offenen Hänger (Block abgebaut): die Marke fällt, der Timer und die Fenster-Hörer sind weg", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.advance(500);
    t.abort();
    expect(store.marks).toEqual([]);
    expect(w.pending()).toBe(0);
    expect(w.listenerCount()).toBe(0);
  });

  // Opus-Review 2026-11-05, Befund 2: nach einem Hänger läuft zuerst die Eingabe (Notizwechsel, Tab zu), erst danach der überfällige Timer.
  it("abort nach einem Hänger, den der überfällige Timer noch nicht melden konnte, macht die Marke slow statt sie zu löschen", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.advance(500);
    w.hang(3100); // der Timer ist überfällig, hat aber noch nicht gelaufen
    t.abort();
    expect(g.isMarked(SVG)).toBe(true);
    expect(store.marks[0]).toMatchObject({ slow: true });
  });

  it("abort nach einem Hänger VOR load (Phase loading) macht die Marke slow", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    w.hang(SLOW_MS + 500);
    t.abort();
    expect(store.marks[0]).toMatchObject({ slow: true });
  });

  it("abort kurz nach load und kurz nach dem letzten Tick: kein Hänger offen, die Marke fällt", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.advance(TICK_MS + 100);
    t.abort();
    expect(store.marks).toEqual([]);
  });

  it("abort nach einem gesehenen Hänger löscht die slow-Marke nicht", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.blockAndRun(SLOW_GAP_MS + TICK_MS + 50);
    t.abort();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("abort vor load (Ladefehler) ohne Hänger löscht die Marke sofort; settle danach tut nichts", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.abort();
    expect(store.marks).toEqual([]);
    t.settle();
    expect(w.pending()).toBe(0);
  });

  it("settle zweimal rufen beginnt nur einen Wächter", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    t.settle();
    expect(w.pending()).toBe(1);
  });

  // Opus-Review 2026-11-05, Befunde 7 und 8: Popout geschlossen, Obsidian beendet.
  it.each(["pagehide", "beforeunload", "unload"])("Fenster-Ereignis %s beendet das Ticket mit Lückenprüfung (ruhig: Marke fällt; Hänger offen: slow)", (ereignis) => {
    const a = setup();
    a.g.begin(SVG, a.w.win).settle();
    a.w.advance(500);
    a.w.emit(ereignis);
    expect(a.store.marks).toEqual([]);
    expect(a.w.pending()).toBe(0);
    const b = setup();
    b.g.begin(SVG, b.w.win).settle();
    b.w.advance(500);
    b.w.hang(4000);
    b.w.emit(ereignis);
    expect(b.g.isMarked(SVG)).toBe(true);
  });

  it("verdecktes Fenster: Verspätungen dort sind kein Hänger, und verdeckte Zeit zählt weder zur Ruhe noch zu MAX_WATCH_MS", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.setVisibility("hidden");
    w.blockAndRun(5000);
    expect(g.isMarked(SVG)).toBe(false);
    // Lange verdeckt: die Marke fällt nicht, weil nie ruhig beobachtet wurde.
    for (let t = 0; t < MAX_WATCH_MS * 2; t += TICK_MS) w.advance(TICK_MS);
    expect(store.marks).toHaveLength(1);
    // Wieder sichtbar und ruhig: sie fällt nach dem Ruhefenster.
    w.setVisibility("visible");
    w.advance(TICK_MS * 2);
    w.advance(CALM_MS + TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("zwei Blöcke mit demselben Text gleichzeitig: der zweite wird nicht blockiert, die Marke fällt erst mit dem letzten Bild", () => {
    const { store, w, g } = setup();
    const a = g.begin(SVG, w.win);
    expect(g.isMarked(SVG)).toBe(false);
    a.settle();
    w.advance(500);
    const b = g.begin(SVG, w.win);
    b.settle();
    w.advance(CALM_MS - 100); // a ist ruhig fertig, b noch nicht
    expect(store.marks).toHaveLength(1);
    w.advance(1000);
    expect(store.marks).toEqual([]);
  });

  it("ein Hänger macht alle gleichzeitig beobachteten Bilder desselben Textes slow; ein späterer ruhiger Abschluss löscht die slow-Marke nicht", () => {
    const { w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.blockAndRun(2000);
    expect(g.isMarked(SVG)).toBe(true);
    const later = g.begin(SVG, w.win);
    later.settle();
    w.advance(CALM_MS + TICK_MS);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("das Ende eines Bildes entfernt nur die Marke der eigenen Sitzung (ein Neuladen des Plugins löscht die neue Marke nicht)", () => {
    const store = memStore();
    const w = fakeWin();
    const alt = createRenderGuard(store, w.clock, "alt", () => 1_000_000);
    const neu = createRenderGuard(store, w.clock, "neu", () => 1_000_000);
    const ticketAlt = alt.begin(SVG, w.win);
    neu.begin(SVG, w.win); // ersetzt die Marke (gleicher Text), jetzt Sitzung „neu“
    ticketAlt.abort();
    expect(store.marks).toEqual([expect.objectContaining({ session: "neu" })]);
  });

  it("clear löscht nur die Marke dieses Textes, auch eine slow-Marke („Trotzdem anzeigen“)", () => {
    const { store, w, g } = setup();
    g.begin(OTHER, w.win);
    g.begin(SVG, w.win).settle();
    w.blockAndRun(2000);
    expect(g.isMarked(SVG)).toBe(true);
    g.clear(SVG);
    expect(g.isMarked(SVG)).toBe(false);
    expect(store.marks).toHaveLength(1);
  });

  it("eine Marke, die älter als MARK_MAX_AGE_MS ist (eine Woche), sperrt nicht mehr", () => {
    const store = memStore();
    const w = fakeWin();
    const alt = createRenderGuard(store, w.clock, "s1", () => 0);
    alt.begin(SVG, w.win);
    const spaeter = createRenderGuard(store, w.clock, "s2", () => MARK_MAX_AGE_MS + 1);
    expect(spaeter.isMarked(SVG)).toBe(false);
    const nah = createRenderGuard(store, w.clock, "s2", () => MARK_MAX_AGE_MS - 1);
    expect(nah.isMarked(SVG)).toBe(true);
  });

  it("mehr als MAX_MARKS gleichzeitig laufende Bilder: die Liste bleibt begrenzt", () => {
    const { store, w, g } = setup();
    for (let i = 0; i < MAX_MARKS + 10; i++) g.begin(`${SVG}<!--${String(i)}-->`, w.win);
    expect(store.marks).toHaveLength(MAX_MARKS);
  });

  it("ohne setTimeout im Fenster fällt die Marke sofort nach load", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    g.begin(SVG, {} as never).settle();
    expect(store.marks).toEqual([]);
  });

  it("die Uhr für die Lücken ist monoton (performance.now), die Wanduhr nur für den Zeitstempel: ein Sprung der Wanduhr macht kein Bild slow", () => {
    const store = memStore();
    const w = fakeWin();
    let wall = 1_000_000;
    const g = createRenderGuard(store, w.clock, "s1", () => wall);
    g.begin(SVG, w.win).settle();
    wall += 3_600_000 * 5; // die Wanduhr springt fünf Stunden vor
    w.advance(CALM_MS + TICK_MS);
    expect(store.marks).toEqual([]);
  });

  it("end() wertet auch die Dauerlast: Frames von 500 ms, der Nutzer wechselt nach 2 s die Notiz → slow statt gelöscht", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    for (let i = 0; i < 3; i++) w.blockAndRun(TICK_MS + 230);
    w.hang(500); // der nächste Frame läuft noch
    t.abort();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("abort mit einer offenen Lücke zwischen Ruhe- und Hängergrenze (400 ms) löscht die Marke (kein Hänger)", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.advance(100);
    w.hang(TICK_MS + 400);
    t.abort();
    expect(store.marks).toEqual([]);
  });

  // Opus-Review, Befund 3: der Block wird bei verdecktem Fenster gezeichnet, das Fenster kommt nach vorn und hängt erst dann.
  it("Hänger beim Wechsel von verdeckt nach sichtbar: er beginnt beim Sichtbarwerden und zählt", () => {
    const { w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.setVisibility("hidden");
    w.advance(3000);
    w.setVisibility("visible"); // visibilitychange
    w.blockAndRun(5000);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("dasselbe beim Abbau: abort nach einem Hänger seit dem Sichtbarwerden macht slow", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.setVisibility("hidden");
    w.advance(3000);
    w.setVisibility("visible");
    w.hang(4000);
    t.abort();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("abort bei verdecktem Fenster nach langer Pause ist kein Hänger", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.setVisibility("hidden");
    w.hang(6000);
    t.abort();
    expect(store.marks).toEqual([]);
  });

  it("dispose beendet alle laufenden Tickets (Plugin wird entladen): ruhige fallen, ein offener Hänger macht slow; danach bleibt nichts zurück", () => {
    const store = memStore();
    const w = fakeWin();
    const g = createRenderGuard(store, w.clock, "s1", () => 1_000_000);
    g.begin(SVG, w.win).settle();
    g.begin(OTHER, w.win).settle();
    w.advance(500);
    w.hang(3000);
    g.dispose();
    expect(g.isMarked(SVG)).toBe(true);
    expect(g.isMarked(OTHER)).toBe(true);
    expect(w.pending()).toBe(0);
    expect(w.listenerCount()).toBe(0);
    const g2 = createRenderGuard(memStore(), w.clock, "s1", () => 1_000_000);
    g2.begin(SVG, w.win).settle();
    w.advance(500);
    g2.dispose();
    expect(g2.isMarked(SVG)).toBe(false);
  });

  it("eine eigene slow-Marke überlebt eine Rotation durch viele eigene laufende Marken", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.blockAndRun(2000);
    for (let i = 0; i < MAX_MARKS + 5; i++) g.begin(`${OTHER}<!--${String(i)}-->`, w.win);
    expect(g.isMarked(SVG)).toBe(true);
    expect(store.marks).toHaveLength(MAX_MARKS);
  });

  it("die Standarduhr ist monoton: ohne Uhr-Argument folgt der Wächter performance.now, nicht Date.now", () => {
    const store = memStore();
    const w = fakeWin();
    const g = createRenderGuard(store, undefined, "s1", () => 1_000_000);
    g.begin(SVG, w.win).settle();
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 3_600_000); // die Wanduhr springt 10 Stunden vor
    w.advance(CALM_MS + 2 * TICK_MS); // die Fake-Timer laufen ohne echte Zeit: performance.now rückt kaum vor
    spy.mockRestore();
    expect(g.isMarked(SVG)).toBe(false);
  });

  it("eine slow-Marke älter als MARK_MAX_AGE_MS wird beim nächsten Zeichnen nicht erneuert", () => {
    const store = memStore();
    const w = fakeWin();
    let wall = 0;
    const g = createRenderGuard(store, w.clock, "s1", () => wall);
    g.begin(SVG, w.win).settle();
    w.blockAndRun(2000);
    wall = MARK_MAX_AGE_MS + 10;
    const g2 = createRenderGuard(store, w.clock, "s2", () => wall);
    expect(g2.isMarked(SVG)).toBe(false);
    g2.begin(SVG, w.win).settle();
    w.advance(CALM_MS + 2 * TICK_MS);
    expect(store.marks).toEqual([]);
  });
});
