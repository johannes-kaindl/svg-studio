// Formatierer: Werte, die nur beim ersten Erzeugen oder beim Öffnen gesetzt werden. Pure.
// Wie `changes.ts` rührt jede Funktion nur die betroffenen Spannen an; alles andere bleibt byte-gleich.
import { applySpans, attrAppendSpan, type TextSpan } from "./changes";
import { scanElements, type ScanIssue } from "./elements";

/**
 * Vergibt `<tag>-<n>` an Elemente ohne `id` (n zählt je Tag, belegte ids und Schlüssel werden übersprungen).
 * NUR für das erste Erzeugen: danach sind ids stabil und werden nie umnummeriert.
 * Wurzel, `style`, `title` und `desc` (feste Schlüssel) bekommen keine.
 * Hat der Text Syntax-Befunde (etwa ein unquotiertes `id=x`, das nicht in `attrs` steht), bleibt er unverändert und die
 * Befunde stehen in `issues`: sonst würde ein zweites `id` danebengesetzt.
 */
export function assignMissingIds(text: string): { text: string; assigned: string[]; issues?: ScanIssue[] } {
  const scan = scanElements(text);
  const elements = scan.elements;
  // Eine doppelte id blockiert nichts (Spec § 6.2); nur Syntaxbefunde: sonst würde ein zweites `id` danebengesetzt.
  const issues = scan.issues.filter((i) => i.kind === "syntax");
  if (issues.length > 0) return { text, assigned: [], issues };
  const taken = new Set<string>();
  for (const e of elements) {
    taken.add(e.key);
    if (e.id !== null) taken.add(e.id);
  }
  const counters = new Map<string, number>();
  const assigned: string[] = [];
  const spans: TextSpan[] = [];
  for (const el of elements) {
    if (el.id !== null || el.key.startsWith("#")) continue;
    let n = counters.get(el.tag) ?? 0;
    let id: string;
    do {
      n++;
      id = `${el.tag}-${n}`;
    } while (taken.has(id));
    counters.set(el.tag, n);
    taken.add(id);
    assigned.push(id);
    // Ein vorhandenes `id=""` wird gefüllt, nicht gedoppelt.
    const empty = el.attrs.find((a) => a.name === "id");
    spans.push(empty !== undefined ? { from: empty.valueStart, to: empty.valueEnd, insert: id } : attrAppendSpan(text, el, "id", id));
  }
  return assigned.length === 0 ? { text, assigned } : { text: applySpans(text, spans), assigned };
}

/** Setzt `data-unit` an der Wurzel, wenn es fehlt; sonst (oder bei Syntaxbefunden im Text) bleibt der Text unverändert. */
export function ensureUnit(text: string, unit: string): string {
  const scan = scanElements(text);
  if (scan.issues.some((i) => i.kind === "syntax")) return text;
  const root = scan.elements.find((e) => e.key === "#wurzel");
  if (root === undefined || root.attrs.some((a) => a.name === "data-unit")) return text;
  return applySpans(text, [attrAppendSpan(text, root, "data-unit", unit)]);
}
