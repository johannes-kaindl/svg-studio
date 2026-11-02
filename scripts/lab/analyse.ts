// Auswertungs-Helfer des Messskripts (scripts/svg-lab.ts). LAB-CODE, nicht Teil des Plugins und nicht von der Gate geprüft.
// Das Paaren und Zerlegen hier ist ein minimaler Stand-in für das spätere `diff.ts` (Plan 2): es soll nur zählen,
// wie oft eine Modellantwort NICHT in eine Änderungsliste zerlegbar ist (Spec § 6.2, Entscheidung Nr. 12) und
// welche Änderungen die Anweisung nicht verlangt hat. Nichts davon wandert nach src/core.
import { applyChanges, type SvgChange } from "../../src/core/changes";
import { scanElements, type SvgElement } from "../../src/core/elements";

// ---------- Antworten lesen ----------

/** Entfernt <think>…</think>. Ein nie geschlossenes `<think>` verschluckt den Rest (dann ist nichts Antwort); ein einzelnes `</think>`
 *  ohne Eröffnung (der Chat-Vorlagen-Eintrag steht schon im Prompt) schneidet alles bis zum letzten `</think>` weg. */
export function stripThink(raw: string): string {
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = closed.search(/<think>/i);
  if (open >= 0) return closed.slice(0, open).trim();
  const lone = closed.toLowerCase().lastIndexOf("</think>");
  return (lone >= 0 ? closed.slice(lone + "</think>".length) : closed).trim();
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
export function extractSvg(raw: string): Extracted<string> {
  const s = stripThink(raw);
  const { text, fenced } = unfence(s, /<svg[\s>]/i);
  const i = text.search(/<svg[\s>]/i);
  const j = text.lastIndexOf("</svg>");
  if (i < 0 || j < i) return { value: null, rein: false, fenced, error: "kein <svg>…</svg> in der Antwort" };
  const svg = text.slice(i, j + "</svg>".length);
  return { value: svg, rein: !fenced && s.trim() === svg, fenced };
}

const OPS = new Set(["change", "add", "remove", "move"]);

/** JSON-Liste `SvgChange[]` aus der Rohantwort; prüft Form, glättet Zahlenwerte in Attributen zu Text und fehlendes parent/after zu null. */
export function extractChanges(raw: string): Extracted<SvgChange[]> {
  const s = stripThink(raw);
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

// ---------- Paaren (Stand-in für diff.ts) ----------

export type Entry =
  | { kind: "attr"; key: string; tag: string; attr: string; from: string | null; to: string | null }
  | { kind: "add"; key: string; tag: string }
  | { kind: "remove"; key: string; tag: string; text: string }
  | { kind: "move"; key: string; tag: string }
  | { kind: "text"; key: string; tag: string };

export interface Pairing {
  entries: Entry[];
  changes: SvgChange[];
  /** Ein Eintrag betrifft ein Element ohne id (Schlüssel `@N`): eine Änderungsliste kann es nicht ansprechen. */
  unaddressable: boolean;
}

interface Tree { els: SvgElement[]; parent: number[]; kids: number[][]; own: string[] }

function buildTree(source: string): Tree | null {
  const text = blankComments(source);
  const { elements, issues } = scanElements(text);
  if (issues.length > 0 || elements.length === 0) return null;
  const parent: number[] = [];
  const kids: number[][] = elements.map(() => []);
  const stack: number[] = [];
  elements.forEach((e, i) => {
    while (stack.length > 0 && elements[stack[stack.length - 1]].end <= e.start) stack.pop();
    const p = stack.length > 0 ? stack[stack.length - 1] : -1;
    parent.push(p);
    if (p >= 0) kids[p].push(i);
    stack.push(i);
  });
  // Eigener Text: Inhalt ohne Kind-Spannen, Leerraum normalisiert.
  const own = elements.map((e, i) => {
    if (e.selfClosing || e.closeStart <= e.openEnd) return "";
    let s = "";
    let at = e.openEnd;
    for (const k of kids[i]) { s += text.slice(at, elements[k].start); at = elements[k].end; }
    s += text.slice(at, e.closeStart);
    return s.replace(/\s+/g, " ").trim();
  });
  return { els: elements, parent, kids, own };
}

/** Schlüssel mit laufender Nummer bei doppelten ids ("a", "a~2"): gepaart wird in Reihenfolge. */
function uniqueKeys(els: SvgElement[]): string[] {
  const seen = new Map<string, number>();
  return els.map((e) => {
    const n = (seen.get(e.key) ?? 0) + 1;
    seen.set(e.key, n);
    return n === 1 ? e.key : `${e.key}~${n}`;
  });
}

const attrMap = (e: SvgElement): Map<string, string> => {
  const m = new Map<string, string>();
  for (const a of e.attrs) if (!m.has(a.name)) m.set(a.name, a.value);
  return m;
};

/** Längste wachsende Teilfolge (Indizes), O(n²) reicht. */
function lisSet(seq: number[]): Set<number> {
  const best: number[] = seq.map(() => 1);
  const prev: number[] = seq.map(() => -1);
  let end = -1;
  let len = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) if (seq[j] < seq[i] && best[j] + 1 > best[i]) { best[i] = best[j] + 1; prev[i] = j; }
    if (best[i] > len) { len = best[i]; end = i; }
  }
  const out = new Set<number>();
  for (let i = end; i >= 0; i = prev[i]) out.add(i);
  return out;
}

export function pairElements(baseText: string, ansText: string): Pairing | null {
  const B = buildTree(baseText);
  const A = buildTree(ansText);
  if (!B || !A) return null;
  const bk = uniqueKeys(B.els);
  const ak = uniqueKeys(A.els);
  const bIdx = new Map(bk.map((k, i) => [k, i]));
  const aToB: number[] = ak.map((k) => bIdx.get(k) ?? -1);
  const bToA: number[] = bk.map(() => -1);
  aToB.forEach((b, a) => { if (b >= 0) bToA[b] = a; });

  const entries: Entry[] = [];
  const changes: SvgChange[] = [];
  let unaddressable = false;
  const addr = (e: SvgElement): void => { if (e.key.startsWith("@")) unaddressable = true; };

  // Anker: hinter welchem unbewegten, gepaarten Geschwister (Antwort-Sicht) landet Element a?
  const moved = new Set<number>(); // Antwort-Indizes verschobener oder ersetzter gepaarter Elemente
  // 1. Verschobene: anderer Elternschlüssel oder aus der Reihenfolge.
  for (let a = 0; a < A.els.length; a++) {
    const b = aToB[a];
    if (b < 0) continue;
    if (A.els[a].parentKey !== B.els[b].parentKey) moved.add(a);
  }
  for (let p = -1; p < A.els.length; p++) {
    const sibs = (p < 0 ? A.els.map((_, i) => i).filter((i) => A.parent[i] < 0) : A.kids[p]).filter((a) => aToB[a] >= 0 && !moved.has(a));
    const seq = sibs.map((a) => aToB[a]);
    const keep = lisSet(seq);
    sibs.forEach((a, i) => { if (!keep.has(i)) moved.add(a); });
  }
  // 2. Blätter mit anderem Text: Entfernen + Einfügen (Attribute dazu mitnehmen).
  const replaced = new Set<number>();
  for (let a = 0; a < A.els.length; a++) {
    const b = aToB[a];
    if (b < 0 || A.kids[a].length > 0 || B.kids[b].length > 0) continue;
    if (A.own[a] !== B.own[b]) replaced.add(a);
  }

  const anchorFor = (a: number): string | null => {
    const sibs = A.parent[a] < 0 ? A.els.map((_, i) => i).filter((i) => A.parent[i] < 0) : A.kids[A.parent[a]];
    for (let i = sibs.indexOf(a) - 1; i >= 0; i--) {
      const s = sibs[i];
      if (aToB[s] >= 0 && !moved.has(s) && !replaced.has(s)) return A.els[s].key;
    }
    return null;
  };
  const parentOf = (a: number): string | null => (A.parent[a] < 0 ? null : A.els[A.parent[a]].key === "#wurzel" ? null : A.els[A.parent[a]].key);

  for (let a = 0; a < A.els.length; a++) {
    const b = aToB[a];
    const ea = A.els[a];
    if (b < 0) {
      const topAdd = A.parent[a] < 0 || aToB[A.parent[a]] >= 0;
      if (topAdd) {
        entries.push({ kind: "add", key: ea.key, tag: ea.tag });
        changes.push({ op: "add", parent: parentOf(a), after: anchorFor(a), markup: ansText.slice(ea.start, ea.end) });
      }
      continue;
    }
    const eb = B.els[b];
    if (replaced.has(a)) {
      entries.push({ kind: "text", key: ea.key, tag: ea.tag });
      addr(ea);
      changes.push({ op: "remove", id: eb.key });
      changes.push({ op: "add", parent: parentOf(a), after: anchorFor(a), markup: ansText.slice(ea.start, ea.end) });
      continue;
    }
    const ma = attrMap(ea);
    const mb = attrMap(eb);
    const attrs: Record<string, string | null> = {};
    for (const [k, v] of ma) if (mb.get(k) !== v) { attrs[k] = v; entries.push({ kind: "attr", key: ea.key, tag: ea.tag, attr: k, from: mb.get(k) ?? null, to: v }); }
    for (const [k, v] of mb) if (!ma.has(k)) { attrs[k] = null; entries.push({ kind: "attr", key: ea.key, tag: ea.tag, attr: k, from: v, to: null }); }
    if (Object.keys(attrs).length > 0) { addr(ea); changes.push({ op: "change", id: eb.key, attrs }); }
    if (moved.has(a)) {
      entries.push({ kind: "move", key: ea.key, tag: ea.tag });
      addr(ea);
      changes.push({ op: "move", id: eb.key, parent: parentOf(a), after: anchorFor(a) });
    }
  }
  for (let b = 0; b < B.els.length; b++) {
    if (bToA[b] >= 0) continue;
    const topRemove = B.parent[b] < 0 || bToA[B.parent[b]] >= 0;
    if (topRemove) {
      const eb = B.els[b];
      entries.push({ kind: "remove", key: eb.key, tag: eb.tag, text: textOf(baseText, B, b) });
      addr(eb);
      changes.push({ op: "remove", id: eb.key });
    }
  }
  return { entries, changes, unaddressable };
}

/** Gesamttext eines Elements samt Nachkommen (für die Zuordnung „Kasten B“). */
function textOf(text: string, t: Tree, i: number): string {
  const parts: string[] = [];
  const walk = (n: number): void => { if (t.own[n]) parts.push(t.own[n]); for (const k of t.kids[n]) walk(k); };
  walk(i);
  return parts.join(" ").trim();
}

/** Kanonische Form: Tags, sortierte Attribute (dekodiert), normalisierter Text; Leerraum zwischen Tags und Attributreihenfolge zählen nicht. */
export function canon(text: string): string | null {
  const t = buildTree(text);
  if (!t) return null;
  const walk = (i: number): string => {
    const e = t.els[i];
    const attrs = [...attrMap(e)].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    return `<${e.tag} ${attrs}>${t.own[i]}${t.kids[i].map(walk).join("")}</>`;
  };
  return t.els.map((_, i) => i).filter((i) => t.parent[i] < 0).map(walk).join("");
}

/** Zerlegbar = die aus dem Paaren gebildete Liste, auf den Ausgang angewendet, ergibt (kanonisch) die Antwort. */
export function decomposable(baseText: string, ansText: string, p: Pairing): { ok: boolean; why?: string } {
  if (p.unaddressable) return { ok: false, why: "Änderung an Element ohne id" };
  const r = applyChanges(baseText, p.changes);
  if (!r.ok) return { ok: false, why: `applyChanges: ${r.problems[0] ?? "?"}` };
  const c1 = canon(r.text);
  const c2 = canon(ansText);
  if (c1 === null || c2 === null) return { ok: false, why: "Ergebnis nicht scanbar" };
  return c1 === c2 ? { ok: true } : { ok: false, why: "Ergebnis weicht von der Antwort ab" };
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
