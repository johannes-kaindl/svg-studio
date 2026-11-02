// Änderungsliste auf SVG-Text anwenden (Spec § 4.1). Pure.
// - Jede Änderung wird zuerst als Spannen-Ersetzung `{ from, to, insert }` gegen den AUSGANGSTEXT berechnet;
//   alle Schlüssel (`id`, `parent`, `after`) beziehen sich auf diesen Text, nie auf Zwischenstände.
//   Überlappende Spannen scheitern, sonst wird von hinten nach vorn angewendet: alles Übrige bleibt BYTE-GLEICH
//   (Einrückung, Kommentare, Leerzeilen, BOM, Zeilenenden).
// - Round-Trip-Wächter: das Ergebnis wird neu gescannt; keine Syntaxbefunde, passende Elementzahl, jeder gesetzte
//   Attributwert kommt dekodiert genau so an, jedes eingefügte Element hängt am gemeinten Elternknoten, und jedes
//   weder entfernte noch verschobene Originalelement behält seinen Elternknoten. Neue doppelte ids scheitern.
// - Alles oder nichts: ein Problem → nichts geändert, Liste der Probleme zurück.
// - Ein Eingabetext mit SYNTAX-Befunden wird abgelehnt: ein unquotiertes Attribut steht nicht in `attrs`, ein
//   `change` könnte es sonst doppeln. Eine doppelte id im Eingabetext blockiert nichts (Spec § 6.2): wer sie
//   anspricht, bekommt "mehrdeutig"; unbeteiligte Elemente bleiben änderbar.
// - `add`-Markup muss ohne jeden Befund scannen und aus genau EINEM Element bestehen, das den ganzen getrimmten
//   Text füllt; sonst ließe sich der Elternknoten schließen und ein Geschwister umhängen.
// - Zeilenende-Stil wie `block-writer` im Kit: `\r\n` irgendwo im Text → eingefügte Zeilen mit `\r\n`.
//
// VERTRAG (gilt für jeden Aufrufer, auch für das Modell):
// - Alle Schlüssel (`id`, `parent`, `after`) benennen Elemente des AUSGANGSTEXTS. Eine Liste kann kein Element
//   ansprechen, das sie selbst eingefügt oder verschoben hat; positionsabhängige Schlüssel (`@N`) sind verboten.
// - `after` muss ein unbewegter Anker sein: ein entferntes oder verschobenes Element taugt nicht.
//   Mehrere Einfügungen hinter DENSELBEN Anker behalten die Listenreihenfolge.
// - Ein neues Element um bestehende zu wickeln („in eine neue Gruppe“) ist in einer Liste nicht ausdrückbar:
//   dafür erst die Gruppe einfügen, dann in einer zweiten Liste die Kinder hineinverschieben.
// - `change` und `move` auf dasselbe Element sind erlaubt (die Attribute gelten am neuen Ort); `change` auf
//   einen Nachkommen eines verschobenen Elements, `remove` eines Elternknotens mit `move` eines Kindes sind es nicht.
// - Entfernt die Liste ein Element samt Nachkommen, darf sie dessen Nachkommen zusätzlich entfernen (zählt einmal).
// - Attributwerte dürfen keine Steuerzeichen außer Tab/LF/CR enthalten; diese drei werden als `&#9;`/`&#10;`/`&#13;`
//   geschrieben (ein wörtlicher Zeilenumbruch würde vom XML-Parser zu einem Leerzeichen normalisiert).
// - Der Schreibweg (Plan 2) prüft das Ergebnis vor dem Schreiben per DOMParser auf Wohlgeformtheit (nicht den ganzen svg-guard).
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

/** C0-Steuerzeichen außer Tab/LF/CR (und U+007F): in XML 1.0 nicht erlaubt. */
function hasBadControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
  }
  return false;
}

/**
 * Wert für ein Attribut mit dem gegebenen Anführungszeichen schreiben (`&`, `<` und das Quote-Zeichen werden Entities;
 * Tab/LF/CR werden Zeichenreferenzen). Steuerzeichen außer diesen dreien werfen: sie sind in XML nicht darstellbar,
 * `applyChanges` meldet sie vorher als Problem.
 */
function escapeAttrValue(value: string, quote: '"' | "'"): string {
  if (hasBadControl(value)) throw new RangeError("Attributwert enthält ein Steuerzeichen, das XML nicht darstellen kann");
  const q = quote === '"' ? "&quot;" : "&apos;";
  let out = "";
  for (const ch of value) {
    out +=
      ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === quote ? q : ch === "\t" ? "&#9;" : ch === "\n" ? "&#10;" : ch === "\r" ? "&#13;" : ch;
  }
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
  /** Bei `move` das Element im Ausgangstext, sonst `null` (frisches Markup). */
  source: SvgElement | null;
}

interface Planned extends TextSpan {
  /** Nummer der Änderung in der Liste (ab 1), für Meldungen. */
  op: number;
  inserted?: Inserted[];
}

export function applyChanges(text: string, changes: readonly SvgChange[]): ApplyResult {
  const scan = scanElements(text);
  const syntax = scan.issues.filter((i) => i.kind === "syntax");
  if (syntax.length > 0) {
    return { ok: false, problems: syntax.map((i) => `Eingabetext nicht sauber lesbar: ${i.message} (Offset ${i.offset})`) };
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
    if (k !== null && k.startsWith("@")) {
      problems.push(`${label}: Schlüssel "${k}" ist positionsabhängig und nicht zulässig (nur id oder fester Schlüssel wie #wurzel)`);
      return null;
    }
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
  const opLabel = (i: number, c: SvgChange): string => `Änderung ${i + 1} (${c.op})`;

  // 1. Attribute je Element zusammenfassen (der spätere `change` gewinnt); `ops` merkt die Nummer je Attribut.
  const merged = new Map<SvgElement, { attrs: Record<string, string | null>; ops: Record<string, number> }>();
  changes.forEach((c, i) => {
    if (c.op !== "change") return;
    const label = opLabel(i, c);
    const el = resolve(label, c.id, false);
    if (el === null) return;
    const acc = merged.get(el) ?? { attrs: {}, ops: {} };
    for (const [name, value] of Object.entries(c.attrs)) {
      if (!ATTR_NAME.test(name)) {
        problems.push(`${label}: ungültiger Attributname "${name}"`);
        continue;
      }
      if (value !== null && hasBadControl(value)) {
        problems.push(`${label}: Wert von ${name} enthält ein Steuerzeichen, das XML nicht darstellen kann`);
        continue;
      }
      acc.attrs[name] = value;
      acc.ops[name] = i + 1;
    }
    merged.set(el, acc);
  });
  const attrSpans = new Map<SvgElement, Planned[]>();
  for (const [el, { attrs, ops }] of merged) {
    const list: Planned[] = [];
    for (const [name, value] of Object.entries(attrs)) {
      const hits = el.attrs.filter((a) => a.name === name);
      if (hits.length > 1) {
        problems.push(`Element "${el.key}": Attribut ${name} kommt mehrfach vor`);
        continue;
      }
      const a = hits[0];
      const op = ops[name];
      if (a === undefined) {
        if (value !== null) list.push({ ...attrAppendSpan(text, el, name, value), op });
      } else if (value === null) {
        let from = a.start;
        while (from > el.start && isWs(text.charCodeAt(from - 1))) from--;
        list.push({ from, to: a.valueEnd + 1, insert: "", op });
      } else if (a.value !== value) {
        list.push({ from: a.valueStart, to: a.valueEnd, insert: escapeAttrValue(value, a.quote), op });
      }
    }
    attrSpans.set(el, list);
  }

  // 2. Strukturänderungen in Listenreihenfolge (die Reihenfolge bestimmt bei gleichem Anker die Einfügereihenfolge).
  const spans: Planned[] = [];
  const removed = new Map<SvgElement, number>();
  const movedEls = new Map<SvgElement, number>();
  const anchors: { op: number; after: SvgElement }[] = [];
  // Kinder, die in einen selbstschließenden Elternknoten kommen, werden zu EINER Ersetzung gesammelt.
  const selfFill = new Map<SvgElement, { bodies: string[]; inserted: Inserted[]; op: number }>();
  let countDelta = 0;
  const unit = (indent: string): string => (indent.includes("\t") ? "\t" : "  ");
  const within = (inner: SvgElement, outer: SvgElement): boolean => inner.start >= outer.start && inner.end <= outer.end;

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

  /** Plant das Einfügen von `body` (ein Element) hinter `after` bzw. als erstes Kind von `parent`.
   *  `reindent`: Folgezeilen von frischem Markup bekommen die Einrückung des Ankers (relative Einrückung bleibt). */
  const plantInsert = (
    label: string,
    op: number,
    parent: SvgElement,
    after: SvgElement | null,
    body: string,
    source: SvgElement | null,
    reindent: boolean,
  ): void => {
    const spot = spotFor(label, parent, after);
    if (spot === null) return;
    if ("selfClose" in spot) {
      const fill = selfFill.get(parent) ?? { bodies: [], inserted: [], op };
      fill.inserted.push({ offset: 1 + fill.bodies.reduce((n, b) => n + b.length, 0), parent, after: null, source });
      fill.bodies.push(body);
      selfFill.set(parent, fill);
      return;
    }
    const ind = spot.lead.slice(eol.length);
    const text2 = reindent && ind !== "" ? body.split(eol).join(eol + ind) : body;
    spans.push({
      from: spot.pos,
      to: spot.pos,
      insert: spot.lead + text2 + spot.trail,
      op,
      inserted: [{ offset: spot.lead.length, parent, after, source }],
    });
  };

  const countWithin = (el: SvgElement): number => elements.filter((e) => within(e, el)).length;

  changes.forEach((c, i) => {
    const label = opLabel(i, c);
    const op = i + 1;
    if (c.op === "add") {
      const parent = resolve(label, c.parent, true);
      const after = c.after === null ? null : resolve(label, c.after, false);
      if (parent === null || (c.after !== null && after === null)) return;
      const markup = c.markup.trim().replace(/\r\n|\n/g, eol);
      if (markup === "") {
        problems.push(`${label}: leeres Markup`);
        return;
      }
      const ms = scanElements(markup);
      if (ms.issues.length > 0) {
        for (const x of ms.issues) problems.push(`${label}: Markup nicht sauber lesbar: ${x.message} (Offset ${x.offset})`);
        return;
      }
      if (hasBadControl(markup)) {
        problems.push(`${label}: Markup enthält ein Steuerzeichen, das XML nicht darstellen kann`);
        return;
      }
      const tops = ms.elements.filter((e) => e.parentKey === null);
      if (tops.length !== 1 || tops[0].start !== 0 || tops[0].end !== markup.length) {
        problems.push(`${label}: Markup muss genau ein Element sein, das den ganzen Text füllt`);
        return;
      }
      countDelta += ms.elements.length;
      if (after !== null) anchors.push({ op, after });
      plantInsert(label, op, parent, after, markup, null, true);
    } else if (c.op === "remove") {
      const el = resolve(label, c.id, false);
      if (el === null) return;
      if (el.key === ROOT_KEY) {
        problems.push(`${label}: "${ROOT_KEY}" lässt sich nicht entfernen`);
        return;
      }
      if (!removed.has(el)) removed.set(el, op);
    } else if (c.op === "move") {
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
      if (within(parent, el)) {
        problems.push(`${label}: Ziel liegt im verschobenen Element "${el.key}"`);
        return;
      }
      if (!movedEls.has(el)) movedEls.set(el, op);
      if (after !== null) anchors.push({ op, after });
      // Die Attribute des Elements gelten am neuen Ort: sie werden in die verschobene Kopie eingearbeitet.
      const own = attrSpans.get(el) ?? [];
      const slice = applySpans(
        text.slice(el.start, el.end),
        own.map((a) => ({ from: a.from - el.start, to: a.to - el.start, insert: a.insert })),
      );
      const r = removalSpan(text, el);
      spans.push({ from: r.from, to: r.to, insert: "", op });
      plantInsert(label, op, parent, after, slice, el, false);
    }
  });

  // Entfernungen: ein Element im entfernten Elternknoten wird mit ihm entfernt (zählt einmal).
  for (const [el, op] of removed) {
    const outer = [...removed.keys()].find((o) => o !== el && within(el, o));
    if (outer !== undefined) continue;
    const r = removalSpan(text, el);
    spans.push({ from: r.from, to: r.to, insert: "", op });
    countDelta -= countWithin(el);
  }
  for (const [m, mop] of movedEls) {
    for (const [r, rop] of removed) {
      if (within(m, r)) {
        problems.push(`Änderung ${rop} (remove) entfernt "${r.key}" samt "${m.key}", das Änderung ${mop} (move) herausnehmen will`);
      }
    }
  }
  // Anker: ein entferntes oder verschobenes Element ist keiner.
  for (const { op, after } of anchors) {
    const rop = removed.get(after);
    const mop = movedEls.get(after);
    const other = rop ?? mop;
    if (other !== undefined && other !== op) {
      problems.push(`Änderung ${Math.min(op, other)} und ${Math.max(op, other)}: "${after.key}" wird ${rop !== undefined ? "entfernt" : "verschoben"} und kann nicht Anker (after) sein`);
    }
  }
  // Attributspannen (verschobene Elemente haben ihre schon in der Kopie).
  for (const [el, list] of attrSpans) if (!movedEls.has(el)) spans.push(...list);
  for (const [parent, fill] of selfFill) {
    spans.push({
      from: parent.openEnd - 2,
      to: parent.openEnd,
      insert: `>${fill.bodies.join("")}</${rawTagName(text, parent)}>`,
      op: fill.op,
      inserted: fill.inserted,
    });
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  // Überlappung: nach Anfang sortiert darf eine Spanne erst dort beginnen, wo die bisherigen enden.
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  let widest: Planned | null = null;
  for (const s of spans) {
    if (widest !== null && s.from < widest.to) {
      problems.push(
        widest.op === s.op
          ? `Änderung ${s.op}: das Ziel überschneidet das Element selbst`
          : `Änderung ${Math.min(widest.op, s.op)} und ${Math.max(widest.op, s.op)} überlappen sich: dasselbe Stück Text würde zweimal geändert`,
      );
    }
    if (widest === null || s.to > widest.to) widest = s;
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const out = applySpans(text, spans);
  const wantAttrs = new Map<SvgElement, Record<string, string | null>>();
  for (const [el, m] of merged) wantAttrs.set(el, m.attrs);
  const guard = roundTripProblems(out, spans, wantAttrs, elements.length + countDelta, {
    elements,
    removed: new Set(removed.keys()),
    moved: new Set(movedEls.keys()),
  });
  if (guard.length > 0) return { ok: false, problems: guard };
  return { ok: true, text: out };
}

/** Elternknoten je Element (Identität statt Schlüssel: Schlüssel können doppelt sein oder sich durch `id`-Änderungen verschieben). */
function parentMap(elements: readonly SvgElement[]): Map<SvgElement, SvgElement | null> {
  const parents = new Map<SvgElement, SvgElement | null>();
  const stack: SvgElement[] = [];
  for (const e of elements) {
    while (stack.length > 0 && stack[stack.length - 1].end <= e.start) stack.pop();
    parents.set(e, stack.length > 0 ? stack[stack.length - 1] : null);
    stack.push(e);
  }
  return parents;
}

/** Wie oft jede id vorkommt, nur Werte ab zwei. */
function duplicateIds(elements: readonly SvgElement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of elements) if (e.id !== null) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  for (const [id, n] of counts) if (n < 2) counts.delete(id);
  return counts;
}

/**
 * Round-Trip-Wächter: liest das Ergebnis neu und prüft, dass es sagt, was die Liste gemeint hat.
 * Nur für Tests exportiert.
 */
export function roundTripProblems(
  out: string,
  spans: readonly Planned[],
  merged: ReadonlyMap<SvgElement, Record<string, string | null>>,
  expectedCount: number,
  originals: { elements: readonly SvgElement[]; removed: ReadonlySet<SvgElement>; moved: ReadonlySet<SvgElement> },
): string[] {
  const res = scanElements(out);
  const syntax = res.issues.filter((i) => i.kind === "syntax");
  if (syntax.length > 0) return syntax.map((i) => `Ergebnis nicht lesbar: ${i.message} (Offset ${i.offset})`);
  const problems: string[] = [];
  if (res.elements.length !== expectedCount) {
    problems.push(`Ergebnis hat ${res.elements.length} statt der erwarteten ${expectedCount} Elemente`);
  }
  // Nur NEUE doppelte ids scheitern; was schon vorher doppelt war, bleibt so.
  const before = duplicateIds(originals.elements);
  for (const [id, n] of duplicateIds(res.elements)) {
    if (n > (before.get(id) ?? 1)) problems.push(`id "${id}" wäre im Ergebnis ${n}-mal vergeben (doppelt)`);
  }
  const atStart = new Map<number, SvgElement>();
  for (const e of res.elements) atStart.set(e.start, e);
  const parentNowOf = parentMap(res.elements);
  // Ausgangs-Offset in Ergebnis-Offset umrechnen: jede Spanne, die davor endet, verschiebt ihn.
  const mapOffset = (s: number): number => spans.reduce((o, sp) => (sp.to <= s ? o + sp.insert.length - (sp.to - sp.from) : o), s);

  // Eingefügte Elemente: Start im Ergebnis = Ausgangs-Start der Spanne + Verschiebung durch frühere Spannen + Offset im Einfügetext.
  const planned: { start: number; ins: Inserted }[] = [];
  let shift = 0;
  for (const sp of spans) {
    for (const ins of sp.inserted ?? []) planned.push({ start: sp.from + shift + ins.offset, ins });
    shift += sp.insert.length - (sp.to - sp.from);
  }
  const movedStart = new Map<SvgElement, number>();
  for (const p of planned) if (p.ins.source !== null) movedStart.set(p.ins.source, p.start);

  for (const [el, attrs] of merged) {
    const now = atStart.get(movedStart.get(el) ?? mapOffset(el.start));
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

  const insertedStarts = new Set(planned.map((p) => p.start));
  for (const { start, ins } of planned) {
    const now = atStart.get(start);
    const parentNow = atStart.get(mapOffset(ins.parent.start));
    if (now === undefined || parentNow === undefined) {
      problems.push(`Eingefügtes Element unter "${ins.parent.key}" fehlt im Ergebnis`);
      continue;
    }
    if (parentNowOf.get(now) !== parentNow) {
      problems.push(`Eingefügtes Element "${now.key}" hängt nicht unter "${ins.parent.key}"`);
      continue;
    }
    // Davor darf nur das gemeinte `after` stehen oder ein anderes in derselben Liste eingefügtes Element.
    const sibs = res.elements.filter((e) => parentNowOf.get(e) === parentNow);
    const prev = sibs[sibs.indexOf(now) - 1];
    const wanted = ins.after === null ? undefined : atStart.get(mapOffset(ins.after.start));
    const fine = prev === undefined ? ins.after === null : prev === wanted || insertedStarts.has(prev.start);
    if (!fine) problems.push(`Eingefügtes Element "${now.key}" steht nicht hinter "${ins.after?.key ?? "dem Anfang"}"`);
  }

  // Jedes Originalelement, das weder entfernt noch verschoben wurde (auch nicht über einen Vorfahren), behält seinen Elternknoten.
  const parentWas = parentMap(originals.elements);
  const gone = new Set<SvgElement>();
  for (const e of originals.elements) {
    const parent = parentWas.get(e) ?? null;
    if (originals.removed.has(e) || originals.moved.has(e) || (parent !== null && gone.has(parent))) {
      gone.add(e);
      continue;
    }
    const now = atStart.get(mapOffset(e.start));
    if (now === undefined) {
      problems.push(`Element "${e.key}" fehlt im Ergebnis`);
      continue;
    }
    const wantParent = parent === null ? null : (atStart.get(mapOffset(parent.start)) ?? null);
    if ((parentNowOf.get(now) ?? null) !== wantParent) {
      problems.push(`Element "${e.key}" hätte im Ergebnis einen anderen Elternknoten als vorher (erwartet "${parent?.key ?? "keinen"}")`);
    }
  }
  return problems;
}
