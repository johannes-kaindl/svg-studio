// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";
import { initStrings, t } from "../src/i18n/strings";
import { renderSvgBlock } from "../src/obsidian/render-block";
import { checkSvg } from "../src/vendor/kit/svg-guard";

installObsidianDom();
initStrings("en");

/** Sicherheitsfix code-kit 0.89.0 (`pure/css-rules` liest nur CSS-Leerraum). Wirkstelle ist `renderSvgBlock`, der Block in der Notiz: dort geht fremdes SVG durch
 *  `checkSvg`, bevor es gezeichnet wird. Mit code-kit 0.78.0 las der Wächter `url(#f` + NBSP + `)` als `url(#f)` und folgte dem billigen `f`, während der Browser
 *  das teure Element mit der Id `f` + NBSP anwendet: der Kostendeckel griff nicht (gemessen 16 043 statt 1,26 Mio. für 80 Rechtecke, Bild gezeichnet). */
const NB = " ";
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string): string => `<svg ${NS} viewBox="0 0 600 600">${inner}</svg>`;
const BLURS = '<feGaussianBlur stdDeviation="40"/><feGaussianBlur stdDeviation="40"/><feGaussianBlur stdDeviation="40"/>';
const rects = (ref: string): string => Array.from({ length: 80 }, (_, i) => `<rect id="r${i}" width="500" height="500" filter="${ref}"/>`).join("");
const render = (src: string): { result: string; items: string[]; img: boolean } => {
  const el = document.createElement("div");
  const result = renderSvgBlock(src, el, { guard: checkSvg, onEdit: () => undefined, onRepair: () => undefined, t });
  return { result, items: [...el.querySelectorAll(".svg-studio-error li")].map((li) => li.textContent ?? ""), img: el.querySelector("img") !== null };
};

describe("svg-guard an der Wirkstelle (code-kit 0.89.0)", () => {
  it("filter=\"url(#f NBSP)\" folgt dem Element mit NBSP in der Id: der Kostendeckel greift wie ohne NBSP", () => {
    const withNbsp = render(svg(`<filter id="f"><feFlood/></filter><filter id="f${NB}">${BLURS}</filter>${rects(`url(#f${NB})`)}`));
    const plain = render(svg(`<filter id="g"><feFlood/></filter><filter id="f">${BLURS}</filter>${rects("url(#f)")}`));
    for (const r of [plain, withNbsp]) {
      expect(r.result).toBe("error");
      expect(r.img).toBe(false);
      expect(r.items.some((i) => i.startsWith("too-costly:"))).toBe(true);
    }
  });

  it("Gegenprobe: dasselbe Dokument mit Verweis auf das billige f wird gezeichnet (der Test misst die Wahl des Elements, nicht die Zahl der Rechtecke)", () => {
    expect(render(svg(`<filter id="f"><feFlood/></filter><filter id="f${NB}">${BLURS}</filter>${rects("url(#f)")}`)).result).toBe("image");
  });

  // Regression, kein Mutationsfall: svg-guard lehnt jedes url() ab, das kein #Fragment ist; url(NBSP data:…) war schon mit code-kit 0.78.0 abgelehnt (gemessen 2026-11-24).
  it("url(NBSP data:…) wird wie url(data:…) abgelehnt, im Attribut und in <style>", () => {
    const data = "data:image/png;base64,AAAA";
    for (const pre of ["", NB]) {
      const attr = render(svg(`<rect id="a" width="5" height="5" fill="url(${pre}${data})"/>`));
      expect(attr.result).toBe("error");
      expect(attr.items.some((i) => i.startsWith("external-reference:"))).toBe(true);
      const style = render(svg(`<style>rect{fill:url(${pre}${data})}</style><rect id="a" width="5" height="5"/>`));
      expect(style.result).toBe("error");
      expect(style.items.some((i) => i.startsWith("unsafe-css:"))).toBe(true);
    }
  });
});
