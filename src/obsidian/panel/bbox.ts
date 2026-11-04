// Ausdehnung eines Elements im Benutzerraum der Wurzel, gemessen vom Browser (`getBBox()`, Spec § 7.4). Keine eigene Bounding-Box-Rechnung für Pfade und
// Bögen. Das Panel (Vorschau im Shadow Root) und das Messlabor (`scripts/lab/page.ts`, chrome-headless-shell) rufen dieselbe Funktion.
// Die Umrechnung kommt aus `getScreenCTM()` der Wurzel und des Elements: sie kennt `viewBox`, `preserveAspectRatio`, verschachtelte `<svg>`, `transform` an
// der Wurzel und CSS-Transformationen. Es steht nichts im Baum (ein Messfühler `g` übernähme das CSS des SVG und verfälschte die Zahlen).
// Ein Element ohne Layout (verborgen, `display: none`, nicht gezeichnet) liefert in Chromium eine Null-Box oder keine Matrix: beides ergibt `null`.
import type { Box } from "../../core/measure-line";

export type { Box };

/** Kinder der Wurzel, die nichts zeichnen (Definitionen, Kopfdaten, Vorlagen). */
const NOT_DRAWN = new Set([
  "defs", "style", "title", "desc", "metadata", "symbol", "clipPath", "mask", "marker", "pattern", "linearGradient", "radialGradient", "filter", "view",
]);

/** Die Umkehrung der Bildschirm-Matrix der Wurzel; sie gilt für alle Elemente derselben Messung, also einmal rechnen. */
function rootInverse(root: SVGSVGElement): DOMMatrix | null {
  try {
    const m = root.getScreenCTM();
    return m === null ? null : m.inverse();
  } catch {
    return null;
  }
}

/** Die Matrix, die den Raum des Elements in den Benutzerraum der Wurzel überführt; `inv` ist `rootInverse(root)`, wenn der Aufrufer es schon hat. */
export function rootToElement(root: SVGSVGElement, el: SVGGraphicsElement, inv: DOMMatrix | null = rootInverse(root)): DOMMatrix | null {
  try {
    const m = el.getScreenCTM();
    return inv === null || m === null ? null : inv.multiply(m);
  } catch {
    return null;
  }
}

function boxWith(root: SVGSVGElement, el: SVGGraphicsElement, inv: DOMMatrix | null): Box | null {
  try {
    const t = rootToElement(root, el, inv);
    if (t === null) return null;
    const bb = el.getBBox();
    if (bb.width === 0 && bb.height === 0) return null; // leere Gruppe, `display: none`, Panel verborgen: nichts zu messen
    const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(t));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    return Object.values(box).every(Number.isFinite) ? box : null;
  } catch {
    return null;
  }
}

/** Ausdehnung von `el` im Benutzerraum von `root` (berücksichtigt `transform` am Element und seinen Eltern, nicht die Strichstärke); `null`, wo nichts zu messen ist. */
export function userBox(root: SVGSVGElement, el: SVGGraphicsElement): Box | null {
  return boxWith(root, el, rootInverse(root));
}

/** Ausdehnung von `el` im EIGENEN Koordinatenraum (`getBBox()` unverändert, vor dem `transform` des Elements und seiner Eltern): der Raum, in dem `rotate(a cx cy)` die Mitte erwartet.
 *  `null`, wo der Browser nichts misst. */
export function localBox(el: SVGGraphicsElement): Box | null {
  try {
    const bb = el.getBBox();
    if (bb.width === 0 && bb.height === 0) return null;
    const box = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
    return Object.values(box).every(Number.isFinite) ? box : null;
  } catch {
    return null;
  }
}

/** Vereinigung der Ausdehnungen der gezeichneten Kinder der Wurzel (ohne Definitionen, Vorlagen und Kopfdaten, siehe `NOT_DRAWN`); `null`, wenn nichts messbar ist. */
export function drawingBox(root: SVGSVGElement): Box | null {
  const inv = rootInverse(root);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of Array.from(root.children)) {
    if (NOT_DRAWN.has(c.localName)) continue;
    const b = boxWith(root, c as SVGGraphicsElement, inv);
    if (b === null) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
