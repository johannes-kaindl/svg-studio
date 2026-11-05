// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkStore, OPEN_TIMEOUT_MS, openIdbPort, type DurablePort } from "../../src/obsidian/mark-store";
import type { Mark } from "../../src/core/render-guard";

const FP = "a".repeat(64);
const mark = (session: string): Mark => ({ fp: FP, at: 1, session });

describe("createMarkStore", () => {
  it("liest den dauerhaften Port einmal und hält die Liste im Hauptspeicher; write schreibt sofort in den Port", async () => {
    const written: Mark[][] = [];
    const port: DurablePort = { read: () => Promise.resolve([mark("alt")]), write: (m) => { written.push(m); } };
    const store = await createMarkStore(port);
    expect(store.read()).toEqual([mark("alt")]);
    store.write([mark("neu")]);
    expect(store.read()).toEqual([mark("neu")]);
    expect(written).toEqual([[mark("neu")]]);
  });

  it("ohne Port (IndexedDB fehlt oder gesperrt): nur Hauptspeicher, ohne Fehler", async () => {
    const store = await createMarkStore(null);
    expect(store.read()).toEqual([]);
    expect(() => { store.write([mark("s")]); }).not.toThrow();
    expect(store.read()).toEqual([mark("s")]);
  });

  it("ein Port, dessen Lesen oder Schreiben wirft, macht keinen Fehler: leere Liste, Hauptspeicher läuft weiter", async () => {
    const port: DurablePort = { read: () => Promise.reject(new Error("quota")), write: () => { throw new Error("quota"); } };
    const store = await createMarkStore(port);
    expect(store.read()).toEqual([]);
    expect(() => { store.write([mark("s")]); }).not.toThrow();
    expect(store.read()).toEqual([mark("s")]);
  });

  it("kaputte gespeicherte Daten ergeben eine leere Liste", async () => {
    const store = await createMarkStore({ read: () => Promise.resolve({ kaputt: true }), write: () => undefined });
    expect(store.read()).toEqual([]);
  });
});

describe("openIdbPort", () => {
  it("ohne indexedDB im Umfeld: null, kein Wurf", async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      expect(await openIdbPort("x")).toBeNull();
    } finally {
      if (saved !== undefined) (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });

  it("ein indexedDB, das beim Öffnen wirft: null", async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error("gesperrt"); } };
    try {
      expect(await openIdbPort("x")).toBeNull();
    } finally {
      if (saved === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
      else (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });

  it("ein Öffnen, das mit einem Fehler endet: null", async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    const req: { onerror?: () => void; onsuccess?: () => void; onupgradeneeded?: () => void; onblocked?: () => void; result?: unknown } = {};
    (globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { setTimeout(() => { req.onerror?.(); }, 0); return req; } };
    try {
      expect(await openIdbPort("x")).toBeNull();
    } finally {
      if (saved === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
      else (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });
});

/** Ein winziges IndexedDB: genug, um den Rundlauf von `openIdbPort` zu prüfen und festzuhalten, DASS `commit()` gerufen wird und `durability: "strict"` im Aufruf steht
 *  (gemessen im Opus-Review 2026-11-05: tragend ist `commit()`, ohne ihn wartet der Abschluss auf den hängenden Hauptthread). */
function fakeIdb() {
  const rec = { durability: [] as unknown[], commits: 0, puts: [] as Array<[unknown, unknown]>, closed: 0, versionchange: null as null | (() => void) };
  const data = new Map<unknown, unknown>();
  const db = {
    createObjectStore: () => undefined,
    close: () => { rec.closed++; },
    set onversionchange(cb: () => void) { rec.versionchange = cb; },
    transaction: (_name: string, _mode: string, opts?: { durability?: string }) => {
      rec.durability.push(opts?.durability);
      return {
        commit: () => { rec.commits++; },
        objectStore: () => ({
          put: (value: unknown, key: unknown) => { rec.puts.push([key, value]); data.set(key, value); },
          get: (key: unknown) => {
            const r: { onsuccess?: () => void; onerror?: () => void; result?: unknown } = {};
            setTimeout(() => { r.result = data.get(key); r.onsuccess?.(); }, 0);
            return r;
          },
        }),
      };
    },
  };
  const req: { onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; result: typeof db } = { result: db };
  return { rec, req, data, indexedDB: { open: () => { setTimeout(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }, 0); return req; } } };
}

describe("openIdbPort: Rundlauf", () => {
  const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
    else (globalThis as { indexedDB?: unknown }).indexedDB = saved;
  });

  it("write ruft commit() und fordert durability strict; read liefert den geschriebenen Wert zurück; close schließt die Verbindung", async () => {
    const f = fakeIdb();
    (globalThis as { indexedDB?: unknown }).indexedDB = f.indexedDB;
    const port = await openIdbPort("x");
    expect(port).not.toBeNull();
    port!.write([mark("s")]);
    expect(f.rec.commits).toBe(1);
    expect(f.rec.durability).toEqual(["strict"]);
    expect(f.rec.puts).toEqual([["list", [mark("s")]]]);
    expect(await port!.read()).toEqual([mark("s")]);
    port!.close?.();
    expect(f.rec.closed).toBe(1);
  });

  it("ein versionchange schließt die Verbindung (ein Upgrade oder deleteDatabase hängt nicht an uns)", async () => {
    const f = fakeIdb();
    (globalThis as { indexedDB?: unknown }).indexedDB = f.indexedDB;
    await openIdbPort("x");
    f.rec.versionchange?.();
    expect(f.rec.closed).toBe(1);
  });

  it("ein Öffnen ohne jedes Ereignis (blockiert) endet nach OPEN_TIMEOUT_MS mit null, der Start hängt nicht", async () => {
    vi.useFakeTimers();
    (globalThis as { indexedDB?: unknown }).indexedDB = { open: () => ({}) };
    const p = openIdbPort("x");
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
    expect(await p).toBeNull();
  });

  it("ein Speicher mit Port: close() reicht an den Port weiter und wirft nie", async () => {
    let closed = 0;
    const store = await createMarkStore({ read: () => Promise.resolve([]), write: () => undefined, close: () => { closed++; } });
    store.close();
    expect(closed).toBe(1);
    expect(() => { (store as unknown as { close(): void }).close(); }).not.toThrow();
    const ohne = await createMarkStore(null);
    expect(() => { ohne.close(); }).not.toThrow();
  });
});
