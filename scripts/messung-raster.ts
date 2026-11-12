/**
 * Messung Raster-Kosten im echten Obsidian (Task „Laufzeit-Schutz …“, Entscheidung B+ 2026-11-11): Blöcke knapp unter und über `CLICK_COST` (250 000) als
 * `<img>` mit Data-URL, 600 px breit (derselbe Weg wie der Block in der Notiz), mit Timer-Lücke (20-ms-Intervall), Frame-Lücke (rAF) und Long-Animation-Frames
 * (Skript gegen Render). Ob die Zeit den Hauptthread blockiert (Timerlücke) oder nur das Bild verspätet (Framelücke), entscheidet, ob der Wächter reicht.
 *
 * Aufruf: Zweitinstanz mit eigenem Profil und Port (Rezept: `.claude/rules/obsidian-instanz.md`), Lock mit `--exclusive focus`, dann
 *   `esbuild scripts/messung-raster.ts --bundle --platform=node --format=esm --outfile=<ordner>/messung-raster.mjs && node <ordner>/messung-raster.mjs --port 9661 --arm <name> --aus <datei.json>`
 * Der Arm (`--arm`) ist nur ein Etikett für die Ausgabe (Startschalter der Instanz: `--disable-gpu`, `--force-device-scale-factor`).
 */
import { writeFileSync } from "node:fs";

import { parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { attachTo, bereiteInstanzVor, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
// @ts-expect-error mjs ohne Typen (code-kit, Messfälle der Kostenschätzung)
import * as cases from "../../../libs/code-kit/scripts/lib/svg-cost-cases.mjs";

interface Fall { name: string; svg: () => string; anzahl?: number }

const FAELLE: Fall[] = [
  { name: "leer", svg: () => cases.base() },
  { name: "mask600 (242k)", svg: () => cases.maskMany(600, 1) },
  { name: "mask650 (262k)", svg: () => cases.maskMany(650, 1) },
  { name: "mask1000 (403k)", svg: () => cases.maskMany(1000, 1) },
  { name: "blur11 (244k)", svg: () => cases.blur(11, 30) },
  { name: "blur12 (266k)", svg: () => cases.blur(12, 30) },
  { name: "blur30 (666k)", svg: () => cases.blur(30, 30) },
  { name: "cssBlur85 (238k)", svg: () => cases.cssBlur(85, 20) },
  { name: "cssBlur95 (266k)", svg: () => cases.cssBlur(95, 20) },
  { name: "cssBlur200 (560k)", svg: () => cases.cssBlur(200, 20) },
  { name: "10x mask600 gleichzeitig", svg: () => cases.maskMany(600, 1), anzahl: 10 },
];

/** Läufe je Fall und Arm; `--laeufe <n>` überschreibt (Task „Raster-Messung in Ruhe wiederholen“: fünf). */
const LAUFE_STANDARD = 3;

/** Läuft im Renderer: zeichnet `anzahl` Bilder, misst bis zur Ruhe (1,5 s ohne Lücke über 100 ms, höchstens `maxMs`). */
const messe = (svgTexte: string[], maxMs: number): string => `
  const texte = ${JSON.stringify(svgTexte)};
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:0;top:0;width:600px;z-index:99999;background:#fff";
  document.body.appendChild(box);
  const g = { timer: 0, raf: 0, frames: 0, lastBig: 0, loafMax: 0, loafRender: 0, loafScript: 0 };
  const t0 = performance.now();
  let lt = t0, lr = t0;
  const iv = setInterval(() => { const n = performance.now(); g.timer = Math.max(g.timer, n - lt - 20); lt = n; }, 20);
  let stop = false;
  const f = () => { const n = performance.now(); const d = n - lr; g.raf = Math.max(g.raf, d); g.frames++; if (d > 100) g.lastBig = n - t0; lr = n; if (!stop) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  let po = null;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { g.loafMax = Math.max(g.loafMax, e.duration); g.loafRender += e.renderStart ? (e.startTime + e.duration - e.renderStart) : 0; g.loafScript += e.scripts.reduce((a, s) => a + s.duration, 0); } }); po.observe({ type: "long-animation-frame", buffered: false }); } catch { /* ältere Engine */ }
  let geladen = 0, tLoad = 0;
  for (const t of texte) {
    const img = document.createElement("img");
    img.style.cssText = "width:600px;height:auto;display:block";
    img.onload = () => { geladen++; tLoad = Math.max(tLoad, performance.now() - t0); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
    box.appendChild(img);
  }
  while (performance.now() - t0 < ${String(maxMs)}) {
    await new Promise((r) => setTimeout(r, 100));
    if (geladen === texte.length && performance.now() - t0 - g.lastBig > 1500 && performance.now() - t0 > 2000) break;
  }
  stop = true; clearInterval(iv); if (po) po.disconnect();
  const dauer = performance.now() - t0;
  box.remove();
  return JSON.stringify({ dpr: window.devicePixelRatio, geladen, tLoad: Math.round(tLoad), timerMax: Math.round(g.timer), frameMax: Math.round(g.raf), frames: g.frames, letzteLuecke: Math.round(g.lastBig), dauer: Math.round(dauer), loafMax: Math.round(g.loafMax), loafRender: Math.round(g.loafRender), loafScript: Math.round(g.loafScript) });`;

interface Messung { dpr: number; geladen: number; tLoad: number; timerMax: number; frameMax: number; frames: number; letzteLuecke: number; dauer: number; loafMax: number; loafRender: number; loafScript: number }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.value("port"));
  if (!Number.isInteger(port)) throw new Error("--port <Port> ist Pflicht (Zweitinstanz)");
  const arm = args.value("arm") ?? "?";
  const aus = args.value("aus");
  const LAUFE = Number(args.value("laeufe") ?? LAUFE_STANDARD);
  const cdp = await attachTo("workspace", port, "svg-studio");
  if (cdp === null) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${String(port)}`);
  // Frisches Profil: Vertrauensdialog bestätigen, damit der Workspace da ist (die Messung braucht kein Plugin).
  const klar = await bereiteInstanzVor(cdp, { pluginIds: [], nurVault: "svg-studio", sprache: "en" });
  console.log(`Instanz: ${klar.hinweis}`);
  await requireVisible(cdp, args.has("vordergrund") ? { vordergrund: "nehmen" } : {});
  const info = await cdp.evaluate<string>(`return JSON.stringify({ dpr: window.devicePixelRatio, ua: navigator.userAgent, sichtbar: document.visibilityState, gpu: !!document.createElement("canvas").getContext("webgl") });`);
  console.log(`Arm ${arm}: ${info}`);
  const zeilen: Array<{ fall: string; laeufe: Messung[] }> = [];
  let nonce = 0;
  for (const fall of FAELLE) {
    const laeufe: Messung[] = [];
    for (let i = 0; i < LAUFE; i++) {
      // Frische URL je Lauf (Dekodier-Cache): ein Kommentar vor der Wurzel ändert Kosten nicht, aber den Text.
      const texte = Array.from({ length: fall.anzahl ?? 1 }, () => `<!-- ${String(++nonce)} -->${fall.svg()}`);
      const r = await Promise.race([
        cdp.evaluate<string>(messe(texte, 40000)),
        new Promise<string>((res) => setTimeout(() => res("KEINE ANTWORT"), 60000)),
      ]);
      if (r === "KEINE ANTWORT") { console.log(`  ${fall.name}: Renderer antwortet nicht in 60 s`); break; }
      laeufe.push(JSON.parse(r) as Messung);
      await new Promise((res) => setTimeout(res, 800));
    }
    zeilen.push({ fall: fall.name, laeufe });
    const w = (k: keyof Messung): string => laeufe.map((m) => String(m[k])).join("/");
    console.log(`  ${fall.name.padEnd(26)} load ${w("tLoad").padEnd(14)} timerMax ${w("timerMax").padEnd(12)} frameMax ${w("frameMax").padEnd(14)} letzteLücke ${w("letzteLuecke").padEnd(16)} loaf(render) ${w("loafRender")}`);
  }
  if (aus !== undefined) writeFileSync(aus, JSON.stringify({ arm, info: JSON.parse(info) as unknown, zeilen }, null, 1));
  cdp.close();
}

runDriver(main);
