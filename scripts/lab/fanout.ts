// Fan-out-Messung (Plan 2, Entscheidung 9; REGISTRY svg-guard „Offen: feImage-/marker-Fan-out ungezählt“). LAB-CODE: läuft außerhalb des Gates.
//
//   Aufruf:  npx vite-node scripts/lab/fanout.ts -- [--runs 5] [--nur a,b,b2,c] [--json] [--shots <ordner>]
//
// Frage: Gibt es SVGs unter 1 MB, die der Bereiniger (`checkSvg`, im ECHTEN Chromium) annimmt und die sich trotzdem sehr lange rendern, weil er marker- und
// feImage-Verweise nicht zählt? Fälle: (a) `polyline` mit 50 000 Punkten und `marker-mid` auf einen `marker` mit einer Gruppe aus 200 Elementen,
// (b) `feImage`-Kette über `href="#g"`, zehn Stufen, (c) verschachtelte `pattern`-Füllungen, dazu Zusatzfälle, die die Fächerung steigern: b2/b4/b8 (2, 4 oder
// 8 `feImage` je Stufe, also 2^10 bis 8^10 Aufrufe) und c2 (vier Flächen je Kachel), und ein leeres SVG als Grundlinie. Je Fall: besteht `checkSvg`? Und die Renderzeit in chrome-headless-shell (Playwright-Cache) auf zwei Wegen:
//   - `<img>` mit Data-URL (so zeigt die Notiz den Block) und
//   - DOM im Shadow Root (so zeigt das Panel; die echte `buildPreview`, zusätzlich die Zeit für `boxOf(null)` der Maßzeile).
// „Renderzeit“ = vom Einfügen bis zum Ende eines `Page.captureScreenshot` (erzwingt Layout, Zeichnen und Rastern); die Grundlinie (leeres SVG) wird abgezogen.
// Je Weg `--runs` Läufe (Vorgabe 5), Median; dauert ein Lauf über 5 s, bricht die Reihe danach ab (n steht in der Tabelle). Ein Aufruf über 120 s gilt als Zeitüberschreitung
// (Browser wird neu gestartet, Ergebnis „> 120 000 ms“). Findet sich kein chrome-headless-shell, steht „nichts gemessen“ da, nicht „kein Befund“.
// Dazu eine Isolationsprobe im echten Chromium: ein SVG mit `<style>* { color: red }</style>` im Shadow Root ändert die Farbe außerhalb nicht.
// Das Skript lädt kein Modell. Befund (> 1 000 ms bei angenommenem SVG): Task im code-kit-Cockpit, Zahlen aus dieser Ausgabe.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePage, Cdp, CALL_TIMEOUT_MS, OBSIDIAN_DOM_SHIM } from "./cdp";
import { findChrome } from "./chrome";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const THRESHOLD_MS = 1000;
const SLOW_RUN_MS = 5_000;

// ---------- Die Fälle ----------

interface Case { key: string; title: string; svg: string }

/** (a) 50 000 Punkte, `marker-mid` zeichnet an jedem inneren Punkt eine Gruppe aus 200 Elementen. */
function caseMarker(points = 50_000, group = 200): string {
  const pts: string[] = [];
  for (let i = 0; i < points; i++) pts.push(`${(i * 37) % 1000},${(i * 53) % 1000}`);
  const dots: string[] = [];
  for (let i = 0; i < group; i++) dots.push(`<circle cx="${(i % 20) * 2}" cy="${Math.floor(i / 20) * 2}" r="0.8" fill="#c00"/>`);
  return `<svg ${NS} viewBox="0 0 1000 1000"><defs><marker id="m" markerWidth="40" markerHeight="20" refX="0" refY="0" markerUnits="userSpaceOnUse"><g id="mg">${dots.join("")}</g></marker></defs>`
    + `<polyline id="p" fill="none" stroke="#000" stroke-width="0.2" marker-mid="url(#m)" points="${pts.join(" ")}"/></svg>`;
}

/** (b) `feImage`-Kette: jede Stufe ist eine Gruppe mit einem Filter, dessen `feImage` auf die Vorstufe zeigt. `per` = `feImage` je Filter (2: Aufrufe verdoppeln sich je Stufe). */
function caseFeImage(stages = 10, per = 1): string {
  const parts: string[] = [`<g id="g0"><rect x="10" y="10" width="80" height="80" fill="#36c"/></g>`];
  for (let i = 1; i <= stages; i++) {
    const imgs = Array.from({ length: per }, (_, k) => `<feImage href="#g${String(i - 1)}" x="${String(k * 2)}" y="${String(k * 2)}" width="100" height="100" result="i${String(k)}"/>`).join("");
    const merge = per > 1 ? `<feMerge>${Array.from({ length: per }, (_, k) => `<feMergeNode in="i${String(k)}"/>`).join("")}</feMerge>` : "";
    parts.push(`<filter id="f${String(i)}" x="0" y="0" width="100" height="100" filterUnits="userSpaceOnUse">${imgs}${merge}</filter>`);
    parts.push(`<g id="g${String(i)}" filter="url(#f${String(i)})"><rect x="0" y="0" width="100" height="100" fill="none"/></g>`);
  }
  // Nur die letzte Stufe wird gezeichnet; die Vorstufen liegen in `defs`.
  const defs = parts.slice(0, -1).join("");
  return `<svg ${NS} viewBox="0 0 100 100"><defs>${defs}</defs>${parts.at(-1)!}</svg>`;
}

/** (c) verschachtelte `pattern`-Füllungen: jede Kachel (2 × 2) enthält eine Fläche, die mit dem nächsten Muster gefüllt ist. */
function casePattern(depth = 10): string {
  const pats: string[] = [];
  for (let i = 0; i < depth; i++) {
    const fill = i === depth - 1 ? "#36c" : `url(#p${String(i + 1)})`;
    pats.push(`<pattern id="p${String(i)}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${fill}"/><circle cx="1" cy="1" r="0.5" fill="${fill}"/></pattern>`);
  }
  return `<svg ${NS} viewBox="0 0 1000 1000"><defs>${pats.join("")}</defs><rect id="r" width="1000" height="1000" fill="url(#p0)"/></svg>`;
}

/** (c2) Zusatz: jede Kachel enthält `per` Flächen, die alle mit dem nächsten Muster gefüllt sind (per^Tiefe Aufrufe, wenn der Browser nichts zwischenspeichert). */
function casePatternFan(depth = 10, per = 4): string {
  const pats: string[] = [];
  for (let i = 0; i < depth; i++) {
    const fill = i === depth - 1 ? "#36c" : `url(#p${String(i + 1)})`;
    const rects = Array.from({ length: per }, (_, k) => `<rect x="${String(k % 2)}" y="${String(Math.floor(k / 2))}" width="1" height="1" fill="${fill}"/>`).join("");
    pats.push(`<pattern id="p${String(i)}" width="2" height="2" patternUnits="userSpaceOnUse">${rects}</pattern>`);
  }
  return `<svg ${NS} viewBox="0 0 1000 1000"><defs>${pats.join("")}</defs><rect id="r" width="1000" height="1000" fill="url(#p0)"/></svg>`;
}

function cases(): Case[] {
  return [
    { key: "base", title: "Grundlinie: ein Kreis", svg: `<svg ${NS} viewBox="0 0 100 100"><circle id="c" cx="50" cy="50" r="40" fill="#36c"/></svg>` },
    { key: "a", title: "(a) polyline 50 000 Punkte, marker-mid, marker mit 200 Elementen", svg: caseMarker() },
    { key: "b", title: "(b) feImage-Kette, 10 Stufen, 1 feImage je Stufe", svg: caseFeImage(10, 1) },
    { key: "b2", title: "(b2) feImage-Kette, 10 Stufen, 2 feImage je Stufe (2^10)", svg: caseFeImage(10, 2) },
    { key: "b4", title: "(b4, Zusatz) feImage-Kette, 10 Stufen, 4 feImage je Stufe (4^10)", svg: caseFeImage(10, 4) },
    { key: "b8", title: "(b8, Zusatz) feImage-Kette, 10 Stufen, 8 feImage je Stufe (8^10)", svg: caseFeImage(10, 8) },
    { key: "c", title: "(c) pattern in pattern, 10 Stufen, Kachel 2 × 2 auf 1000 × 1000", svg: casePattern(10) },
    { key: "c2", title: "(c2, Zusatz) pattern in pattern, 10 Stufen, 4 Flächen je Kachel (4^10)", svg: casePatternFan(10, 4) },
  ];
}

// ---------- Die Seite im Browser ----------

/** Browserseite: bündelt den echten Bereiniger und die echte Vorschau. `createDiv`/`createEl` sind Obsidians Erweiterungen; hier ein Ersatz. */
async function pageBundle(): Promise<string> {
  const guard = JSON.stringify(resolve(ROOT, "src/vendor/kit/svg-guard.ts"));
  const preview = JSON.stringify(resolve(ROOT, "src/obsidian/panel/preview.ts"));
  const entry = `
    import { checkSvg } from ${guard};
    import { buildPreview } from ${preview};
    ${OBSIDIAN_DOM_SHIM}
    const stage = () => { document.body.replaceChildren(); document.body.style.margin = "0"; };
    const flat = (p) => p.code + ": " + p.detail;
    window.__lab = {
      check(text) { const t0 = performance.now(); const r = checkSvg(text); return { ok: r.ok, ms: performance.now() - t0, problems: r.ok ? [] : r.problems.slice(0, 5).map(flat) }; },
      async img(text) {
        stage();
        const bytes = new TextEncoder().encode(text); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
        const img = document.body.appendChild(new Image());
        img.style.cssText = "display:block;width:600px;height:auto";
        img.src = "data:image/svg+xml;base64," + btoa(bin);
        await img.decode();
        return { w: img.naturalWidth };
      },
      shadow(text) {
        stage();
        let selected = "-";
        const h = buildPreview(document.body, { guard: checkSvg, onSelect: (id) => { selected = String(id); } });
        const t0 = performance.now();
        const r = h.show(text);
        const showMs = performance.now() - t0;
        const t1 = performance.now();
        const box = r.ok ? h.boxOf(null) : null;
        const boxMs = performance.now() - t1;
        document.body.firstElementChild.style.cssText = "width:600px";
        window.__h = h;
        return { ok: r.ok, showMs, boxMs, box };
      },
      isolation() {
        stage();
        const outside = document.body.appendChild(document.createElement("p")); outside.textContent = "außen";
        const before = getComputedStyle(outside).color;
        const h = buildPreview(document.body, { guard: checkSvg, onSelect: () => {} });
        const r = h.show('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>* { color: red }</style><text id="t" x="1" y="5">x</text></svg>');
        const inside = getComputedStyle(document.body.querySelector(".svg-studio-stage").shadowRoot.querySelector("text")).color;
        const after = getComputedStyle(outside).color;
        const body = getComputedStyle(document.body).color;
        return { ok: r.ok, before, after, body, inside };
      },
    };`;
  return bundlePage(entry, ROOT);
}

// ---------- Messen ----------

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const ms = (n: number): string => `${String(Math.round(n))}`;

interface Series { runs: number[]; timedOut: boolean; png: number; extra: Record<string, number | null> }
interface Row {
  key: string; title: string; bytes: number;
  guard: { ok: boolean; ms: number; problems: string[] };
  img: Series | null; shadow: Series | null;
}

async function series(c: { current: Cdp }, exe: string, bundle: string, call: string, runs: number, shot: string | null): Promise<Series> {
  const out: Series = { runs: [], timedOut: false, png: 0, extra: {} };
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    try {
      const r = await c.current.eval<Record<string, unknown>>(call);
      const p = await c.current.paint();
      out.png = p.bytes;
      if (shot !== null) await writeFile(shot, Buffer.from(p.data, "base64"));
      out.runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (typeof r === "object" && r !== null) {
        for (const k of ["showMs", "boxMs"]) if (typeof r[k] === "number") (out.extra[k] ??= 0, out.extra[k] = Math.max(out.extra[k] as number, r[k]));
        const bx = r.box as { width?: number; height?: number } | null | undefined;
        out.extra.boxNull = bx === null || bx === undefined ? 1 : 0;
      }
    } catch (e) {
      out.timedOut = true;
      process.stderr.write(`  Abbruch: ${(e as Error).message.slice(0, 200)}\n`);
      c.current.close();
      c.current = await Cdp.launch(exe);
      await c.current.eval(bundle);
      break;
    }
    if (out.runs.at(-1)! > SLOW_RUN_MS) break;
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const arg = (k: string): string | null => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? null) : null; };
  const runs = Number(arg("--runs") ?? 5);
  const only = arg("--nur")?.split(",") ?? null;
  const json = argv.includes("--json");
  // `--shots <ordner>`: je Fall und Weg das letzte Bild als PNG (Gegenprobe, dass wirklich etwas gezeichnet wurde).
  const shots = arg("--shots");
  if (shots !== null) await mkdir(shots, { recursive: true });

  let exe: string;
  try { exe = await findChrome(); } catch (e) {
    console.log(`NICHTS GEMESSEN: ${(e as Error).message}`);
    return;
  }
  const bundle = await pageBundle();
  const c = { current: await Cdp.launch(exe) };
  try {
    await c.current.eval(bundle);
    const version = (await c.current.send("Browser.getVersion")) as { product: string };

    const iso = await c.current.eval<{ ok: boolean; before: string; after: string; body: string; inside: string }>("__lab.isolation()");
    const rows: Row[] = [];
    for (const cs of cases()) {
      if (only && cs.key !== "base" && !only.includes(cs.key)) continue;
      const bytes = new TextEncoder().encode(cs.svg).length;
      process.stderr.write(`${cs.key}: ${String(bytes)} Byte\n`);
      await c.current.eval(`window.__t = ${JSON.stringify(cs.svg)}; 0`);
      const guard = await c.current.eval<Row["guard"]>("__lab.check(window.__t)");
      const row: Row = { key: cs.key, title: cs.title, bytes, guard, img: null, shadow: null };
      if (guard.ok) {
        row.img = await series(c, exe, bundle, "__lab.img(window.__t)", runs, shots === null ? null : join(shots, `${cs.key}-img.png`));
        // Nach einem Neustart steht der Text nicht mehr da.
        await c.current.eval(`window.__t = ${JSON.stringify(cs.svg)}; 0`);
        row.shadow = await series(c, exe, bundle, "(async () => __lab.shadow(window.__t))()", runs, shots === null ? null : join(shots, `${cs.key}-shadow.png`));
      }
      rows.push(row);
    }
    if (json) { console.log(JSON.stringify({ browser: version.product, isolation: iso, rows }, null, 1)); return; }

    const base = rows.find((r) => r.key === "base");
    const bImg = base?.img && !base.img.timedOut ? median(base.img.runs) : 0;
    const bShadow = base?.shadow && !base.shadow.timedOut ? median(base.shadow.runs) : 0;
    console.log(`Browser: ${version.product} (chrome-headless-shell), 800 × 600, ${String(runs)} Läufe je Weg, Median; Renderzeit = Einfügen bis Ende des Screenshots, abzüglich Grundlinie (img ${ms(bImg)} ms, Shadow ${ms(bShadow)} ms).\n`);
    console.log("| Fall | Byte | checkSvg | img (ms) | Shadow-DOM (ms) | boxOf(null) (ms) |\n|---|---|---|---|---|---|");
    const cell = (s: Series | null, b: number): string => s === null ? "nicht gerendert" : s.timedOut ? `> ${String(CALL_TIMEOUT_MS)} (Zeitüberschreitung)` : `${ms(median(s.runs) - b)} (min ${ms(Math.min(...s.runs) - b)}, max ${ms(Math.max(...s.runs) - b)}, n=${String(s.runs.length)}, PNG ${String(s.png)} B)`;
    for (const r of rows) {
      const g = r.guard.ok ? `ok (${ms(r.guard.ms)} ms)` : `ABGELEHNT: ${r.guard.problems.join("; ")}`;
      const bx = r.shadow && !r.shadow.timedOut ? (r.shadow.extra.boxNull === 1 ? "null" : ms(r.shadow.extra.boxMs ?? 0)) : "-";
      console.log(`| ${r.title} | ${String(r.bytes)} | ${g} | ${cell(r.img, bImg)} | ${cell(r.shadow, bShadow)} | ${bx} |`);
    }
    const slow = rows.filter((r) => r.guard.ok && r.key !== "base" && [r.img, r.shadow].some((s) => s && (s.timedOut || median(s.runs) - (s === r.img ? bImg : bShadow) > THRESHOLD_MS)));
    console.log(`\nIsolation im echten Chromium (<style>* { color: red }</style> im Shadow Root): Farbe außen vorher ${iso.before}, nachher ${iso.after}, Seite ${iso.body}, innen ${iso.inside} → ${iso.before === iso.after && iso.inside.includes("255, 0, 0") ? "isoliert" : "NICHT ISOLIERT"}.`);
    console.log(`\nBefund (angenommen von checkSvg und > ${String(THRESHOLD_MS)} ms): ${slow.length === 0 ? "keiner" : slow.map((r) => r.key).join(", ")}`);
  } finally {
    c.current.close();
  }
}

await main();
