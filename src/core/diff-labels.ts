// Beschriftung der Einträge des Element-Diffs für die Prüfliste (Spec § 6.2, Plan 2 D1). Pure und sprachfrei: die Wörter kommen als `LabelTexts` von außen
// (`src/i18n/strings.ts`, `labelTexts()`), der Kern setzt nur zusammen. Der Titel ist auch die Beschriftung, unter der eine Ablehnung oder ein Kommentar ans Modell geht.
//
// Titel je Eintrag („Kreis mond“ = Elementart plus `id`):
//   attr      Kreis mond: r 40 → 60        · `d`/`points`: „Pfad weg: Form geändert“ (nie Zahlen) · Wurzel: „Bildfläche: viewBox 0 0 460 425 → 0 0 700 425“
//   add       Rechteck tür: hinzugefügt    remove  Rechteck tür: entfernt
//   move      Kreis mond: nach vorn / nach hinten · Elternwechsel: „Rechteck tür: in Gruppe wand-nord“
//   replace   Stil geändert (auch Titel, Beschreibung) · sonst nach Grund: „…: Text geändert“, „…: Elementart geändert“, „…: verschoben, Text geändert“,
//             wrap „Elemente: in neue Gruppe g-neu“, unwrap „Gruppe wand: aufgelöst“
// Die Segmente füttern das Redline (Wort-Diff alt → neu). Ein `replace` trägt zusätzlich die kanonische Form vorher/nachher (ohne Pfaddaten), damit sichtbar ist, was
// in dem Ganzen steckt (Reste aus Plan 2 B3, Punkt 1: Attributänderungen an Nachkommen eines ersetzten oder eingepackten Elements).
import { canonDocument } from "./canon";
import type { DiffEntry } from "./diff";
import { diffWords, wordDiffSegments } from "../vendor/kit/word-diff";

export interface LabelTexts {
  /** Elementart als Wort („circle“ → „Kreis“); unbekannt: der Name selbst. */
  tag(tag: string): string;
  root: string;
  unset: string;
  shapeChanged: string;
  /** Der Name des festen Schlüssels: Stil, Titel, Beschreibung. */
  fixed(kind: "style" | "title" | "desc"): string;
  changed: string;
  added: string;
  removed: string;
  front: string;
  back: string;
  reordered: string;
  inGroup(key: string): string;
  inRoot: string;
  textChanged: string;
  tagChanged: string;
  movedAndText: string;
  wrapSubject: string;
  wrapped(key: string): string;
  unwrapped: string;
}

export interface EntryText {
  title: string;
  segments: Array<{ kind: "same" | "del" | "ins"; text: string }>;
  changeKind: "insertion" | "deletion" | "substitution";
  /** Das Element, zu dem die Vorschau springt (`PreviewHandle.select`); `null` bei Wurzel, Stil, Titel, Beschreibung. */
  jumpId: string | null;
}

type Seg = EntryText["segments"][number];

const SHAPE_ATTRS = new Set(["d", "points"]);
/** Mehr als so viele Zeichen kanonische Form je Seite zeigt die Karte nicht (sie zeigte dann Zahlensalat und sprengte die Seitenleiste). */
const MAX_DETAIL = 1200;
/** Darüber wird kein Wort-Diff gebildet (Rechenzeit); die Karte bleibt ohne Detail. */
const MAX_WORDS = 40000;
/** Gleicher Text rund um eine Abweichung, der in einer großen Karte stehen bleibt. */
const CONTEXT = 40;

const fixedKind = (key: string): "style" | "title" | "desc" | null => (key.startsWith("#style-") ? "style" : key === "#title" ? "title" : key === "#desc" ? "desc" : null);

/** Pfaddaten und Punktlisten in der kanonischen Form durch „…“ ersetzen (Spec § 6.2: keine Zahlen für Formen). */
const elideShapes = (canon: string): string => canon.replace(/( )(d|points)="(?:[^"\\]|\\.)*"/g, '$1$2="…"');

function wordSegments(from: string, to: string): Seg[] {
  return wordDiffSegments(from, to, diffWords(from, to).changes);
}

/** Die kanonische Form eines Markups aus einer `add`-Änderung (ohne Pfaddaten); leer, wenn es nicht zu lesen ist. */
const canonOfMarkup = (markup: string): string => elideShapes(canonDocument(markup) ?? "");

/** Vorher/Nachher eines `replace`, `wrap` oder `unwrap` als Segmente; leer, wenn eine Seite fehlt oder zu groß ist. */
function replaceDetail(e: Extract<DiffEntry, { kind: "replace" }>): Seg[] {
  let before = "";
  let after = "";
  for (const c of e.changes) {
    if (c.op === "remove" && c.expect !== undefined) before += elideShapes(c.expect);
    else if (c.op === "add") after += canonOfMarkup(c.markup);
  }
  if (before === "" && after === "") return [];
  if (before.length > MAX_WORDS || after.length > MAX_WORDS) return [];
  const segs = wordSegments(before, after);
  return before.length > MAX_DETAIL || after.length > MAX_DETAIL ? shorten(segs) : segs;
}

/**
 * Eine große Ersetzung zeigt nur ihre Abweichungen: lange gleiche Stücke werden auf den Rand gekürzt („…“), bis die Karte das Maß hält; Gelöschtes und Eingefügtes
 * bleibt vor Gleichem erhalten. Ohne das blieb eine nebenbei geänderte Farbe in einer großen Gruppe unsichtbar (Opus-Gesamtreview 2026-11-05, Spec § 3 Punkt 2).
 */
function shorten(segs: Seg[]): Seg[] {
  const out: Seg[] = segs.map((seg, i) => {
    if (seg.kind !== "same" || seg.text.length <= 2 * CONTEXT + 4) return seg;
    const head = i === 0 ? "" : seg.text.slice(0, CONTEXT);
    const tail = i === segs.length - 1 ? "" : seg.text.slice(-CONTEXT);
    return { kind: "same", text: `${head}…${tail}` };
  });
  let used = 0;
  const kept: Seg[] = [];
  // Ein einzelnes Stück nimmt höchstens ein Viertel des Maßes, damit das Gelöschte nicht das Eingefügte verdrängt.
  const cap = MAX_DETAIL / 4;
  for (const seg0 of out) {
    const seg: Seg = seg0.text.length > cap ? { kind: seg0.kind, text: `${seg0.text.slice(0, cap)}…` } : seg0;
    const room = MAX_DETAIL - used;
    if (room <= 0) break;
    kept.push(seg.text.length <= room ? seg : { kind: seg.kind, text: `${seg.text.slice(0, room)}…` });
    used += seg.text.length;
  }
  if (kept.length < out.length) kept.push({ kind: "same", text: "…" });
  return kept;
}

export function describeEntry(e: DiffEntry, t: LabelTexts): EntryText {
  const fixed = fixedKind(e.key);
  const subject = e.key === "#wurzel" ? t.root : fixed !== null ? t.fixed(fixed) : `${t.tag(e.tag)} ${e.key}`;
  const jumpId = e.key.startsWith("#") || e.key.startsWith("@") ? null : e.key;
  const whole = (title: string, kind: Seg["kind"], changeKind: EntryText["changeKind"]): EntryText => ({ title, segments: [{ kind, text: title }], changeKind, jumpId });
  // Feste Schlüssel stehen ohne Doppelpunkt („Stil geändert“): es gibt nur einen davon, eine `id` braucht der Leser nicht.
  const verb = (word: string): string => (fixed !== null ? `${subject} ${word}` : `${subject}: ${word}`);

  switch (e.kind) {
    case "attr": {
      const changeKind = e.from === null ? "insertion" : e.to === null ? "deletion" : "substitution";
      if (SHAPE_ATTRS.has(e.attr)) return whole(verb(t.shapeChanged), "same", "substitution");
      const head = `${subject}: ${e.attr} `;
      const title = `${head}${e.from ?? t.unset} → ${e.to ?? t.unset}`;
      return { title, segments: [{ kind: "same", text: head }, ...wordSegments(e.from ?? "", e.to ?? "")], changeKind, jumpId };
    }
    case "add":
      return whole(verb(t.added), "ins", "insertion");
    case "remove":
      return whole(verb(t.removed), "del", "deletion");
    case "move": {
      const where = e.reparent === true ? (e.parentKey === null ? t.inRoot : t.inGroup(e.parentKey)) : e.front === true ? t.front : e.front === false ? t.back : t.reordered;
      return whole(verb(where), "same", "substitution");
    }
    case "replace": {
      let title: string;
      if (fixed !== null) {
        // Aufeinanderfolgende Ersetzungen von Stil, Titel und Beschreibung stehen in EINEM Eintrag (der Diff legt sie zusammen): alle nennen, nicht nur den ersten.
        const kinds = new Set([fixed, ...e.changes.flatMap((c) => (c.op === "remove" ? [fixedKind(c.id)] : [])).filter((k) => k !== null)]);
        title = `${[...kinds].map((k) => t.fixed(k)).join(", ")} ${t.changed}`;
      }
      else if (e.reason === "wrap") title = `${t.wrapSubject}: ${t.wrapped(e.key)}`;
      else if (e.reason === "unwrap") title = `${t.tag(e.tag)} ${e.key}: ${t.unwrapped}`;
      else title = `${subject}: ${e.reason === "tag" ? t.tagChanged : e.reason === "moved-and-text" ? t.movedAndText : t.textChanged}`;
      const detail = replaceDetail(e);
      const segments: Seg[] = detail.length === 0 ? [{ kind: "same", text: title }] : [{ kind: "same", text: `${title}\n` }, ...detail];
      return { title, segments, changeKind: "substitution", jumpId };
    }
  }
}
