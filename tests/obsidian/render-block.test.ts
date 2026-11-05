// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { CLICK_COST, COST_LIMIT } from "../../src/core/render-guard";
import { initStrings, t } from "../../src/i18n/strings";
import { MID_COST_SVG } from "../helpers/costly-svg";
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

/** Klein und wohlgeformt, aber teuer: eine Polylinie mit 2000 Punkten und `marker-mid` auf einem Marker mit 1000 Kreisen (Kostenmodell von code-kit 0.58.0, weit über der Grenze von 1 Mio.). */
const COSTLY = (() => {
  const pts = Array.from({ length: 2000 }, (_, i) => `${i % 100},${(i * 7) % 100}`).join(" ");
  const dots = Array.from({ length: 1000 }, (_, i) => `<circle cx="${i % 10}" cy="${Math.floor(i / 10) % 10}" r="0.2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><marker id="m" markerWidth="10" markerHeight="10">${dots}</marker></defs><polyline points="${pts}" fill="none" stroke="black" marker-mid="url(#m)"/></svg>`;
})();

describe("renderSvgBlock", () => {
  it("zu teuer (too-costly) → Fehlerkasten mit dem eigenen Satz statt „code: detail“, nichts gezeichnet", () => {
    const { el, result } = mk(COSTLY);
    expect(result).toBe("error");
    expect(el.querySelector("img")).toBeNull();
    const items = [...el.querySelectorAll(".svg-studio-error li")].map((li) => li.textContent ?? "");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/^too-costly: this SVG would take too long to draw \(about \d+(\.\d)? times the allowed cost\)\. /);
    expect(items[0]).toContain("fewer nested masks, markers or filters");
  });

  it("ein führendes BOM wird angenommen, gezeichnet wird der Text OHNE BOM (der Text, den der Bereiniger geprüft hat)", () => {
    const { el, result } = mk(`\uFEFF${OK}`);
    expect(result).toBe("image");
    const src = el.querySelector("img")!.getAttribute("src")!;
    const bytes = base64ToBytes(src.slice("data:image/svg+xml;base64,".length));
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(OK);
    expect(bytes[0]).toBe(0x3c);
  });

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

  // Ein SVG nur mit `viewBox` (so schreiben Modelle) hat keine eigene Größe; als Bild in einem `inline-block` mit `max-width: 100%` wurde es 0 px breit und war unsichtbar (Messung im Bild-Lauf 2026-11-05).
  describe("Größe eines Bildes ohne width und height", () => {
    const img = (svg: string): HTMLImageElement => mk(svg).el.querySelector("img.svg-studio-img")!;
    it("nur viewBox: die Breite der viewBox wird als width gesetzt (height folgt aus dem Seitenverhältnis)", () => {
      const i = img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 320"><rect id="r" width="5" height="5"/></svg>`);
      expect(i.getAttribute("width")).toBe("580");
      expect(i.hasAttribute("height")).toBe(false);
    });
    it("viewBox mit Ursprung und Dezimalzahlen: die dritte Zahl zählt", () => {
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10, -5.5 48.5 24"><rect id="r" width="5" height="5"/></svg>`).getAttribute("width")).toBe("48.5");
    });
    it("mit width oder height am SVG bleibt das Bild, wie es ist", () => {
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><rect id="r" width="5" height="5"/></svg>`).hasAttribute("width")).toBe(false);
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg" height="50" viewBox="0 0 24 24"><rect id="r" width="5" height="5"/></svg>`).hasAttribute("width")).toBe(false);
    });
    it("keine brauchbare viewBox: nichts wird erfunden", () => {
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" width="5" height="5"/></svg>`).hasAttribute("width")).toBe(false);
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 10"><rect id="r" width="5" height="5"/></svg>`).hasAttribute("width")).toBe(false);
      expect(img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="a b c d"><rect id="r" width="5" height="5"/></svg>`).hasAttribute("width")).toBe(false);
    });
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
    const freed = new Set<string>();
      return {
        log,
        guard: {
          isMarked: () => isMarked,
          clear: (text?: string) => { isMarked = false; if (text !== undefined) freed.add(text); log.push("clear"); },
          released: (text: string) => freed.has(text),
          release: (text: string) => { freed.add(text); log.push("release"); },
        dispose: () => undefined,
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

    it("onDispose: der Block meldet eine Aufräum-Funktion an, die den Wächter beendet (Notizwechsel)", () => {
      const f = fakeGuard(false);
      let cleanup: (() => void) | null = null;
      const el = document.createElement("div");
      renderSvgBlock(OK, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard, onDispose: (c) => { cleanup = c; } });
      expect(cleanup).not.toBeNull();
      const before = f.log.length;
      (cleanup as unknown as () => void)();
      expect(f.log.slice(before)).toEqual(["abort"]);
    });

    // Klick-zum-Rendern nach Kostenwert (code-kit 0.58.0, `cost` im ok-Ergebnis): ab `clickCost` Platzhalter, erst der Klick zeichnet; die Marke fällt, es wurde nichts gezeichnet.
    describe("Kostenschwelle", () => {
      const cost = (svg: string): number => { const r = checkSvg(svg); if (!r.ok) throw new Error("erwartet ok"); return r.cost; };
      const MID = MID_COST_SVG;
      const run = (src: string, extra: Partial<Parameters<typeof renderSvgBlock>[2]> = {}) => {
        const f = fakeGuard(false);
        const el = document.createElement("div");
        const result = renderSvgBlock(src, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard, ...extra });
        return { f, el, result };
      };

      it("der Probekörper liegt zwischen Schwelle und Grenze (echter Kostenwert des Bereinigers)", () => {
        const c = cost(MID);
        expect(c).toBeGreaterThanOrEqual(CLICK_COST);
        expect(c).toBeLessThan(COST_LIMIT);
        expect(cost(OK)).toBeLessThan(CLICK_COST);
      });

      it("ab der Schwelle: Platzhalter mit Prozentangabe, kein Bild, die Marke fällt wieder; der Klick zeichnet", () => {
        const { f, el, result } = run(MID);
        expect(result).toBe("held");
        expect(el.querySelector("img")).toBeNull();
        expect(el.querySelector(".svg-studio-held p")?.textContent).toMatch(/^This SVG is expensive to draw \(about \d+ % of the allowed cost\), so it is shown in the note only after a click\.$/);
        expect(el.querySelector("button.svg-studio-show")?.textContent).toBe("Show");
        expect(f.log).toEqual(["begin", "abort"]);
        (el.querySelector("button.svg-studio-show") as HTMLElement).click();
        expect(el.querySelector("img.svg-studio-img")).not.toBeNull();
        expect(el.querySelector(".svg-studio-held")).toBeNull();
        expect(f.log).toEqual(["begin", "abort", "release", "begin", "settle"]);
      });

      it("knapp unter der Schwelle wird gezeichnet, genau auf der Schwelle nicht (Grenzwert zählt zum Platzhalter)", () => {
        const c = cost(MID);
        expect(run(MID, { clickCost: c + 1 }).result).toBe("image");
        expect(run(MID, { clickCost: c }).result).toBe("held");
      });

      it("die Freigabe gilt für denselben Text auch in einem zweiten Block (gemeinsamer Zustand im Wächter), nicht für einen anderen", () => {
        const f = fakeGuard(false);
        const mkBlock = (src: string) => renderSvgBlock(src, document.createElement("div"), { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard });
        expect(mkBlock(MID)).toBe("held");
        f.guard.release(MID);
        expect(mkBlock(MID)).toBe("image");
        expect(mkBlock(MID.replace("0.2", "0.3"))).toBe("held");
      });

      it("ein billiges Bild bleibt ein Bild (keine Marke weniger, kein Platzhalter)", () => {
        const { f, result } = run(OK);
        expect(result).toBe("image");
        expect(f.log).toEqual(["begin", "settle"]);
      });

      it("forced zeichnet nichts Abgelehntes: ein SVG über der Grenze bleibt ein Fehlerkasten", () => {
        expect(run(COSTLY, { forced: true }).result).toBe("error");
      });

      it("Reihenfolge: der Notausschalter geht der Kostenschwelle vor (Platzhalter „nicht automatisch“, ohne Bereiniger, ohne begin)", () => {
        const f = fakeGuard(false);
        const el = document.createElement("div");
        expect(renderSvgBlock(MID, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard, autoShow: () => false })).toBe("held");
        expect(el.querySelector(".svg-studio-held p")?.textContent).toContain("not shown automatically");
        expect(f.log).toEqual([]);
      });

      it("Reihenfolge: eine Absturzmarke geht der Kostenschwelle vor (Platzhalter ohne Bereiniger, ohne begin)", () => {
        const f = fakeGuard(true);
        const el = document.createElement("div");
        expect(renderSvgBlock(MID, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard })).toBe("held");
        expect(el.querySelector(".svg-studio-held")?.textContent).toContain("blocked the display");
        expect(f.log).toEqual([]);
      });
    });

    const BAD = `<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`;

    // Pläne 2 / Review: der Bereiniger ist selbst ein Teil des Zeichnens, das hängen kann (DOMParser bei verschachtelten Selektoren).
    it("die Marke steht VOR dem Bereiniger (begin vor guard); der Bereiniger läuft bei markiertem Text oder ausgeschaltetem Schalter gar nicht", () => {
      const f = fakeGuard(false);
      const order: string[] = [];
      const begin = f.guard.begin;
      f.guard.begin = (text, win) => { order.push("begin"); return begin(text, win); };
      const guard = ((text: string) => { order.push("guard"); return checkSvg(text); }) as typeof checkSvg;
      renderSvgBlock(OK, document.createElement("div"), { guard, onEdit() {}, onRepair() {}, t, marks: f.guard });
      expect(order).toEqual(["begin", "guard"]);
      for (const mk of [fakeGuard(true), fakeGuard(false)]) {
        order.length = 0;
        renderSvgBlock(OK, document.createElement("div"), { guard, onEdit() {}, onRepair() {}, t, marks: mk.guard, autoShow: () => false });
        expect(order).toEqual([]);
      }
    });

    it("ein vom Bereiniger abgelehntes SVG bleibt ein Fehlerkasten; die Marke wird beendet (abort), das Bild entsteht nie", () => {
      const f = fakeGuard(false);
      const el = document.createElement("div");
      expect(renderSvgBlock(BAD, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard })).toBe("error");
      expect(f.log).toEqual(["begin", "abort"]);
      expect(el.querySelector("img")).toBeNull();
    });

    it("ein markiertes oder ausgeschaltetes Bild zeigt den Platzhalter, auch wenn der Text vom Bereiniger abgelehnt würde; erst „Anzeigen“ läuft der volle Weg bis zum Fehlerkasten", () => {
      const f = fakeGuard(true);
      const el = document.createElement("div");
      expect(renderSvgBlock(BAD, el, { guard: checkSvg, onEdit() {}, onRepair() {}, t, marks: f.guard, autoShow: () => false })).toBe("held");
      (el.querySelector("button.svg-studio-show") as HTMLElement).click();
      expect(el.querySelector(".svg-studio-error")).not.toBeNull();
      expect(f.log.slice(0, 2)).toEqual(["clear", "begin"]);
    });
  });
});
