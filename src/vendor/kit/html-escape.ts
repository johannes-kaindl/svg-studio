// vendored from code-kit@0.91.1, src/ts/pure/html-escape.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: lifted and aligned from seven private copies (Welle 36, h1, order 2 of the hypertext-exporter design, spec sections 7.2, 7.3, 10, 14). Measured 2026-11-19:
//   epub-exporter       src/core/dom-to-xhtml.ts:32-37  escapeText / escapeAttr   (& < >  /  + ")
//   epub-exporter       src/core/code-blocks.ts:59-64   escapeText / escapeAttr   (identical to the one above)
//   epub-exporter       src/core/epub-builder.ts:8-14   xmlEscape                 (& < > ")
//   obsidian-letterhead src/core/frontmatter.ts:132     esc                       (& < > ", takes `unknown` through its own asText)
//   code-kit            src/ts/pure/print-document.ts   escAttr (private)         (& " < >)
//   calendar-notes      src/core/dav/requests.ts:14     xmlEscape                 (& < > " ', the apostrophe as `&apos;`)
//   svg-studio          src/core/fields.ts:294          escapeText                (& < >)
// The consumers do not move in this commit (the breadth does that); each one's differences from this module are listed below, so a difference is a
// reason and not drift.
//
// Two functions, one contract each:
//   `escapeHtmlText`  — safe in a text node: `&`, `<`, `>`. Quotes stay as they are (a quote in a text node is harmless, and escaping it would change the
//                       bytes of every existing text output for nothing).
//   `escapeHtmlAttr`  — safe in a text node AND in an attribute value quoted with `"` or with `'`: the three above plus `"` and `'`.
// `&` is replaced in the same pass as the others (one character class, one pass), so an already-masked text is masked again (`&amp;` → `&amp;amp;`):
// the function never decodes, and a second call on its own output is a different string by design.
//
// Differences from the seven copies, each with its reason:
//   * the apostrophe becomes `&#39;`, not `&apos;` (calendar-notes): `&apos;` is not defined in HTML 4 and some parsers of the old XHTML 1.0 family
//     do not know it; `&#39;` is read by HTML and by XML alike, so one spelling serves the XML writer (calendar-notes) and the HTML writer;
//   * epub-exporter and svg-studio leave `"` and `'` alone in TEXT; so does `escapeHtmlText` (same bytes as before);
//   * the attribute function also masks `'` (only calendar-notes did); a single-quoted attribute is legal HTML and a consumer that writes one must not
//     be the one that gets the escaping wrong;
//   * input that is not a string: `null`, `undefined`, a symbol, an object, a function, an array and a Date give `""`; a number, a boolean and a bigint
//     give `String(value)`. letterhead's `asText` also joins arrays with `,` and prints dates; that is formatting, not escaping, and stays in
//     letterhead (it calls its own `asText`, then this module). The escape never throws: `String(symbol)` would, so symbols are listed out.

const SPECIAL_TEXT = /[&<>]/g;
const SPECIAL_ATTR = /[&<>"']/g;

const ENTITY: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

/** Masks `&`, `<` and `>` for a text node. Non-strings: see the module header. Never decodes, never throws. */
export function escapeHtmlText(value: unknown): string {
  return scalarText(value).replace(SPECIAL_TEXT, (c) => ENTITY[c] ?? c);
}

/** Masks `&`, `<`, `>`, `"` and `'`: safe in a text node and in an attribute value quoted with either quote. Never decodes, never throws. */
export function escapeHtmlAttr(value: unknown): string {
  return scalarText(value).replace(SPECIAL_ATTR, (c) => ENTITY[c] ?? c);
}
