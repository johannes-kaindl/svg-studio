// vendored from code-kit@0.59.0, src/ts/web/svg-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
 *  - Render cost (`too-costly`): a document that stays inside those limits can still freeze the display, because a
 *    reference multiplies work the element count does not see: a `marker` is drawn at every vertex, a `mask`, a
 *    `clipPath` and a filter are applied once per element that names them, and each of those can name the next
 *    (a `mask` inside a `mask` with 4 rects per level and 10 levels is 3.6 KB and did not finish in 60 s). The guard
 *    walks the reference graph (`use`, `mask`, `clip-path`, `filter`, `marker-*`, `fill`/`stroke` patterns, `feImage href`,
 *    `pattern href`; from the attribute, from `style=` and from the rules of `<style>`, with `var()` followed; markers,
 *    dashes and fills also by inheritance and through `<use>`) and adds up what one drawing costs: every element counts
 *    once, a reference adds the cost of its target once per use, a shape its vertices, and a dashed stroke, a positioned
 *    glyph, a filter primitive, a mask and a clip application carry the weights of `SVG_RENDER_COST`. The sum is compared
 *    with `maxRenderCost`; the default is about one second of Chromium drawing time. A reference back to an element that
 *    contains it (`mask` in itself, a `feImage` of its own host; not a marker's own shapes) is `unsafe-markup`: engines
 *    break such a loop each in their own way. A `var()` that expands past its limits, and a `<style>` that nests `{` or `(` deeper than 100 levels (it
 *    is refused before the text is parsed: a few thousand levels crash Chromium's `DOMParser`), are `unsafe-css`.
 *
 *  What it does NOT do: it does not sanitize, it does not look at the picture (`ok` is a statement about what the
 *  document can make a browser load or run, and about its cost, not about what it shows), and the cost is an
 *  ESTIMATE, NOT A GUARANTEE. Three independent reviews with Chromium measurements found classes it does not see (the
 *  measured list is in the README of this module and in `docs/internal/svg-guard-cost.md`; what they found and the guard fixed is kept as a
 *  closed list of cases, `tests/fixtures/svg-guard-round4.mjs`): shapes, clips and masks that
 *  CSS sets (`d`, `clip-path: polygon()`, `mask-image: linear-gradient()`), text in a clip or mask, gradients with thousands
 *  of stops, animations (the cost is paid every frame), scales it does not follow, and selectors it cannot evaluate. It
 *  assumes the picture is shown about 600 px wide and that a filtered element fills the viewport (the size of a shape
 *  is not known). A consumer that shows the picture much larger should lower `maxRenderCost`; one that shows it smaller can
 *  raise it. A consumer must not rely on this check alone: draw a block whose `cost` is near the limit only after a click. */

export type SvgProblemCode =
  | "not-svg" | "parse-error" | "doctype" | "too-large" | "too-many-elements" | "too-deep" | "too-costly"
  | "forbidden-element" | "event-attribute" | "external-reference" | "unsafe-url"
  | "unsafe-css" | "unsafe-markup";

export interface SvgProblem {
  code: SvgProblemCode;
  /** Local name of the offending element, when the problem belongs to one. */
  element?: string;
  /** Local name of the offending attribute, when the problem belongs to one. */
  attribute?: string;
  /** Only on `too-costly`: `"cost"` is the render-cost estimate over `maxRenderCost` (a simpler picture fixes it), `"limit"` is a size limit of the document (style sheets, values, references, `var()` work) or an estimate that could not be made (the picture is too big, simplifying does not help). */
  kind?: "cost" | "limit";
  /** Only on `kind: "cost"`: the estimated cost; `Infinity` when the estimate ran over. */
  cost?: number;
  /** Only on `kind: "cost"`: the limit it was compared with (`maxRenderCost`). */
  limit?: number;
  detail: string;
}

export interface SvgGuardOptions {
  /** UTF-8 size limit of the text. Default 1 000 000. */
  maxBytes?: number;
  /** Element limit (the root counts, every expansion of a `<use>` counts). Default 5 000. */
  maxElements?: number;
  /** Nesting depth of elements (the root is level 1). Default 200. */
  maxDepth?: number;
  /** Estimated drawing cost, in `SVG_RENDER_COST` units (about a microsecond of Chromium time at 600 px width). Default
   *  1 000 000, about a second on the measuring machine; `Infinity` switches the check off. */
  maxRenderCost?: number;
}

/** `svg` is the CHECKED root element of the inert parsed document: insert this tree, never the text (see header).
 *  `cost` is the estimated drawing cost of the document (see `SVG_RENDER_COST`), so a consumer can show or log it. `bom` is
 *  `true` when the text began with a byte order mark (U+FEFF), which the guard cut off before parsing (Windows tools and some
 *  exports write one); a writer that wants to keep the file as it was puts it back. A second mark, or anything else before the
 *  root element, is still refused. */
export type SvgGuardResult = { ok: true; svg: SVGSVGElement; cost: number; bom?: true } | { ok: false; problems: SvgProblem[] };

/** The weights of the render-cost model. Unit: about one microsecond of drawing time in Chromium at a picture width of
 *  `referenceWidthPx`, rounded UP from the measurement so the estimate errs on the side of rejecting.
 *
 *  MEASURED 2026-11-04 with `chrome-headless-shell` 153.0.8010.12 (Playwright cache, macOS arm64, Apple M5 Pro, software
 *  raster without GPU), 800×600 page, the SVG shown as `<img>` 600 px wide from a data URL, time from inserting to the
 *  end of `Page.captureScreenshot` minus an empty page (37–44 ms), median of 2–3 runs. Every filtered element in the
 *  measurement was a full-surface rect of a `viewBox="0 0 100 100"` (so 1 user unit = 6 px). To re-measure: run the
 *  families in `docs/internal/svg-guard-cost.md` (`scripts/lib/headless-chrome.mjs` renders one SVG and returns the ms) and
 *  keep `npm run check:svg-guard-chromium` green, which renders the accepted boundary cases and fails above 2 s.
 *
 *  - `mask` 400: per mask application 330–370 µs (mask in mask 4 per level, 5 to 7 levels: 113, 480, 2011 ms for 341,
 *    1365, 5461 applications; 1000 elements with one mask 347 ms). `clip` 40: 34 µs (clipPath fan 4 per level, 9 levels:
 *    2995 ms for 87 381 applications; a clip of a single rect is free, 13 ms for 1000).
 *  - Added after the first review (2026-11-04, Opus, see the review section of `docs/internal/svg-guard-cost.md`): `vertex` 1 (a polyline of
 *    20 000 points 15 ms, so 0.75 µs); `clipPerVertex` 15 (a clipPath of 20 000 points 300 ms per application); `dashPerDash` 1 and
 *    `dashBase` 50 (round 3: a zig-zag of 2 000 points, length 198 000, dash 0.2 with round caps 841 ms = 0.85 µs per dash, butt caps 0.35, dash 2 0.6, dash 20 0.9; 1 000 circles with dash 0.5 0.3 µs; the dashes are length ÷ period); `glyph` 6 (20 000
 *    individually positioned glyphs 109 ms, 50 times through `use` 6.2 s); `mergeNode` 450 (4 900 nodes 1.8 s); `blendHeavy` 350
 *    (hue and saturation on 4 999 elements 1.7 s) and `blendLight` 70 (multiply on 1 000 elements 65 ms); `ruleElement` 0.04 and
 *    `ruleHasElement` 1 (25 000 `:not()` rules over 4 900 elements 4.4 s, 2 000 `:has()` rules over 4 800 elements 10 s).
 *  - marker: no weight of its own, `element` 1 per drawn element: marker 50 000 vertices × 200 elements (10 M) 4.0 s, marker in
 *    marker 198³ (7.8 M) 6.6 s, so 0.4 to 0.85 µs per element instance.
 *  - `filter` 200 per application (flood, the cheapest primitive, 0 ms). Per primitive, full surface, one application:
 *    blur 0.8 ms at 6 px, 1.3 at 12, 2.5 at 30, 5.6 at 60, 13.7 at 120, 19.2 at 180, then 9.5 at 300 and 11.5 at 600 px
 *    (Chromium switches method) → `400 + 120 × min(px, 180)`; the weight is the one at a region of 200 %: the region grows the
 *    cost up to the visible area (40 rects, blur 30: default region 397 ms, 200 % 759, 1 000 % or a huge userSpaceOnUse region
 *    1 065, so at most 1.4 × the weight); morphology radius 6 px 13 ms, 30 px 38, 120 px 48,
 *    600 px 268; convolve order 3 12.5 ms, 5 30, 10 119, and from about 20 Chromium draws nothing (cheap here, not
 *    elsewhere); turbulence 1 octave 1.8 ms, 4 octaves 3.7, 10 octaves 6.7, 255 octaves 6.8 (the plateau is why
 *    `turbOctaves` is 10); diffuse lighting 4.4, specular 5.2, spot light 5.9; displacement map 2.5 with its
 *    turbulence; composite arithmetic 1.8; blend 1.1; tile 0.8; merge 0.8; colour matrix, component transfer and offset 0.5;
 *    drop shadow = blur + 0.2. A CSS `filter: blur(Npx)` is counted like the SVG primitive at N px (30 px at viewBox 100:
 *    3.6 ms); how Chromium scales these pixels with the viewBox is NOT modelled (`blur(3px)` at viewBox 10: 3.8 ms each, 100
 *    elements at viewBox 10 368 ms against 35 ms at viewBox 600).
 *  - `feImage` 50: 46 µs per application, 1000 filtered elements 46 ms; a chain of 10 levels with 8 per level 13.4 s, 4 per
 *    level 0.5 s (Chromium's growth is polynomial; the estimate follows the nominal fan-out for `feImageLevels` levels).
 *  - Cheap and not counted: gradients with few or evenly spaced stops (0.14 ms per element, 4999 of them 0.7 s; but 4 000
 *    unevenly spaced stops cost 46 ms per element), opacity (4999 layers 48 ms), nested groups with opacity (7 ms). A
 *    `pattern` of plain shapes in `pattern` is cheap to Chromium (0 ms with 4 fills per tile and 10 levels) but is counted. Re-measure
 *    these when raising the limit. */
export const SVG_RENDER_COST = {
  /** One drawn element, also one element of a marker instance. */
  element: 1,
  mask: 400,
  clip: 40,
  filter: 200,
  blurBase: 400,
  blurPerPx: 120,
  blurMaxPx: 180,
  dropShadowExtra: 1500,
  morphBase: 14000,
  morphPerPx: 1000,
  morphKneePx: 40,
  morphPerPxBeyond: 450,
  convolvePerCell: 1500,
  turbBase: 1500,
  turbPerOctave: 600,
  turbOctaves: 10,
  lighting: 8000,
  displacement: 1500,
  composite: 2500,
  blend: 1500,
  colorMatrix: 1000,
  componentTransfer: 1000,
  offset: 1000,
  merge: 1000,
  tile: 1500,
  flood: 200,
  mergeNode: 450,
  feImage: 50,
  /** How many `feImage` references in a row are followed. Chromium draws a chain of 10 levels with 1/2/3/4/8 `feImage` per level in
   *  14/57/205/501/13 361 ms: growth is polynomial, not the nominal 1/1 024/59 049/1 M/10^9, so the estimate follows the nominal
   *  fan-out for this many levels only (2 per level then costs 85 000, 3 per level 510 000, 4 per level 2 M). */
  feImageLevels: 5,
  /** One vertex of a shape drawn once (path, polyline, polygon, line); also the vertex of a clip or mask content. */
  vertex: 1,
  /** An extra per vertex inside a clipPath (300 ms per application at 20 000 points). */
  clipPerVertex: 15,
  /** A dashed stroke: per shape, and per dash (outline length ÷ period; 0.3 to 0.9 µs measured). `maxDashes` caps what one shape adds. */
  dashBase: 50,
  dashPerDash: 1,
  maxDashes: 10_000_000,
  /** One individually positioned glyph of a `<text>` (x, y, dx, dy, rotate). */
  glyph: 6,
  /** `mix-blend-mode`: hue, saturation, color, luminosity are not separable and cost more. */
  blendHeavy: 350,
  blendLight: 70,
  /** Style resolution: per rule and element (25 000 rules × 4 900 elements 4.4 s), and one more per pair when the selector uses `:has()`. */
  ruleElement: 0.04,
  ruleHasElement: 1,
  /** A state rule (`:hover`, …) is charged for this many matched elements at most: one chain is hovered at a time. */
  stateElements: 8,
  /** At most this many element and property pairs from style rules; `var()` expands at most this deep and this long. */
  maxPairs: 200_000,
  /** A scale the walk cannot follow (a `viewBox` below the root, a `marker`, a `pattern`, a `symbol`, an unreadable transform) counts as this much. */
  unknownScale: 1000,
  /** Hard limits on what the guard reads, so that its own run time stays small whatever the input: characters in all `<style>` elements,
   *  in one value, in one selector; the product of selector length and elements over all rules (a `:has()` counts tenfold); references
   *  in one value; distinct values of one custom property; edges in the whole graph. */
  maxStyleChars: 250_000,
  maxValueChars: 50_000,
  maxSelectorChars: 2_000,
  selectorBudget: 8_000_000,
  maxIdsPerValue: 64,
  maxCustomValues: 64,
  maxEdges: 200_000,
  /** Characters all `var()` expansions of one document may read, and the deepest nesting of `{` or `(` inside a `<style>` (some parsers crash on it). */
  varWork: 2_000_000,
  maxNesting: 100,
  varDepth: 4,
  varMaxLength: 20_000,
  /** A CSS filter function other than blur() and drop-shadow() (grayscale(), hue-rotate(), …). */
  cssFilterFunction: 1000,
  /** The picture width the weights were measured at; a viewBox of any other width scales lengths in user units. */
  referenceWidthPx: 600,
  /** Width assumed when the root has neither a usable `viewBox` nor a `width` (the CSS default of an `<img>`). */
  defaultWidth: 300,
  /** At most this many `<style>` rules that set filter, mask, clip-path or marker (each one is a query over the tree). */
  maxRules: 300,
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_ELEMENTS = 5_000;
const DEFAULT_MAX_DEPTH = 200;
const DEFAULT_MAX_RENDER_COST = 1_000_000;

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

/** The elements an element points at through EVERY reference attribute that is a fragment (`href` in any namespace
 *  and the `:href` forms). Engines differ in which one wins when several are present (Chromium renders plain `href`),
 *  so none may be left out of the count: a decoy `xlink:href="#tiny"` must not hide `href="#bomb"`. For `<use>` and
 *  `<feImage>`, which draw what the fragment names, and `<pattern>`, which takes its content from it. */
function hrefTargets(el: Element, byId: ReadonlyMap<string, Element>): Element[] {
  const out: Element[] = [];
  if (el.localName !== "use" && el.localName !== "feImage" && el.localName !== "pattern") return out;
  for (const attr of Array.from(el.attributes)) {
    if (!isReferenceName(attr)) continue;
    const t = trimUrlLikeBrowser(attr.value);
    if (!t.startsWith("#")) continue;
    const target = byId.get(decodeId(t.slice(1)));
    if (target !== undefined) out.push(target);
  }
  return out;
}

function decodeId(id: string): string {
  try { return decodeURIComponent(id); } catch { return id; }
}

function isReferenceName(attr: Attr): boolean {
  const lower = attr.localName.toLowerCase();
  return lower === "href" || lower === "src" || /:(?:href|src)$/i.test(attr.name);
}

/** One reference: the work of drawing `to` happens `times` times, each time plus `add` for applying it. `level` marks
 *  an edge that counts against the `feImage`/`pattern` depth (see `SVG_RENDER_COST.feImageLevels`). */
interface CostEdge { to: Element; times: number; add: number; level?: boolean }

/** Elements that draw nothing where they stand: their children are drawn only for whoever references them. */
const NOT_DRAWN_IN_PLACE: ReadonlySet<string> = new Set(["defs", "symbol", "mask", "clipPath", "marker", "filter", "linearGradient", "radialGradient"]);

/** Sum over the reference graph: `own(el, drawn)` for every element once (`drawn` is false for a definition met as a child),
 *  plus for every child and every reference `times × (add + cost of the target)`. An element that is not drawn in place
 *  (`defs`, `mask`, `marker`, …) costs only itself as a child and its whole subtree as a target: a definition nobody
 *  references costs nothing. Memoized per element and state (a diamond of references is walked once), iterative (a long chain
 *  must not overflow the stack). `levels` is how many `level` edges may be followed in a row; deeper ones add nothing. A
 *  product that overflows is `Infinity`, which compares as too large. Returns `"cycle"` when a reference leads back to an
 *  element that is still being expanded; `findCycle` has settled before that this cannot happen for the cost walk, the check
 *  stays as the guard against an endless loop. */
function accumulate(root: Element, own: (el: Element, drawn: boolean) => number, edges: (el: Element) => CostEdge[], levels = 0, shallowDefinitions = false, onDone?: (el: Element, sum: number) => void): number | "cycle" {
  const memo = new Map<string, number>();
  const active = new Set<Element>();
  const ids = new Map<Element, number>();
  const key = (el: Element, rem: number, deep: boolean): string => {
    let id = ids.get(el);
    if (id === undefined) { id = ids.size; ids.set(el, id); }
    return `${String(id)}/${String(rem)}/${deep ? "d" : "s"}`;
  };
  interface Frame { el: Element; key: string; via: CostEdge | null; kids: Array<{ edge: CostEdge; rem: number; deep: boolean }>; i: number; sum: number }
  const frame = (el: Element, rem: number, deep: boolean, via: CostEdge | null): Frame => {
    const kids: Frame["kids"] = [];
    const shallow = shallowDefinitions && !deep && el.namespaceURI === SVG_NS && NOT_DRAWN_IN_PLACE.has(el.localName);
    if (!shallow) {
      for (const c of Array.from(el.children)) kids.push({ edge: { to: c, times: 1, add: 0 }, rem, deep: false });
      for (const e of edges(el)) {
        const r = e.level === true ? rem - 1 : rem;
        if (r >= 0) kids.push({ edge: e, rem: r, deep: true });
      }
    }
    return { el, key: key(el, rem, deep), via, kids, i: 0, sum: own(el, !shallow) };
  };
  const stack: Frame[] = [frame(root, levels, true, null)];
  active.add(root);
  for (let f = stack.at(-1); f !== undefined; f = stack.at(-1)) {
    const kid = f.kids[f.i];
    if (kid !== undefined) {
      f.i++;
      if (active.has(kid.edge.to)) return "cycle"; // before the memo: a state reached earlier must not hide a loop
      const k = key(kid.edge.to, kid.rem, kid.deep);
      const known = memo.get(k);
      if (known !== undefined) { f.sum += kid.edge.times * (kid.edge.add + known); continue; }
      active.add(kid.edge.to);
      stack.push(frame(kid.edge.to, kid.rem, kid.deep, kid.edge));
    } else {
      stack.pop();
      active.delete(f.el);
      memo.set(f.key, f.sum);
      onDone?.(f.el, f.sum);
      const parent = stack.at(-1);
      if (parent !== undefined && f.via !== null) parent.sum += f.via.times * (f.via.add + f.sum);
    }
  }
  return memo.get(key(root, levels, true)) ?? 1;
}

/** Does any reference (children included) lead back to an element on the way? Independent of depth limits, of what is
 *  drawn and of the order in which edges are listed: white/grey/black walk over the whole graph, iterative. */
function findCycle(root: Element, edges: ReadonlyMap<Element, CostEdge[]>): boolean {
  const state = new Map<Element, 1 | 2>(); // 1 = on the way, 2 = done
  interface Frame { el: Element; kids: Element[]; i: number }
  const open = (el: Element): Frame => {
    state.set(el, 1);
    const kids = Array.from(el.children);
    for (const e of edges.get(el) ?? []) kids.push(e.to);
    return { el, kids, i: 0 };
  };
  const stack: Frame[] = [open(root)];
  for (let f = stack.at(-1); f !== undefined; f = stack.at(-1)) {
    const kid = f.kids[f.i++];
    if (kid === undefined) { state.set(f.el, 2); stack.pop(); continue; }
    const s = state.get(kid);
    if (s === 1) return true;
    if (s === undefined) stack.push(open(kid));
  }
  return false;
}

/** Rendered instances of the whole tree: every element once, plus once more for every `<use>` that expands its
 *  target's subtree (the element limit). `"cycle"` when a `<use>` leads back to an element that contains it. */
function expandedCount(root: Element, byId: ReadonlyMap<string, Element>): number | "cycle" {
  return accumulate(root, () => 1, (el) => (el.localName === "use" ? hrefTargets(el, byId).map((to) => ({ to, times: 1, add: 0 })) : []));
}

// ── Render cost ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = "filter" | "mask" | "clip" | "paint" | "marker-start" | "marker-mid" | "marker-end" | "marker" | "dash" | "blend" | "animation" | "transform" | "scale" | "custom";

/** The properties the cost model reads. The vendor prefix is not part of the name; `--*` are custom properties (their
 *  values are what `var()` is replaced by). */
function kindOf(name: string): Kind | null {
  if (name.startsWith("--")) return "custom";
  const n = name.toLowerCase().replace(/^-(?:webkit|moz)-/, "");
  switch (n) {
    case "fill": case "stroke": return "paint";
    case "filter": return "filter";
    case "clip-path": return "clip";
    case "marker": case "marker-start": case "marker-mid": case "marker-end": return n;
    case "stroke-dasharray": return "dash";
    case "mix-blend-mode": return "blend";
    case "animation": case "animation-name": return "animation";
    case "transform": return "transform";
    case "scale": return "scale";
    default: return n.startsWith("mask") ? "mask" : null;
  }
}

/** Is this declaration one the cost model reads? A `fill`/`stroke` from a style sheet only when it names something or hides it behind
 *  `var(`; one from an attribute or `style=` always (it decides what a shape inherits). */
function isRelevant(name: string, value: string, always = false): boolean {
  const kind = kindOf(name);
  if (kind === null) return false;
  const lc = value.toLowerCase();
  if (kind === "paint") return always || lc.includes("url(") || lc.includes("var(");
  if (kind === "dash") return true; // `none` matters too: it switches an inherited dash off
  if (kind === "blend") return lc.trim() !== "normal";
  if (kind === "transform" || kind === "scale") return lc.trim() !== "none";
  return true;
}

function stripImportant(value: string): string {
  const v = value.trimEnd();
  const bang = v.lastIndexOf("!");
  return bang >= 0 && v.slice(bang + 1).trim().toLowerCase() === "important" ? v.slice(0, bang).trimEnd() : v;
}

/** Declarations of a CSS block (`style=`) as [name, value], names lower-cased. Splits on `;` outside parentheses and
 *  strings, so `url(data:…;base64,…)` and quoted semicolons stay whole. Linear. */
function parseDeclarations(block: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  const add = (end: number): void => {
    const part = block.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) { const name = part.slice(0, colon).trim().toLowerCase(); if (name !== "") out.push([name, stripImportant(part.slice(colon + 1).trim())]); }
  };
  for (let i = 0; i < block.length; i++) {
    const ch = block[i] ?? "";
    if (quote !== "") { if (ch === quote || ch === "\n") quote = ""; continue; } // an unescaped line break ends a CSS string
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === ";" && depth === 0) { add(i); start = i + 1; }
  }
  add(block.length);
  return out;
}

interface Rule { selector: string; decls: Array<[string, string]>; shape: "style" | "keyframe" }

/** The rules of a style sheet, as a real tokenizer would see them: strings, parentheses and nesting are tracked, so a brace in a
 *  string or a rule inside a rule neither ends nor hides the outer one. Linear in the text. At-rules that only group
 *  (`@media`, `@supports`, `@layer`, `@container`, `@scope`) are looked through; the steps of `@keyframes` are `keyframe`; the
 *  declarations of other at-rules (`@font-face`, `@page`) are dropped. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  interface Frame { prelude: string; decls: Array<[string, string]> }
  const stack: Frame[] = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  const declaration = (): void => {
    const part = buf;
    buf = "";
    const top = stack.at(-1);
    const colon = part.indexOf(":");
    if (top === undefined || colon <= 0) return;
    const name = part.slice(0, colon).trim().toLowerCase();
    if (name !== "") top.decls.push([name, stripImportant(part.slice(colon + 1).trim())]);
  };
  const close = (): void => {
    declaration();
    const f = stack.pop();
    if (f === undefined || f.prelude.startsWith("@")) return;
    const parent = stack.at(-1)?.prelude;
    // A rule inside a rule is a rule of its own with the outer selector implied: read on its own it matches a superset, which is the safe side.
    rules.push({ selector: f.prelude, decls: f.decls, shape: parent !== undefined && /^@(?:-\w+-)?keyframes/i.test(parent) ? "keyframe" : "style" });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quote !== "") { buf += ch; if (ch === quote || ch === "\n") quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    if (depth > 0) { buf += ch; continue; }
    if (ch === ";") declaration();
    else if (ch === "{") { stack.push({ prelude: buf.trim(), decls: [] }); buf = ""; }
    else if (ch === "}") close();
    else buf += ch;
  }
  while (stack.length > 0) close();
  return rules;
}

/** The deepest nesting of `{` and `(` inside the `<style>` elements of a text, found before the text is parsed: Chromium's `DOMParser` crashes the renderer on a
 *  few thousand levels (5 000 nested `a{` in 10 KB, 20 000 `:is(`), and nothing the guard does later can come in time. */
function cssNesting(text: string): number {
  let max = 0;
  for (let at = text.indexOf("<style"); at >= 0;) {
    const open = text.indexOf(">", at);
    if (open < 0) break;
    const close = text.indexOf("</style", open);
    const end = close < 0 ? text.length : close;
    let brace = 0;
    let paren = 0;
    for (let i = open + 1; i < end; i++) {
      const c = text.charCodeAt(i);
      if (c === 123) { if (++brace > max) max = brace; } else if (c === 125) { if (brace > 0) brace--; } else if (c === 40) { if (++paren > max) max = paren; } else if (c === 41 && paren > 0) paren--;
    }
    at = close < 0 ? -1 : text.indexOf("<style", close);
  }
  return max;
}

/** Index of `needle` (lower-case ASCII) in `text` from `from`, ignoring ASCII case, without copying `text`: the index fits `text`. */
function findCI(text: string, needle: string, from = 0): number {
  const n = needle.length;
  for (let i = from; i + n <= text.length; i++) {
    let j = 0;
    while (j < n && (text.charCodeAt(i + j) | 32) === needle.charCodeAt(j)) j++;
    if (j === n) return i;
  }
  return -1;
}

/** The ids `url(#id)` calls in `text` name. Linear: the call is delimited by the next `)` or `(` and trimmed by hand. */
function fragmentIds(text: string): string[] {
  const ids: string[] = [];
  for (let at = findCI(text, "url("); at >= 0; at = findCI(text, "url(", at + 4)) {
    let from = at + 4;
    while (from < text.length && /\s/.test(text[from] ?? "")) from++;
    const q = text[from];
    if (q === '"' || q === "'") {
      // a quoted url ends at the closing quote, whatever stands inside: `url("#a)b")` names the id `a)b`; with no closing quote the string runs to the end
      // of the value, and anything after the closing quote is ignored, as a browser does
      const close = text.indexOf(q, from + 1);
      const b = trimUrlLikeBrowser(text.slice(from + 1, close < 0 ? text.length : close));
      if (b.startsWith("#")) ids.push(decodeId(b.slice(1)));
      continue;
    }
    let end = from;
    while (end < text.length && text[end] !== ")" && text[end] !== "(") end++;
    if (text[end] !== ")") continue;
    const b = trimUrlLikeBrowser(text.slice(from, end));
    if (b.startsWith("#")) ids.push(decodeId(b.slice(1).trimEnd()));
  }
  return ids;
}

/** Top-level function calls of a CSS value as [name, arguments], in one pass with a stack: `blur(5px) drop-shadow(1px 1px
 *  2px rgb(0, 0, 0))` is two calls. A call that is never closed is dropped. */
function cssCalls(value: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const open: Array<{ name: string; from: number }> = [];
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") {
      let s = i;
      while (s > 0 && /[A-Za-z0-9_-]/.test(value[s - 1] ?? "")) s--;
      open.push({ name: value.slice(s, i).toLowerCase(), from: i + 1 });
    } else if (ch === ")") {
      const o = open.pop();
      if (o !== undefined && open.length === 0) out.push([o.name, value.slice(o.from, i)]);
    }
  }
  return out;
}

/** Whitespace-separated tokens at parenthesis depth 0. */
function topLevelTokens(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? (text[i] ?? "") : " ";
    const space = depth === 0 && /\s/.test(ch);
    if (space) { if (from >= 0) { out.push(text.slice(from, i)); from = -1; } continue; }
    if (from < 0) from = i;
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
  }
  return out;
}

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
function numbers(text: string | null): number[] { return (text ?? "").match(NUMBER)?.map(Number) ?? []; }
/** The largest of a list, 0 when empty or all negative (no spread: a list may be very long). */
function largest(xs: number[]): number { let m = 0; for (const x of xs) if (x > m) m = x; return m; }

const CSS_UNIT_PX: Record<string, number> = { px: 1, "": 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, rem: 16, ex: 8, ch: 8 };
/** A CSS length in pixels. What is not a plain number with a unit (`calc()`, `min()`, `var()`, a unit this does not know) counts as
 *  1000 px: the cost is capped anyway, so an unreadable length is the worst case. Never negative. */
function cssLengthPx(token: string): number {
  const t = token.trim();
  if (t === "") return 0;
  const m = /^([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)([a-z%]*)$/i.exec(t);
  if (m === null) return 1000;
  const factor = CSS_UNIT_PX[(m[2] ?? "").toLowerCase()];
  return factor === undefined ? 1000 : Math.max(0, Number(m[1]) * factor);
}

const C = SVG_RENDER_COST;
/** Marks a custom property with more distinct values than `maxCustomValues`; `var()` of it expands to nothing the guard can follow. */
const OVERFLOW = "\u0000overflow";
const blurCost = (px: number): number => C.blurBase + C.blurPerPx * Math.min(Math.max(px, 0), C.blurMaxPx);

/** Cost of the CSS filter functions in a `filter` value (the `url()` calls are references, not functions). */
function cssFilterCost(value: string): number {
  let sum = 0;
  for (const [name, args] of cssCalls(value)) {
    if (name === "url" || name === "var") continue;
    const lengths = topLevelTokens(args).filter((t) => /^[-+.\d]/.test(t) || t.includes("("));
    const colour = (t: string): boolean => /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(t);
    const real = lengths.filter((t) => !colour(t));
    if (name === "blur") sum += blurCost(cssLengthPx(real[0] ?? "0"));
    else if (name === "drop-shadow") sum += blurCost(cssLengthPx(real[2] ?? "0")) + C.dropShadowExtra;
    else sum += C.cssFilterFunction;
  }
  return sum;
}

/** `var(--name, fallback)` replaced by the value of every declaration of `--name` in the document (the document is not
 *  walked for which one applies: all of them count), a fallback when there is none. `null` when it grows past the limit. */
function expandVars(value: string, customs: ReadonlyMap<string, string[]>, budget: { left: number }, depth = 0): string | null {
  if (findCI(value, "var(") < 0) return value;
  if (depth > C.varDepth) return null;
  budget.left -= value.length + 16; // all the var() work of one document is bounded, however the values are spread
  if (budget.left < 0) return null;
  let out = "";
  let from = 0;
  for (let at = findCI(value, "var("); at >= 0; at = findCI(value, "var(", from)) {
    out += value.slice(from, at);
    let level = 1;
    let i = at + 4;
    while (i < value.length && level > 0) { if (value[i] === "(") level++; else if (value[i] === ")") level--; i++; }
    const inner = value.slice(at + 4, level === 0 ? i - 1 : i);
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const known = customs.get(name);
    // the length check after the append catches the same overflow; this one is before the join, so a long list is not built first
    if (known !== undefined && (known[0] === OVERFLOW || known.reduce((n, v) => n + v.length, out.length) > C.varMaxLength)) return null;
    const text = known !== undefined && known.length > 0 ? known.join(" ") : comma < 0 ? "" : inner.slice(comma + 1);
    const expanded = expandVars(text, customs, budget, depth + 1);
    if (expanded === null) return null;
    out += " " + expanded + " ";
    if (out.length > C.varMaxLength) return null;
    from = i;
  }
  return out + value.slice(from);
}

/** The largest stretch a 2×2 matrix `[a c; b d]` gives a vector (its spectral norm), exact. */
function matrixScale(a: number, b: number, c: number, d: number): number {
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((s + Math.sqrt(Math.max(s * s - 4 * det * det, 0))) / 2);
}

const ANGLE_RAD: Record<string, number> = { "": Math.PI / 180, deg: Math.PI / 180, rad: 1, turn: 2 * Math.PI, grad: Math.PI / 200 };
/** How much a transform list can enlarge a length, as an upper bound; what it cannot read counts as 1000. */
function transformBound(value: string): number {
  let bound = 1;
  for (const [name, args] of cssCalls(value)) {
    const nums = numbers(args);
    const readable = !args.includes("(") && nums.length > 0;
    let b = 1;
    switch (name) {
      case "scale": case "scale3d": b = readable ? largest(nums.map(Math.abs)) : 1000; break;
      case "scalex": case "scaley": case "scalez": b = readable ? Math.abs(nums[0] ?? 1) : 1000; break;
      case "matrix": b = nums.length >= 4 && readable ? matrixScale(nums[0] ?? 1, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1) : 1000; break;
      case "matrix3d": b = readable ? Math.sqrt(nums.reduce((s, x) => s + x * x, 0)) : 1000; break;
      case "skewx": case "skewy": case "skew": {
        const arg = args.trim();
        let u = arg.length;
        while (u > 0 && /[A-Za-z]/.test(arg[u - 1] ?? "")) u--;
        const unit = arg.slice(u).toLowerCase();
        const t = Math.tan(Math.abs(nums[0] ?? 0) * (ANGLE_RAD[unit] ?? 1000));
        b = Number.isFinite(t) ? Math.sqrt(2 + t * t) : 1000;
        break;
      }
      case "translate": case "translatex": case "translatey": case "translatez": case "translate3d": case "rotate": case "rotatex": case "rotatey": case "rotatez": case "rotate3d": break;
      default: b = 1000;
    }
    bound *= b;
  }
  return bound;
}

/** Strictly four numbers, width and height above zero, as a browser reads a `viewBox`; anything else is no viewBox. */
function parseViewBox(text: string | null): { w: number; h: number } | null {
  if (text === null) return null;
  const parts = text.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const [, , w, h] = parts.map(Number);
  return w !== undefined && h !== undefined && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** Pixels per user unit of the root at the reference width: from the `viewBox` (`slice` fills the box, so the smaller side
 *  counts), else from a numeric `width`, else the `<img>` default. */
function pixelScale(root: Element): number {
  const vb = parseViewBox(root.getAttribute("viewBox"));
  if (vb !== null) return C.referenceWidthPx / (/\bslice\b/i.test(root.getAttribute("preserveAspectRatio") ?? "") ? Math.min(vb.w, vb.h) : vb.w);
  const attr = /^\s*([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i.exec(root.getAttribute("width") ?? "")?.[1];
  return C.referenceWidthPx / (attr !== undefined && Number(attr) > 0 ? Number(attr) : C.defaultWidth);
}

function blendCost(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === "normal" || v === "") return 0;
  return v === "hue" || v === "saturation" || v === "color" || v === "luminosity" ? C.blendHeavy : C.blendLight;
}

/** Per-document facts the weights need: pixels per user unit at the root, the vertices of every shape and the size of the picture in user units (what a percentage is of). */
interface Context { scale: number; vertices: Map<Element, number>; boxW: number; boxH: number }

/** What drawing this element once costs on its own: a filter primitive by its weight (the scale-dependent part of a blur, a drop
 *  shadow's blur and a morphology is added where the filter is applied, see `filterCost`), a shape by its vertices, a text by its
 *  positioned glyphs, the rest as one element. */
function ownCost(el: Element, ctx: Context, drawn: boolean): number {
  if (el.namespaceURI !== SVG_NS || !drawn) return C.element;
  switch (el.localName) {
    case "filter": return C.filter;
    case "feGaussianBlur": case "feMorphology": return 0;
    case "feDropShadow": return C.dropShadowExtra;
    case "feConvolveMatrix": {
      const [ox, oy] = numbers(el.getAttribute("order"));
      return C.convolvePerCell * Math.max(ox ?? 3, 1) * Math.max(oy ?? ox ?? 3, 1);
    }
    case "feTurbulence": return C.turbBase + C.turbPerOctave * Math.min(Math.max(numbers(el.getAttribute("numOctaves"))[0] ?? 1, 0), C.turbOctaves);
    case "feDiffuseLighting": case "feSpecularLighting": return C.lighting;
    case "feDisplacementMap": return C.displacement;
    case "feComposite": return C.composite;
    case "feBlend": return C.blend;
    case "feColorMatrix": return C.colorMatrix;
    case "feComponentTransfer": return C.componentTransfer;
    case "feOffset": return C.offset;
    case "feMerge": return C.merge;
    case "feMergeNode": return C.mergeNode;
    case "feTile": return C.tile;
    case "feFlood": return C.flood;
    case "feImage": return C.feImage;
    case "path": case "polyline": case "polygon": case "line": return C.element + C.vertex * (ctx.vertices.get(el) ?? 0);
    case "text": case "tspan": case "textPath": {
      let glyphs = 0;
      for (const a of ["x", "y", "dx", "dy", "rotate"]) glyphs += numbers(el.getAttribute(a)).length;
      return C.element + C.glyph * glyphs;
    }
    default: return C.element;
  }
}

/** Number of vertices a marker can be drawn at and a stroke has to be walked along, as an upper bound; 0 for the shapes without. */
function vertexCount(el: Element): number {
  switch (el.localName) {
    case "line": return 2;
    case "polyline": case "polygon": return Math.floor(numbers(el.getAttribute("points")).length / 2);
    case "path": {
      // every number is at most one vertex, and so is every command letter (`z` closes a subpath and is a vertex of its own)
      const d = el.getAttribute("d") ?? "";
      let letters = 0;
      for (let i = 0; i < d.length; i++) { const c = d.charCodeAt(i); if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++; }
      return numbers(d).length + letters;
    }
    default: return 0;
  }
}

/** Length of the outline of a path, in user units, as an upper bound: curves by their control polygon, arcs by a full ellipse and the chord. */
function pathLength(d: string): number {
  let total = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const hop = (x: number, y: number): void => { total += Math.hypot(x - cx, y - cy); cx = x; cy = y; };
  for (const seg of d.split(/(?=[MmLlHhVvCcSsQqTtAaZz])/)) { // not at the e of 1e5
    const cmd = seg.charAt(0);
    if (!/[A-Za-z]/.test(cmd)) continue;
    const a = numbers(seg.slice(1));
    const rel = cmd === cmd.toLowerCase();
    const X = (v: number): number => (rel ? cx + v : v);
    const Y = (v: number): number => (rel ? cy + v : v);
    switch (cmd.toLowerCase()) {
      case "m": for (let i = 0; i + 1 < a.length; i += 2) { if (i === 0) { cx = X(a[0] ?? 0); cy = Y(a[1] ?? 0); sx = cx; sy = cy; } else hop(X(a[i] ?? 0), Y(a[i + 1] ?? 0)); } break;
      case "l": case "t": for (let i = 0; i + 1 < a.length; i += 2) hop(X(a[i] ?? 0), Y(a[i + 1] ?? 0)); break;
      case "h": for (const v of a) hop(rel ? cx + v : v, cy); break;
      case "v": for (const v of a) hop(cx, rel ? cy + v : v); break;
      case "c": for (let i = 0; i + 5 < a.length; i += 6) { const bx = cx, by = cy; const ex = X(a[i + 4] ?? 0), ey = Y(a[i + 5] ?? 0); total += Math.hypot(X(a[i] ?? 0) - bx, Y(a[i + 1] ?? 0) - by) + Math.hypot(X(a[i + 2] ?? 0) - X(a[i] ?? 0), Y(a[i + 3] ?? 0) - Y(a[i + 1] ?? 0)) + Math.hypot(ex - X(a[i + 2] ?? 0), ey - Y(a[i + 3] ?? 0)); cx = ex; cy = ey; } break;
      case "s": case "q": for (let i = 0; i + 3 < a.length; i += 4) { const ex = X(a[i + 2] ?? 0), ey = Y(a[i + 3] ?? 0); total += Math.hypot(X(a[i] ?? 0) - cx, Y(a[i + 1] ?? 0) - cy) + Math.hypot(ex - X(a[i] ?? 0), ey - Y(a[i + 1] ?? 0)); cx = ex; cy = ey; } break;
      case "a": for (let i = 0; i + 6 < a.length; i += 7) { const ex = X(a[i + 5] ?? 0), ey = Y(a[i + 6] ?? 0); total += Math.hypot(ex - cx, ey - cy) + 2 * Math.PI * Math.max(Math.abs(a[i] ?? 0), Math.abs(a[i + 1] ?? 0)); cx = ex; cy = ey; } break;
      case "z": hop(sx, sy); break;
      default: break;
    }
  }
  return total;
}

const LENGTH_UNIT_PX: Record<string, number> = { px: 1, "": 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 4 / 3, pc: 16, em: 16, rem: 16, ex: 8, ch: 8 };
/** A length attribute in user units: a number, with a unit or a percentage of `basis`. What it cannot read (`calc()`, an unknown unit) counts as `basis`, the worst case. */
function userLength(raw: string | null, basis: number): number {
  if (raw === null) return 0;
  const t = raw.trim();
  if (t === "") return 0;
  const m = /^([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i.exec(t);
  if (m === null) return basis;
  const n = Math.abs(Number(m[1]));
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "%") return (n / 100) * basis;
  const f = LENGTH_UNIT_PX[unit];
  return f === undefined ? basis : n * f;
}

/** Length of the outline of a shape in user units (an upper bound; `pathLength` counts if it is larger, Chromium dashes by it); 0 for what is not a shape. */
function shapeLength(el: Element, ctx: Context): number {
  const w = (name: string): number => userLength(el.getAttribute(name), ctx.boxW);
  const h = (name: string): number => userLength(el.getAttribute(name), ctx.boxH);
  const diag = Math.sqrt((ctx.boxW * ctx.boxW + ctx.boxH * ctx.boxH) / 2);
  let length = 0;
  switch (el.localName) {
    case "line": length = Math.hypot(w("x2") - w("x1"), h("y2") - h("y1")); break;
    case "polyline": case "polygon": {
      const p = numbers(el.getAttribute("points"));
      for (let i = 2; i + 1 < p.length; i += 2) length += Math.hypot((p[i] ?? 0) - (p[i - 2] ?? 0), (p[i + 1] ?? 0) - (p[i - 1] ?? 0));
      if (el.localName === "polygon" && p.length >= 4) length += Math.hypot((p[0] ?? 0) - (p.at(-2) ?? 0), (p[1] ?? 0) - (p.at(-1) ?? 0));
      break;
    }
    case "path": length = pathLength(el.getAttribute("d") ?? ""); break;
    case "rect": length = 2 * (w("width") + h("height")); break;
    case "circle": length = 2 * Math.PI * userLength(el.getAttribute("r"), diag); break;
    case "ellipse": length = 2 * Math.PI * Math.max(w("rx"), h("ry")); break;
    default: return 0;
  }
  return Math.max(length, numbers(el.getAttribute("pathLength"))[0] ?? 0);
}

/** Period of a `stroke-dasharray` in user units: the sum of the list (an odd list is repeated); 0 when there is no dash. What it cannot read
 *  (`%`, `calc()`, a unit) counts as a period of 0.01, the worst case. */
function dashPeriod(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "none") return 0;
  const parts = v.split(/[\s,]+/).filter((t) => t !== "");
  let sum = 0;
  let unreadable = false;
  for (const t of parts) {
    const m = /^([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)(?:px)?$/.exec(t);
    if (m === null) { unreadable = true; continue; }
    const x = Number(m[1]);
    if (x < 0) return 0;
    sum += x;
  }
  if (unreadable) return 0.01;
  if (parts.length % 2 === 1) sum *= 2;
  return sum > 0 ? sum : 0;
}

/** The scale-dependent part of a filter, found once per filter: the deviations of its blurs and drop shadows, the radii of its morphologies. */
interface FilterParts { blurs: number[]; radii: number[]; boxUnits: boolean }
const filterPartsCache = new WeakMap<Element, FilterParts>();
function filterParts(filter: Element): FilterParts {
  const known = filterPartsCache.get(filter);
  if (known !== undefined) return known;
  const parts: FilterParts = { blurs: [], radii: [], boxUnits: /objectboundingbox/i.test(filter.getAttribute("primitiveUnits") ?? "") };
  for (const p of Array.from(filter.getElementsByTagName("*"))) {
    if (p.namespaceURI !== SVG_NS) continue;
    if (p.localName === "feGaussianBlur") parts.blurs.push(largest(numbers(p.getAttribute("stdDeviation"))));
    else if (p.localName === "feDropShadow") parts.blurs.push(largest(numbers(p.getAttribute("stdDeviation") ?? "2")));
    else if (p.localName === "feMorphology") parts.radii.push(largest(numbers(p.getAttribute("radius"))));
  }
  filterPartsCache.set(filter, parts);
  return parts;
}
const morphCost = (px: number): number => C.morphBase + C.morphPerPx * Math.min(px, C.morphKneePx) + C.morphPerPxBeyond * Math.max(px - C.morphKneePx, 0);

/** Cost of the blurs, drop shadows and morphologies of a filter applied where one user unit is `scale` pixels. In
 *  `objectBoundingBox` units a deviation is a fraction of the shape, at most of the picture. */
function filterCost(filter: Element, scale: number, memo: Map<Element, Map<number, number>>): number {
  let byScale = memo.get(filter);
  if (byScale === undefined) { byScale = new Map(); memo.set(filter, byScale); }
  const known = byScale.get(scale);
  if (known !== undefined) return known;
  const parts = filterParts(filter);
  const px = (v: number): number => (v > 0 ? v * (parts.boxUnits ? C.referenceWidthPx : scale) : 0);
  let sum = 0;
  for (const s of parts.blurs) sum += blurCost(px(s));
  for (const r of parts.radii) sum += morphCost(px(r));
  byScale.set(scale, sum);
  return sum;
}

/** What a declaration block (an attribute list, `style=` or a rule's body) asks for, read once. */
interface Effect {
  filters: string[]; fnCost: number; masks: string[]; clips: string[];
  fill?: string[]; stroke?: string[];
  markers: Partial<Record<"marker-start" | "marker-mid" | "marker-end", string[]>>;
  /** Dash period in user units; 0 switches a dash off. Of several declarations the smallest period counts. */
  dash?: number;
  blend: number;
  /** Largest stretch of `transform`, and of the `scale` property, as upper bounds; both apply (0: not set). */
  bound: number;
  scaleBound: number;
  animated: boolean;
}
const newEffect = (): Effect => ({ filters: [], fnCost: 0, masks: [], clips: [], markers: {}, blend: 0, bound: 0, scaleBound: 0, animated: false });

/** What a value reads as, once: `var()` expanded, lower-cased, and what is derived from it. One value is read once, however many elements carry it. */
interface Read { value: string; lc: string; ids?: string[]; fn?: number; bound?: number; dash?: number }
interface Reader { customs: ReadonlyMap<string, string[]>; read: (raw: string) => Read | null }
function makeReader(customs: ReadonlyMap<string, string[]>): Reader {
  const cache = new Map<string, Read | null>();
  const budget = { left: C.varWork };
  return {
    customs,
    read(raw: string): Read | null {
      const known = cache.get(raw);
      if (known !== undefined) return known;
      const value = expandVars(raw, customs, budget);
      const r = value === null ? null : { value, lc: value.trim().toLowerCase() };
      cache.set(raw, r);
      return r;
    },
  };
}

/** `var(--name, fallback)` and nothing else around it: its name and fallback. */
function singleVar(raw: string): { name: string; fallback: string | null } | null {
  const t = raw.trim();
  if (!/^var\(/i.test(t) || !t.endsWith(")")) return null;
  let depth = 0;
  let comma = -1;
  for (let i = 3; i < t.length; i++) {
    const c = t[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0 && i < t.length - 1) return null; }
    else if (c === "," && depth === 1 && comma < 0) comma = i;
  }
  const inner = t.slice(4, -1);
  const k = comma < 0 ? -1 : comma - 4;
  return { name: (k < 0 ? inner : inner.slice(0, k)).trim(), fallback: k < 0 ? null : inner.slice(k + 1) };
}

/** The period of a dash array that comes through `var()`: of the values the custom property has in the document the smallest counts, the cascade is not evaluated. */
function dashOf(rd: Read, raw: string, customs: ReadonlyMap<string, string[]>): number {
  if (rd.dash !== undefined) return rd.dash;
  const one = singleVar(raw);
  let p: number;
  if (one === null) p = dashPeriod(rd.value);
  else {
    // (a custom property with too many values never gets here: `read` refused the value)
    const known = customs.get(one.name);
    const candidates = known !== undefined && known.length > 0 ? known : one.fallback !== null ? [one.fallback] : [];
    p = 0;
    for (const c of candidates) { const q = dashPeriod(c); if (q > 0 && (p === 0 || q < p)) p = q; }
  }
  rd.dash = p;
  return p;
}

/** Reads the declarations of one block into an effect: a value is read once however many elements the block reaches, and a value or a list past the
 *  limits is a problem, not work. `null` when nothing in it is read. */
function effectOf(decls: ReadonlyArray<readonly [string, string]>, reader: Reader, problems: SvgProblem[], element: string): Effect | null {
  let fx: Effect | null = null;
  for (const [name, raw] of decls) {
    const kind = kindOf(name);
    if (kind === null || kind === "custom" || !isRelevant(name, raw, true)) continue;
    if (raw.length > C.maxValueChars) {
      problems.push({ code: "too-costly", kind: "limit", element, detail: `the value of ${name} has ${String(raw.length)} characters, the limit is ${String(C.maxValueChars)}` });
      continue;
    }
    const rd = reader.read(raw);
    if (rd === null) {
      problems.push({ code: "unsafe-css", element, detail: `var() in ${name} expands past ${String(C.varMaxLength)} characters, ${String(C.varDepth)} levels, ${String(C.maxCustomValues)} values of one custom property or the work limit of the document` });
      continue;
    }
    const f = (fx ??= newEffect());
    const idsOf = (): string[] => {
      if (rd.ids === undefined) {
        rd.ids = fragmentIds(rd.value);
        if (rd.ids.length > C.maxIdsPerValue) {
          problems.push({ code: "too-costly", kind: "limit", element, detail: `${name} names ${String(rd.ids.length)} references, the limit is ${String(C.maxIdsPerValue)}` });
          rd.ids = rd.ids.slice(0, C.maxIdsPerValue);
        }
      }
      return rd.ids;
    };
    const lc = rd.lc;
    switch (kind) {
      case "transform": f.bound = Math.max(f.bound, rd.bound ??= transformBound(rd.value)); break;
      case "scale": f.scaleBound = Math.max(f.scaleBound, lc === "none" ? 1 : /^[\d.\s+eE-]+$/.test(lc) ? largest(numbers(lc).map(Math.abs)) : 1000); break;
      case "blend": f.blend = blendCost(rd.value); break;
      case "dash": { const p = dashOf(rd, raw, reader.customs); f.dash = f.dash === undefined || f.dash === 0 ? p : p === 0 ? f.dash : Math.min(f.dash, p); break; }
      case "animation": f.animated = lc !== "none"; break;
      case "paint": if (lc !== "inherit" && lc !== "unset" && lc !== "revert") f[name.toLowerCase().endsWith("stroke") ? "stroke" : "fill"] = idsOf(); break;
      case "filter": f.filters = idsOf(); f.fnCost = rd.fn ??= cssFilterCost(rd.value); break;
      case "mask": f.masks = idsOf(); break;
      case "clip": f.clips = idsOf(); break;
      default: {
        // marker, marker-start, marker-mid, marker-end
        if (lc !== "none" && lc !== "initial" && !lc.includes("url(")) break; // inherit, unset, revert: keep what the parent has
        for (const slot of kind === "marker" ? (["marker-start", "marker-mid", "marker-end"] as const) : [kind]) f.markers[slot] = lc.includes("url(") ? idsOf() : [];
      }
    }
  }
  return fx;
}

/** Elements a property does nothing to, as Chromium 153 draws them (measured: filter on a `mask`, `clipPath`, `pattern` and `filter`, mask on a `mask`, clip-path on a
 *  `marker` change nothing; clip-path on a `clipPath` and filter or mask on a `marker` are applied, per level and per marker instance). Nothing that is not
 *  drawn takes any of them: `fe*` primitives, gradients, `stop`, `defs`, `view`, `style`, `title`, `desc`, `metadata`, `filter`. A rule that reaches every element
 *  therefore does not make a filter apply to its own primitives and loop. `fill`, `stroke`, dashes and markers are inherited through all of them and still count. */
const NEVER_STYLED: ReadonlySet<string> = new Set(["filter", "linearGradient", "radialGradient", "stop", "style", "title", "desc", "metadata", "defs", "view"]);
function isStyledFor(kind: "filter" | "mask" | "clip", el: Element): boolean {
  if (el.namespaceURI !== SVG_NS) return true;
  const n = el.localName;
  if (n.startsWith("fe") || NEVER_STYLED.has(n)) return false;
  if (kind === "filter") return n !== "mask" && n !== "clipPath" && n !== "pattern";
  if (kind === "mask") return n !== "mask";
  return n !== "marker";
}

const SHAPES: ReadonlySet<string> = new Set(["path", "polyline", "polygon", "line", "rect", "circle", "ellipse", "text"]);
const STATE_PSEUDO = /:(?:hover|active|focus(?:-visible|-within)?|target(?:-within)?|visited|link|any-link|checked|disabled|enabled)\b/gi;

/** Estimated drawing cost of the whole document, or `"cycle"`; pushes the problems the collection finds on the way. */
function renderCost(root: Element, all: Element[], byId: ReadonlyMap<string, Element>, problems: SvgProblem[]): number | "cycle" {
  const doc = root.ownerDocument;
  const vb = parseViewBox(root.getAttribute("viewBox"));
  const widthAttr = Number(/^\s*([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i.exec(root.getAttribute("width") ?? "")?.[1] ?? C.defaultWidth);
  const ctx: Context = { scale: pixelScale(root), vertices: new Map(), boxW: vb?.w ?? (widthAttr > 0 ? widthAttr : C.defaultWidth), boxH: vb?.h ?? C.defaultWidth / 2 };
  for (const el of all) { const v = vertexCount(el); if (v > 0) ctx.vertices.set(el, v); }
  // Where every element stands in document order and how many elements its subtree has: "a contains b" is a comparison, and the deepest nesting of the tree is known.
  const position = new Map<Element, number>();
  const subtree = new Map<Element, number>();
  const depthOf = new Map<Element, number>();
  let maxTreeDepth = 1;
  all.forEach((el, k) => {
    position.set(el, k);
    subtree.set(el, 1);
    const parent = el.parentElement;
    const d = (parent === null ? 0 : depthOf.get(parent) ?? 0) + 1;
    depthOf.set(el, d);
    if (d > maxTreeDepth) maxTreeDepth = d;
  });
  for (const el of all.slice(1).reverse()) { const parent = el.parentElement; if (parent !== null) subtree.set(parent, (subtree.get(parent) ?? 1) + (subtree.get(el) ?? 1)); }
  const inside = (outer: Element, inner: Element): boolean => { const i = position.get(outer), j = position.get(inner); return i !== undefined && j !== undefined && i <= j && j < i + (subtree.get(outer) ?? 1); };

  // ── style sheets and inline styles, each read once ──
  const styleChars = all.reduce((n, el) => n + (el.localName === "style" && el.namespaceURI === SVG_NS ? (el.textContent ?? "").length : 0), 0);
  if (styleChars > C.maxStyleChars) {
    problems.push({ code: "too-costly", kind: "limit", element: "style", detail: `the style sheets have ${String(styleChars)} characters, the limit is ${String(C.maxStyleChars)}` });
    return Infinity;
  }
  const inline = new Map<Element, Array<[string, string]>>();
  const customs = new Map<string, string[]>();
  const noteCustom = (name: string, value: string): void => {
    const l = customs.get(name);
    if (l === undefined) customs.set(name, [value]);
    else if (l[0] !== OVERFLOW && !l.includes(value)) { if (l.length >= C.maxCustomValues) customs.set(name, [OVERFLOW]); else l.push(value); }
  };
  for (const el of all) {
    const attr = el.getAttribute("style");
    if (attr === null || attr === "") continue;
    if (attr.length > C.maxStyleChars) { problems.push({ code: "too-costly", kind: "limit", element: el.localName, attribute: "style", detail: `a style attribute of ${String(attr.length)} characters, the limit is ${String(C.maxStyleChars)}` }); return Infinity; }
    const decls = parseDeclarations(attr);
    inline.set(el, decls);
    for (const [n, v] of decls) if (n.startsWith("--")) noteCustom(n, v);
  }
  const rules: Rule[] = [];
  for (const style of all) {
    if (style.localName !== "style" || style.namespaceURI !== SVG_NS) continue;
    for (const r of parseRules(style.textContent ?? "")) {
      rules.push(r);
      for (const [n, v] of r.decls) if (n.startsWith("--")) noteCustom(n, v);
    }
  }

  const reader = makeReader(customs);
  let styleCost = 0;
  let relevantRules = 0;
  let pairs = 0;
  let selectorWork = 0;
  const sheet = new Map<Element, Effect[]>();
  const animated = new Set<Element>();
  const stop = (detail: string): number => { problems.push({ code: "too-costly", kind: "limit", element: "style", detail }); return Infinity; };
  const hitsOf = (r: Rule): Element[] | null => {
    if (/&|:scope|:host/i.test(r.selector)) return all;
    if (r.selector.length > C.maxSelectorChars) return null;
    const selector = r.selector.replace(STATE_PSEUDO, "");
    // a combinator or a functional pseudo-class walks up the tree for every element: the deeper the tree, the more work
    selectorWork += selector.length * (/:has\(/i.test(selector) ? 10 : 1) * (/[\s>+~]|:is\(|:not\(|:where\(|:has\(/i.test(selector) ? Math.max(1, Math.floor(maxTreeDepth / 4)) : 1) * all.length;
    if (selectorWork > C.selectorBudget) return null;
    let hit: Element[];
    try { hit = Array.from(doc.querySelectorAll(selector)); } catch { return all; }
    if (selector !== r.selector && hit.length > C.stateElements) hit = hit.slice(0, C.stateElements); // a filter costs the same whatever it sits on
    return hit;
  };
  for (const phase of ["rules", "keyframes"] as const) {
    for (const r of rules) {
      if ((r.shape === "keyframe") !== (phase === "keyframes")) continue;
      if (phase === "rules") styleCost += Math.ceil(all.length * C.ruleElement) + (/:has\(/i.test(r.selector) ? all.length * C.ruleHasElement : 0);
      const decls = r.decls.filter(([n, v]) => isRelevant(n, v) && kindOf(n) !== "custom");
      if (decls.length === 0) continue;
      if (phase === "rules" && ++relevantRules > C.maxRules) return stop(`${String(relevantRules)} rules that set filter, mask, clip-path, marker or stroke-dasharray exceed the limit of ${String(C.maxRules)}`);
      const fx = effectOf(decls, reader, problems, "style");
      if (fx === null) continue;
      const hits = phase === "rules" ? hitsOf(r) : animated;
      if (hits === null) return stop(`the selector work of the rules (${String(selectorWork)}, one rule of ${String(r.selector.length)} characters) exceeds the limits of ${String(C.selectorBudget)} and ${String(C.maxSelectorChars)} characters`);
      for (const el of hits) {
        const list = sheet.get(el);
        if (list === undefined) sheet.set(el, [fx]); else list.push(fx);
        pairs += 1 + fx.filters.length + fx.masks.length + fx.clips.length + (fx.markers["marker-start"]?.length ?? 0) + (fx.markers["marker-mid"]?.length ?? 0) + (fx.markers["marker-end"]?.length ?? 0);
        if (pairs > C.maxPairs) return stop(`style rules reach more than ${String(C.maxPairs)} element, rule and reference pairs`);
        if (phase === "rules" && fx.animated) animated.add(el);
      }
    }
    if (phase === "rules") for (const [el, decls] of inline) if (decls.some(([n, v]) => kindOf(n) === "animation" && v.trim().toLowerCase() !== "none")) animated.add(el);
  }

  // ── per element, parents first: what it asks for, how much it enlarges a unit, what it inherits ──
  interface Merged { fx: Effect; fill?: string[]; stroke?: string[]; markers: Effect["markers"]; dash?: number }
  const merged = new Map<Element, Merged>();
  const scaleOf = new Map<Element, number>(); // pixels per user unit where the element stands in the tree
  const plainOf = new Map<Element, number>(); // the same, without what only a marker or a pattern does to its own content
  let docMax = 1;
  let idTotal = 0;
  for (const el of all) {
    const list: Effect[] = [];
    const attrs: Array<[string, string]> = [];
    for (const a of Array.from(el.attributes)) if (!a.name.includes(":") && isRelevant(a.name, a.value, true)) attrs.push([a.name.toLowerCase(), a.value]);
    const a = attrs.length > 0 ? effectOf(attrs, reader, problems, el.localName) : null;
    if (a !== null) list.push(a);
    for (const e of sheet.get(el) ?? []) list.push(e);
    const i = inline.has(el) ? effectOf(inline.get(el) ?? [], reader, problems, el.localName) : null;
    if (i !== null) list.push(i);

    const fx = newEffect();
    const filters = new Set<string>(), masks = new Set<string>(), clips = new Set<string>();
    const m: Merged = { fx, markers: {} };
    const slotSets: Record<"marker-start" | "marker-mid" | "marker-end", Set<string>> = { "marker-start": new Set(), "marker-mid": new Set(), "marker-end": new Set() };
    for (const e of list) {
      for (const id of e.filters) filters.add(id);
      for (const id of e.masks) masks.add(id);
      for (const id of e.clips) clips.add(id);
      fx.fnCost = Math.max(fx.fnCost, e.fnCost);
      fx.blend = Math.max(fx.blend, e.blend);
      fx.bound = Math.max(fx.bound, e.bound);
      fx.scaleBound = Math.max(fx.scaleBound, e.scaleBound);
      if (e.animated) fx.animated = true;
      if (e.fill !== undefined) m.fill = e.fill;
      if (e.stroke !== undefined) m.stroke = e.stroke;
      // the cascade is not evaluated (specificity, !important, order): of several periods the smallest counts, a dash is off only if every declaration says so
      if (e.dash !== undefined) m.dash = m.dash === undefined || m.dash === 0 ? e.dash : e.dash === 0 ? m.dash : Math.min(m.dash, e.dash);
      for (const s of ["marker-start", "marker-mid", "marker-end"] as const) { const v = e.markers[s]; if (v !== undefined) { m.markers[s] ??= []; for (const id of v) slotSets[s].add(id); } }
    }
    fx.filters = Array.from(filters); fx.masks = Array.from(masks); fx.clips = Array.from(clips);
    for (const s of ["marker-start", "marker-mid", "marker-end"] as const) if (m.markers[s] !== undefined) m.markers[s] = Array.from(slotSets[s]);
    idTotal += fx.filters.length + fx.masks.length + fx.clips.length + (m.fill?.length ?? 0) + (m.stroke?.length ?? 0) + (m.markers["marker-start"]?.length ?? 0) + (m.markers["marker-mid"]?.length ?? 0) + (m.markers["marker-end"]?.length ?? 0);
    if (idTotal > C.maxEdges) return stop(`the document names more than ${String(C.maxEdges)} references`);

    const parent = el.parentElement;
    const pm = parent === null ? undefined : merged.get(parent);
    if (m.fill === undefined) m.fill = pm?.fill;
    if (m.stroke === undefined) m.stroke = pm?.stroke;
    if (m.dash === undefined) m.dash = pm?.dash;
    for (const s of ["marker-start", "marker-mid", "marker-end"] as const) m.markers[s] ??= pm?.markers[s];

    // How many pixels one user unit is here: the root's scale, times every transform on the way, times what the walk cannot follow.
    const svgNs = el.namespaceURI === SVG_NS;
    const plainStretch = (fx.bound || 1) * (fx.scaleBound || 1) * (el !== root && svgNs && (el.localName === "svg" || el.localName === "symbol") && el.hasAttribute("viewBox") ? C.unknownScale : 1);
    const ownUnits = svgNs && (el.localName === "pattern" || (el.localName === "marker" && (el.getAttribute("markerUnits") !== "userSpaceOnUse" || el.hasAttribute("viewBox"))));
    const stretch = plainStretch * (ownUnits ? C.unknownScale : 1);
    const cap = C.unknownScale * C.referenceWidthPx;
    const plain = Math.min((parent === null ? 1 : plainOf.get(parent) ?? 1) * plainStretch, cap);
    plainOf.set(el, plain);
    if (plain > docMax) docMax = plain;
    // capped so that 160 nested scale(100) are a large number, not Infinity (the blur and the morphology are capped or rejected anyway)
    scaleOf.set(el, Math.min((parent === null ? ctx.scale : scaleOf.get(parent) ?? ctx.scale) * stretch, cap));
    merged.set(el, m);
  }

  // Content that a use, a feImage, a mask, a clip path, a marker or a pattern draws is drawn in the coordinate system of whoever refers to it, which
  // the walk does not follow: it counts at the larger of its own scale and the largest enlargement anywhere in the picture (a shrinking group never lowers it).
  const cover = new Array<number>(all.length + 1).fill(0);
  const markTarget = (to: Element | undefined): void => {
    if (to === undefined) return;
    const k = position.get(to);
    if (k === undefined) return;
    cover[k] = (cover[k] ?? 0) + 1;
    cover[k + (subtree.get(to) ?? 1)] = (cover[k + (subtree.get(to) ?? 1)] ?? 0) - 1;
  };
  for (const el of all) {
    const m = merged.get(el) as Merged;
    for (const to of hrefTargets(el, byId)) markTarget(to);
    for (const id of m.fx.masks) markTarget(byId.get(id));
    for (const id of m.fx.clips) markTarget(byId.get(id));
    for (const s of ["marker-start", "marker-mid", "marker-end"] as const) for (const id of m.markers[s] ?? []) markTarget(byId.get(id));
    for (const pat of [m.fill, m.stroke]) for (const id of pat ?? []) { const to = byId.get(id); if (to?.localName === "pattern") markTarget(to); }
  }
  const referenced = new Set<Element>();
  {
    let run = 0;
    all.forEach((el, k) => { run += cover[k] ?? 0; if (run > 0) referenced.add(el); });
  }
  const docPx = ctx.scale * docMax;

  // ── references ──
  const edges = new Map<Element, CostEdge[]>();
  const extra = new Map<Element, number>();
  const addExtra = (el: Element, n: number): void => { if (n !== 0) extra.set(el, (extra.get(el) ?? 0) + n); };
  const filterMemo = new Map<Element, Map<number, number>>();
  const useEdges = (el: Element): CostEdge[] => (el.localName === "use" ? hrefTargets(el, byId).map((to) => ({ to, times: 1, add: 0 })) : []);
  /** The sum of `own` over the subtree of every element, following `<use>` (a use of a use of a group counts the group). */
  const totalsOf = (own: ReadonlyMap<Element, number>): Map<Element, number> => {
    const out = new Map<Element, number>();
    accumulate(root, (el) => own.get(el) ?? 0, useEdges, 0, false, (el, sum) => { out.set(el, sum); });
    return out;
  };
  const vertTotal = totalsOf(ctx.vertices);
  const shapeTotal = totalsOf(new Map(all.filter((el) => SHAPES.has(el.localName)).map((el) => [el, 1])));
  const anyDash = Array.from(merged.values()).some((m) => (m.dash ?? 0) > 0);
  const lengthTotal = anyDash ? totalsOf(new Map(all.map((el) => [el, shapeLength(el, ctx)]))) : new Map<Element, number>();
  let edgeCount = 0;
  for (const el of all) {
    const m = merged.get(el) as Merged;
    const list: CostEdge[] = [];
    for (const to of hrefTargets(el, byId)) list.push({ to, times: 1, add: 0, ...(el.localName === "feImage" || el.localName === "pattern" ? { level: true } : {}) });
    const here = referenced.has(el) ? Math.max(scaleOf.get(el) ?? ctx.scale, docPx) : scaleOf.get(el) ?? ctx.scale;
    if (isStyledFor("filter", el)) {
      for (const id of m.fx.filters) { const to = byId.get(id); if (to !== undefined) list.push({ to, times: 1, add: filterCost(to, here, filterMemo) }); }
      addExtra(el, m.fx.fnCost + m.fx.blend);
    }
    if (isStyledFor("mask", el)) for (const id of m.fx.masks) { const to = byId.get(id); if (to !== undefined) list.push({ to, times: 1, add: C.mask }); }
    if (isStyledFor("clip", el)) for (const id of m.fx.clips) { const to = byId.get(id); if (to !== undefined) list.push({ to, times: 1, add: C.clip + C.clipPerVertex * (vertTotal.get(to) ?? 0) }); }
    const v = ctx.vertices.get(el) ?? 0;
    if (v > 0) {
      for (const [slot, times] of [["marker-start", 1], ["marker-mid", Math.max(v - 2, 0)], ["marker-end", 1]] as const) {
        if (times === 0) continue;
        for (const id of m.markers[slot] ?? []) { const to = byId.get(id); if (to !== undefined && !inside(to, el)) list.push({ to, times, add: 0 }); }
      }
    }
    if (SHAPES.has(el.localName)) {
      for (const pat of [m.fill, m.stroke]) for (const id of pat ?? []) { const to = byId.get(id); if (to?.localName === "pattern") list.push({ to, times: 1, add: 0, level: true }); }
      const period = m.dash ?? 0;
      if (period > 0) addExtra(el, C.dashBase + C.dashPerDash * Math.min((lengthTotal.get(el) ?? 0) / period, C.maxDashes));
    }
    if (el.localName === "use") {
      // the instance inherits what the use sets: markers, dashes and fills apply to everything in the target
      for (const to of hrefTargets(el, byId)) {
        const n = vertTotal.get(to) ?? 0;
        if (n > 0) for (const slot of ["marker-start", "marker-mid", "marker-end"] as const) {
          for (const id of m.markers[slot] ?? []) { const mk = byId.get(id); if (mk !== undefined && !inside(mk, el)) list.push({ to: mk, times: n, add: 0 }); }
        }
        const period = m.dash ?? 0;
        if (period > 0) addExtra(el, C.dashBase + C.dashPerDash * Math.min((lengthTotal.get(to) ?? 0) / period, C.maxDashes));
        const shapes = shapeTotal.get(to) ?? 0;
        if (shapes > 0) for (const pat of [m.fill, m.stroke]) for (const id of pat ?? []) { const p = byId.get(id); if (p?.localName === "pattern") list.push({ to: p, times: shapes, add: 0, level: true }); }
      }
    }
    edgeCount += list.length;
    if (edgeCount > C.maxEdges) return stop(`the document has more than ${String(C.maxEdges)} references`);
    if (list.length > 0) edges.set(el, list);
  }

  if (findCycle(root, edges)) return "cycle";
  addExtra(root, styleCost);
  return accumulate(root, (el, drawn) => ownCost(el, ctx, drawn) + (drawn ? (extra.get(el) ?? 0) : 0), (el) => edges.get(el) ?? [], C.feImageLevels, true);
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

export function checkSvg(input: string, options: SvgGuardOptions = {}): SvgGuardResult {
  const bom = input.charCodeAt(0) === 0xfeff;
  const text = bom ? input.slice(1) : input;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxRenderCost = options.maxRenderCost ?? DEFAULT_MAX_RENDER_COST;

  // UTF-8 is never shorter than UTF-16 in code units, so a long string is rejected without encoding it.
  if (text.length > maxBytes) return { ok: false, problems: [{ code: "too-large", detail: `${text.length} characters exceed the limit of ${maxBytes} bytes` }] };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) return { ok: false, problems: [{ code: "too-large", detail: `${bytes} bytes exceed the limit of ${maxBytes}` }] };
  if (text.trim() === "") return { ok: false, problems: [{ code: "not-svg", detail: "empty text" }] };
  if (/<!doctype/i.test(text) || /<!entity/i.test(text)) {
    return { ok: false, problems: [{ code: "doctype", detail: "DOCTYPE and entity declarations are not allowed" }] };
  }

  const nesting = cssNesting(text);
  if (nesting > C.maxNesting) return { ok: false, problems: [{ code: "unsafe-css", element: "style", detail: `a style sheet nests {} or () ${String(nesting)} levels deep, the limit is ${String(C.maxNesting)}: a parser may crash on it` }] };

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

  let cost = 0;
  // a <use> expansion past the element limit is refused already: the cost walk would only repeat the answer on a document built to be big
  if (expanded !== "cycle" && !(expanded > maxElements)) {
    let c: number | "cycle";
    try { c = renderCost(root, all, byId, problems); } catch (e) {
      // one verdict, never an exception: whatever the estimate trips over is a document the guard does not let through
      problems.push({ code: "too-costly", kind: "limit", detail: `the render cost could not be estimated: ${e instanceof Error ? e.message : String(e)}` });
      c = 0;
    }
    if (c === "cycle") problems.push({ code: "unsafe-markup", detail: "a reference (mask, clip-path, filter, marker or feImage) refers back to an element that contains it" });
    else {
      cost = c;
      // `!(c <= max)`: a NaN from absurd input is rejected, not waved through
      if (!(c <= maxRenderCost)) problems.push({ code: "too-costly", kind: "cost", cost: c, limit: maxRenderCost, detail: Number.isFinite(c) ? `estimated render cost ${String(Math.round(c))} exceeds the limit of ${String(maxRenderCost)} (about ${String(Math.round(c / 1000))} ms of Chromium drawing time at ${String(C.referenceWidthPx)} px width, limit ${String(Math.round(maxRenderCost / 1000))} ms)` : `estimated render cost unbounded exceeds the limit of ${String(maxRenderCost)}` });
    }
  }

  return problems.length === 0 ? { ok: true, svg: root as unknown as SVGSVGElement, cost, ...(bom ? { bom: true as const } : {}) } : { ok: false, problems };
}
