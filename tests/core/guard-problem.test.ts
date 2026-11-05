// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { guardProblemsLine } from "../../src/core/protocol";
import { guardProblemText, initStrings } from "../../src/i18n/strings";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import { MID_COST_SVG } from "../helpers/costly-svg";

// Die Felder `kind`, `cost` und `limit` kommen seit code-kit 0.59.0 vom Bereiniger selbst; dieser Test bindet das Plugin an den echten Bereiniger, nicht an einen nachgebauten Befund.
describe("Befunde `too-costly` des echten Bereinigers", () => {
  const problems = (svg: string, o = {}) => { const r = checkSvg(svg, o); if (r.ok) throw new Error("erwartet abgelehnt"); return r.problems; };

  it("Kostenschätzung über der Grenze: kind cost mit cost und limit, Satz mit Verhältnis, Rat an das Modell", () => {
    const ps = problems(MID_COST_SVG, { maxRenderCost: 100_000 });
    const p = ps[0]!;
    expect(p.code).toBe("too-costly");
    expect(p.kind).toBe("cost");
    expect(p.cost).toBeGreaterThan(p.limit!);
    expect(p.limit).toBe(100_000);
    initStrings("en");
    expect(guardProblemText(p)).toMatch(/^too-costly: this SVG would take too long to draw \(about [\d.]+ times the allowed cost\)/);
    expect(guardProblemsLine(ps)).toContain("zu aufwendig");
  });

  it("Mengengrenze (zu großes Stilblatt): der Eintrag kind limit, dazu ein Eintrag cost mit unendlichen Kosten; kein Rat an das Modell, die Ursache steht vorn", () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg"><style>${"a{fill:red}".repeat(30_000)}</style><rect id="r"/></svg>`;
    const ps = problems(sheet);
    const limit = ps.find((p) => p.code === "too-costly" && p.kind === "limit");
    expect(limit).toBeDefined();
    expect(limit!.detail).toMatch(/characters, the limit is/);
    expect(ps.findIndex((p) => p.kind === "limit")).toBeLessThan(ps.findIndex((p) => p.kind === "cost" && p.cost === Infinity) === -1 ? Infinity : ps.findIndex((p) => p.kind === "cost" && p.cost === Infinity));
    initStrings("en");
    expect(guardProblemText(limit!)).toBe(`too-costly: ${limit!.detail}`);
    expect(guardProblemsLine(ps)).not.toContain("zu aufwendig");
  });
});
