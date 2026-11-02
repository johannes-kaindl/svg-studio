// Änderungsliste auf SVG-Text anwenden (Spec § 4.1). Pure.
// - Jede Änderung wird zuerst als Spannen-Ersetzung `{ from, to, insert }` gegen den AUSGANGSTEXT berechnet;
//   alle Schlüssel (`id`, `parent`, `after`) beziehen sich auf diesen Text, nie auf Zwischenstände.
//   Überlappende Spannen scheitern, sonst wird von hinten nach vorn angewendet: alles Übrige bleibt BYTE-GLEICH
//   (Einrückung, Kommentare, Leerzeilen, BOM, Zeilenenden).
// - Round-Trip-Wächter: das Ergebnis wird neu gescannt; keine Befunde, passende Elementzahl, jeder gesetzte
//   Attributwert kommt dekodiert genau so an, jedes eingefügte Element hängt am gemeinten Elternknoten.
// - Alles oder nichts: ein Problem → nichts geändert, Liste der Probleme zurück.
// - Ein Eingabetext mit Scan-Befunden wird abgelehnt: ein unquotiertes Attribut steht nicht in `attrs`, ein
//   `change` könnte es sonst doppeln.
// - Zeilenende-Stil wie `block-writer` im Kit: `\r\n` irgendwo im Text → eingefügte Zeilen mit `\r\n`.
import { attr, scanElements, type SvgElement } from "./elements";

export type SvgChange =
  | { op: "change"; id: string; attrs: Record<string, string | null> }
  | { op: "add"; parent: string | null; after: string | null; markup: string }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; parent: string | null; after: string | null };
// id/parent/after sind Element-Schlüssel (SvgElement.key), auch #wurzel oder #style-1.
// parent null = #wurzel; after null = als erstes Kind.

export type ApplyResult = { ok: true; text: string } | { ok: false; problems: string[] };

/** Ersetzt `text.slice(from, to)` durch `insert`; `from === to` ist eine reine Einfügung. */
export interface TextSpan {
  from: number;
  to: number;
  insert: string;
}

const ROOT_KEY = "#wurzel";
const ATTR_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const isWs = (c: number): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

/** Wert für ein Attribut mit dem gegebenen Anführungszeichen schreiben (`&`, `<` und das Quote-Zeichen werden Entities). */
function escapeAttrValue(value: string, quote: '"' | "'"): string {
  const q = quote === '"' ? "&quot;" : "&apos;";
  let out = "";
  for (const ch of value) out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === quote ? q : ch;
  return out;
}

/** Rohname des Start-Tags mit Präfix, wie im Quelltext. */
function rawTagName(text: string, el: SvgElement): string {
  let i = el.start + 1;
  while (i < el.openEnd && !isWs(text.charCodeAt(i)) && text.charCodeAt(i) !== 0x2f && text.charCodeAt(i) !== 0x3e) i++;
  return text.slice(el.start + 1, i);
}

/** Spanne, die ein neues Attribut hinter das letzte (oder hinter den Tag-Namen) hängt, im Quote-Stil des Elements. */
export function attrAppendSpan(text: string, el: SvgElement, name: string, value: string): TextSpan {
  const last = el.attrs.length > 0 ? el.attrs[el.attrs.length - 1] : null;
  const pos = last !== null ? last.valueEnd + 1 : el.start + 1 + rawTagName(text, el).length;
  const quote = el.attrs.length > 0 ? el.attrs[0].quote : '"';
  return { from: pos, to: pos, insert: ` ${name}=${quote}${escapeAttrValue(value, quote)}${quote}` };
}

/** Wendet nicht überlappende Spannen an: von vorn nach hinten zusammengesetzt, jede gegen den Ausgangstext. */
export function applySpans(text: string, spans: readonly TextSpan[]): string {
  const sorted = [...spans].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = "";
  let last = 0;
  for (const s of sorted) {
    out += text.slice(last, s.from) + s.insert;
    last = s.to;
  }
  return out + text.slice(last);
}

const lineStartOf = (text: string, pos: number): number => (pos === 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1);

/** Einrückung vor `pos`, wenn davor auf der Zeile nur Leerzeichen/Tabs stehen, sonst `null`. */
function leadingIndent(text: string, pos: number): string | null {
  const s = text.slice(lineStartOf(text, pos), pos);
  for (let i = 0; i < s.length; i++) if (s[i] !== " " && s[i] !== "\t") return null;
  return s;
}

/** Entfernt-Spanne: steht das Element allein auf seinen Zeilen, geht die ganze Zeile mit, sonst nur die Spanne. */
function removalSpan(text: string, el: SvgElement): { from: number; to: number } {
  const lead = leadingIndent(text, el.start);
  if (lead !== null) {
    const nl = text.indexOf("\n", el.end);
    const stop = nl < 0 ? text.length : nl;
    let blank = true;
    for (let i = el.end; i < stop; i++) {
      const c = text.charCodeAt(i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0d) blank = false;
    }
    if (blank) return { from: el.start - lead.length, to: nl < 0 ? text.length : nl + 1 };
  }
  return { from: el.start, to: el.end };
}

/** Wo und womit eingefügt wird. `selfClose`: der Elternknoten ist selbstschließend und wird zu `<p>…</p>`. */
type Spot = { pos: number; lead: string; trail: string } | { selfClose: true };

interface Inserted {
  /** Offset des eingefügten Elements innerhalb von `insert`. */
  offset: number;
  parent: SvgElement;
  after: SvgElement | null;
}

interface Planned extends TextSpan {
  inserted?: Inserted[];
}

export function applyChanges(text: string, changes: readonly SvgChange[]): ApplyResult {
  const scan = scanElements(text);
  if (scan.issues.length > 0) {
    return { ok: false, problems: scan.issues.map((i) => `Eingabetext nicht sauber lesbar: ${i.message} (Offset ${i.offset})`) };
  }
  const elements = scan.elements;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const problems: string[] = [];

  const byKey = new Map<string, SvgElement[]>();
  const kids = new Map<string, SvgElement[]>();
  for (const e of elements) {
    const l = byKey.get(e.key);
    if (l) l.push(e);
    else byKey.set(e.key, [e]);
    if (e.parentKey !== null) {
      const k = kids.get(e.parentKey);
      if (k) k.push(e);
      else kids.set(e.parentKey, [e]);
    }
  }
  const resolve = (label: string, key: string | null, asParent: boolean): SvgElement | null => {
    const k = key === null && asParent ? ROOT_KEY : key;
    const hits = k === null ? undefined : byKey.get(k);
    if (hits === undefined || k === null) {
      const names = elements.filter((e) => !e.key.startsWith("@")).map((e) => e.key);
      problems.push(`${label}: kein Element "${k}" (vorhanden: ${names.join(", ") || "keine"})`);
      return null;
    }
    if (hits.length > 1) {
      problems.push(`${label}: "${k}" ist mehrdeutig (${hits.length} Elemente)`);
      return null;
    }
    return hits[0];
  };

  const spans: Planned[] = [];
  const merged = new Map<SvgElement, Record<string, string | null>>();
  // Kinder, die in einen selbstschließenden Elternknoten kommen, werden zu EINER Ersetzung gesammelt.
  const selfFill = new Map<SvgElement, { bodies: string[]; inserted: Inserted[] }>();
  let countDelta = 0;
  const unit = (indent: string): string => (indent.includes("\t") ? "\t" : "  ");

  const spotFor = (label: string, parent: SvgElement, after: SvgElement | null): Spot | null => {
    if (after !== null) {
      if (after.parentKey !== parent.key) {
        problems.push(`${label}: "${after.key}" ist kein Kind von "${parent.key}"`);
        return null;
      }
      const ind = leadingIndent(text, after.start);
      return { pos: after.end, lead: ind !== null ? eol + ind : "", trail: "" };
    }
    if (parent.selfClosing) return { selfClose: true };
    const first = (kids.get(parent.key) ?? [])[0];
    if (first !== undefined) {
      const ind = leadingIndent(text, first.start);
      return { pos: parent.openEnd, lead: ind !== null ? eol + ind : "", trail: "" };
    }
    const pi = leadingIndent(text, parent.start);
    const inner = text.slice(parent.openEnd, parent.closeStart);
    if (pi !== null && inner.trim() === "") {
      return { pos: parent.openEnd, lead: eol + pi + unit(pi), trail: inner === "" ? eol + pi : "" };
    }
    return { pos: parent.openEnd, lead: "", trail: "" };
  };

  /** Plant das Einfügen von `body` (ein Element) hinter `after` bzw. als erstes Kind von `parent`. */
  const plantInsert = (label: string, parent: SvgElement, after: SvgElement | null, body: string): void => {
    const spot = spotFor(label, parent, after);
    if (spot === null) return;
    if ("selfClose" in spot) {
      const fill = selfFill.get(parent) ?? { bodies: [], inserted: [] };
      fill.inserted.push({ offset: 1 + fill.bodies.reduce((n, s) => n + s.length, 0), parent, after: null });
      fill.bodies.push(body);
      selfFill.set(parent, fill);
      return;
    }
    spans.push({ from: spot.pos, to: spot.pos, insert: spot.lead + body + spot.trail, inserted: [{ offset: spot.lead.length, parent, after }] });
  };

  const countWithin = (el: SvgElement): number => elements.filter((e) => e.start >= el.start && e.end <= el.end).length;

  changes.forEach((c, i) => {
    const label = `Änderung ${i + 1} (${c.op})`;
    if (c.op === "change") {
      const el = resolve(label, c.id, false);
      if (el === null) return;
      const acc = merged.get(el) ?? {};
      for (const [name, value] of Object.entries(c.attrs)) {
        if (!ATTR_NAME.test(name)) {
          problems.push(`${label}: ungültiger Attributname "${name}"`);
          continue;
        }
        acc[name] = value;
      }
      merged.set(el, acc);
    } else if (c.op === "add") {
      const parent = resolve(label, c.parent, true);
      const after = c.after === null ? null : resolve(label, c.after, false);
      if (parent === null || (c.after !== null && after === null)) return;
      const markup = c.markup.trim().replace(/\r\n|\n/g, eol);
      if (markup === "") {
        problems.push(`${label}: leeres Markup`);
        return;
      }
      countDelta += scanElements(markup).elements.length;
      plantInsert(label, parent, after, markup);
    } else if (c.op === "remove") {
      const el = resolve(label, c.id, false);
      if (el === null) return;
      if (el.key === ROOT_KEY) {
        problems.push(`${label}: "${ROOT_KEY}" lässt sich nicht entfernen`);
        return;
      }
      const r = removalSpan(text, el);
      spans.push({ from: r.from, to: r.to, insert: "" });
      countDelta -= countWithin(el);
    } else {
      const el = resolve(label, c.id, false);
      const parent = resolve(label, c.parent, true);
      const after = c.after === null ? null : resolve(label, c.after, false);
      if (el === null || parent === null || (c.after !== null && after === null)) return;
      if (el.key === ROOT_KEY) {
        problems.push(`${label}: "${ROOT_KEY}" lässt sich nicht verschieben`);
        return;
      }
      if (after === el) {
        problems.push(`${label}: "${el.key}" kann nicht hinter sich selbst stehen`);
        return;
      }
      const r = removalSpan(text, el);
      spans.push({ from: r.from, to: r.to, insert: "" });
      plantInsert(label, parent, after, text.slice(el.start, el.end));
    }
  });

  for (const [el, attrs] of merged) {
    for (const [name, value] of Object.entries(attrs)) {
      const hits = el.attrs.filter((a) => a.name === name);
      if (hits.length > 1) {
        problems.push(`Element "${el.key}": Attribut ${name} kommt mehrfach vor`);
        continue;
      }
      const a = hits[0];
      if (a === undefined) {
        if (value !== null) spans.push(attrAppendSpan(text, el, name, value));
      } else if (value === null) {
        let from = a.start;
        while (from > el.start && isWs(text.charCodeAt(from - 1))) from--;
        spans.push({ from, to: a.valueEnd + 1, insert: "" });
      } else if (a.value !== value) {
        spans.push({ from: a.valueStart, to: a.valueEnd, insert: escapeAttrValue(value, a.quote) });
      }
    }
  }
  for (const [parent, fill] of selfFill) {
    spans.push({
      from: parent.openEnd - 2,
      to: parent.openEnd,
      insert: `>${fill.bodies.join("")}</${rawTagName(text, parent)}>`,
      inserted: fill.inserted,
    });
  }
  if (problems.length > 0) return { ok: false, problems };

  // Überlappung: nach Anfang sortiert darf eine Spanne erst dort beginnen, wo die bisherigen enden.
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  let maxTo = 0;
  for (const s of spans) {
    if (s.from < maxTo) problems.push(`Änderungen überlappen sich bei Offset ${s.from}: dasselbe Stück Text würde zweimal geändert`);
    maxTo = Math.max(maxTo, s.to);
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const out = applySpans(text, spans);
  const guard = roundTripProblems(out, spans, merged, elements.length + countDelta);
  if (guard.length > 0) return { ok: false, problems: guard };
  return { ok: true, text: out };
}

/** Round-Trip-Wächter: liest das Ergebnis neu und prüft, dass es sagt, was die Liste gemeint hat. */
function roundTripProblems(
  out: string,
  spans: readonly Planned[],
  merged: ReadonlyMap<SvgElement, Record<string, string | null>>,
  expectedCount: number,
): string[] {
  const res = scanElements(out);
  if (res.issues.length > 0) return res.issues.map((i) => `Ergebnis nicht lesbar: ${i.message} (Offset ${i.offset})`);
  const problems: string[] = [];
  if (res.elements.length !== expectedCount) {
    problems.push(`Ergebnis hat ${res.elements.length} statt der erwarteten ${expectedCount} Elemente`);
  }
  const atStart = new Map<number, SvgElement>();
  for (const e of res.elements) atStart.set(e.start, e);
  // Ausgangs-Offset in Ergebnis-Offset umrechnen: jede Spanne, die davor endet, verschiebt ihn.
  const mapOffset = (s: number): number => spans.reduce((o, sp) => (sp.to <= s ? o + sp.insert.length - (sp.to - sp.from) : o), s);

  for (const [el, attrs] of merged) {
    const now = atStart.get(mapOffset(el.start));
    if (now === undefined) {
      problems.push(`Element "${el.key}" fehlt im Ergebnis`);
      continue;
    }
    for (const [name, value] of Object.entries(attrs)) {
      const got = attr(now, name);
      if (got !== value) {
        problems.push(`Element "${el.key}": ${name} wäre ${got === null ? "nicht gesetzt" : `"${got}"`} statt ${value === null ? "entfernt" : `"${value}"`}`);
      }
    }
  }

  // Eingefügte Elemente: Start im Ergebnis = Ausgangs-Start der Spanne + Verschiebung durch frühere Spannen + Offset im Einfügetext.
  const planned: { start: number; ins: Inserted }[] = [];
  let shift = 0;
  for (const sp of spans) {
    for (const ins of sp.inserted ?? []) planned.push({ start: sp.from + shift + ins.offset, ins });
    shift += sp.insert.length - (sp.to - sp.from);
  }
  const insertedStarts = new Set(planned.map((p) => p.start));
  for (const { start, ins } of planned) {
    const now = atStart.get(start);
    const parentNow = atStart.get(mapOffset(ins.parent.start));
    if (now === undefined || parentNow === undefined) {
      problems.push(`Eingefügtes Element unter "${ins.parent.key}" fehlt im Ergebnis`);
      continue;
    }
    if (now.parentKey !== parentNow.key) {
      problems.push(`Eingefügtes Element "${now.key}" hängt nicht unter "${ins.parent.key}"`);
      continue;
    }
    // Davor darf nur das gemeinte `after` stehen oder ein anderes in derselben Liste eingefügtes Element.
    const sibs = res.elements.filter((e) => e.parentKey === parentNow.key);
    const prev = sibs[sibs.indexOf(now) - 1];
    const wanted = ins.after === null ? undefined : atStart.get(mapOffset(ins.after.start));
    const fine = prev === undefined ? ins.after === null : prev === wanted || insertedStarts.has(prev.start);
    if (!fine) problems.push(`Eingefügtes Element "${now.key}" steht nicht hinter "${ins.after?.key ?? "dem Anfang"}"`);
  }
  return problems;
}
