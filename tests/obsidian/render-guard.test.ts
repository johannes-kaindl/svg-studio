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
  it("begin setzt die Marke SOFORT (vor dem Zeichnen); isMarked sieht sie", () => {
    const store = memStore();
    const g = createRenderGuard(store);
    const { win } = fakeWin();
    g.begin(SVG, win);
    expect(g.isMarked(SVG)).toBe(true);
    expect(g.isMarked(OTHER)).toBe(false);
    expect(store.writes).toBe(1);
  });

  it("settle: die Marke fällt erst nach zwei Frames; bleiben die Frames aus (Hauptthread hängt), steht sie noch", () => {
    const store = memStore();
    const g = createRenderGuard(store);
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.settle();
    expect(g.isMarked(SVG)).toBe(true);
    w.frame();
    expect(g.isMarked(SVG)).toBe(true);
    w.frame();
    expect(g.isMarked(SVG)).toBe(false);
  });

  it("Gegenprobe ohne Marke: ein SVG, das nie begonnen wurde, ist nicht markiert", () => {
    expect(createRenderGuard(memStore()).isMarked(SVG)).toBe(false);
  });

  it("ein Bild, das länger als SLOW_MS brauchte, behält die Marke, auch wenn die Frames danach kommen", () => {
    let now = 1000;
    const g = createRenderGuard(memStore(), () => now);
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.settle();
    now += SLOW_MS + 1;
    w.frame();
    w.frame();
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("genau SLOW_MS ist noch schnell genug", () => {
    let now = 1000;
    const g = createRenderGuard(memStore(), () => now);
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.settle();
    now += SLOW_MS;
    w.frame();
    w.frame();
    expect(g.isMarked(SVG)).toBe(false);
  });

  it("abort löscht die Marke sofort (Ladefehler ist kein Hänger); settle danach tut nichts mehr", () => {
    const g = createRenderGuard(memStore());
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.abort();
    expect(g.isMarked(SVG)).toBe(false);
    t.settle();
    expect(w.pending()).toBe(0);
  });

  it("settle zweimal rufen plant nur einmal; abort nach settle löscht nichts", () => {
    const g = createRenderGuard(memStore());
    const w = fakeWin();
    const t = g.begin(SVG, w.win);
    t.settle();
    t.settle();
    t.abort();
    expect(w.pending()).toBe(1);
    expect(g.isMarked(SVG)).toBe(true);
  });

  it("clear löscht nur die Marke dieses Textes", () => {
    const g = createRenderGuard(memStore());
    const w = fakeWin();
    g.begin(SVG, w.win);
    g.begin(OTHER, w.win);
    g.clear(SVG);
    expect(g.isMarked(SVG)).toBe(false);
    expect(g.isMarked(OTHER)).toBe(true);
  });

  it("ein zweites Fenster sieht die Marke des ersten (gemeinsamer Speicher, frisch gelesen)", () => {
    const store = memStore();
    const a = createRenderGuard(store);
    const b = createRenderGuard(store);
    a.begin(SVG, fakeWin().win);
    expect(b.isMarked(SVG)).toBe(true);
    b.clear(SVG);
    expect(a.isMarked(SVG)).toBe(false);
  });

  it("ohne requestAnimationFrame wird sofort geprüft", () => {
    const g = createRenderGuard(memStore());
    const t = g.begin(SVG, {} as Window);
    t.settle();
    expect(g.isMarked(SVG)).toBe(false);
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
    store.write([{ fp: "a".repeat(64), at: 1 }]);
    expect(saved).toEqual([[MARKS_KEY, null], [MARKS_KEY, [{ fp: "a".repeat(64), at: 1 }]]]);
  });
});
