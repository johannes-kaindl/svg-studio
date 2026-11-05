import { describe, expect, it } from "vitest";
import { createMarkStore, openIdbPort, type DurablePort } from "../../src/obsidian/mark-store";
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
