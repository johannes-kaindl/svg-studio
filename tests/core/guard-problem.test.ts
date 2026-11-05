// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { costEstimate, isSizeLimit } from "../../src/core/guard-problem";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import { MID_COST_SVG } from "../helpers/costly-svg";

// Die Form des Details bindet an den echten Bereiniger (code-kit 0.58.0): ändert das Kit den Wortlaut, wird dieser Test rot und nicht der Rat an den Nutzer still falsch.
describe("costEstimate / isSizeLimit gegen den echten Bereiniger", () => {
  const problems = (svg: string, o = {}) => { const r = checkSvg(svg, o); if (r.ok) throw new Error("erwartet abgelehnt"); return r.problems; };

  it("Kostenschätzung über der Grenze: Verhältnis aus dem Detail", () => {
    const p = problems(MID_COST_SVG, { maxRenderCost: 100_000 })[0]!;
    expect(p.code).toBe("too-costly");
    const e = costEstimate(p);
    expect(e).not.toBeNull();
    expect(e!.ratio).toBeGreaterThan(1);
    expect(isSizeLimit(p)).toBe(false);
  });

  it("Mengengrenze (zu großes Stilblatt): keine Schätzung, aber eine Mengengrenze", () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg"><style>${"a{fill:red}".repeat(30_000)}</style><rect id="r"/></svg>`;
    const ps = problems(sheet);
    const limit = ps.find((p) => p.code === "too-costly" && /characters, the limit is/.test(p.detail));
    expect(limit).toBeDefined();
    expect(costEstimate(limit!)).toBeNull();
    expect(isSizeLimit(limit!)).toBe(true);
  });

  it("andere Codes und Texte: null", () => {
    expect(costEstimate({ code: "doctype", detail: "estimated render cost 5 exceeds the limit of 1" })).toBeNull();
    expect(costEstimate({ code: "too-costly", detail: "etwas anderes" })).toBeNull();
    expect(costEstimate({ code: "too-costly", detail: "estimated render cost unbounded exceeds the limit of 1000000" })).toEqual({ ratio: null });
  });
});
