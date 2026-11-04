// Messprobe der Maße im ECHTEN Chromium (Plan 2, C3, Review B2, S1, S2, N3): rechnen `userBox` und `drawingBox` (`src/obsidian/panel/bbox.ts`) für gängige Eingaben richtig?
// LAB-CODE: läuft außerhalb des Gates, kein Modell, nur chrome-headless-shell.
//
//   Aufruf:  npx vite-node scripts/lab/measure-probe.ts          (Exit-Code 1, wenn ein Fall vom Soll abweicht)
//
// Jeder Fall nennt das Soll im Benutzerraum der Wurzel (von Hand gerechnet) und die Ist-Zahl der echten Vorschau (`buildPreview` mit `boxOf`). `null` heißt „nichts zu messen“.
// Dazu die Laufzeit von `drawingBox` bei 5 000 Kindern (S2: eine Umrechnung statt einer je Kind) und das verborgene Panel (N3: `null`, nie eine Null-Box).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePage, Cdp, OBSIDIAN_DOM_SHIM } from "./cdp";
import { findChrome } from "./chrome";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NS = 'xmlns="http://www.w3.org/2000/svg"';

interface B { x: number; y: number; width: number; height: number }
interface Case { name: string; svg: string; want: Record<string, B | null> }
const b = (x: number, y: number, width: number, height: number): B => ({ x, y, width, height });

const CASES: Case[] = [
  { name: "B2.1 verschachteltes <svg x=100 y=100 width=100 height=100 viewBox 0 0 10 10>, rect 10 × 10",
    svg: `<svg ${NS} viewBox="0 0 400 400"><svg id="ns" x="100" y="100" width="100" height="100" viewBox="0 0 10 10"><rect id="n" width="10" height="10"/></svg></svg>`,
    want: { n: b(100, 100, 100, 100), "*": b(100, 100, 100, 100) } },
  { name: "B2.2 display=none und leere Gruppe mit transform an der Wurzel",
    svg: `<svg ${NS} viewBox="0 0 400 400"><rect id="a" x="100" y="100" width="100" height="100"/><rect id="h" display="none" width="50" height="50"/><g id="e" transform="translate(350,350)"/></svg>`,
    want: { a: b(100, 100, 100, 100), h: null, e: null, "*": b(100, 100, 100, 100) } },
  { name: "B2.3 <symbol> und <marker>, <pattern>, Verlauf, clipPath an der Wurzel",
    svg: `<svg ${NS} viewBox="0 0 400 400"><symbol id="s"><rect width="390" height="390"/></symbol><marker id="m"><rect width="380" height="380"/></marker><pattern id="p"><rect width="370" height="370"/></pattern><clipPath id="c"><rect width="360" height="360"/></clipPath><rect id="a" x="100" y="100" width="100" height="100"/></svg>`,
    want: { a: b(100, 100, 100, 100), "*": b(100, 100, 100, 100) } },
  { name: "rotiertes Element: translate(10,20) rotate(90), rect 30 × 10",
    svg: `<svg ${NS} viewBox="0 0 100 100"><g id="g" transform="translate(10,20) rotate(90)"><rect id="r" width="30" height="10"/></g></svg>`,
    want: { r: b(0, 20, 10, 30), g: b(0, 20, 10, 30) } },
  { name: "Element in <defs> und <use> darauf (x=50 y=60)",
    svg: `<svg ${NS} viewBox="0 0 100 100"><defs><rect id="d" width="10" height="10"/></defs><use id="u" href="#d" x="50" y="60"/></svg>`,
    want: { u: b(50, 60, 10, 10), "*": b(50, 60, 10, 10) } },
  { name: "viewBox mit Versatz (-50 -50 100 100)",
    svg: `<svg ${NS} viewBox="-50 -50 100 100"><rect id="o" x="-50" y="-40" width="10" height="10"/></svg>`,
    want: { o: b(-50, -40, 10, 10) } },
  { name: "preserveAspectRatio: viewBox 100 × 50 in 300 × 300",
    svg: `<svg ${NS} viewBox="0 0 100 50" width="300" height="300"><rect id="p" x="10" y="10" width="20" height="20"/></svg>`,
    want: { p: b(10, 10, 20, 20) } },
  { name: "CSS-Transformation an der Wurzel (rotate(10deg))",
    svg: `<svg ${NS} viewBox="0 0 100 100" style="transform: rotate(10deg)"><rect id="rz" x="10" y="10" width="20" height="20"/></svg>`,
    want: { rz: b(10, 10, 20, 20) } },
  { name: "S1: CSS des SVG trifft keinen Messfühler (g { transform: scale(0) }, svg > g:empty { scale(.5) })",
    svg: `<svg ${NS} viewBox="0 0 400 400"><style>g { transform: scale(0) } svg > g:empty { transform: scale(.5) }</style><rect id="r" x="10" y="10" width="20" height="20"/></svg>`,
    want: { r: b(10, 10, 20, 20) } },
];

async function pageScript(): Promise<string> {
  const guard = JSON.stringify(resolve(ROOT, "src/vendor/kit/svg-guard.ts"));
  const preview = JSON.stringify(resolve(ROOT, "src/obsidian/panel/preview.ts"));
  const entry = `
    import { checkSvg } from ${guard};
    import { buildPreview } from ${preview};
    ${OBSIDIAN_DOM_SHIM}
    const css = ".svg-studio-stage-wrap{position:relative;contain:paint;overflow:hidden}.svg-studio-stage{width:600px;overflow:auto}";
    function mount(svg) {
      document.body.replaceChildren();
      document.body.style.margin = "0";
      document.head.appendChild(document.createElement("style")).textContent = css;
      const h = buildPreview(document.body, { guard: checkSvg, onSelect: () => {} });
      const r = h.show(svg);
      return { h, r };
    }
    window.__m = {
      measure(svg, ids) {
        const { h, r } = mount(svg);
        if (!r.ok) return { error: r.problems.map((p) => p.code + ": " + p.detail).join("; ") };
        const boxes = { "*": h.boxOf(null) };
        for (const id of ids) boxes[id] = h.boxOf(id);
        return { boxes };
      },
      perf(n) {
        const { h, r } = mount('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">' + '<rect x="1" y="1" width="5" height="5"/>'.repeat(n) + "</svg>");
        const runs = [];
        for (let i = 0; i < 3; i++) { const t0 = performance.now(); h.boxOf(null); runs.push(performance.now() - t0); }
        return { ok: r.ok, ms: Math.min(...runs) };
      },
      hidden(svg) {
        const { h } = mount(svg);
        document.querySelector(".svg-studio-stage-wrap").style.display = "none";
        return { drawing: h.boxOf(null), r: h.boxOf("r") };
      },
    };`;
  return bundlePage(entry, ROOT);
}

const near = (a: number, c: number): boolean => Math.abs(a - c) <= 0.5;
const same = (got: B | null, want: B | null): boolean => (got === null || want === null ? got === want : near(got.x, want.x) && near(got.y, want.y) && near(got.width, want.width) && near(got.height, want.height));
const fmt = (v: B | null): string => (v === null ? "null" : `{${[v.x, v.y, v.width, v.height].map((n) => String(Math.round(n * 100) / 100)).join(", ")}}`);

async function main(): Promise<void> {
  let exe: string;
  try { exe = await findChrome(); } catch (e) { console.log(`NICHTS GEMESSEN: ${(e as Error).message}`); return; }
  const c = await Cdp.launch(exe);
  let failed = false;
  try {
    await c.eval(await pageScript());
    const version = (await c.send("Browser.getVersion")) as { product: string };
    console.log(`Browser: ${version.product} (chrome-headless-shell); Box = {x, y, Breite, Höhe} im Benutzerraum der Wurzel, Toleranz 0,5\n`);
    console.log("| Fall | Element | Soll | Ist | |\n|---|---|---|---|---|");
    for (const cs of CASES) {
      const ids = Object.keys(cs.want).filter((k) => k !== "*");
      const r = await c.eval<{ error?: string; boxes?: Record<string, B | null> }>(`__m.measure(${JSON.stringify(cs.svg)}, ${JSON.stringify(ids)})`);
      if (r.error !== undefined || r.boxes === undefined) { console.log(`| ${cs.name} | - | - | Bereiniger lehnt ab: ${r.error ?? "?"} | FEHLER |`); failed = true; continue; }
      for (const [k, want] of Object.entries(cs.want)) {
        const got = r.boxes[k] ?? null;
        const ok = same(got, want);
        if (!ok) failed = true;
        console.log(`| ${cs.name} | ${k === "*" ? "Zeichnung" : `#${k}`} | ${fmt(want)} | ${fmt(got)} | ${ok ? "ok" : "ABWEICHUNG"} |`);
      }
    }
    const perf = await c.eval<{ ok: boolean; ms: number }>("__m.perf(4999)");
    const perfOk = perf.ok && perf.ms < 100;
    console.log(`\nS2 Laufzeit drawingBox bei 4 999 Kindern: ${String(Math.round(perf.ms))} ms (Schranke 100 ms; vorher 643 ms) → ${perfOk ? "ok" : "ZU LANGSAM"}`);
    if (!perfOk) failed = true;
    const hid = await c.eval<{ drawing: B | null; r: B | null }>(`__m.hidden(${JSON.stringify(`<svg ${NS} viewBox="0 0 100 100"><rect id="r" width="10" height="10"/></svg>`)})`);
    const hidOk = hid.drawing === null && hid.r === null;
    console.log(`N3 verborgenes Panel (display:none am Wrapper): Zeichnung ${fmt(hid.drawing)}, Element ${fmt(hid.r)} → ${hidOk ? "ok (null)" : "FALSCH (keine Null-Box erwartet)"}`);
    if (!hidOk) failed = true;
  } finally {
    c.close();
  }
  if (failed) { console.log("\nERGEBNIS: FEHLER"); process.exitCode = 1; } else console.log("\nERGEBNIS: alle Fälle stimmen.");
}

await main();
