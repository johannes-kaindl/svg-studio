// Editor-Angaben aus einem Bestands-SVG entfernen (Plan 2, Entscheidung E4 a): Inkscape schreibt `sodipodi:namedview`, ein `metadata` mit RDF, Attribute
// `sodipodi:*` und `inkscape:*` und die zugehörigen `xmlns:`-Deklarationen. `svg-guard` lehnt das ab (Namensräume fremder Editoren sind nicht erlaubt);
// der Kit-Vertrag „ablehnen statt still entfernen“ bleibt. Diese Regel entfernt es ausdrücklich, ohne Modell, als Änderungsliste, die der Nutzer als
// Diff sieht und annimmt. Pure.
import type { SvgChange } from "./changes";
import type { Problem } from "./problem";
import { isUnnamedKey, scanElements, type SvgElement } from "./elements";

/** Präfixe der Editor-Namensräume (Inkrementweise Liste, ergänzt nur nach Fund in einem echten Bestand). */
const EDITOR_PREFIXES = ["sodipodi", "inkscape", "rdf", "cc", "dc"] as const;
const OWN_PREFIXES = ["sodipodi", "inkscape"] as const;

const prefixOf = (name: string): string | null => {
  const i = name.indexOf(":");
  return i > 0 ? name.slice(0, i) : null;
};

export function stripEditorMetadata(text: string): { ok: true; changes: SvgChange[] } | { ok: false; problem: Problem } {
  const scan = scanElements(text);
  const syntax = scan.issues.find((i) => i.kind === "syntax");
  if (syntax !== undefined) return { ok: false, problem: { code: "text-unreadable", params: [syntax.message, syntax.offset] } };
  const els = scan.elements;
  const rawName = (e: SvgElement): string => {
    let k = e.start + 1;
    while (k < e.openEnd && !/[ \t\r\n/>]/.test(text[k])) k++;
    return text.slice(e.start + 1, k);
  };
  const names = els.map(rawName);

  // Entfernen: Elemente der Editor-Namensräume und ein `metadata`, in dem solche stehen; nur die obersten (Nachkommen gehen mit).
  const removed: boolean[] = els.map(() => false);
  const gone: boolean[] = els.map(() => false);
  const parentIdx = new Map<SvgElement, number>();
  const stack: number[] = [];
  els.forEach((e, i) => {
    while (stack.length > 0 && els[stack[stack.length - 1]].end <= e.start) stack.pop();
    parentIdx.set(e, stack.length > 0 ? stack[stack.length - 1] : -1);
    stack.push(i);
  });
  const hasEditorDescendant: boolean[] = els.map(() => false);
  for (let i = els.length - 1; i >= 0; i--) {
    const p = parentIdx.get(els[i]) ?? -1;
    const pre = prefixOf(names[i]);
    if (p >= 0 && (hasEditorDescendant[i] || (pre !== null && (EDITOR_PREFIXES as readonly string[]).includes(pre)))) hasEditorDescendant[p] = true;
  }
  els.forEach((e, i) => {
    const p = parentIdx.get(e) ?? -1;
    const pre = prefixOf(names[i]);
    const editorEl = (pre !== null && (EDITOR_PREFIXES as readonly string[]).includes(pre)) || (e.tag === "metadata" && hasEditorDescendant[i]);
    gone[i] = (p >= 0 && gone[p]) || (editorEl && p >= 0);
    removed[i] = editorEl && p >= 0 && !(gone[p]);
  });

  // Welche Präfixe bleiben im Rest in Gebrauch (Element- oder Attributnamen, ohne die entfernten Teile und ohne die Attribute, die wir streichen)?
  const stillUsed = new Set<string>();
  els.forEach((e, i) => {
    if (gone[i]) return;
    const pre = prefixOf(names[i]);
    if (pre !== null) stillUsed.add(pre);
    for (const a of e.attrs) {
      const ap = prefixOf(a.name);
      if (ap === null || ap === "xmlns" || ap === "xml") continue;
      if ((OWN_PREFIXES as readonly string[]).includes(ap)) continue; // wird gestrichen
      stillUsed.add(ap);
    }
  });

  const removes: SvgChange[] = [];
  const changes: SvgChange[] = [];
  const unnamed: string[] = [];
  els.forEach((e, i) => {
    if (gone[i] && !removed[i]) return;
    if (removed[i]) {
      if (isUnnamedKey(e.key)) unnamed.push(names[i]);
      else removes.push({ op: "remove", id: e.key });
      return;
    }
    const attrs: Record<string, string | null> = {};
    for (const a of e.attrs) {
      const pre = prefixOf(a.name);
      if (pre === null) continue;
      if ((OWN_PREFIXES as readonly string[]).includes(pre)) attrs[a.name] = null;
      else if (pre === "xmlns") {
        const declared = a.name.slice("xmlns:".length);
        if ((EDITOR_PREFIXES as readonly string[]).includes(declared) && !stillUsed.has(declared)) attrs[a.name] = null;
      }
    }
    if (Object.keys(attrs).length === 0) return;
    if (isUnnamedKey(e.key)) unnamed.push(names[i]);
    else changes.push({ op: "change", id: e.key, attrs });
  });
  if (unnamed.length > 0) {
    return { ok: false, problem: { code: "editor-unnamed", params: [[...new Set(unnamed)].join(", ")] } };
  }
  return { ok: true, changes: [...removes, ...changes] };
}
