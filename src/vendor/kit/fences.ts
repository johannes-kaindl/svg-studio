// vendored from code-kit@0.54.0, src/ts/pure/fences.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `3d-codeblocks/src/core/shapes/fence.ts` (`fenceFor`), `src/core/shapes/references.ts` (`shapesBlock`,
// here `wrapInFence` with the language as a parameter) and `src/obsidian/panel-accept.ts` (`closesOpenFence`, here on the opening
// line instead of the notes text and a fence object). Reduced K1: the scanner (`listFences`/`findFenceAt`) stays with its carrier.

/** The fence for `body`: three backticks, or one more than the longest run of backticks inside the body, so no body line can close it. */
export function fenceFor(body: string): string {
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** A fenced block with language `lang`. The body is normalised first: a leading BOM goes, CRLF becomes LF, trailing line breaks go
 *  (a BOM would sit in the first line of the body and break its parsing). Known, accepted normalisation: the way back (block → file)
 *  writes a file without BOM. The fence is measured on the normalised body. */
export function wrapInFence(lang: string, body: string): string {
  const clean = body.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const fence = fenceFor(clean);
  return `${fence}${lang}\n${clean}\n${fence}`;
}

/** Would a line of `body` close the fence that `openLineText` opens? CommonMark: same character (backtick or tilde), at least as long,
 *  at most three spaces of indent, nothing but whitespace after it. `false` when `openLineText` is no fence at all. Use it before
 *  writing a body into an existing block: a body that closes the fence early cuts the block in two. */
export function closesFence(openLineText: string, body: string): boolean {
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(openLineText.replace(/^\uFEFF/, ""));
  const marker = open?.[1];
  if (marker === undefined) return false;
  const ch = marker.startsWith("`") ? "`" : "~";
  const close = new RegExp(`^ {0,3}${ch}{${String(marker.length)},}[ \\t]*$`);
  return body.split(/\r?\n/).some((line) => close.test(line));
}
