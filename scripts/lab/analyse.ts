// Auswertungs-Helfer des Messskripts (scripts/svg-lab.ts). LAB-CODE, nicht Teil des Plugins und nicht von der Gate geprüft.
// Das Paaren und Zerlegen kommt seit Plan 2 (B3) aus `src/core/diff.ts` (`diffSvg`); hier bleibt nur die Übersetzung in die
// Einträge der Auswertung: wie oft eine Modellantwort NICHT in eine Änderungsliste zerlegbar ist (Spec § 6.2, Entscheidung Nr. 12)
// und welche Änderungen die Anweisung nicht verlangt hat.
import { buildCanonTree } from "../../src/core/canon";
import type { SvgChange } from "../../src/core/changes";
import { diffSvg } from "../../src/core/diff";
import { scanElements } from "../../src/core/elements";
import { stripThinkBlocks } from "../../src/vendor/kit/think-splitter";

// ---------- Antworten lesen ----------

/** Entfernt <think>…</think>. Ein nie geschlossenes `<think>` verschluckt den Rest (dann ist nichts Antwort); ein einzelnes `</think>`
 *  ohne Eröffnung (der Chat-Vorlagen-Eintrag steht schon im Prompt) schneidet alles bis zum letzten `</think>` weg.
 *  `kanal` (Standard): auch der Denkkanal von Gemma — die Rohantwort ist „Entwurf, `<channel|>`, Antwort“ (reasoning_effort none, im content);
 *  alles bis zum ersten `<channel|>` ist Denken. Das ist der Leser des Plugins (`src/core/protocol.ts`). `kanal: false` ist der Leser der
 *  Messung vom 2026-11-02, der den Entwurf im Zaun las (Messnote, „Korrektur der Auswertung 2026-11-04“); nur noch für die Gegenprobe. */
export function stripThink(raw: string, o: { kanal?: boolean } = {}): string {
  if (o.kanal !== false) return stripThinkBlocks(raw, { dropStrayClose: true, dropUnclosed: true, channel: true }).trim();
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = closed.search(/<think>/i);
  if (open >= 0) return closed.slice(0, open).trim();
  const lone = closed.toLowerCase().lastIndexOf("</think>");
  return (lone >= 0 ? closed.slice(lone + "</think>".length) : closed).trim();
}

/** Der gelesene Text einer Rohantwort. Mit `kanal` (Standard) die Antwort hinter `<channel|>`; steht dort nichts Brauchbares (`has` trifft nicht), der
 *  Text davor: Gemma schreibt manchmal die Antwort in den Denkkanal und lässt die eigentliche Antwort leer (gemessen: Verfeinern V1 in der SVG-Form und
 *  alle 8 in der JSON-Form). `kanal: false` ist der Leser der Messung vom 2026-11-02 (immer der Text vor dem Kanal-Tag, Entwurf zuerst). */
function readText(raw: string, o: { kanal?: boolean }, has: RegExp): string {
  const s = stripThink(raw, o);
  return o.kanal === false || has.test(s) ? s : stripThink(raw, { kanal: false });
}

/** Kommentare zählen nicht (Auswertungsvertrag): durch Leerzeichen gleicher Länge ersetzt, Offsets bleiben gültig. */
export function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Inhalt des ersten Markdown-Zauns, der `needle` enthält; sonst der Text selbst. */
function unfence(s: string, needle: RegExp): { text: string; fenced: boolean } {
  const re = /```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) if (needle.test(m[1])) return { text: m[1], fenced: true };
  return { text: s, fenced: false };
}

export interface Extracted<T> { value: T | null; rein: boolean; fenced: boolean; error?: string }

/** SVG aus der Rohantwort: von `<svg` bis zum letzten `</svg>`. `rein` = die Antwort IST nur das SVG (ohne Zaun, Prosa, Prolog). */
export function extractSvg(raw: string, o: { kanal?: boolean } = {}): Extracted<string> {
  const s = readText(raw, o, /<svg[\s>]/i);
  const { text, fenced } = unfence(s, /<svg[\s>]/i);
  const i = text.search(/<svg[\s>]/i);
  const j = text.lastIndexOf("</svg>");
  if (i < 0 || j < i) return { value: null, rein: false, fenced, error: "kein <svg>…</svg> in der Antwort" };
  const svg = text.slice(i, j + "</svg>".length);
  return { value: svg, rein: !fenced && s.trim() === svg, fenced };
}

const OPS = new Set(["change", "add", "remove", "move"]);

/** JSON-Liste `SvgChange[]` aus der Rohantwort; prüft Form, glättet Zahlenwerte in Attributen zu Text und fehlendes parent/after zu null. */
export function extractChanges(raw: string, o: { kanal?: boolean } = {}): Extracted<SvgChange[]> {
  const s = readText(raw, o, /\[|\{/);
  const { text, fenced } = unfence(s, /\[|\{/);
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  let data: unknown;
  try {
    if (a >= 0 && b > a) data = JSON.parse(text.slice(a, b + 1));
    else data = JSON.parse(text.trim());
  } catch (e) {
    return { value: null, rein: false, fenced, error: `kein JSON: ${String(e).slice(0, 80)}` };
  }
  if (!Array.isArray(data) && data !== null && typeof data === "object") {
    const o = data as Record<string, unknown>;
    data = Array.isArray(o.changes) ? o.changes : Array.isArray(o.aenderungen) ? o.aenderungen : [data];
  }
  if (!Array.isArray(data)) return { value: null, rein: false, fenced, error: "keine Liste" };
  const out: SvgChange[] = [];
  for (const [n, raw0] of data.entries()) {
    const c = raw0 as Record<string, unknown> | null;
    if (c === null || typeof c !== "object" || typeof c.op !== "string" || !OPS.has(c.op)) return { value: null, rein: false, fenced, error: `Eintrag ${n}: op fehlt oder unbekannt` };
    const key = (v: unknown): string | null | undefined => (v === undefined || v === null ? null : typeof v === "string" ? v : undefined);
    if (c.op === "change") {
      if (typeof c.id !== "string" || c.attrs === null || typeof c.attrs !== "object") return { value: null, rein: false, fenced, error: `Eintrag ${n}: change braucht id und attrs` };
      const attrs: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(c.attrs as Record<string, unknown>)) {
        if (v === null || typeof v === "string") attrs[k] = v;
        else if (typeof v === "number" || typeof v === "boolean") attrs[k] = String(v);
        else return { value: null, rein: false, fenced, error: `Eintrag ${n}: Attributwert von ${k} nicht lesbar` };
      }
      out.push({ op: "change", id: c.id, attrs });
    } else if (c.op === "add") {
      const parent = key(c.parent);
      const after = key(c.after);
      if (typeof c.markup !== "string" || parent === undefined || after === undefined) return { value: null, rein: false, fenced, error: `Eintrag ${n}: add braucht markup, parent, after` };
      out.push({ op: "add", parent, after, markup: c.markup });
    } else if (c.op === "remove") {
      if (typeof c.id !== "string") return { value: null, rein: false, fenced, error: `Eintrag ${n}: remove braucht id` };
      out.push({ op: "remove", id: c.id });
    } else {
      const parent = key(c.parent);
      const after = key(c.after);
      if (typeof c.id !== "string" || parent === undefined || after === undefined) return { value: null, rein: false, fenced, error: `Eintrag ${n}: move braucht id, parent, after` };
      out.push({ op: "move", id: c.id, parent, after });
    }
  }
  return { value: out, rein: !fenced && s.trim().startsWith("["), fenced };
}

// ---------- id-Quote ----------

const FIXED_TAGS = new Set(["style", "title", "desc"]);

export function idQuote(text: string): { quote: number; total: number; dup: number; complete: boolean } {
  const { elements } = scanElements(text);
  const under = elements.filter((e) => e.parentKey !== null && !(FIXED_TAGS.has(e.tag) && e.key.startsWith("#")));
  const ids = under.map((e) => e.id).filter((x): x is string => x !== null && x !== "");
  const dup = ids.length - new Set(ids).size;
  const quote = under.length === 0 ? 0 : ids.length / under.length;
  return { quote, total: under.length, dup, complete: under.length > 0 && ids.length === under.length && dup === 0 };
}

// ---------- Paaren (diff.ts) ----------

export type Entry =
  | { kind: "attr"; key: string; tag: string; attr: string; from: string | null; to: string | null }
  | { kind: "add"; key: string; tag: string }
  | { kind: "remove"; key: string; tag: string; text: string }
  | { kind: "move"; key: string; tag: string }
  | { kind: "text"; key: string; tag: string };

export interface Pairing {
  entries: Entry[];
  /** `diffSvg` hat die Antwort in Einträge zerlegt (und alle zusammen ergeben die Antwort). */
  decomposable: boolean;
  /** Bei `decomposable: false` der Grund. */
  why?: string;
}

/** Gesamttext eines Elements samt Nachkommen (für die Zuordnung „Kasten B“). */
function textOfKey(baseText: string, key: string): string {
  const t = buildCanonTree(baseText);
  const i = t?.elements.findIndex((e) => e.key === key) ?? -1;
  if (t === null || i < 0) return "";
  const parts: string[] = [];
  const walk = (n: number): void => {
    for (const p of t.ownText[n]) if (p !== "") parts.push(p);
    for (const k of t.kids[n]) walk(k);
  };
  walk(i);
  return parts.join(" ").trim();
}

/** `null`, wenn Ausgang oder Antwort nicht lesbar sind (keine Zerlegung möglich); sonst die Einträge von `diffSvg` in der Form der Auswertung. */
export function pairElements(baseText: string, ansText: string): Pairing | null {
  const d = diffSvg(baseText, ansText);
  if (!d.decomposable) return /nicht lesbar/.test(d.why) ? null : { entries: [], decomposable: false, why: d.why };
  // (`nicht lesbar` gilt für Ausgang und Antwort; ein Ergebnis, das `applyChanges` nicht lesen kann, kommt hier als „passen nicht zusammen“.)
  const entries: Entry[] = d.entries.map((e): Entry => {
    switch (e.kind) {
      case "attr": return { kind: "attr", key: e.key, tag: e.tag, attr: e.attr, from: e.from, to: e.to };
      case "add": return { kind: "add", key: e.key, tag: e.tag };
      case "remove": return { kind: "remove", key: e.key, tag: e.tag, text: textOfKey(baseText, e.key) };
      case "move": return { kind: "move", key: e.key, tag: e.tag };
      case "replace": return { kind: "text", key: e.key, tag: e.tag };
    }
  });
  return { entries, decomposable: true };
}

/** Zerlegbar = `diffSvg` hat Einträge gebildet, die zusammen die Antwort ergeben. */
export function decomposable(_baseText: string, _ansText: string, p: Pairing): { ok: boolean; why?: string } {
  return p.decomposable ? { ok: true } : { ok: false, why: p.why ?? "nicht zerlegbar" };
}

// ---------- „nicht verlangt“ ----------

export interface ChangeRule { attrs: string[] | "*"; tags?: string[]; ids?: string }
export interface Allowed {
  change?: ChangeRule[];
  add?: boolean;
  remove?: boolean | { tags?: string[]; ids?: string; text?: string[] };
}

const CLASSES: Record<string, string[]> = {
  "@geometrie": ["x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "x1", "y1", "x2", "y2", "transform"],
  "@farbe": ["fill", "stroke", "style", "color", "stop-color", "fill-opacity", "stroke-opacity", "opacity"],
};

function attrAllowed(rule: ChangeRule, attr: string): boolean {
  if (rule.attrs === "*") return true;
  return rule.attrs.some((a) => (a.startsWith("@") ? (CLASSES[a] ?? []).includes(attr) : a === attr));
}

export function isRequested(e: Entry, allowed: Allowed): boolean {
  switch (e.kind) {
    case "attr":
      return (allowed.change ?? []).some(
        (r) => attrAllowed(r, e.attr) && (r.tags === undefined || r.tags.includes(e.tag)) && (r.ids === undefined || new RegExp(r.ids, "i").test(e.key)),
      );
    case "add":
      return allowed.add === true;
    case "remove": {
      const r = allowed.remove;
      if (r === true) return true;
      if (!r) return false;
      return (r.tags?.includes(e.tag) ?? false) || (r.ids !== undefined && new RegExp(r.ids, "i").test(e.key)) || (r.text?.includes(e.text) ?? false);
    }
    default:
      return false;
  }
}

export interface Unrequested { total: number; unrequested: number; share: number; done: boolean; list: string[] }

export function judgeEntries(p: Pairing, allowed: Allowed): Unrequested {
  const bad = p.entries.filter((e) => !isRequested(e, allowed));
  const label = (e: Entry): string => (e.kind === "attr" ? `${e.key}.${e.attr}` : `${e.kind} ${e.key}`);
  const total = p.entries.length;
  return { total, unrequested: bad.length, share: total === 0 ? 0 : bad.length / total, done: total - bad.length > 0, list: bad.slice(0, 8).map(label) };
}
