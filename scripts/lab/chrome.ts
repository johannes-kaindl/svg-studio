// Startet die Messseite (scripts/lab/page.ts) in chrome-headless-shell und liest ihr Ergebnis. LAB-CODE.
// Kein Obsidian, keine CDP-Brücke, kein Lock: ein eigener Wegwerfprozess, der nur eine Datei im Temp-Ordner öffnet.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export interface PageJob {
  key: string;
  svg: string;
  base?: string;
  messen?: Record<string, { w?: number; h?: number; laenge?: number; winkel?: number }>;
  prueft?: Array<Record<string, unknown>>;
}
export interface PageCheck { art: string; ok: boolean; detail: string }
export interface PageResult {
  key: string;
  parseOk: boolean;
  guard: { ok: boolean; problems: string[] };
  messen: PageCheck[] | null;
  prueft: PageCheck[];
}

/** Neuestes chrome-headless-shell aus dem Playwright-Cache. */
export async function findChrome(): Promise<string> {
  const root = join(homedir(), "Library", "Caches", "ms-playwright");
  const dirs = (await readdir(root)).filter((d) => d.startsWith("chromium_headless_shell-"));
  dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const sub of await readdir(join(root, d))) {
      if (sub.startsWith("chrome-headless-shell")) return join(root, d, sub, "chrome-headless-shell");
    }
  }
  throw new Error(`kein chrome-headless-shell unter ${root} (npx playwright install chromium-headless-shell)`);
}

let bundle: string | null = null;
async function pageBundle(): Promise<string> {
  if (bundle !== null) return bundle;
  const entry = resolve(fileURLToPath(new URL("./page.ts", import.meta.url)));
  const r = await build({ entryPoints: [entry], bundle: true, format: "iife", platform: "browser", target: "es2022", write: false, logLevel: "silent" });
  bundle = r.outputFiles[0].text;
  return bundle;
}

/** Alle Aufträge in EINEM Seitenlauf (ein Prozessstart, kein Zustand zwischen Läufen). */
export async function runPage(jobs: PageJob[]): Promise<PageResult[]> {
  if (jobs.length === 0) return [];
  const [exe, js] = await Promise.all([findChrome(), pageBundle()]);
  const dir = await mkdtemp(join(tmpdir(), "svg-lab-"));
  try {
    const safeJson = JSON.stringify(jobs).replace(/</g, "\\u003c").replace(new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g"), (c) => `\\u${c.charCodeAt(0).toString(16)}`);
    const html = `<!doctype html><html><head><meta charset="utf-8"><script type="application/json" id="jobs">${safeJson}</script></head><body><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    const file = join(dir, "page.html");
    await writeFile(file, html);
    const stdout = await new Promise<string>((ok, fail) => {
      execFile(exe, ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--window-size=1000,800", "--dump-dom", `file://${file}`], { maxBuffer: 1024 * 1024 * 1024, timeout: 300_000 }, (err, out) => {
        if (err) fail(err);
        else ok(out);
      });
    });
    const m = /id="out"[^>]*data-b64="([^"]*)"/.exec(stdout) ?? /data-b64="([^"]*)"[^>]*id="out"/.exec(stdout);
    if (!m) throw new Error(`Messseite lieferte kein Ergebnis (Skriptfehler?). Anfang der Ausgabe: ${stdout.slice(0, 300)}`);
    return JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) as PageResult[];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
