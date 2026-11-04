// Isolationsprobe der Vorschau im ECHTEN Chromium (Plan 2, C3, Review B1 und S4). LAB-CODE: läuft außerhalb des Gates, kein Modell, nur chrome-headless-shell.
//
//   Aufruf:  npx vite-node scripts/lab/isolation.ts          (Exit-Code 1, wenn ein Angriff wirkt oder eine Vererbung durchschlägt)
//
// Frage 1 (B1): Kann ein SVG, das `checkSvg` annimmt, sich über das Panel legen? Angriffe: `position: absolute` und `position: fixed` an der Wurzel, `:host { position: fixed !important;
// inset: 0; z-index: max; contain: none }` und `:host { transform: translateY(300px) scale(3) }`, alle mit einer roten Fläche. Gemessen wird, was der Nutzer spürt: trifft
// `elementFromPoint` am Knopf „Übernehmen“, an der Maßzeile und am anderen Blatt weiter dieses Element (Klicks kommen an), und ist der Pixel dort nicht rot (nichts gemalt, auch keine
// falsche Maßzeile). Die Gegenprobe baut dieselbe Vorschau OHNE den Wrapper (Host direkt im Elternknoten): dort müssen die Angriffe wirken, sonst misst die Probe nichts.
// Frage 2 (S4): Erbt das Bild Obsidians Schrift und Farbe (13 px monospace, Grau)? Soll: wie im `<img>` der Notiz (16 px, Serif, `currentColor` = Schwarz).
// Der Aufbau ahmt Obsidian nach: zwei Blätter mit `contain: strict`, rechts das Panel mit Vorschau, Maßzeile und Knopf.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { bundlePage, Cdp, OBSIDIAN_DOM_SHIM } from "./cdp";
import { findChrome } from "./chrome";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const RED = "rgb(255,0,0)";
const T = `<text id="t" x="1" y="8">x</text>`;
const ATTACKS: Record<string, string> = {
  "A1 Wurzel position:absolute": `<svg ${NS} viewBox="0 0 10 10" style="position:absolute;left:0;top:0;width:400px;height:600px;max-width:none"><rect width="10" height="10" fill="${RED}"/></svg>`,
  "A2 Wurzel position:fixed": `<svg ${NS} viewBox="0 0 10 10" style="position:fixed;left:0;top:0;width:800px;height:600px;max-width:none"><rect width="10" height="10" fill="${RED}"/></svg>`,
  "A3 :host fixed, z-index max, contain:none": `<svg ${NS} viewBox="0 0 10 10"><style>:host { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; background: ${RED} !important; max-height: none !important; contain: none !important; }</style>${T}</svg>`,
  "A4 :host transform (scale 3, 300px)": `<svg ${NS} viewBox="0 0 10 10"><style>:host { transform: translateY(300px) scale(3); transform-origin: 0 0; background: ${RED} !important; }</style>${T}</svg>`,
};

async function pageScript(): Promise<string> {
  const guard = JSON.stringify(resolve(ROOT, "src/vendor/kit/svg-guard.ts"));
  const preview = JSON.stringify(resolve(ROOT, "src/obsidian/panel/preview.ts"));
  const entry = `
    import { checkSvg } from ${guard};
    import { buildPreview } from ${preview};
    ${OBSIDIAN_DOM_SHIM}
    const hit = (n) => n === null ? "null" : n.localName + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.split(" ").join(".") : "");
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    function stage() {
      document.body.replaceChildren();
      document.body.setAttribute("style", "margin:0;font-family:monospace;font-size:13px;color:rgb(200,200,200);--interactive-accent:rgb(0,128,255)");
      const app = document.body.appendChild(document.createElement("div"));
      app.setAttribute("style", "position:relative;width:800px;height:600px;display:flex");
      const leaf = (id) => {
        const l = app.appendChild(document.createElement("div"));
        l.id = id;
        l.setAttribute("style", "width:400px;height:600px;position:relative;overflow:hidden;isolation:isolate;contain:strict");
        const v = l.appendChild(document.createElement("div"));
        v.setAttribute("style", "overflow:auto;height:100%");
        return v;
      };
      const note = leaf("note");
      note.appendChild(document.createElement("p")).id = "outside";
      note.firstChild.textContent = "Notiztext außen";
      const panel = leaf("panel");
      const ph = panel.appendChild(document.createElement("div"));
      const measure = panel.appendChild(document.createElement("div")); measure.id = "fake-measure"; measure.textContent = "Fläche 100 × 100 cm";
      const accept = panel.appendChild(document.createElement("button")); accept.id = "accept"; accept.textContent = "Übernehmen";
      // Die Regeln der Vorschau aus styles.css.
      document.head.appendChild(document.createElement("style")).textContent =
        ".svg-studio-stage-wrap{position:relative;contain:paint;overflow:hidden}.svg-studio-stage{border:1px solid gray;padding:8px;max-height:24em;overflow:auto}";
      return { ph, outside: note.firstChild, measure, accept };
    }
    window.__p = {
      attack(svg, wrapped) {
        const s = stage();
        const h = buildPreview(s.ph, { guard: checkSvg, onSelect: () => {} });
        const r = h.show(svg);
        const wrap = s.ph.querySelector(".svg-studio-stage-wrap");
        const host = s.ph.querySelector(".svg-studio-stage");
        if (!wrapped) { wrap.parentElement.insertBefore(host, wrap); wrap.remove(); }
        const [ax, ay] = center(s.accept), [mx, my] = center(s.measure), [ox, oy] = center(s.outside);
        return {
          guard: r.ok,
          hitAccept: hit(document.elementFromPoint(ax, ay)), hitMeasure: hit(document.elementFromPoint(mx, my)), hitOutside: hit(document.elementFromPoint(ox, oy)),
          points: { accept: [ax, ay], measure: [mx, my], outside: [ox, oy] },
        };
      },
      inheritance() {
        const s = stage();
        const h = buildPreview(s.ph, { guard: checkSvg, onSelect: () => {} });
        h.show('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><text id="t" x="0" y="30">Wand</text><rect id="r" width="1em" height="10" fill="currentColor"/></svg>');
        const sh = s.ph.querySelector(".svg-studio-stage").shadowRoot;
        const t = getComputedStyle(sh.querySelector("#t")), r = sh.querySelector("#r");
        return { fontFamily: t.fontFamily, fontSize: t.fontSize, fill: getComputedStyle(r).fill, widthOf1em: r.getBBox().width };
      },
    };`;
  return bundlePage(entry, ROOT);
}

/** Rot, grün, blau des Pixels (x, y) aus einem 1×1-PNG (8 Bit, RGB oder RGBA, Filter 0). */
function pixel(png: Buffer): number[] {
  let o = 8;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  return Array.from(inflateSync(Buffer.concat(idat)).subarray(1, 4));
}

const isRed = (p: number[]): boolean => p[0]! > 200 && p[1]! < 60 && p[2]! < 60;

interface Row { attack: string; wrapped: boolean; hitAccept: string; hitMeasure: string; hitOutside: string; redAt: string[]; pass: boolean }

async function main(): Promise<void> {
  let exe: string;
  try { exe = await findChrome(); } catch (e) { console.log(`NICHTS GEMESSEN: ${(e as Error).message}`); return; }
  const c = await Cdp.launch(exe);
  let failed = false;
  try {
    await c.eval(await pageScript());
    const version = (await c.send("Browser.getVersion")) as { product: string };
    console.log(`Browser: ${version.product} (chrome-headless-shell)\n`);
    const rows: Row[] = [];
    for (const wrapped of [true, false]) {
      for (const [attack, svg] of Object.entries(ATTACKS)) {
        const r = await c.eval<{ guard: boolean; hitAccept: string; hitMeasure: string; hitOutside: string; points: Record<string, number[]> }>(`__p.attack(${JSON.stringify(svg)}, ${String(wrapped)})`);
        if (!r.guard) throw new Error(`checkSvg lehnt ${attack} ab: die Probe misst nichts`);
        const redAt: string[] = [];
        for (const [name, [x, y]] of Object.entries(r.points) as Array<[string, number[]]>) {
          if (isRed(pixel(await c.shot({ x: x!, y: y!, width: 1, height: 1 })))) redAt.push(name);
        }
        const pass = r.hitAccept === "button#accept" && r.hitMeasure === "div#fake-measure" && r.hitOutside === "p#outside" && redAt.length === 0;
        rows.push({ attack, wrapped, hitAccept: r.hitAccept, hitMeasure: r.hitMeasure, hitOutside: r.hitOutside, redAt, pass });
      }
    }
    console.log("| Angriff | Wrapper | Knopf „Übernehmen“ | Maßzeile | anderes Blatt | rot gemalt über | Ergebnis |\n|---|---|---|---|---|---|---|");
    for (const r of rows) console.log(`| ${r.attack} | ${r.wrapped ? "ja" : "nein (Gegenprobe)"} | ${r.hitAccept} | ${r.hitMeasure} | ${r.hitOutside} | ${r.redAt.join(", ") || "-"} | ${r.wrapped ? (r.pass ? "wirkungslos" : "WIRKT") : (r.pass ? "wirkungslos (Probe taugt nichts)" : "wirkt (erwartet)")} |`);
    if (rows.some((r) => r.wrapped && !r.pass)) failed = true;
    if (rows.filter((r) => !r.wrapped).every((r) => r.pass)) { console.log("\nFEHLER: die Gegenprobe ohne Wrapper zeigt keinen wirksamen Angriff; die Probe beweist nichts."); failed = true; }

    const inh = await c.eval<{ fontFamily: string; fontSize: string; fill: string; widthOf1em: number }>("__p.inheritance()");
    const inhOk = inh.fontSize === "16px" && !/mono/i.test(inh.fontFamily) && inh.fill === "rgb(0, 0, 0)" && Math.round(inh.widthOf1em) === 16;
    console.log(`\nVererbung (Seite: monospace 13 px, Grau): text ${inh.fontFamily} ${inh.fontSize}, currentColor-Fläche ${inh.fill}, width="1em" = ${String(Math.round(inh.widthOf1em))} → ${inhOk ? "unbeeinflusst (wie im <img>)" : "ERBT VON OBSIDIAN"}.`);
    if (!inhOk) failed = true;
  } finally {
    c.close();
  }
  if (failed) { console.log("\nERGEBNIS: FEHLER"); process.exitCode = 1; } else console.log("\nERGEBNIS: alle Angriffe wirkungslos, Gegenprobe wirkt, keine Vererbung.");
}

await main();
