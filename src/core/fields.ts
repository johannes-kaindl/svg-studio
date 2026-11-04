// Zahlenfelder (Spec § 7.5): welche Werte ein gewähltes Element als Felder zeigt und welche Änderungsliste eine Eingabe ergibt. Pure.
// Ein Feld ändert über `applyChanges` genau ein Attribut (`change`), alles andere bleibt byte-gleich. Ausnahme ist der Text eines `<text>`: Text ist kein Attribut,
// er wird mit `remove` (mit `expect`) plus `add` des Elements mit neuem Inhalt ersetzt. Die Sprache gehört der Oberfläche: Probleme sind `Problem { code, params }`,
// der Grund eines schreibgeschützten Felds ist ein Code (`ReadonlyReason`); nur das Wort für den Rundentitel („Von Hand“) steht hier, weil der Vertrag es mit `lang` verlangt.
import { buildCanonTree, canonNode } from "./canon";
import type { SvgChange } from "./changes";
import { attr, decodeEntities, scanElements, type SvgElement } from "./elements";
import type { Problem } from "./problem";

export type FieldKind = "number" | "text" | "color" | "translate" | "rotate";
/** Warum ein Feld schreibgeschützt ist (die Oberfläche übersetzt den Code). */
export type ReadonlyReason =
  | "unit" // Wert mit Einheit oder Prozent
  | "value" // Wert, den das Feld nicht abbildet (Liste, Ausdruck)
  | "style" // das `style`-Attribut setzt dieselbe Eigenschaft und gewinnt
  | "markup" // Text mit Unterelementen, Zeilenumbruch oder Kommentar
  | "unnamed" // das Element, sein Elternknoten oder sein Vorgänger hat keine id
  | "ambiguous" // die id kommt mehrfach vor
  | TransformReason;
export type TransformReason = "matrix" | "scale" | "skew" | "transform";
export interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** Wert wie im Quelltext (Zahl, Farbe, Text); leer, wenn das Attribut fehlt. */
  value: string;
  /** Gesetzt = schreibgeschützt, mit dem Grund als Code. */
  readonly?: ReadonlyReason;
}
export type Transform =
  | { ok: true; translate: [number, number]; rotate: { a: number; cx: number; cy: number } | null }
  | { ok: false; reason: TransformReason };
export type FieldResult = { ok: true; changes: SvgChange[]; label: string } | { ok: false; problem: Problem };
export interface FieldCtx {
  /** Mitte des Elements im Koordinatenraum VOR seinem eigenen `transform` (Mitte von `getBBox()`); nur die erste Drehung braucht sie. */
  center?: [number, number];
  lang: "de" | "en";
}

/** Das Wort vor der Aufzählung („Von Hand: mond r 60“); dieselben Wörter wie `review.author.hand` in `src/i18n/strings.ts` (ein Test hält sie gleich). */
export const HAND_LABEL: Readonly<Record<"de" | "en", string>> = { de: "Von Hand", en: "By hand" };

const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx"],
  line: ["x1", "y1", "x2", "y2"],
  text: ["x", "y", "font-size"],
};
/** Elemente ohne eigene Lage-Attribute: sie verschieben sich über `transform`. */
const MOVABLE: ReadonlySet<string> = new Set(["polygon", "polyline", "path", "g"]);
const PAINT_COLORS = ["fill", "stroke"] as const;
/** Nur diese Felder nimmt ein leeres Feld als „Attribut entfernen“ an. */
const REMOVABLE: ReadonlySet<string> = new Set(["fill", "stroke", "stroke-width", "rx"]);
/** Diese Maße sind in SVG nie negativ. */
const NON_NEGATIVE: ReadonlySet<string> = new Set(["r", "rx", "ry", "width", "height", "font-size", "stroke-width"]);

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
/** Eingabe: Ziffern mit Punkt oder Komma, kein Exponent. */
const INPUT_NUMBER = /^([+-]?)(\d+(?:[.,]\d*)?|[.,]\d+)$/;
/** Wert im Quelltext: eine Zahl, auch mit Exponent. */
const PLAIN_NUMBER = new RegExp(`^${NUM}(?:[eE][+-]?\\d+)?$`);
const WITH_UNIT = new RegExp(`^${NUM}\\s*[A-Za-z%]+$`);
const LIMIT = 1e12;

/** Zahl ohne Exponent und ohne „-0“, höchstens sechs Nachkommastellen. */
function fmt(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  let s = String(r);
  if (s.includes("e")) s = r.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** „60“, „60.5“, „60,5“ → 60.5; alles andere (Einheit, Prozent, Exponent, Text) → `null`. */
function parseInput(raw: string): number | null {
  const m = INPUT_NUMBER.exec(raw.trim());
  if (m === null) return null;
  const n = Number(`${m[1]}${m[2].replace(",", ".")}`);
  return Number.isFinite(n) && Math.abs(n) <= LIMIT && !fmt(n).includes("e") ? n : null;
}

/** Zahl eines vorhandenen Attributwerts (auch mit Exponent), sonst `null`. */
function parseStored(value: string): number | null {
  const v = value.trim();
  if (!PLAIN_NUMBER.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- transform ----------------------------------------------------------------------------------------------------------------------

const FUNCTION = /\s*([A-Za-z]+)\s*\(([^()]*)\)\s*,?/y;
const ARG = new RegExp(`^${NUM}(?:[eE][+-]?\\d+)?$`);

function args(list: string): number[] | null {
  const parts = list.trim() === "" ? [] : list.trim().split(/[\s,]+/);
  if (!parts.every((p) => ARG.test(p))) return null;
  const nums = parts.map(Number);
  return nums.every(Number.isFinite) ? nums : null;
}

/**
 * Liest ein `transform`-Attribut in der Form, die die Felder abbilden: höchstens ein `translate`, danach höchstens ein `rotate`.
 * `matrix`, `scale`, `skew` und alles, was sich in diese Reihenfolge nicht fügt, ist `ok: false` mit dem Grund. Kein Attribut oder ein leeres: keine Verschiebung, keine Drehung.
 */
export function parseTransform(value: string | null): Transform {
  const translate: [number, number] = [0, 0];
  let rotate: { a: number; cx: number; cy: number } | null = null;
  let seenTranslate = false;
  const v = value ?? "";
  let at = 0;
  FUNCTION.lastIndex = 0;
  while (v.slice(at).trim() !== "") {
    FUNCTION.lastIndex = at;
    const m = FUNCTION.exec(v);
    if (m === null) return { ok: false, reason: "transform" };
    at = FUNCTION.lastIndex;
    const name = m[1];
    if (name === "matrix") return { ok: false, reason: "matrix" };
    if (name === "scale") return { ok: false, reason: "scale" };
    if (name === "skewX" || name === "skewY") return { ok: false, reason: "skew" };
    const a = args(m[2]);
    if (a === null) return { ok: false, reason: "transform" };
    if (name === "translate" && !seenTranslate && rotate === null && (a.length === 1 || a.length === 2)) {
      seenTranslate = true;
      translate[0] = a[0]!;
      translate[1] = a[1] ?? 0;
    } else if (name === "rotate" && rotate === null && (a.length === 1 || a.length === 3)) {
      rotate = { a: a[0], cx: a[1] ?? 0, cy: a[2] ?? 0 };
    } else return { ok: false, reason: "transform" };
  }
  return { ok: true, translate, rotate };
}

/** Schreibt eine Verschiebung und eine Drehung als `transform`-Wert; nichts zu schreiben ergibt den leeren Text. */
export function writeTransform(t: Extract<Transform, { ok: true }>): string {
  const parts: string[] = [];
  if (t.translate[0] !== 0 || t.translate[1] !== 0) parts.push(`translate(${fmt(t.translate[0])} ${fmt(t.translate[1])})`);
  if (t.rotate !== null) {
    const { a, cx, cy } = t.rotate;
    parts.push(cx === 0 && cy === 0 ? `rotate(${fmt(a)})` : `rotate(${fmt(a)} ${fmt(cx)} ${fmt(cy)})`);
  }
  return parts.join(" ");
}

// ---- Felder -------------------------------------------------------------------------------------------------------------------------

/** Setzt das `style`-Attribut dieselbe Eigenschaft? Dann gewinnt es gegen das Attribut, das ein Feld schriebe. */
function styleSets(el: SvgElement, name: string): boolean {
  const style = attr(el, "style");
  if (style === null) return false;
  return style.split(";").some((decl) => decl.split(":")[0].trim().toLowerCase() === name);
}

/** Inhalt eines `<text>` ohne Unterelemente; sonst der Grund. */
function textContentOf(el: SvgElement, text: string, all: readonly SvgElement[]): { content: string } | { reason: ReadonlyReason } {
  if (el.selfClosing) return { content: "" };
  const inner = text.slice(el.openEnd, el.closeStart);
  if (inner.includes("<") || inner.includes("\n") || inner.includes("\r") || inner.includes("\t")) return { reason: "markup" };
  if (all.some((e) => e.start >= el.openEnd && e.start < el.closeStart)) return { reason: "markup" };
  return { content: decodeEntities(inner) };
}

/** Eltern- und Vorgängerschlüssel eines Elements für das Ersetzen (`add` braucht beide); `null` mit Grund, wenn einer positionsabhängig (`@n`) wäre. */
function placement(el: SvgElement, all: readonly SvgElement[]): { parent: string | null; after: string | null } | null {
  const parent = el.parentKey === null || el.parentKey === "#wurzel" ? null : el.parentKey;
  if (parent !== null && parent.startsWith("@")) return null;
  let prev: SvgElement | null = null;
  for (const e of all) if (e.parentKey === el.parentKey && e.start < el.start && (prev === null || e.start > prev.start)) prev = e;
  if (prev !== null && prev.key.startsWith("@")) return null;
  return { parent, after: prev === null ? null : prev.key };
}

function blocked(el: SvgElement, all: readonly SvgElement[]): ReadonlyReason | null {
  if (el.key.startsWith("@")) return "unnamed";
  if (all.filter((e) => e.key === el.key).length > 1) return "ambiguous";
  return null;
}

/** Die Felder des Elements, in der Reihenfolge der Spec (§ 7.5). Elemente, die die Spec nicht nennt, haben keine. */
export function fieldsFor(el: SvgElement, text: string): FieldSpec[] {
  const geometry = GEOMETRY[el.tag];
  if (geometry === undefined && !MOVABLE.has(el.tag)) return [];
  const all = scanElements(text).elements;
  const block = blocked(el, all);
  const out: FieldSpec[] = [];
  const add = (spec: FieldSpec, reason: ReadonlyReason | null = null): void => {
    const why = block ?? reason;
    out.push(why === null ? spec : { ...spec, readonly: why });
  };
  const numeric = (name: string, kind: "number" | "translate", stored: string | null, forced: ReadonlyReason | null = null): void => {
    const value = stored === null ? "" : stored.trim();
    if (value !== "" && parseStored(value) === null) return add({ name, kind, value }, WITH_UNIT.test(value) ? "unit" : "value");
    add({ name, kind, value }, forced ?? (styleSets(el, name) ? "style" : null));
  };
  for (const name of geometry ?? []) numeric(name, "number", attr(el, name));
  if (el.tag === "text") {
    const c = textContentOf(el, text, all);
    const place = placement(el, all);
    if ("content" in c) add({ name: "text", kind: "text", value: c.content }, place === null ? "unnamed" : null);
    else add({ name: "text", kind: "text", value: "" }, c.reason);
  }
  const tr = parseTransform(attr(el, "transform"));
  if (MOVABLE.has(el.tag)) {
    const bad = tr.ok ? null : tr.reason;
    numeric("translate-x", "translate", tr.ok ? fmt(tr.translate[0]) : null, bad);
    numeric("translate-y", "translate", tr.ok ? fmt(tr.translate[1]) : null, bad);
  }
  for (const name of PAINT_COLORS) {
    const v = attr(el, name);
    add({ name, kind: "color", value: v === null ? "" : v.trim() }, styleSets(el, name) ? "style" : null);
  }
  numeric("stroke-width", "number", attr(el, "stroke-width"));
  add({ name: "rotate", kind: "rotate", value: tr.ok ? fmt(tr.rotate === null ? 0 : tr.rotate.a) : "" }, tr.ok ? null : tr.reason);
  return out;
}

// ---- Änderung -----------------------------------------------------------------------------------------------------------------------

const COLOR = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[A-Za-z]+|(?:rgb|rgba|hsl|hsla)\([0-9A-Za-z.,%\s/+-]*\)|url\(#[^\s()'"]+\))$/;

/** Steuerzeichen (C0, U+007F): in XML nicht darstellbar bzw. in einem einzeiligen Feld (Tab, Zeilenumbruch) nicht gemeint. */
function badText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

const fail = (code: Problem["code"], ...params: Problem["params"]): { ok: false; problem: Problem } => ({ ok: false, problem: { code, params } });

/** Eine Eingabe in einem Feld des Elements: die Änderungsliste, die sie ergibt (leer, wenn der Wert gleich bleibt), oder das Problem. */
export function fieldChange(el: SvgElement, text: string, field: string, input: string, ctx: FieldCtx): FieldResult {
  const spec = fieldsFor(el, text).find((f) => f.name === field);
  if (spec === undefined) return fail("field-unknown", field);
  if (spec.readonly !== undefined) return fail("field-readonly", field, spec.readonly);
  const label = HAND_LABEL[ctx.lang];
  const done = (changes: SvgChange[]): FieldResult => ({ ok: true, changes, label });
  const setAttr = (name: string, value: string | null): FieldResult => done([{ op: "change", id: el.key, attrs: { [name]: value } }]);
  const raw = input.trim();

  if (spec.kind === "text") return textChange(el, text, spec, input, done);

  if (spec.kind === "color") {
    if (raw === "") return !REMOVABLE.has(field) ? fail("field-empty", field) : spec.value === "" ? done([]) : setAttr(field, null);
    // Leerraum in `rgb( … )` wird ein Leerzeichen: ein wörtlicher Zeilenumbruch im Wert würde als `&#10;` geschrieben (Rest-Task B2, Punkt 2: Wertform).
    const color = raw.replace(/\s+/g, " ");
    if (!COLOR.test(color)) return fail("field-color", field, input);
    return color === spec.value ? done([]) : setAttr(field, color);
  }

  // number, translate, rotate
  if (raw === "") {
    if (spec.kind === "number" && REMOVABLE.has(field)) return spec.value === "" ? done([]) : setAttr(field, null);
    return fail("field-empty", field);
  }
  const n = parseInput(raw);
  if (n === null) return fail("field-number", field, input);
  if (n < 0 && NON_NEGATIVE.has(field)) return fail("field-negative", field);
  const next = fmt(n);

  if (spec.kind === "number") {
    const current = parseStored(spec.value);
    return current !== null && fmt(current) === next ? done([]) : setAttr(field, next);
  }

  const tr = parseTransform(attr(el, "transform"));
  if (!tr.ok) return fail("field-readonly", field, tr.reason);
  const t = { translate: [...tr.translate] as [number, number], rotate: tr.rotate === null ? null : { ...tr.rotate } };
  if (spec.kind === "translate") {
    t.translate[field === "translate-x" ? 0 : 1] = Number(next);
  } else if (Number(next) === 0) {
    t.rotate = null;
  } else if (t.rotate !== null) {
    t.rotate.a = Number(next); // die vorhandene Drehmitte bleibt: die Form dreht um denselben Punkt weiter
  } else {
    if (ctx.center === undefined || !ctx.center.every((c) => Number.isFinite(c))) return fail("field-no-center");
    t.rotate = { a: Number(next), cx: Number(fmt(ctx.center[0])), cy: Number(fmt(ctx.center[1])) };
  }
  const written = writeTransform({ ok: true, ...t });
  const current = attr(el, "transform");
  if (written === "") return current === null ? done([]) : setAttr("transform", null);
  return current !== null && current.trim() === written ? done([]) : setAttr("transform", written);
}

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Der Text eines `<text>` ohne Unterelemente: das Element wird mit neuem Inhalt ersetzt (`remove` mit `expect`, dann `add` am selben Ort). */
function textChange(el: SvgElement, text: string, spec: FieldSpec, input: string, done: (c: SvgChange[]) => FieldResult): FieldResult {
  if (badText(input)) return fail("field-text-invalid", spec.name);
  if (input === spec.value) return done([]);
  const all = scanElements(text).elements;
  const place = placement(el, all);
  const tree = buildCanonTree(text);
  const index = tree === null ? -1 : tree.elements.findIndex((e) => e.start === el.start);
  if (place === null || tree === null || index < 0) return fail("field-readonly", spec.name, "unnamed");
  const open = text.slice(el.start, el.openEnd).replace(/\s*\/>$/, ">");
  const name = /^<([^\s/>]+)/.exec(open)![1];
  return done([
    { op: "remove", id: el.key, expect: canonNode(tree, index) },
    { op: "add", parent: place.parent, after: place.after, markup: `${open}${escapeText(input)}</${name}>` },
  ]);
}
