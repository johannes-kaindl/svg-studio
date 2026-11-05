// Dauerhafter Speicher der Absturzmarken (Kern: `src/core/render-guard.ts`, Wächter: `render-guard.ts`).
//
// Warum nicht `localStorage`: Chromium schreibt es mit einer Ratenbremse (`max(5 s, 60 min × Commits / 60 − verstrichene Zeit)`); nur der erste Schreibvorgang einer Sitzung
// liegt nach 5 s auf der Platte, danach dauert es bis zu rund 60 s (gemessen im Opus-Review 2026-11-05: 5,1 / 53,7 / 59,0 / 59,0 s; Obsidian setzt
// `--enable-aggressive-domstorage-flushing` nicht). Ein `kill -9` oder „Sofort beenden“ im Hänger verliert die Marke dann. Warum nicht eine Datei im Plugin-Ordner:
// `adapter.write` ist asynchron und seine Fortsetzungen brauchen den Hauptthread, der hängt; `fs` verletzt die Store-Regel `no-nodejs-modules`; und der Plugin-Ordner
// wird mitsynchronisiert (die Marke gehört zum Gerät, nicht in den Sync).
// IndexedDB mit `put` und `commit()` überlebt `kill -9` auch nach 0,3 s mitten in einem 30-s-Hänger (gemessen; tragend ist `commit()`: nur `strict` ohne `commit()` verlor die Marke
// 3 von 3, `commit()` allein hielt sie 3 von 3; `strict` kommt dazu), ist gerätelokal und Web-Standard (läuft auch am Handy; wo `commit()` fehlt, etwa Safari vor 15, bleibt der
// Schutz auf die Sitzung beschränkt, gefangen und ungemessen). Die Liste liegt zusätzlich im Hauptspeicher: Lesen ist synchron, geschrieben wird beim Setzen der Marke, VOR dem Rendern.
// Fehlt IndexedDB oder ist es gesperrt (Privatmodus, Quota), arbeitet der Speicher nur im Hauptspeicher weiter: der Schutz gilt dann nur innerhalb der Sitzung, ohne Fehlerflut.
import type { App } from "obsidian";
import { parseMarks, type Mark } from "../core/render-guard";

export interface MarkStore {
  /** Die Marken, synchron (aus dem Hauptspeicher). */
  read(): Mark[];
  /** Ersetzt die Liste; das Festschreiben läuft im Hintergrund und wirft nie. */
  write(marks: Mark[]): void;
  /** Schließt die Verbindung zum dauerhaften Speicher (Plugin wird entladen). */
  close(): void;
}

/** Was der dauerhafte Teil können muss: einmal lesen (beim Start), schreiben ohne zu warten. */
export interface DurablePort {
  read(): Promise<unknown>;
  write(marks: Mark[]): void;
  close?(): void;
}

/** Hauptspeicher plus (falls vorhanden) dauerhafter Port. Liest den Port einmal; ein Fehler dabei heißt: leere Liste. */
export async function createMarkStore(port: DurablePort | null): Promise<MarkStore> {
  let mem: Mark[] = [];
  if (port !== null) {
    try { mem = parseMarks(await port.read()); } catch { mem = []; }
  }
  return {
    read: () => mem,
    write(marks) {
      mem = marks;
      try { port?.write(marks); } catch { /* ohne dauerhaften Speicher gilt der Schutz nur in dieser Sitzung */ }
    },
    close() {
      try { port?.close?.(); } catch { /* schon zu */ }
    },
  };
}

const STORE_NAME = "marks";
const KEY = "list";

/** So lange wartet der Start auf IndexedDB; danach arbeitet der Speicher nur im Hauptspeicher (ein blockiertes Öffnen kommt ohne Ereignis, und Obsidian lädt Plugins nacheinander). */
export const OPEN_TIMEOUT_MS = 1500;

/** IndexedDB als dauerhafter Port; `null`, wenn es fehlt, sich nicht öffnen lässt oder nicht binnen `OPEN_TIMEOUT_MS` antwortet. */
export function openIdbPort(name: string): Promise<DurablePort | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { resolve(null); }, OPEN_TIMEOUT_MS);
    const done = (port: DurablePort | null): void => { window.clearTimeout(timer); resolve(port); };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, 1);
    } catch {
      done(null);
      return;
    }
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onerror = () => { done(null); };
    req.onblocked = () => { done(null); };
    req.onsuccess = () => {
      const db = req.result;
      // Eine spätere Schema-Version oder ein `deleteDatabase` darf nicht an unserer offenen Verbindung hängen.
      db.onversionchange = () => { db.close(); };
      done({
        close: () => { db.close(); },
        read: () => new Promise((res, rej) => {
          const get = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(KEY);
          get.onsuccess = () => { res(get.result); };
          get.onerror = () => { rej(get.error ?? new Error("indexeddb read")); };
        }),
        write(marks) {
          // `strict`: die Daten sind beim Abschluss auf der Platte; `commit()` stößt das sofort an, auch wenn der Hauptthread danach hängt (gemessen).
          const tx = db.transaction(STORE_NAME, "readwrite", { durability: "strict" });
          tx.objectStore(STORE_NAME).put(marks, KEY);
          tx.commit();
        },
      });
    };
  });
}

/** Der Speicher des Plugins: IndexedDB je Vault (`appId`), sonst Hauptspeicher. */
export async function openMarkStore(app: App): Promise<MarkStore> {
  const appId = (app as unknown as { appId?: string }).appId ?? "app";
  return createMarkStore(await openIdbPort(`svg-studio-render-marks-${appId}`));
}
