// Bildfläche der Wurzel: viewBox, sonst width/height; Einheit aus `data-unit` (Spec § 5.1). Pure.
import { attr, scanElements } from "./elements";

export interface Canvas {
  width: number;
  height: number;
  unit: string | null;
  source: "viewBox" | "size";
}

// `\d+(\.\d*)?` statt `\d+\.?\d*`: Letzteres backtrackt bei langen Ziffernfolgen quadratisch.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i;

function parseViewBox(value: string): { width: number; height: number } | null {
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) return null;
  const width = Number(parts[2]);
  const height = Number(parts[3]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Zahl mit optionalem Einheiten-Suffix; die Einheit selbst wird verworfen (sie kommt nur aus `data-unit`). Prozentangaben und Unsinn ergeben `null`. */
function parseLength(value: string | null): { n: number } | null {
  if (value === null) return null;
  const m = LENGTH.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  return { n };
}

export function measureCanvas(text: string): Canvas | null {
  const root = scanElements(text).elements.find((e) => e.parentKey === null);
  if (!root || root.tag !== "svg") return null;
  const dataUnit = attr(root, "data-unit")?.trim() || null;

  const vbValue = attr(root, "viewBox");
  const vb = vbValue === null ? null : parseViewBox(vbValue);
  if (vb) return { width: vb.width, height: vb.height, unit: dataUnit, source: "viewBox" };

  const w = parseLength(attr(root, "width"));
  const h = parseLength(attr(root, "height"));
  if (w && h) return { width: w.n, height: h.n, unit: dataUnit, source: "size" };
  return null;
}
