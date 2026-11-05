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
const mk = (src: string): { el: HTMLElement; result: "image" | "held" | "error"; edits: number; repairs: number } => {
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

  // Laufzeit-Schutz (Task „Absturzmarke und Klick-zum-Rendern“): Marke VOR dem Einsetzen des Bildes, nach `load` ein Frame-Abschluss, bei Marke nur ein Platzhalter.
  describe("Absturzmarke und Notausschalter", () => {
    const fakeGuard = (marked: boolean) => {
      const log: string[] = [];
      let isMarked = marked;
      return {
        log,
        guard: {
          isMarked: () => isMarked,
          clear: () => { isMarked = false; log.push("clear"); },
          begin: (_text: string, _win: Window) => {
            log.push("begin");
            return { settle: () => { log.push("settle"); }, abort: () => { log.push("abort"); } };
          },
        },
      };
    };
    const render = (marks: ReturnType<typeof fakeGuard>["guard"] | undefined, autoShow?: () => boolean) => {
      const el = document.createElement("div");
      const result = renderSvgBlock(OK, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, ...(marks === undefined ? {} : { marks }), ...(autoShow === undefined ? {} : { autoShow }) });
      return { el, result };
    };

    it("ohne Marke: die Marke steht, BEVOR das Bild eine src hat; load → settle", () => {
      const f = fakeGuard(false);
      const el = document.createElement("div");
      let srcAtBegin: string | null = "unset";
      const begin = f.guard.begin;
      // Beobachten, was zum Zeitpunkt von begin im Element steht.
      f.guard.begin = (text, win) => { srcAtBegin = el.querySelector("img")?.getAttribute("src") ?? null; return begin(text, win); };
      expect(renderSvgBlock(OK, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard })).toBe("image");
      expect(srcAtBegin).toBeNull();
      const img = el.querySelector("img") as HTMLImageElement;
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
      // happy-dom meldet `load` für eine Data-URL von selbst.
      expect(f.log).toEqual(["begin", "settle"]);
      img.dispatchEvent(new Event("load"));
      expect(f.log).toEqual(["begin", "settle", "settle"]);
    });

    it("ein Ladefehler (error) bricht die Marke ab", () => {
      const f = fakeGuard(false);
      const { el } = render(f.guard);
      (el.querySelector("img") as HTMLImageElement).dispatchEvent(new Event("error"));
      expect(f.log).toContain("abort");
    });

    it("mit Marke: kein Bild, kein begin; Platzhalter mit Hinweis und dem Knopf „Show anyway“", () => {
      const f = fakeGuard(true);
      const { el, result } = render(f.guard);
      expect(result).toBe("held");
      expect(el.querySelector("img")).toBeNull();
      expect(el.querySelector(".svg-studio-held")?.textContent).toContain("blocked the display");
      expect(el.querySelector("button.svg-studio-show")?.textContent).toBe("Show anyway");
      expect(f.log).toEqual([]);
      expect(el.querySelector("button.svg-studio-edit")).not.toBeNull();
    });

    it("„Show anyway“ löscht die Marke, setzt sie neu (begin) und zeigt das Bild", () => {
      const f = fakeGuard(true);
      const { el } = render(f.guard);
      (el.querySelector("button.svg-studio-show") as HTMLElement).click();
      expect(f.log.slice(0, 2)).toEqual(["clear", "begin"]);
      expect(el.querySelector("img")).not.toBeNull();
      expect(el.querySelector(".svg-studio-held")).toBeNull();
      expect(el.querySelectorAll("button.svg-studio-edit")).toHaveLength(1);
    });

    it("Notausschalter aus: Platzhalter statt Bild, ohne Marke und ohne begin; der Knopf „Show“ zeigt das Bild", () => {
      const f = fakeGuard(false);
      const { el, result } = render(f.guard, () => false);
      expect(result).toBe("held");
      expect(el.querySelector("img")).toBeNull();
      expect(el.querySelector(".svg-studio-held")?.textContent).toContain("not shown automatically");
      expect(el.querySelector("button.svg-studio-show")?.textContent).toBe("Show");
      expect(f.log).toEqual([]);
      (el.querySelector("button.svg-studio-show") as HTMLElement).click();
      expect(f.log[0]).toBe("begin");
      expect(el.querySelector("img")).not.toBeNull();
    });

    it("Notausschalter an (Vorgabe) und ohne Wächter: das Bild erscheint wie bisher", () => {
      expect(render(undefined).result).toBe("image");
      expect(render(fakeGuard(false).guard, () => true).result).toBe("image");
    });

    it("ein abgelehntes SVG bleibt ein Fehlerkasten, mit oder ohne Marke und Notausschalter", () => {
      const el = document.createElement("div");
      const f = fakeGuard(true);
      expect(renderSvgBlock(`<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard, autoShow: () => false })).toBe("error");
    });
  });
});
