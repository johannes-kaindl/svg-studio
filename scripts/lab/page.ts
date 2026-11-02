// Browserseite des Messskripts (läuft in chrome-headless-shell, gebündelt von scripts/svg-lab.ts). Lab-Code, nicht Teil des Plugins.
// Eingabe: JSON in <script id="jobs">; Ausgabe: base64-JSON in <div id="out" data-b64>.
// Hier läuft, was ein echtes DOM braucht: Bereiniger (checkSvg), Wohlgeformtheit (DOMParser), getBBox/getCTM/getPointAtLength.
import { checkSvg } from "../../src/vendor/kit/svg-guard";

interface Job {
  key: string;
  svg: string;
  base?: string;
  /** Maßtreue: benannte Elemente gegen Soll-Ausdehnung. */
  messen?: Record<string, { w?: number; h?: number; laenge?: number; winkel?: number }>;
  prueft?: Array<Record<string, unknown>>;
}
interface Check { art: string; ok: boolean; detail: string }
interface JobResult {
  key: string;
  parseOk: boolean;
  guard: { ok: boolean; problems: string[] };
  messen: Check[] | null;
  prueft: Check[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const TOL = 1;
const TOL_DEG = 1;

interface Mounted { svg: SVGSVGElement; probe: SVGGElement }

function parseOk(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  return doc.getElementsByTagName("parsererror").length === 0 && doc.documentElement !== null;
}

/** Bereiniger, dann in die Seite hängen (nie der Text). Ein Messfühler `g` ganz am Ende liefert die Wurzel-Transformation. */
function mount(text: string): { m: Mounted | null; problems: string[] } {
  const r = checkSvg(text);
  if (!r.ok) return { m: null, problems: r.problems.slice(0, 6).map((p) => `${p.code}: ${p.detail}`) };
  const svg = r.svg;
  svg.setAttribute("width", "800");
  svg.removeAttribute("height");
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:0;top:0;width:800px";
  document.body.appendChild(holder);
  holder.appendChild(svg);
  const probe = document.createElementNS(SVG_NS, "g") as SVGGElement;
  svg.appendChild(probe);
  return { m: { svg, probe }, problems: [] };
}

interface Box { x: number; y: number; w: number; h: number }

/** Ausdehnung im Benutzerraum der Wurzel (berücksichtigt `transform` am Element und seinen Eltern, nicht die Strichstärke). */
function userBox(m: Mounted, el: SVGGraphicsElement): Box | null {
  try {
    const bb = el.getBBox();
    const V = m.probe.getCTM();
    const M = el.getCTM();
    if (!V || !M) return null;
    const T = V.inverse().multiply(M);
    const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(T));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  } catch {
    return null;
  }
}

const byId = (m: Mounted, id: string): SVGGraphicsElement | null => m.svg.querySelector(`[id="${id.replace(/"/g, '\\"')}"]`) as SVGGraphicsElement | null;
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const f = (n: number): string => String(Math.round(n * 100) / 100);

function texts(m: Mounted): Array<{ t: string; el: SVGGraphicsElement }> {
  return Array.from(m.svg.querySelectorAll("text")).map((el) => ({ t: (el.textContent ?? "").replace(/\s+/g, " ").trim(), el: el as unknown as SVGGraphicsElement }));
}

/** Union der Ausdehnungen der sichtbaren Zeichen-Kinder der Wurzel (ohne Messfühler, defs, style, title, desc). */
function contentBox(m: Mounted): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of Array.from(m.svg.children)) {
    if (c === m.probe || ["defs", "style", "title", "desc", "metadata"].includes(c.localName)) continue;
    const b = userBox(m, c as SVGGraphicsElement);
    if (!b) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function measureNamed(m: Mounted, spec: NonNullable<Job["messen"]>): Check[] {
  const out: Check[] = [];
  for (const [name, want] of Object.entries(spec)) {
    const el = byId(m, name);
    if (!el) { out.push({ art: name, ok: false, detail: "fehlt" }); continue; }
    const b = userBox(m, el);
    if (!b) { out.push({ art: name, ok: false, detail: "nicht messbar" }); continue; }
    const bad: string[] = [];
    if (want.w !== undefined && !near(b.w, want.w, TOL)) bad.push(`w ${f(b.w)} statt ${want.w}`);
    if (want.h !== undefined && !near(b.h, want.h, TOL)) bad.push(`h ${f(b.h)} statt ${want.h}`);
    if (want.laenge !== undefined || want.winkel !== undefined) {
      const g = el as unknown as SVGGeometryElement;
      try {
        const L = g.getTotalLength();
        const V = m.probe.getCTM();
        const M = el.getCTM();
        const T = V && M ? V.inverse().multiply(M) : new DOMMatrix();
        const p0 = g.getPointAtLength(0);
        const p1 = g.getPointAtLength(L);
        const a = new DOMPoint(p0.x, p0.y).matrixTransform(T);
        const z = new DOMPoint(p1.x, p1.y).matrixTransform(T);
        const len = Math.hypot(z.x - a.x, z.y - a.y);
        const ang = (Math.atan2(Math.abs(z.y - a.y), Math.abs(z.x - a.x)) * 180) / Math.PI;
        if (want.laenge !== undefined && !near(len, want.laenge, TOL)) bad.push(`Länge ${f(len)} statt ${want.laenge}`);
        if (want.winkel !== undefined && !near(ang, want.winkel, TOL_DEG)) bad.push(`Winkel ${f(ang)}° statt ${want.winkel}°`);
      } catch {
        bad.push("Endpunkte nicht lesbar (kein Linienelement?)");
      }
    }
    out.push({ art: name, ok: bad.length === 0, detail: bad.length === 0 ? `w ${f(b.w)} h ${f(b.h)}` : bad.join("; ") });
  }
  return out;
}

function hexToRgb(hex: string): string | null {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

function countColor(m: Mounted, rgb: string): number {
  let n = 0;
  for (const el of Array.from(m.svg.querySelectorAll("*"))) {
    const cs = getComputedStyle(el);
    if (cs.fill === rgb || cs.stroke === rgb) n++;
  }
  return n;
}

function runCheck(spec: Record<string, unknown>, a: Mounted, b: Mounted | null): Check {
  const art = String(spec.art);
  const need = (): Mounted | null => b;
  switch (art) {
    case "skala": {
      const base = need();
      const ba = base ? contentBox(base) : null;
      const aa = contentBox(a);
      if (!ba || !aa || ba.w === 0 || ba.h === 0) return { art, ok: false, detail: "nicht messbar" };
      const fw = aa.w / ba.w;
      const fh = aa.h / ba.h;
      const want = Number(spec.faktor);
      const tol = Number(spec.toleranz);
      return { art, ok: near(fw, want, tol) && near(fh, want, tol), detail: `Faktor ${f(fw)} × ${f(fh)} (Soll ${want} ±${tol})` };
    }
    case "farbe": {
      const rgb = hexToRgb(String(spec.wert));
      if (!rgb) return { art, ok: false, detail: "Sollfarbe unlesbar" };
      const before = b ? countColor(b, rgb) : 0;
      const after = countColor(a, rgb);
      return { art, ok: after > before, detail: `Elemente mit ${String(spec.wert)}: ${before} → ${after}` };
    }
    case "verschiebung": {
      const base = need();
      const id = String(spec.id);
      const e0 = base ? byId(base, id) : null;
      const e1 = byId(a, id);
      const b0 = base && e0 ? userBox(base, e0) : null;
      const b1 = e1 ? userBox(a, e1) : null;
      if (!b0 || !b1) return { art, ok: false, detail: `${id} fehlt oder nicht messbar` };
      const dx = b1.x - b0.x;
      const dy = b1.y - b0.y;
      return { art, ok: near(dx, Number(spec.dx), TOL) && near(dy, Number(spec.dy), TOL), detail: `Δx ${f(dx)} Δy ${f(dy)} (Soll ${String(spec.dx)}, ${String(spec.dy)})` };
    }
    case "fenster": {
      const e = byId(a, String(spec.id));
      const w = byId(a, String(spec.wand));
      const be = e ? userBox(a, e) : null;
      const bw = w ? userBox(a, w) : null;
      if (!be || !bw) return { art, ok: false, detail: "Fenster oder Wand fehlt" };
      const dc = be.x + be.w / 2 - (bw.x + bw.w / 2);
      const dy = be.y + be.h / 2 - (bw.y + bw.h / 2);
      const ok = near(be.w, Number(spec.breite), TOL) && near(dc, 0, TOL) && Math.abs(dy) <= 20;
      return { art, ok, detail: `Breite ${f(be.w)}, Abstand zur Wandmitte x ${f(dc)} y ${f(dy)}` };
    }
    case "texte": {
      const ts = texts(a).map((x) => x.t);
      const da = ((spec.da as string[] | undefined) ?? []).filter((t) => !ts.includes(t));
      const fehlt = ((spec.fehlt as string[] | undefined) ?? []).filter((t) => ts.includes(t));
      return { art, ok: da.length === 0 && fehlt.length === 0, detail: `Texte [${ts.join(", ")}]${da.length ? `; fehlen: ${da.join(",")}` : ""}${fehlt.length ? `; noch da: ${fehlt.join(",")}` : ""}` };
    }
    case "strichstaerke": {
      const re = new RegExp(String(spec.ids));
      const els = Array.from(a.svg.querySelectorAll("[id]")).filter((e) => re.test(e.id));
      const want = Number(spec.wert);
      const bad = els.filter((e) => !near(parseFloat(getComputedStyle(e).strokeWidth), want, 0.01)).map((e) => e.id);
      return { art, ok: els.length > 0 && bad.length === 0, detail: els.length === 0 ? "keine Wände" : bad.length ? `nicht ${want}: ${bad.join(",")}` : `${els.length} Wände auf ${want}` };
    }
    case "beschriftung": {
      const t = String(spec.text);
      const hit = texts(a).find((x) => x.t === t);
      const room = byId(a, String(spec.raum));
      const bt = hit ? userBox(a, hit.el) : null;
      const br = room ? userBox(a, room) : null;
      if (!bt || !br) return { art: `${art} ${t}`, ok: false, detail: !hit ? "Text fehlt" : "Raum fehlt" };
      const dx = bt.x + bt.w / 2 - (br.x + br.w / 2);
      const dy = bt.y + bt.h / 2 - (br.y + br.h / 2);
      const tol = Number(spec.toleranz);
      return { art: `${art} ${t}`, ok: Math.abs(dx) <= tol && Math.abs(dy) <= tol, detail: `Abstand zur Raummitte x ${f(dx)} y ${f(dy)} (Toleranz ${tol})` };
    }
    default:
      return { art, ok: false, detail: "unbekannte Prüfung" };
  }
}

function runJob(job: Job): JobResult {
  const res: JobResult = { key: job.key, parseOk: parseOk(job.svg), guard: { ok: false, problems: [] }, messen: null, prueft: [] };
  const a = mount(job.svg);
  res.guard = { ok: a.m !== null, problems: a.problems };
  if (!a.m) { document.body.replaceChildren(); return res; }
  if (job.messen) res.messen = measureNamed(a.m, job.messen);
  if (job.prueft && job.prueft.length > 0) {
    const b = job.base ? mount(job.base).m : null;
    res.prueft = job.prueft.map((s) => {
      try { return runCheck(s, a.m as Mounted, b); } catch (e) { return { art: String(s.art), ok: false, detail: `Fehler: ${String(e)}` }; }
    });
  }
  document.body.replaceChildren();
  return res;
}

const jobs = JSON.parse(document.getElementById("jobs")?.textContent ?? "[]") as Job[];
const results = jobs.map(runJob);
const bytes = new TextEncoder().encode(JSON.stringify(results));
let bin = "";
for (const b of bytes) bin += String.fromCharCode(b);
const out = document.createElement("div");
out.id = "out";
out.dataset.b64 = btoa(bin);
document.body.appendChild(out);
