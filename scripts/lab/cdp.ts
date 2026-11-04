// Kleiner DevTools-Protokoll-Treiber für chrome-headless-shell (Playwright-Cache). LAB-CODE: von `fanout.ts`, `isolation.ts` und `measure-probe.ts` benutzt.
// Ein eigener Wegwerfprozess auf Port 0, kein Obsidian, keine CDP-Brücke, kein Lock. `bundlePage` bündelt Browser-Code des Plugins zu einem Skript.
import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";

export const CALL_TIMEOUT_MS = 120_000;

export class Cdp {
  private id = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private constructor(private readonly ws: WebSocket, readonly proc: ChildProcess) {
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (m.id === undefined) return;
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.fail(new Error(m.error.message));
      else w.ok(m.result);
    });
  }

  static async launch(exe: string): Promise<Cdp> {
    const proc = spawn(exe, ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--window-size=800,600", "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const url = await new Promise<string>((ok, fail) => {
      let buf = "";
      const timer = setTimeout(() => { fail(new Error("chrome-headless-shell meldet keinen DevTools-Port")); }, 20_000);
      proc.stderr?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) { clearTimeout(timer); ok(m[1]); }
      });
      proc.on("exit", (code) => { clearTimeout(timer); fail(new Error(`chrome-headless-shell beendet (${String(code)})`)); });
    });
    const port = new URL(url).port;
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("kein Seiten-Ziel");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((ok, fail) => { ws.addEventListener("open", () => { ok(); }); ws.addEventListener("error", () => { fail(new Error("WebSocket")); }); });
    const c = new Cdp(ws, proc);
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    return c;
  }

  send(method: string, params: object = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(id); fail(new Error(`Zeitüberschreitung ${String(timeoutMs)} ms: ${method}`)); }, timeoutMs);
      this.waiting.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Punkt oder Rechteck des Bildschirms als PNG. */
  async shot(clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const r = (await this.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })) as { data: string };
    return Buffer.from(r.data, "base64");
  }

  /** Erzwingt Layout, Zeichnen, Rastern; liefert die Größe des PNG (Gegenprobe: nicht leer). */
  async paint(): Promise<{ bytes: number; data: string }> {
    const r = (await this.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    return { bytes: Math.floor((r.data.length * 3) / 4), data: r.data };
  }

  close(): void {
    try { this.ws.close(); } catch { /* schon zu */ }
    this.proc.kill("SIGKILL");
  }
}


/** Bündelt `entry` (TypeScript-Text, Importe mit absoluten Pfaden) zu einem Skript für die Seite. */
export async function bundlePage(entry: string, resolveDir: string): Promise<string> {
  const r = await build({ stdin: { contents: entry, resolveDir, loader: "ts" }, bundle: true, format: "iife", platform: "browser", target: "es2022", write: false, logLevel: "silent" });
  return r.outputFiles[0].text;
}

/** Ersatz für Obsidians `createEl`/`createDiv` auf `HTMLElement`, als Quelltext für `bundlePage`-Einträge. */
export const OBSIDIAN_DOM_SHIM = `
  const proto = HTMLElement.prototype;
  proto.createEl = function (tag, o = {}) { const e = this.ownerDocument.createElement(tag); if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; this.appendChild(e); return e; };
  proto.createDiv = function (o) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); };
`;
