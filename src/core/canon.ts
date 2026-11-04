// Kanonische Form eines SVG-Dokuments oder Elements. Pure.
// Zwei Texte, die dasselbe Bild beschreiben, aber anders gesetzt sind (Einrückung, Attributreihenfolge, Kommentare, neu umbrochene
// Pfaddaten), haben dieselbe Form. Sie dient `diff.ts` (gepaarte Elemente vergleichen, Vollständigkeitsprüfung) und `remove.expect`
// in `changes.ts` (das Element ist seit der Runde unverändert). Doppelte ids sind erlaubt: der Baum kennt Indizes, keine Schlüssel.
import { scanElements, type ScanIssue, type SvgElement } from "./elements";

export interface CanonTree {
  /** In Dokumentreihenfolge; Kinder stehen immer hinter ihrem Elternknoten. */
  elements: SvgElement[];
  /** Index des Elternknotens, `-1` für die Wurzel. */
  parent: number[];
  /** Indizes der Kinder in Dokumentreihenfolge. */
  kids: number[][];
  /** Eigener Text je Element: `kids.length + 1` Stücke (vor, zwischen und nach den Kindern), ohne Kommentare, Leerraum zusammengefasst. */
  ownText: string[][];
  /** Tag-Name wie im Text, mit Präfix und Schreibweise (`<RECT>` und `<x:rect>` sind nicht `<rect>`). */
  names: string[];
}

/** Elemente, in denen Leerraum zwischen Kindern gerendert wird. */
const TEXT_TAGS = new Set(["text", "tspan", "textpath", "tref", "altglyph"]);

const WS_RUN = /[ \t\r\n]+/g;

/** Jede Folge aus XML-Leerraum (Leerzeichen, Tab, LF, CR; NICHT Unicode-Leerraum wie NBSP) wird ein Leerzeichen, am Rand ganz entfernt. */
const collapse = (v: string, keepEdges: boolean): string => {
  const c = v.replace(WS_RUN, " ");
  if (keepEdges) return c;
  const from = c.startsWith(" ") ? 1 : 0;
  const to = c.length > from && c.endsWith(" ") ? c.length - 1 : c.length;
  return c.slice(from, to);
};

/** Vergleichsregel für Attributwerte der kanonischen Form: XML-Leerraum gekürzt und jede Folge zu einem Leerzeichen (anders als die Attributwert-Normalisierung des Scanners auch am Rand und für `&#10;`). */
export function normalizeValue(v: string): string {
  return collapse(v, false);
}

/**
 * Baum aus einem schon gescannten Text. `null` bei Syntaxbefunden (doppelte ids sind keine).
 * Der Text muss derselbe sein, aus dem `scan` stammt.
 */
export function canonTreeOf(text: string, scan: { elements: SvgElement[]; issues: readonly ScanIssue[]; comments: ReadonlyArray<{ start: number; end: number }> }): CanonTree | null {
  if (scan.issues.some((i) => i.kind === "syntax")) return null;
  const elements = scan.elements;
  const parent: number[] = [];
  const kids: number[][] = elements.map(() => []);
  const stack: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    while (stack.length > 0 && elements[stack[stack.length - 1]].end <= elements[i].start) stack.pop();
    const p = stack.length > 0 ? stack[stack.length - 1] : -1;
    parent.push(p);
    if (p >= 0) kids[p].push(i);
    stack.push(i);
  }
  // Kommentare liegen in Dokumentreihenfolge; ein Zeiger läuft mit, damit jede Textlücke nur ihre eigenen Kommentare sieht.
  const comments = scan.comments;
  let ci = 0;
  /** Text zwischen zwei Tags ohne Kommentare. `preserve`: unverändert (xml:space="preserve"); sonst Leerraum zusammengefasst. */
  const gap = (from: number, to: number, preserve: boolean): string => {
    while (ci < comments.length && comments[ci].end <= from) ci++;
    let out = "";
    let at = from;
    let k = ci;
    while (k < comments.length && comments[k].start < to) {
      if (comments[k].start >= at) out += text.slice(at, comments[k].start);
      at = Math.max(at, comments[k].end);
      k++;
    }
    if (at < to) out += text.slice(at, to);
    return preserve ? out : collapse(out, true);
  };
  // xml:space="preserve" gilt für den Teilbaum, bis ein Nachfahre "default" setzt; Eltern stehen vor ihren Kindern.
  const preserve: boolean[] = [];
  for (let i = 0; i < elements.length; i++) {
    const own = elements[i].attrs.find((a) => a.name === "xml:space")?.value;
    preserve.push(own === "preserve" ? true : own === "default" ? false : parent[i] >= 0 && preserve[parent[i]]);
  }
  const names = elements.map((e) => {
    let k = e.start + 1;
    while (k < e.openEnd && !/[ \t\r\n/>]/.test(text[k])) k++;
    return text.slice(e.start + 1, k);
  });
  const ownText: string[][] = elements.map(() => []);
  // Die Lücken (Text zwischen Tags) werden in Textreihenfolge gelesen, damit der Kommentar-Zeiger `ci` nur vorwärts läuft.
  const pieces: Array<{ el: number; slot: number; from: number; to: number }> = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const ks = kids[i];
    let at = e.openEnd;
    for (let j = 0; j <= ks.length; j++) {
      const to = j < ks.length ? elements[ks[j]].start : e.closeStart;
      pieces.push({ el: i, slot: j, from: at, to: Math.max(at, to) });
      if (j < ks.length) at = elements[ks[j]].end;
    }
  }
  pieces.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const pc of pieces) {
    const raw = gap(pc.from, pc.to, preserve[pc.el]);
    let piece = raw;
    if (!preserve[pc.el]) {
      const bare = collapse(raw, false);
      const edge = pc.slot === 0 || pc.slot === kids[pc.el].length;
      // Reiner Leerraum zwischen Tags ist Struktur und egal; nur in Textelementen zählt ein Leerzeichen ZWISCHEN zwei Kindern (b c gegen bc).
      if (bare === "") piece = !edge && raw !== "" && TEXT_TAGS.has(elements[pc.el].tag) ? " " : "";
      else piece = kids[pc.el].length === 0 ? bare : raw;
    }
    ownText[pc.el][pc.slot] = piece;
  }
  return { elements, parent, kids, ownText, names };
}

/** Baum eines Textes; `null` bei Syntaxbefunden. */
export function buildCanonTree(text: string): CanonTree | null {
  return canonTreeOf(text, scanElements(text));
}

const memo = new WeakMap<CanonTree, string[]>();

function allNodes(t: CanonTree): string[] {
  const cached = memo.get(t);
  if (cached !== undefined) return cached;
  const out: string[] = new Array<string>(t.elements.length);
  // Kinder haben größere Indizes als der Elternknoten: von hinten nach vorn ist jedes Kind fertig, wenn sein Elternknoten drankommt.
  for (let i = t.elements.length - 1; i >= 0; i--) {
    const e = t.elements[i];
    const attrs = e.attrs
      .map((a) => [a.name, normalizeValue(a.value)] as const)
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([n, v]) => `${n}=${JSON.stringify(v)}`)
      .join(" ");
    let body = "";
    const ks = t.kids[i];
    for (let j = 0; j <= ks.length; j++) {
      const piece = t.ownText[i][j];
      if (piece !== "") body += JSON.stringify(piece);
      if (j < ks.length) body += out[ks[j]];
    }
    out[i] = `<${t.names[i]}${attrs === "" ? "" : ` ${attrs}`}>${body}</${t.names[i]}>`;
  }
  memo.set(t, out);
  return out;
}

/** Kanonische Form des Elements mit diesem Index samt Nachkommen: Tag, Attribute nach Namen sortiert mit zusammengefasstem Leerraum, eigener Text, Kinder. */
export function canonNode(t: CanonTree, i: number): string {
  return allNodes(t)[i] ?? "";
}

/** Kanonische Form des ganzen Dokuments (die Wurzel); `null` bei Syntaxbefunden oder ohne Element. */
export function canonDocument(text: string): string | null {
  const t = buildCanonTree(text);
  if (t === null || t.elements.length === 0) return null;
  return canonNode(t, 0);
}
