// vendored from code-kit@0.78.0, src/ts/pure/css-color.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `3d-codeblocks/src/core/shapes/parse.ts` (`HEX`, `normalizeColor`), 2026-11; the same pattern stood character for
// character in `obsidian-letterhead/src/core/model.ts` (`HEX_COLOR`) and, as a transitional copy, in `svg-studio/src/core/background.ts`.
// `hexToRgb` and `rgbToHex` (0.66.0) replace six hand-written variants in timescape, kuro-screensaver, perlin-studio (two files), svg-studio and
// obsidian-kit (`hexToRgb01`); how they differed is in `tests/css-color.test.ts`.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Is `v` a hex colour of the form `#rgb` or `#rrggbb` (any case, no alpha, no colour name, no `rgb()`)? A guard for values that come from saved
 *  settings or user input; the string is returned unchanged by the guard, use {@link normalizeHex} for a canonical form. */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/** The canonical form of a hex colour: lower case, always six digits (`#ABC` → `#aabbcc`); `null` if `v` is not a hex colour in the sense of
 *  {@link isHexColor}. */
export function normalizeHex(v: string): string | null {
  if (!isHexColor(v)) return null;
  const hex = v.slice(1).toLowerCase();
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
}

/** Red, green, blue as integers 0..255. */
export type Rgb = [number, number, number];

/** A hex colour in the sense of {@link isHexColor} (`#rgb` or `#rrggbb`, any case) as `[r, g, b]` (0..255); `#rgb` is expanded by doubling each digit
 *  (`#abc` → `#aabbcc`, as CSS does). `null` for anything else: no hash, whitespace, eight digits, a name, a non-string. The failure is a value, not
 *  a colour and not a throw: the caller knows whether black or an error is right (a contrast calculation throws, a colour field falls back). Input
 *  that a user types (trim, optional `#`) is the caller's to prepare. */
export function hexToRgb(v: string): Rgb | null {
  const hex = typeof v === "string" ? normalizeHex(v) : null;
  if (hex === null) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `[r, g, b]` as lower-case `#rrggbb`. Each channel is rounded and clamped to 0..255; a channel that is not a number (`NaN`) is 0. */
export function rgbToHex(rgb: readonly [number, number, number]): string {
  const h = (v: number): string => (Number.isNaN(v) ? 0 : Math.max(0, Math.min(255, Math.round(v)))).toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
