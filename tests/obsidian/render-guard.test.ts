import { describe, expect, it } from "vitest";
import { createRenderGuard, appMarkStore, MARKS_KEY, type MarkStore } from "../../src/obsidian/render-guard";
import { SLOW_MS, type Mark } from "../../src/core/render-guard";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="a" r="1"/></svg>`;
const OTHER = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="b" r="2"/></svg>`;

function memStore(): MarkStore & { value: unknown; writes: number } {
  const s = { value: null as unknown, writes: 0, read() { return s.value; }, write(m: Mark[]) { s.writes++; s.value = JSON.parse(JSON.stringify(m)); } };
  return s;
}
/** Ein Fenster, dessen Frames der Test selbst auslöst (oder nie). */
function fakeWin() {
  const queue: Array<() => void> = [];
  return { win: { requestAnimationFrame: (cb: () => void) => { queue.push(cb); return queue.length; } } as unknown as Window, frame: () => { const q = queue.splice(0); q.forEach((cb) => { cb(); }); }, pending: () => queue.length };
}

describe("createRenderGuard", () => {
  it("begin schreibt die Marke SOFORT in den Speicher (vor dem Zeichnen); in derselben Sitzung blockiert sie nichts, nach einem Neustart (neue Sitzung) schon", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    g.begin(SVG, fakeWin().win);
    expect((store.value as Mark[]).length).toBe(1);
    expect(g.isMarked(SVG)).toBe(false);
    const nachNeustart = createRenderGuard(store, () => 0, "s2");
    expect(nachNeustart.isMarked(SVG)).toBe(true);
    expect(nachNeustart.isMarked(OTHER)).toBe(false);
  });

  it("settle: die Marke fällt erst nach zwei Frames; bleiben die Frames aus (Hauptthread hängt), steht sie noch", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    const w = fakeWin();
    g.begin(SVG, w.win).settle();
    expect((store.value as Mark[]).length).toBe(1);
    w.frame();
    expect((store.value as Mark[]).length).toBe(1);
    w.frame();
    expect(store.value).toEqual([]);
  });

  it("Gegenprobe ohne Marke: ein SVG, das nie begonnen wurde, ist nicht markiert", () => {
    expect(createRenderGuard(memStore()).isMarked(SVG)).toBe(false);
  });

  it("zwei Blöcke mit demselben Text gleichzeitig: der zweite wird nicht blockiert, die Marke fällt erst mit dem letzten Bild", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    const w1 = fakeWin();
    const w2 = fakeWin();
    const a = g.begin(SVG, w1.win);
    expect(g.isMarked(SVG)).toBe(false);
    const b = g.begin(SVG, w2.win);
    a.settle();
    w1.frame();
    w1.frame();
    expect((store.value as Mark[]).length).toBe(1); // b zeichnet noch
    b.settle();
    w2.frame();
    w2.frame();
    expect(store.value).toEqual([]);
  });

  it("ein Bild, das länger als SLOW_MS brauchte, wird zur slow-Marke: sie blockiert auch in der eigenen Sitzung, die Frames danach löschen sie nicht", () => {
    let now = 1000;
    const g = createRenderGuard(memStore(), () => now, "s1");
    const w = fakeWin();
    g.begin(SVG, w.win).settle();
    now += SLOW_MS + 1;
    w.frame();
    w.frame();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("genau SLOW_MS ist noch schnell genug", () => {
    let now = 1000;
    const g = createRenderGuard(memStore(), () => now, "s1");
    const w = fakeWin();
    g.begin(SVG, w.win).settle();
    now += SLOW_MS;
    w.frame();
    w.frame();
    expect(g.isMarked(SVG)).toBe(false);
  });

  it("ein langsames und ein schnelles Bild mit demselben Text: die slow-Marke bleibt", () => {
    let now = 0;
    const g = createRenderGuard(memStore(), () => now, "s1");
    const w1 = fakeWin();
    const w2 = fakeWin();
    const slow = g.begin(SVG, w1.win);
    now = 100;
    const fast = g.begin(SVG, w2.win);
    fast.settle();
    w2.frame();
    w2.frame(); // Zeit 100: schnell
    now = SLOW_MS + 500;
    slow.settle();
    w1.frame();
    w1.frame(); // langsam
    expect(g.isMarked(SVG)).toBe(true);
    const later = g.begin(SVG, fakeWin().win);
    later.abort();
    expect(g.isMarked(SVG)).toBe(true); // ein späterer schneller Abschluss löscht eine slow-Marke nicht
  });

  it("abort löscht die Marke sofort (Ladefehler ist kein Hänger); settle danach tut nichts mehr", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.abort();
    expect(store.value).toEqual([]);
    t.settle();
    expect(w.pending()).toBe(0);
  });

  it("settle zweimal rufen plant nur einmal; abort nach settle löscht nichts", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.settle();
    t.settle();
    t.abort();
    expect(w.pending()).toBe(1);
    expect((store.value as Mark[]).length).toBe(1);
  });

  it("clear löscht nur die Marke dieses Textes, auch eine slow-Marke („Trotzdem anzeigen“)", () => {
    let now = 0;
    const store = memStore();
    const g = createRenderGuard(store, () => now, "s1");
    const w = fakeWin();
    g.begin(OTHER, w.win);
    const t = g.begin(SVG, w.win);
    t.settle();
    now = SLOW_MS + 1;
    w.frame();
    w.frame();
    expect(g.isMarked(SVG)).toBe(true);
    g.clear(SVG);
    expect(g.isMarked(SVG)).toBe(false);
    expect((store.value as Mark[]).map((m) => m.fp).length).toBe(1);
  });

  it("ohne requestAnimationFrame wird sofort geprüft", () => {
    const store = memStore();
    const g = createRenderGuard(store, () => 0, "s1");
    g.begin(SVG, {} as Window).settle();
    expect(store.value).toEqual([]);
  });

  it("ein Speicher, der wirft, verweigert kein Bild: Lesen = keine Marke, Schreiben = ohne Schutz", () => {
    const app = { loadLocalStorage: () => { throw new Error("x"); }, saveLocalStorage: () => { throw new Error("y"); } };
    const g = createRenderGuard(appMarkStore(app as never));
    expect(g.isMarked(SVG)).toBe(false);
    expect(() => g.begin(SVG, fakeWin().win).settle()).not.toThrow();
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
