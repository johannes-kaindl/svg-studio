// Attrappe der Obsidian-Seite von Übernehmen: eine Notiz `n.md` mit Editor, ein Vault als Karte, ein Adapter für den Schnappschuss.
// Muster: obsidian-kit `tests/panel-accept.test.ts` (Kit-eigene Fakes), hier ins Repo gekürzt und um den Schnappschuss-Adapter ergänzt.
import { vi } from "vitest";
import { MarkdownView, TFile } from "obsidian";
import type { AcceptAs } from "../../src/core/settings";
import { buildAcceptEnv } from "../../src/obsidian/accept";
import type { AcceptEnv } from "../../src/vendor/kit-obsidian/panel-accept";

export const mkFile = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

export interface AcceptOpts {
  acceptAs?: AcceptAs;
  /** Die Notiz `n.md` ist als Editor offen (Strg+Z-Weg) statt nur im Vault. */
  editorOpen?: boolean;
  /** Die zuletzt aktive Notiz steht im Lesemodus. */
  reading?: boolean;
  /** Keine Notiz offen. */
  noView?: boolean;
  /** Cursor im Editor (Zeile, Zeichen); ohne Angabe steht er am Ende der Notiz. */
  cursor?: { line: number; ch: number };
  /** Nach dem ersten Schreiben über `vault.process` wechselt die zuletzt aktive Notiz auf diese (eine zweite, im Lesemodus). */
  switchNoteTo?: string;
  /** Ein Schreibfehler des Schnappschusses (Pfadteil `snapshots`). */
  failSnapshot?: boolean;
}

export function acceptSetup(files: Record<string, string>, opts: AcceptOpts = {}) {
  const store: Record<string, string> = { ...files };
  const snaps = new Map<string, string>();
  const folders = new Set<string>();
  /** Reihenfolge der Schreib- und Schnappschuss-Aufrufe. */
  const order: string[] = [];
  const text = (p: string): string => store[p] ?? "";
  const cursor = (): { line: number; ch: number } => {
    if (opts.cursor !== undefined) return opts.cursor;
    const lines = text("n.md").split("\n");
    return { line: lines.length - 1, ch: (lines.at(-1) ?? "").length };
  };
  const offsetOf = (value: string, c: { line: number; ch: number }): number => value.split("\n").slice(0, c.line).reduce((n, l) => n + l.length + 1, 0) + c.ch;
  const editor = {
    getValue: () => text("n.md"),
    somethingSelected: () => false,
    getCursor: () => cursor(),
    replaceRange: (t: string, from: { line: number; ch: number }, to: { line: number; ch: number } = from) => {
      order.push("editor.replaceRange");
      const lines = text("n.md").split("\n");
      const head = [...lines.slice(0, from.line), (lines[from.line] ?? "").slice(0, from.ch)].join("\n");
      const tail = [(lines[to.line] ?? "").slice(to.ch), ...lines.slice(to.line + 1)].join("\n");
      store["n.md"] = head + t + tail;
    },
    // Wie Obsidian: der Text kommt an den Cursor.
    replaceSelection: (t: string) => {
      order.push("editor.replaceSelection");
      const v = text("n.md");
      const o = offsetOf(v, cursor());
      store["n.md"] = v.slice(0, o) + t + v.slice(o);
    },
  };
  const view = new MarkdownView({} as never);
  Object.assign(view, { file: mkFile("n.md"), editor });
  if (opts.reading === true) view.getMode = () => "preview";
  let last: MarkdownView = view;

  const exists = (p: string): boolean => Object.keys(store).some((k) => k.toLowerCase() === p.toLowerCase()) || snaps.has(p) || folders.has(p);
  const app = {
    vault: {
      configDir: ".config-x",
      getAbstractFileByPath: (p: string) => (p in store ? mkFile(p) : null),
      read: async (f: TFile) => text(f.path),
      process: vi.fn(async (f: TFile, fn: (t: string) => string) => { order.push(`vault.process:${f.path}`); store[f.path] = fn(text(f.path)); }),
      create: vi.fn(async (path: string, data: string) => {
        if (path in store) throw new Error("File already exists.");
        order.push(`vault.create:${path}`);
        store[path] = data;
        return mkFile(path);
      }),
      createBinary: vi.fn(async () => { throw new Error("nicht erwartet"); }),
      adapter: {
        exists: async (p: string) => exists(p),
        mkdir: async (p: string) => { folders.add(p); },
        write: async (p: string, data: string) => {
          if (opts.failSnapshot === true) throw new Error("disk full");
          order.push("snapshot.write");
          snaps.set(p, data);
        },
        list: async (root: string) => ({ files: [], folders: [...folders].filter((f) => f.startsWith(`${root}/`) && !f.slice(root.length + 1).includes("/")) }),
        rmdir: async () => undefined,
      },
    },
    metadataCache: { fileToLinktext: (f: TFile) => f.name },
    fileManager: {
      // Wie Obsidian: ein belegter Name bekommt eine Nummer („name 1.svg“).
      getAvailablePathForAttachment: vi.fn(async (name: string, note: string) => {
        const dir = note === "" ? "Standard" : "Anhänge";
        const dot = name.lastIndexOf(".");
        const stem = name.slice(0, dot);
        const ext = name.slice(dot);
        let path = `${dir}/${name}`;
        for (let n = 1; exists(path); n++) path = `${dir}/${stem} ${String(n)}${ext}`;
        return path;
      }),
    },
  };
  const ports = {
    editorFor: (p: string) => (opts.editorOpen === true && p === "n.md" ? editor : null),
    vault: {
      read: async (p: string) => text(p),
      process: async (p: string, fn: (t: string) => string) => {
        order.push(`ports.process:${p}`);
        store[p] = fn(text(p));
        if (opts.switchNoteTo !== undefined) {
          const other = new MarkdownView({} as never);
          Object.assign(other, { file: mkFile(opts.switchNoteTo) });
          other.getMode = () => "preview";
          last = other;
        }
      },
    },
  };
  const env: AcceptEnv = buildAcceptEnv({
    app: app as never,
    ports,
    settings: () => ({ acceptAs: opts.acceptAs ?? "file" }),
    lastEditor: () => (opts.noView === true ? null : last),
  });
  return { env, store, snaps, order, app, view, editor };
}
