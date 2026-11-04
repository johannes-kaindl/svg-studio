// vendored from code-kit@0.52.1, src/ts/web/svg-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { CSS_RISKY, CSS_RISKY_PLAIN, isLocalRef, normalizeUrlRef, trimUrlLikeBrowser } from "./safe-markdown";

/** Checks SVG text written by a model (or any untrusted source) BEFORE it is shown or stored. The guard REJECTS: it
 *  returns every problem it finds and never repairs, strips or rewrites the input. A silently cleaned SVG shows
 *  something the author did not write; a rejected one can be fixed or asked for again.
 *
 *  ── The consumer obligation ─────────────────────────────────────────────────────────────
 *  A passing result carries `svg`, the checked root element of an inert `DOMParser` document: insert THAT tree
 *  (`importNode`/`adoptNode`), never the text. The text is not safe to parse a second time: an HTML parser reads the
 *  same characters differently from the XML parser the guard judged (a CDATA section or comment inside `<style>`,
 *  `<title>` or `<desc>` can turn the rest of the text into live markup after `innerHTML`), and no check of the XML
 *  tree can promise anything about a re-parse. The same holds for a file: `.svg` files that pass are safe as files
 *  only because processing instructions, `xml:base`, external references and non-allowlisted elements are refused.
 *
 *  ── What it decides ─────────────────────────────────────────────────────────────────────
 *  Syntax is settled by the XML parser, not by a regex over the text: `new DOMParser()` with `image/svg+xml` has
 *  already resolved entities, quotes and namespaces. Everything below classifies that OUTCOME. The one text-level
 *  check is the DOCTYPE, and it runs BEFORE parsing: an internal entity subset is how an entity-expansion bomb
 *  arrives, so such a document is never handed to the parser.
 *
 *  ── The rules ───────────────────────────────────────────────────────────────────────────
 *  - Not parseable → `parse-error`; root is not `svg` in the SVG namespace (also: `xmlns` forgotten) → `not-svg`.
 *  - Elements: an ALLOWLIST of SVG element names (drawing, structure, gradients, pattern, clip/mask, marker, text,
 *    filter primitives, `title`, `desc`, `metadata`, `style`). Anything else is `forbidden-element`: scripting,
 *    embedding, animation, navigation (`a`), `image`, HTML names such as `p` or `img`, and everything outside the SVG
 *    namespace (editor metadata such as `sodipodi:*` too: this is a guard for generated SVG, not an Inkscape import).
 *  - Any processing instruction, anywhere (`<?xml-stylesheet?>` loads CSS when the file is opened), and any comment or
 *    CDATA section inside `style`, `title` or `desc` → `unsafe-markup`; so is a `<use>` reference cycle.
 *  - `on*` attributes (any case, any namespace) → `event-attribute`. `xml:base` → `external-reference`.
 *  - Reference attributes are `href`/`src` in ANY namespace and any qualified name ending in `:href`/`:src` (the HTML
 *    parser maps the literal prefix `xlink:href` to the xlink namespace whatever the document declared). Only a
 *    fragment (`#id`) is allowed, and `data:image/png|jpeg|gif|webp|avif`; `javascript:`, `vbscript:` and any other
 *    `data:` → `unsafe-url`; everything else (remote, protocol-relative, a relative file) → `external-reference`.
 *  - "Is this a fragment?" is decided on the URL as the browser sees it (`trimUrlLikeBrowser`: C0 controls and
 *    space at the edges, tab/LF/CR anywhere), so `&#x200B;#c` is not one. Scheme detection uses the wider
 *    `normalizeUrlRef` (stripping more there only causes more rejections).
 *  - `url(...)` in an attribute value or in CSS → only `url(#id)`; otherwise `external-reference` (attribute) or
 *    `unsafe-css` (CSS). One scan serves both.
 *  - ANY backslash in ANY attribute value, in `<style>` text or in `style=` → `unsafe-css`. CSS escapes can spell
 *    every other forbidden token (`u\72l(`), so the guard never unescapes, it rejects.
 *  - CSS (`<style>` text, `style=`) also refuses what `CSS_RISKY` of `pure/safe-markdown` names (`src(`,
 *    `image-set(`, `image(`, `cross-fade(`, `attr(`, `@import`, `@function`, comments, …) once the allowed
 *    `url(#id)` calls are taken out, plus `expression(` and `-moz-binding`. Other attributes get `CSS_RISKY_PLAIN`.
 *  - Limits: bytes, elements (the root counts, and so does every expansion of a `<use>`, followed through EVERY
 *    reference attribute it carries, whichever one an engine renders: ten levels of ten `<use>` are 10^9 rendered
 *    instances in 101 elements) and nesting depth.
 *
 *  What it does NOT do: it does not judge rendering cost beyond those limits, it does not sanitize, and `ok` is not
 *  a statement about the picture, only about what the document can make a browser load or run. */

export type SvgProblemCode =
  | "not-svg" | "parse-error" | "doctype" | "too-large" | "too-many-elements" | "too-deep"
  | "forbidden-element" | "event-attribute" | "external-reference" | "unsafe-url"
  | "unsafe-css" | "unsafe-markup";

export interface SvgProblem {
  code: SvgProblemCode;
  /** Local name of the offending element, when the problem belongs to one. */
  element?: string;
  /** Local name of the offending attribute, when the problem belongs to one. */
  attribute?: string;
  detail: string;
}

export interface SvgGuardOptions {
  /** UTF-8 size limit of the text. Default 1 000 000. */
  maxBytes?: number;
  /** Element limit (the root counts, every expansion of a `<use>` counts). Default 5 000. */
  maxElements?: number;
  /** Nesting depth of elements (the root is level 1). Default 200. */
  maxDepth?: number;
}

/** `svg` is the CHECKED root element of the inert parsed document: insert this tree, never the text (see header). */
export type SvgGuardResult = { ok: true; svg: SVGSVGElement } | { ok: false; problems: SvgProblem[] };

const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_ELEMENTS = 5_000;
const DEFAULT_MAX_DEPTH = 200;

/** Case-sensitive local names (SVG names are camelCase). `a`, `image`, `foreignObject`, `script` and the animation
 *  elements are left out on purpose; anything outside the SVG namespace is rejected on top of this list. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "symbol", "use", "switch", "view", "title", "desc", "metadata", "style",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB",
  "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset",
  "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
]);
/** Elements whose text an HTML parser reads in a mode of its own (RAWTEXT, integration points). */
const TEXTUAL_ELEMENTS: ReadonlySet<string> = new Set(["style", "title", "desc"]);

const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/;
/** Legacy CSS that `CSS_RISKY` does not name. */
const LEGACY_CSS: ReadonlyArray<readonly [RegExp, string]> = [
  [/expression\(/i, "expression()"],
  [/-moz-binding/i, "-moz-binding"],
];

/** Classifies one URL value of an attribute that names a resource. `null` = allowed. */
function classifyReference(raw: string): { code: "unsafe-url" | "external-reference"; detail: string } | null {
  const trimmed = trimUrlLikeBrowser(raw);
  if (trimmed.startsWith("#")) return null;
  const v = normalizeUrlRef(raw);
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v)?.[1];
  if (scheme === "javascript" || scheme === "vbscript") return { code: "unsafe-url", detail: `${scheme}: URL` };
  if (scheme === "data") return SAFE_DATA_URL.test(trimmed.toLowerCase()) ? null : { code: "unsafe-url", detail: "data: URL that is not a raster image" };
  const remote = !isLocalRef(raw, false, true);
  return { code: "external-reference", detail: remote ? "reference to a remote resource" : "reference to another file (only #fragment is allowed)" };
}

/** Is the body of one `url(...)` call a reference into the same document, as the browser sees it? */
function isFragmentUrl(body: string): boolean {
  let b = trimUrlLikeBrowser(body);
  if (b.startsWith('"') || b.startsWith("'")) b = trimUrlLikeBrowser(b.slice(1));
  return b.startsWith("#");
}

/** THE `url(` scan, for attributes and for CSS: `loose` is true when some call is not a closed `url(#fragment)`;
 *  `rest` is the text with the allowed calls taken out, for the other lists. A call is delimited by the next `)`
 *  or `(`, so one call cannot swallow the next. */
function scanUrlCalls(text: string): { loose: boolean; rest: string } {
  let loose = false;
  let rest = "";
  let last = 0;
  for (const m of text.matchAll(/url\(/gi)) {
    const start = m.index ?? 0;
    if (start < last) continue;
    let end = start + 4;
    while (end < text.length && text[end] !== ")" && text[end] !== "(") end++;
    if (text[end] === ")" && isFragmentUrl(text.slice(start + 4, end))) {
      rest += text.slice(last, start);
      last = end + 1;
    } else {
      loose = true;
    }
  }
  return { loose, rest: rest + text.slice(last) };
}

/** Problems of one CSS text: the first matching reason per rule, not per occurrence. */
function cssReasons(css: string): string[] {
  const out: string[] = [];
  if (css.includes("\\")) out.push("backslash escape");
  const { loose, rest } = scanUrlCalls(css);
  if (loose) out.push("url() that is not a #fragment");
  const risky = CSS_RISKY.exec(rest)?.[0];
  if (risky !== undefined && !(loose && risky.toLowerCase() === "url(")) out.push(`"${risky}"`);
  for (const [re, label] of LEGACY_CSS) if (re.test(css)) out.push(label);
  return out;
}

/** The elements a `<use>` points at through EVERY reference attribute that is a fragment (`href` in any namespace
 *  and the `:href` forms). Engines differ in which one wins when several are present (Chromium renders plain `href`),
 *  so none may be left out of the count: a decoy `xlink:href="#tiny"` must not hide `href="#bomb"`. */
function useTargets(el: Element, byId: ReadonlyMap<string, Element>): Element[] {
  const out: Element[] = [];
  if (el.localName !== "use") return out;
  for (const attr of Array.from(el.attributes)) {
    if (!isReferenceName(attr)) continue;
    const t = trimUrlLikeBrowser(attr.value);
    if (!t.startsWith("#")) continue;
    let id = t.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep the raw id */ }
    const target = byId.get(id);
    if (target !== undefined) out.push(target);
  }
  return out;
}

function isReferenceName(attr: Attr): boolean {
  const lower = attr.localName.toLowerCase();
  return lower === "href" || lower === "src" || /:(?:href|src)$/i.test(attr.name);
}

/** Rendered instances of the whole tree: every element once, plus once more for every `<use>` that expands its
 *  target's subtree. Memoized per element (a diamond of references is walked once), iterative (a long chain must not
 *  overflow the stack). Returns `"cycle"` when a `<use>` leads back to an element that is still being expanded. */
function expandedCount(root: Element, byId: ReadonlyMap<string, Element>): number | "cycle" {
  const memo = new Map<Element, number>();
  const active = new Set<Element>();
  interface Frame { el: Element; kids: Element[]; i: number; sum: number }
  const frame = (el: Element): Frame => {
    const kids = Array.from(el.children);
    kids.push(...useTargets(el, byId));
    return { el, kids, i: 0, sum: 1 };
  };
  const stack: Frame[] = [frame(root)];
  active.add(root);
  for (let f = stack.at(-1); f !== undefined; f = stack.at(-1)) {
    const kid = f.kids[f.i];
    if (kid !== undefined) {
      f.i++;
      const known = memo.get(kid);
      if (known !== undefined) { f.sum += known; continue; }
      if (active.has(kid)) return "cycle";
      active.add(kid);
      stack.push(frame(kid));
    } else {
      stack.pop();
      active.delete(f.el);
      memo.set(f.el, f.sum);
      const parent = stack.at(-1);
      if (parent !== undefined) parent.sum += f.sum;
    }
  }
  return memo.get(root) ?? 1;
}

/** One pass over every node of the document: processing instructions anywhere, comments and CDATA sections inside
 *  `style`/`title`/`desc`, and the nesting depth. Iterative. `"too-deep"` stops the walk. */
function walkNodes(doc: Document, maxDepth: number): SvgProblem[] | "too-deep" {
  const problems: SvgProblem[] = [];
  const stack: Array<{ node: Node; depth: number; textual: string | null }> = [];
  for (const c of Array.from(doc.childNodes)) stack.push({ node: c, depth: 0, textual: null });
  while (stack.length > 0) {
    const { node, depth, textual } = stack.pop() as { node: Node; depth: number; textual: string | null };
    if (node.nodeType === 7) {
      problems.push({ code: "unsafe-markup", detail: `processing instruction <?${(node as ProcessingInstruction).target ?? node.nodeName}?> is not allowed` });
    } else if (node.nodeType === 8 || node.nodeType === 4) {
      if (textual !== null) problems.push({ code: "unsafe-markup", element: textual, detail: `${node.nodeType === 8 ? "comment" : "CDATA section"} inside <${textual}> is not allowed` });
    } else if (node.nodeType === 1) {
      const el = node as Element;
      const d = depth + 1;
      if (d > maxDepth) return "too-deep";
      const t = textual ?? (el.namespaceURI === SVG_NS && TEXTUAL_ELEMENTS.has(el.localName) ? el.localName : null);
      for (const c of Array.from(el.childNodes)) stack.push({ node: c, depth: d, textual: t });
    }
  }
  return problems;
}

export function checkSvg(text: string, options: SvgGuardOptions = {}): SvgGuardResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  // UTF-8 is never shorter than UTF-16 in code units, so a long string is rejected without encoding it.
  if (text.length > maxBytes) return { ok: false, problems: [{ code: "too-large", detail: `${text.length} characters exceed the limit of ${maxBytes} bytes` }] };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) return { ok: false, problems: [{ code: "too-large", detail: `${bytes} bytes exceed the limit of ${maxBytes}` }] };
  if (text.trim() === "") return { ok: false, problems: [{ code: "not-svg", detail: "empty text" }] };
  if (/<!doctype/i.test(text) || /<!entity/i.test(text)) {
    return { ok: false, problems: [{ code: "doctype", detail: "DOCTYPE and entity declarations are not allowed" }] };
  }

  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length > 0 || root === null) {
    return { ok: false, problems: [{ code: "parse-error", detail: "the text is not well-formed XML" }] };
  }
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
    return { ok: false, problems: [{ code: "not-svg", element: root.localName, detail: `root is <${root.localName}> in namespace "${root.namespaceURI ?? ""}", expected <svg> in ${SVG_NS} (xmlns missing?)` }] };
  }

  const all = [root, ...Array.from(root.getElementsByTagName("*"))];
  if (all.length > maxElements) {
    return { ok: false, problems: [{ code: "too-many-elements", detail: `${all.length} elements exceed the limit of ${maxElements}` }] };
  }

  const walked = walkNodes(doc, maxDepth);
  if (walked === "too-deep") return { ok: false, problems: [{ code: "too-deep", detail: `elements are nested deeper than ${maxDepth} levels` }] };
  const problems: SvgProblem[] = walked;

  for (const el of all) {
    const name = el.localName;
    if (el.namespaceURI !== SVG_NS) {
      problems.push({ code: "forbidden-element", element: name, detail: `element in namespace "${el.namespaceURI ?? ""}" is not allowed` });
    } else if (!ALLOWED_ELEMENTS.has(name)) {
      problems.push({ code: "forbidden-element", element: name, detail: `<${name}> is not on the allowlist of SVG elements` });
    }
    if (name === "style" && el.namespaceURI === SVG_NS) {
      for (const reason of cssReasons(el.textContent ?? "")) problems.push({ code: "unsafe-css", element: name, detail: `<style> contains ${reason}` });
    }

    for (const attr of Array.from(el.attributes)) {
      const local = attr.localName;
      const lower = local.toLowerCase();
      if ((lower === "base" && attr.namespaceURI === XML_NS) || attr.name.toLowerCase() === "xml:base") {
        problems.push({ code: "external-reference", element: name, attribute: local, detail: "xml:base changes what every relative reference means" });
        continue;
      }
      if (lower.length > 2 && lower.startsWith("on")) {
        problems.push({ code: "event-attribute", element: name, attribute: local, detail: `event handler attribute ${local}` });
        continue;
      }
      if (lower === "style" && attr.namespaceURI === null) {
        for (const reason of cssReasons(attr.value)) problems.push({ code: "unsafe-css", element: name, attribute: local, detail: `style attribute contains ${reason}` });
        continue;
      }
      if (attr.value.includes("\\")) {
        problems.push({ code: "unsafe-css", element: name, attribute: local, detail: `backslash escape in attribute ${local}` });
      }
      // Any namespace: the HTML parser maps the literal prefix `xlink:href` to the xlink namespace whatever the
      // document declared, and the guard must not depend on which parser a later reader uses.
      if (isReferenceName(attr)) {
        const verdict = classifyReference(attr.value);
        if (verdict !== null) problems.push({ code: verdict.code, element: name, attribute: local, detail: `${verdict.detail}: ${attr.value.slice(0, 80)}` });
        continue;
      }
      const v = normalizeUrlRef(attr.value);
      if (/^(?:javascript|vbscript):/.test(v) || v.startsWith("data:text/html")) {
        problems.push({ code: "unsafe-url", element: name, attribute: local, detail: `script URL in attribute ${local}` });
      }
      const { loose, rest } = scanUrlCalls(attr.value);
      if (loose) problems.push({ code: "external-reference", element: name, attribute: local, detail: `url() that is not a #fragment in ${local}` });
      const risky = CSS_RISKY_PLAIN.exec(rest)?.[0];
      // a loose `url(` is already reported above; the loose call is still in `rest`, so it must not be reported twice
      if (risky !== undefined && !(loose && risky.toLowerCase() === "url(")) problems.push({ code: "unsafe-css", element: name, attribute: local, detail: `"${risky}" in attribute ${local}` });
    }
  }

  const byId = new Map<string, Element>();
  for (const el of all) {
    const id = el.getAttribute("id");
    if (id !== null && !byId.has(id)) byId.set(id, el);
  }
  const expanded = expandedCount(root, byId);
  if (expanded === "cycle") problems.push({ code: "unsafe-markup", element: "use", detail: "a <use> element refers back to an element that contains it" });
  else if (expanded > maxElements) problems.push({ code: "too-many-elements", detail: `${expanded} rendered instances (every <use> expanded) exceed the limit of ${maxElements}` });

  return problems.length === 0 ? { ok: true, svg: root as unknown as SVGSVGElement } : { ok: false, problems };
}
