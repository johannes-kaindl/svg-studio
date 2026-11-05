import { describe, expect, it } from "vitest";
import { createRenderGuard, appMarkStore, MARKS_KEY, type MarkStore } from "../../src/obsidian/render-guard";
import { CALM_MS, MAX_WATCH_MS, SLOW_GAP_MS, SLOW_MS, TICK_MS, type Mark } from "../../src/core/render-guard";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="a" r="1"/></svg>`;
const OTHER = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="b" r="2"/></svg>`;

function memStore(): MarkStore & { value: unknown; writes: number } {
  const s = { value: null as unknown, writes: 0, read() { return s.value; }, write(m: Mark[]) { s.writes++; s.value = JSON.parse(JSON.stringify(m)); } };
  return s;
}
/** Ein Fenster mit eigener Zeit: `advance` lässt Zeit vergehen und ruft fällige Timer pünktlich, `block` lässt Zeit vergehen, ohne dass Timer laufen (der Hauptthread hängt); danach laufen die fälligen Timer verspätet. */
function fakeWin() {
  let now = 0;
  let nextId = 1;
  let visibility = "visible";
  const timers: Array<{ id: number; at: number; cb: () => void }> = [];
  const win = {
    setTimeout: (cb: () => void, ms: number) => { const id = nextId++; timers.push({ id, at: now + ms, cb }); return id; },
    clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    document: { get visibilityState() { return visibility; } },
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
    block(ms: number) { now += ms; runDue(now); },
    pending: () => timers.length,
    hide() { visibility = "hidden"; },
  };
}
const stored = (store: { value: unknown }): Mark[] => store.value as Mark[];

describe("createRenderGuard: Wächter nach dem Setzen der Marke", () => {
  const setup = () => {
    const store = memStore();
    const w = fakeWin();
    const g = createRenderGuard(store, w.clock, "s1");
    return { store, w, g };
  };

  it("begin schreibt die Marke SOFORT in den Speicher; in derselben Sitzung blockiert sie nichts, nach einem Neustart (neue Sitzung) schon", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win);
    expect(stored(store)).toHaveLength(1);
    expect(g.isMarked(SVG)).toBe(false);
    const nachNeustart = createRenderGuard(store, w.clock, "s2");
    expect(nachNeustart.isMarked(SVG)).toBe(true);
    expect(nachNeustart.isMarked(OTHER)).toBe(false);
  });

  it("ruhiger Hauptthread: die Marke fällt erst nach dem Ruhefenster, nicht schon nach load und zwei Frames", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(CALM_MS - TICK_MS);
    expect(stored(store)).toHaveLength(1);
    w.advance(2 * TICK_MS);
    expect(store.value).toEqual([]);
    expect(g.isMarked(SVG)).toBe(false);
  });

  it("Hänger nach load (Raster-Kosten): die Marke wird slow und bleibt, auch wenn Obsidian sich erholt und lange ruhig bleibt", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(60);
    w.block(2700);
    expect(g.isMarked(SVG)).toBe(true);
    expect((stored(store))[0]).toMatchObject({ slow: true });
    w.advance(60000);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("Hänger, der nie endet (Obsidian wird beendet): die Marke steht, es kommt kein Tick", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(60);
    expect(stored(store)).toHaveLength(1);
    expect(w.pending()).toBe(1);
    // Keine Zeit mehr: der Speicher behält die Marke, nach einem Neustart blockiert sie.
    expect(createRenderGuard(store, w.clock, "s2").isMarked(SVG)).toBe(true);
  });

  it("eine Verspätung zwischen Ruhe- und Hängergrenze verlängert das Ruhefenster, macht aber nicht slow", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    w.advance(1000);
    w.block(600); // Verspätung 600 ms: über der Ruhegrenze, unter dem Hänger
    expect(stored(store)).toHaveLength(1);
    expect((stored(store))[0]!.slow).toBeUndefined();
    w.advance(CALM_MS - TICK_MS); // von der verspäteten Stelle noch nicht ruhig genug
    expect(stored(store)).toHaveLength(1);
    w.advance(3 * TICK_MS);
    expect(store.value).toEqual([]);
  });

  it("dauerhaft beschäftigt (nie ruhig): nach MAX_WATCH_MS fällt die Marke trotzdem, ohne slow", () => {
    const { store, w, g } = setup();
    g.begin(SVG, w.win).settle();
    for (let t = 0; t < MAX_WATCH_MS; t += 700) { w.advance(TICK_MS); w.block(450); } // jede Runde 450 ms Verspätung (unter SLOW_GAP_MS)
    w.advance(5000);
    expect(store.value).toEqual([]);
  });

  it("kommt load selbst spät (Stilkosten vor dem Laden), ist das Bild sofort slow", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    w.block(SLOW_MS + 1);
    t.settle();
    expect(g.isMarked(SVG)).toBe(true);
    expect((stored(store))[0]).toMatchObject({ slow: true });
    expect(w.pending()).toBe(0);
  });

  it("genau SLOW_MS bis load ist noch schnell genug", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    w.block(SLOW_MS);
    t.settle();
    w.advance(CALM_MS + TICK_MS);
    expect(store.value).toEqual([]);
  });

  it("abort während der Beobachtung (Block abgebaut): die Marke fällt, der Timer ist weg", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.advance(500);
    t.abort();
    expect(store.value).toEqual([]);
    expect(w.pending()).toBe(0);
  });

  it("abort nach einem gesehenen Hänger löscht die slow-Marke nicht", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.block(SLOW_GAP_MS + TICK_MS + 50);
    t.abort();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("abort vor load (Ladefehler) löscht die Marke sofort; settle danach tut nichts", () => {
    const { store, w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.abort();
    expect(store.value).toEqual([]);
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

  it("verdecktes Fenster: gedrosselte Timer sind kein Hänger", () => {
    const { w, g } = setup();
    const t = g.begin(SVG, w.win);
    t.settle();
    w.hide();
    w.block(5000);
    expect(g.isMarked(SVG)).toBe(false);
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
    expect(stored(store)).toHaveLength(1);
    w.advance(1000);
    expect(store.value).toEqual([]);
  });

  it("ein Hänger macht alle gleichzeitig beobachteten Bilder desselben Textes slow; ein späterer ruhiger Abschluss löscht die slow-Marke nicht", () => {
    const { w, g } = setup();
    const a = g.begin(SVG, w.win);
    a.settle();
    w.block(2000);
    expect(g.isMarked(SVG)).toBe(true);
    const later = g.begin(SVG, w.win);
    later.settle();
    w.advance(CALM_MS + TICK_MS);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("clear löscht nur die Marke dieses Textes, auch eine slow-Marke („Trotzdem anzeigen“)", () => {
    const { store, w, g } = setup();
    g.begin(OTHER, w.win);
    const t = g.begin(SVG, w.win);
    t.settle();
    w.block(2000);
    expect(g.isMarked(SVG)).toBe(true);
    g.clear(SVG);
    expect(g.isMarked(SVG)).toBe(false);
    expect(stored(store)).toHaveLength(1);
  });

  it("ohne setTimeout im Fenster fällt die Marke sofort nach load", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    g.begin(SVG, {} as never).settle();
    expect(store.value).toEqual([]);
  });

  it("ein Speicher, der wirft, verweigert kein Bild: Lesen = keine Marke, Schreiben = ohne Schutz", () => {
    const app = { loadLocalStorage: () => { throw new Error("x"); }, saveLocalStorage: () => { throw new Error("y"); } };
    const g = createRenderGuard(appMarkStore(app as never));
    const w = fakeWin();
    expect(g.isMarked(SVG)).toBe(false);
    expect(() => { g.begin(SVG, w.win).settle(); w.advance(3000); }).not.toThrow();
  });
});

describe("appMarkStore", () => {
  it("schreibt unter dem Schlüssel des Plugins; eine leere Liste löscht den Eintrag (null)", () => {
    const saved: Array<[string, unknown]> = [];
    const store = appMarkStore({ loadLocalStorage: () => null, saveLocalStorage: (k: string, v: unknown) => { saved.push([k, v]); } } as never);
    store.write([]);
    store.write([{ fp: "a".repeat(64), at: 1, session: "s" }]);
    expect(saved).toEqual([[MARKS_KEY, null], [MARKS_KEY, [{ fp: "a".repeat(64), at: 1, session: "s" }]]]);
  });
});
