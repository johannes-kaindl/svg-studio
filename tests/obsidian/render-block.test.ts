// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { initStrings, t } from "../../src/i18n/strings";
import { renderSvgBlock } from "../../src/obsidian/render-block";
import { base64ToBytes } from "../../src/vendor/kit/data-url";
import { checkSvg } from "../../src/vendor/kit/svg-guard";

installObsidianDom();
initStrings("en");
const OK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Mond</title><circle id="m" r="4"/></svg>`;
const mk = (src: string): { el: HTMLElement; result: "image" | "error"; edits: number; repairs: number } => {
  const el = document.createElement("div");
  const c = { edits: 0, repairs: 0 };
  const result = renderSvgBlock(src, el, { guard: checkSvg, onEdit: () => c.edits++, onRepair: () => c.repairs++, t });
  return { el, result, get edits() { return c.edits; }, get repairs() { return c.repairs; } };
};

describe("renderSvgBlock", () => {
  it("gültig → genau ein Bild, Data-URL dekodiert zum Quelltext, alt aus <title>", () => {
    const { el, result } = mk(OK);
    expect(result).toBe("image");
    const imgs = el.querySelectorAll("img.svg-studio-img");
    expect(imgs).toHaveLength(1);
    const img = imgs[0] as HTMLImageElement;
    expect(img.getAttribute("src")?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const b64 = img.getAttribute("src")!.slice("data:image/svg+xml;base64,".length);
    expect(new TextDecoder().decode(base64ToBytes(b64))).toBe(OK);
    expect(img.alt).toBe("Mond");
  });

  it("ohne <title> heißt das Bild 'SVG'", () => {
    const { el } = mk(OK.replace("<title>Mond</title>", ""));
    expect((el.querySelector("img") as HTMLImageElement).alt).toBe("SVG");
  });

  it("der Knopf trägt den Namen 'Edit in SVG Studio' und ruft onEdit", () => {
    const r = mk(OK);
    const b = r.el.querySelector("button.svg-studio-edit")!;
    expect(b.getAttribute("aria-label")).toBe("Edit in SVG Studio");
    (b as HTMLElement).click();
    expect(r.edits).toBe(1);
  });

  it("abgelehnt → Fehlerkasten mit Code und Detail je Problem, Knöpfe Reparieren und Bearbeiten", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="https://x"><rect/></a></svg>`;
    const r = mk(bad);
    expect(r.result).toBe("error");
    const items = [...r.el.querySelectorAll(".svg-studio-error li")].map((li) => li.textContent ?? "");
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((s) => s.startsWith("forbidden-element: "))).toBe(true);
    (r.el.querySelector(".svg-studio-repair") as HTMLElement).click();
    (r.el.querySelector(".svg-studio-edit-text") as HTMLElement).click();
    expect(r.repairs).toBe(1);
    expect(r.edits).toBe(1);
    expect(r.el.querySelector("img")).toBeNull();
  });

  it("im Block-Element steht nie ein svg-Element, auch bei Ablehnung nicht (kein Markup aus dem Quelltext im DOM)", () => {
    for (const src of [OK, `<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`, "kein svg"]) {
      const { el } = mk(src);
      expect(el.querySelector("svg")).toBeNull();
      expect(el.innerHTML).not.toContain("<script");
    }
  });

  it("ein erneutes Rendern ersetzt den Inhalt statt ihn zu verdoppeln", () => {
    const el = document.createElement("div");
    const o = { guard: checkSvg, onEdit() {}, onRepair() {}, t };
    renderSvgBlock(OK, el, o);
    renderSvgBlock(OK, el, o);
    expect(el.querySelectorAll("img")).toHaveLength(1);
  });
});
