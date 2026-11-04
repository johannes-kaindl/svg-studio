// Änderungsliste auf SVG-Text anwenden (Spec § 4.1). Pure.
// - Jede Änderung wird zuerst als Spannen-Ersetzung `{ from, to, Ersatz }` gegen den AUSGANGSTEXT berechnet;
//   alle Schlüssel (`id`, `parent`, `after`) beziehen sich auf diesen Text, nie auf Zwischenstände.
//   Überlappende Spannen scheitern, sonst wird von vorn nach hinten zusammengesetzt: alles Übrige bleibt BYTE-GLEICH
//   (Einrückung, Kommentare, Leerzeilen, BOM, Zeilenenden).
// - Verschobene Elemente (`move`) wandern als „Scheibe“: Besitzer einer Spanne ist das innerste verschobene Element, das sie
//   umschließt (ohne seine eigene Entfern-Spanne); sonst gehört sie „oben“ (dem Text). Die Scheibe eines verschobenen Elements ist
//   sein Ausgangstext mit den Spannen, die es besitzt; sie wird dort eingesetzt, wohin das `move` zeigt. So gelten `change`, `add`,
//   `remove` und `move` auf Nachkommen am neuen Ort. Das Ergebnis ist eine Stückliste aus kopierten Originalstücken und neuem Text;
//   aus ihr kommt auch die Abbildung Ausgangs-Offset → Ergebnis-Offset, mit der der Wächter jede Positionsfrage beantwortet.
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
// - `change` und `move` auf dasselbe Element sind erlaubt (die Attribute gelten am neuen Ort). `change`, `add`, `remove` und `move` auf einen Nachkommen eines verschobenen Elements gelten am neuen Ort;
//   `remove` eines Elternknotens mit `move` eines Kindes ist es nicht. Zwei `move`, die sich gegenseitig ineinanderschieben, scheitern.
// - `remove` mit `expect` (kanonische Form des Elements im Ausgang, `canonNode`): weicht das Element im Text ab, scheitert die Liste
//   („hat sich seit der Runde geändert“). Nötig für `style`, `title`, `desc`, deren Schlüssel von der Position abhängt, und für jede Runde, die auf einem älteren Stand aufbaut.
// - Entfernt die Liste ein Element samt Nachkommen, darf sie dessen Nachkommen zusätzlich entfernen (zählt einmal).
// - Attributwerte dürfen keine Steuerzeichen außer Tab/LF/CR enthalten; diese drei werden als `&#9;`/`&#10;`/`&#13;`
//   geschrieben (ein wörtlicher Zeilenumbruch würde vom XML-Parser zu einem Leerzeichen normalisiert).
// - Der Schreibweg (Plan 2) prüft das Ergebnis vor dem Schreiben per DOMParser auf Wohlgeformtheit (nicht den ganzen svg-guard).
import { canonNode, canonTreeOf } from "./canon";
import { attr, scanElements, type SvgElement } from "./elements";

export type SvgChange =
  | { op: "change"; id: string; attrs: Record<string, string | null> }
  | { op: "add"; parent: string | null; after: string | null; markup: string }
  | { op: "remove"; id: string; expect?: string }
  | { op: "move"; id: string; parent: string | null; after: string | null };
// id/parent/after sind Element-Schlüssel (SvgElement.key), auch #wurzel oder #style-1.
// parent null = #wurzel; after null = als erstes Kind.

export type ApplyResult = { ok: true; text: string } | { ok: false; problems: string[] };

/** Ersetzt `text.slice(from, to)` durch `insert`; `from === to` ist eine reine Einfügung. (Für Formatierer, die nur Attributspannen setzen.) */
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

/** Einrückung vor `pos`, wenn davor auf der Zeile nur Leerzeichen/Tabs stehen, sonst `null`. Läuft rückwärts nur über den Leerraum (kein Suchen bis zum Zeilenanfang: eine einzeilige Datei bliebe sonst quadratisch). */
function leadingIndent(text: string, pos: number): string | null {
  let i = pos;
  while (i > 0) {
    const c = text.charCodeAt(i - 1);
    if (c === 0x0a) break;
    if (c !== 0x20 && c !== 0x09) return null;
    i--;
  }
  return text.slice(i, pos);
}

/** Entfernt-Spanne: steht das Element allein auf seinen Zeilen, geht die ganze Zeile mit, sonst nur die Spanne. */
function removalSpan(text: string, el: SvgElement): { from: number; to: number } {
  const lead = leadingIndent(text, el.start);
  if (lead !== null) {
    // Vorwärts nur über Leerraum bis zum Zeilenende; das erste andere Zeichen heißt „nicht allein auf der Zeile“.
    let i = el.end;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0d) break;
      i++;
    }
    if (i >= text.length) return { from: el.start - lead.length, to: text.length };
    if (text.charCodeAt(i) === 0x0a) return { from: el.start - lead.length, to: i + 1 };
  }
  return { from: el.start, to: el.end };
}

/** Wo und womit eingefügt wird. `selfClose`: der Elternknoten ist selbstschließend und wird zu `<p>…</p>`. */
type Spot = { pos: number; lead: string; trail: string } | { selfClose: true };

export interface Inserted {
  parent: SvgElement;
  after: SvgElement | null;
  /** Bei `move` das Element im Ausgangstext, sonst `null` (frisches Markup). */
  source: SvgElement | null;
  /** Wer an dieser Stelle im Ergebnis stehen muss: lokaler Tag und id nach der Liste (`null` ohne id). */
  tag: string;
  id: string | null;
}

/** Ein Stück des Ersatzes einer Spanne: neuer Text oder die Scheibe eines verschobenen Elements. `mark` merkt, wo das Element im Ergebnis beginnt. */
type Part = { text: string; mark?: Inserted } | { slice: SvgElement; mark: Inserted };

interface Planned {
  from: number;
  to: number;
  /** Nummer der Änderung in der Liste (ab 1), für Meldungen. */
  op: number;
  parts: Part[];
}

const text1 = (t: string): Part[] => [{ text: t }];

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
  const parentOf = parentMap(elements);
  const starts = elements.map((e) => e.start);
  /** Erster Index mit `start >= pos`. */
  const lowerBound = (pos: number): number => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
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
        if (value !== null) {
          const sp = attrAppendSpan(text, el, name, value);
          list.push({ from: sp.from, to: sp.to, parts: text1(sp.insert), op });
        }
      } else if (value === null) {
        let from = a.start;
        while (from > el.start && isWs(text.charCodeAt(from - 1))) from--;
        list.push({ from, to: a.valueEnd + 1, parts: [], op });
      } else if (a.value !== value) {
        list.push({ from: a.valueStart, to: a.valueEnd, parts: text1(escapeAttrValue(value, a.quote)), op });
      }
    }
    attrSpans.set(el, list);
  }

  // 2. Strukturänderungen in Listenreihenfolge (die Reihenfolge bestimmt bei gleichem Anker die Einfügereihenfolge).
  const spans: Planned[] = [];
  const insertedList: Inserted[] = [];
  const removed = new Map<SvgElement, number>();
  const movedEls = new Map<SvgElement, number>();
  const anchors: { op: number; after: SvgElement }[] = [];
  // Kinder, die in einen selbstschließenden Elternknoten kommen, werden zu EINER Ersetzung gesammelt.
  const selfFill = new Map<SvgElement, { bodies: Part[]; op: number }>();
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

  /** Plant das Einfügen eines Elements hinter `after` bzw. als erstes Kind von `parent`: frisches Markup (`body` ein Text) oder die Scheibe von `source`.
   *  `reindent`: Folgezeilen von frischem Markup bekommen die Einrückung des Ankers (relative Einrückung bleibt). */
  const plantInsert = (
    label: string,
    op: number,
    parent: SvgElement,
    after: SvgElement | null,
    body: string | null,
    source: SvgElement | null,
    reindent: boolean,
    ident: { tag: string; id: string | null },
  ): void => {
    const spot = spotFor(label, parent, after);
    if (spot === null) return;
    const mark: Inserted = { parent, after: "selfClose" in spot ? null : after, source, tag: ident.tag, id: ident.id };
    insertedList.push(mark);
    if ("selfClose" in spot) {
      const fill = selfFill.get(parent) ?? { bodies: [], op };
      fill.bodies.push(source !== null ? { slice: source, mark } : { text: body ?? "", mark });
      selfFill.set(parent, fill);
      return;
    }
    const ind = spot.lead.slice(eol.length);
    const parts: Part[] = [{ text: spot.lead }];
    if (source !== null) parts.push({ slice: source, mark });
    else parts.push({ text: reindent && ind !== "" ? (body ?? "").split(eol).join(eol + ind) : (body ?? ""), mark });
    if (spot.trail !== "") parts.push({ text: spot.trail });
    spans.push({ from: spot.pos, to: spot.pos, op, parts });
  };

  /** Anzahl der Elemente im Bereich von `el` (samt ihm). */
  const countWithin = (el: SvgElement): number => lowerBound(el.end) - lowerBound(el.start);
  /** Ein Vorfahre von `el` (nicht `el` selbst), den eine Entfernung erfasst. */
  const removedAncestor = (el: SvgElement): SvgElement | null => {
    for (let a = parentOf.get(el) ?? null; a !== null; a = parentOf.get(a) ?? null) if (removed.has(a)) return a;
    return null;
  };
  let canonTree: ReturnType<typeof canonTreeOf> | undefined;
  const indexOfEl = new Map<SvgElement, number>();

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
      plantInsert(label, op, parent, after, markup, null, true, { tag: tops[0].tag, id: tops[0].id });
    } else if (c.op === "remove") {
      const el = resolve(label, c.id, false);
      if (el === null) return;
      if (el.key === ROOT_KEY) {
        problems.push(`${label}: "${ROOT_KEY}" lässt sich nicht entfernen`);
        return;
      }
      if (c.expect === undefined && (el.key === "#title" || el.key === "#desc" || el.key.startsWith("#style-"))) {
        problems.push(`${label}: "${el.key}" hängt von seiner Stelle im Text ab; remove braucht dafür expect (kanonische Form des Elements)`);
        return;
      }
      if (c.expect !== undefined) {
        if (canonTree === undefined) {
          canonTree = canonTreeOf(text, scan);
          elements.forEach((e, k) => indexOfEl.set(e, k));
        }
        if (canonTree === null || canonNode(canonTree, indexOfEl.get(el) ?? -1) !== c.expect) {
          problems.push(`${label}: "${el.key}" hat sich seit der Runde geändert`);
          return;
        }
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
      const r = removalSpan(text, el);
      spans.push({ from: r.from, to: r.to, parts: [], op });
      const newId = merged.get(el)?.attrs.id;
      plantInsert(label, op, parent, after, null, el, false, { tag: el.tag, id: newId === undefined ? el.id : newId === "" ? null : newId });
    }
  });

  // Entfernungen: ein Element im entfernten Elternknoten wird mit ihm entfernt (zählt einmal).
  for (const [el, op] of removed) {
    if (removedAncestor(el) !== null) continue;
    const r = removalSpan(text, el);
    spans.push({ from: r.from, to: r.to, parts: [], op });
    countDelta -= countWithin(el);
  }
  for (const [m, mop] of movedEls) {
    for (let a: SvgElement | null = m; a !== null; a = parentOf.get(a) ?? null) {
      const rop = removed.get(a);
      if (rop === undefined) continue;
      problems.push(
        a === m
          ? `Änderung ${Math.min(rop, mop)} und ${Math.max(rop, mop)}: "${m.key}" soll verschoben und entfernt werden`
          : `Änderung ${rop} (remove) entfernt "${a.key}" samt "${m.key}", das Änderung ${mop} (move) herausnehmen will`,
      );
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
  // Attributspannen (die eines verschobenen Elements gehören ihm und wandern mit).
  for (const list of attrSpans.values()) spans.push(...list);
  for (const [parent, fill] of selfFill) {
    spans.push({
      from: parent.openEnd - 2,
      to: parent.openEnd,
      parts: [{ text: ">" }, ...fill.bodies, { text: `</${rawTagName(text, parent)}>` }],
      op: fill.op,
    });
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  // 3. Besitzer jeder Spanne: das innerste verschobene Element, das sie umschließt (reine Einfügung: echt im Inneren), ohne seine
  //    eigene Entfern-Spanne; sonst „oben“ (null).
  //    Nur Elemente, die VOR der Spanne beginnen (`start < from`) kommen als Besitzer in Frage: eine Spanne, die genau an `m.start` beginnt,
  //    liegt vor `m` (eine Einfügestelle) oder ist `m`s eigene Entfern-Spanne, nie in `m`.
  const ownerOf = (s: Planned): SvgElement | null => {
    if (movedEls.size === 0) return null;
    const idx = lowerBound(s.from) - 1;
    for (let e: SvgElement | null = idx >= 0 ? elements[idx] : null; e !== null; e = parentOf.get(e) ?? null) {
      if (movedEls.has(e) && (s.from === s.to ? s.from < e.end : s.to <= e.end)) return e;
    }
    return null;
  };
  const owned = new Map<SvgElement | null, Planned[]>();
  for (const s of spans) {
    const o = ownerOf(s);
    const l = owned.get(o);
    if (l) l.push(s);
    else owned.set(o, [s]);
  }

  // Überlappung je Besitzer: nach Anfang sortiert darf eine Spanne erst dort beginnen, wo die bisherigen enden.
  for (const list of owned.values()) {
    list.sort((a, b) => a.from - b.from || a.to - b.to);
    let widest: Planned | null = null;
    for (const s of list) {
      if (widest !== null && s.from < widest.to) {
        problems.push(
          widest.op === s.op
            ? `Änderung ${s.op}: das Ziel überschneidet das Element selbst`
            : `Änderung ${Math.min(widest.op, s.op)} und ${Math.max(widest.op, s.op)} überlappen sich: dasselbe Stück Text würde zweimal geändert`,
        );
      }
      if (widest === null || s.to > widest.to) widest = s;
    }
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  // 4. Zusammensetzen als Stückliste: kopierte Originalstücke (mit ihrem Ergebnis-Offset) und neuer Text.
  const chunks: string[] = [];
  let len = 0;
  const origPieces: { from: number; to: number; at: number }[] = [];
  const startOf = new Map<Inserted, number>();
  const emitted = new Set<SvgElement>();
  const emitText = (t: string): void => {
    if (t === "") return;
    chunks.push(t);
    len += t.length;
  };
  const emitOrig = (from: number, to: number): void => {
    if (to <= from) return;
    origPieces.push({ from, to, at: len });
    emitText(text.slice(from, to));
  };
  const emitRange = (from: number, to: number, owner: SvgElement | null): void => {
    let last = from;
    for (const s of owned.get(owner) ?? []) {
      emitOrig(last, s.from);
      for (const part of s.parts) {
        if (part.mark !== undefined) startOf.set(part.mark, len);
        if ("slice" in part) emitSlice(part.slice);
        else emitText(part.text);
      }
      last = s.to;
    }
    emitOrig(last, to);
  };
  const emitSlice = (m: SvgElement): void => {
    if (emitted.has(m)) return;
    emitted.add(m);
    emitRange(m.start, m.end, m);
  };
  try {
    emitRange(0, text.length, null);
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, problems: ["Die Verschiebungen sind zu tief ineinander verschachtelt"] };
    throw e;
  }
  if (emitted.size < movedEls.size) {
    // Ein verschobenes Element, das nie eingesetzt wurde, steckt in einem Kreis: jedes sitzt in der Scheibe eines anderen, das selbst nicht einsetzbar ist.
    const holder = new Map<SvgElement, SvgElement | null>();
    for (const [o, list] of owned) for (const s of list) for (const part of s.parts) if ("slice" in part) holder.set(part.slice, o);
    const loose = [...movedEls.keys()].find((m) => !emitted.has(m));
    const path: SvgElement[] = [];
    const seenAt = new Map<SvgElement, number>();
    for (let m: SvgElement | null | undefined = loose; m !== undefined && m !== null && !seenAt.has(m); m = holder.get(m)) {
      seenAt.set(m, path.length);
      path.push(m);
    }
    const last = holder.get(path[path.length - 1]);
    const cycle = last !== undefined && last !== null && seenAt.has(last) ? path.slice(seenAt.get(last)) : path;
    const ops = [...new Set(cycle.map((m) => movedEls.get(m) ?? 0))].sort((a, b) => a - b);
    const names = ops.length <= 2 ? ops.join(" und ") : `${ops.slice(0, -1).join(", ")} und ${ops[ops.length - 1]}`;
    return { ok: false, problems: [`Änderung ${names} verschieben sich gegenseitig ineinander`] };
  }
  const out = chunks.join("");

  origPieces.sort((a, b) => a.from - b.from);
  const mapOffset = (off: number): number | undefined => {
    let lo = 0;
    let hi = origPieces.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (origPieces[mid].from <= off) lo = mid + 1;
      else hi = mid;
    }
    const pc = lo > 0 ? origPieces[lo - 1] : undefined;
    return pc !== undefined && off < pc.to ? pc.at + (off - pc.from) : undefined;
  };

  const wantAttrs = new Map<SvgElement, Record<string, string | null>>();
  for (const [el, m] of merged) wantAttrs.set(el, m.attrs);
  const insertedAt: { start: number; ins: Inserted }[] = [];
  for (const ins of insertedList) {
    const start = startOf.get(ins);
    if (start === undefined) return { ok: false, problems: [`Eingefügtes Element unter "${ins.parent.key}" wurde nicht in das Ergebnis geschrieben`] };
    insertedAt.push({ start, ins });
  }
  const guard = roundTripProblems(out, mapOffset, insertedAt, wantAttrs, elements.length + countDelta, {
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
 * `mapOffset` bildet einen Ausgangs-Offset auf den Ergebnis-Offset ab (nur für kopierte Originalstücke, sonst `undefined`);
 * `inserted` nennt die Ergebnis-Offsets der eingefügten und verschobenen Elemente. Nur für Tests exportiert.
 */
export function roundTripProblems(
  out: string,
  mapOffset: (orig: number) => number | undefined,
  inserted: ReadonlyArray<{ start: number; ins: Inserted }>,
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
  const kidsNow = new Map<SvgElement | null, SvgElement[]>();
  const posInParent = new Map<SvgElement, number>();
  for (const e of res.elements) {
    const p = parentNowOf.get(e) ?? null;
    const l = kidsNow.get(p);
    if (l) l.push(e);
    else kidsNow.set(p, [e]);
    posInParent.set(e, (l ?? kidsNow.get(p)!).length - 1);
  }
  const nowAt = (orig: number): SvgElement | undefined => {
    const m = mapOffset(orig);
    return m === undefined ? undefined : atStart.get(m);
  };

  for (const [el, attrs] of merged) {
    const now = nowAt(el.start);
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

  // Eingefügte und verschobene Elemente in Listenreihenfolge: richtiger Ort (Elternknoten, Vorgänger) und richtiger Inhalt (Tag, id).
  // Vorgänger ist das gemeinte `after` oder, hinter demselben Anker, das zuletzt eingefügte Element derselben Gruppe (Listenreihenfolge).
  const lastOfGroup = new Map<SvgElement, Map<SvgElement | null, SvgElement>>();
  for (const { start, ins } of inserted) {
    const now = atStart.get(start);
    const parentNow = nowAt(ins.parent.start);
    if (now === undefined || parentNow === undefined) {
      problems.push(`Eingefügtes Element unter "${ins.parent.key}" fehlt im Ergebnis`);
      continue;
    }
    if (parentNowOf.get(now) !== parentNow) {
      problems.push(`Eingefügtes Element "${now.key}" hängt nicht unter "${ins.parent.key}"`);
      continue;
    }
    if (now.tag !== ins.tag || now.id !== ins.id) {
      problems.push(`An der Stelle von "${ins.id ?? ins.tag}" steht im Ergebnis "${now.id ?? now.tag}" statt des gemeinten Elements`);
      continue;
    }
    const group = lastOfGroup.get(ins.parent) ?? new Map<SvgElement | null, SvgElement>();
    lastOfGroup.set(ins.parent, group);
    const wanted = group.get(ins.after) ?? (ins.after === null ? undefined : nowAt(ins.after.start));
    const prev = (kidsNow.get(parentNow) ?? [])[(posInParent.get(now) ?? 0) - 1];
    if (prev !== wanted) problems.push(`Eingefügtes Element "${now.key}" steht nicht hinter "${ins.after?.key ?? "dem Anfang"}"`);
    group.set(ins.after, now);
  }

  // Jedes Originalelement, das weder entfernt noch verschoben wurde (auch nicht über einen entfernten Vorfahren), behält seinen Elternknoten.
  // Nachkommen eines verschobenen Elements gehören dazu: sie wandern mit ihrem Elternknoten, ihr Elternknoten bleibt derselbe.
  const parentWas = parentMap(originals.elements);
  const gone = new Set<SvgElement>();
  for (const e of originals.elements) {
    const parent = parentWas.get(e) ?? null;
    if (originals.removed.has(e) || (parent !== null && gone.has(parent))) {
      gone.add(e);
      continue;
    }
    if (originals.moved.has(e)) continue;
    const now = nowAt(e.start);
    if (now === undefined) {
      problems.push(`Element "${e.key}" fehlt im Ergebnis`);
      continue;
    }
    const wantParent = parent === null ? null : (nowAt(parent.start) ?? null);
    if ((parentNowOf.get(now) ?? null) !== wantParent) {
      problems.push(`Element "${e.key}" hätte im Ergebnis einen anderen Elternknoten als vorher (erwartet "${parent?.key ?? "keinen"}")`);
    }
  }
  return problems;
}
