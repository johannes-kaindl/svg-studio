import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HAND_LABEL } from "../src/core/fields";
import { faultText, initStrings, problemText, STRINGS, t } from "../src/i18n/strings";

describe("Oberflächentexte", () => {
  it("beide Sprachen haben dieselben Schlüssel", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });
  it("jeder Text ist gefüllt und die Platzhalter stimmen überein", () => {
    const ph = (s: string): string => (s.match(/\{\d+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(STRINGS.en)) {
      expect(STRINGS.en[k], k).not.toBe("");
      expect(STRINGS.de[k], k).not.toBe("");
      expect(ph(STRINGS.de[k]!), k).toBe(ph(STRINGS.en[k]!));
    }
  });
  it("Befehlsnamen: Verb plus Gegenstand, ohne Plugin-Namen (Entscheidung 19)", () => {
    for (const lang of ["en", "de"] as const) {
      initStrings(lang);
      for (const k of ["cmd.new", "cmd.edit"]) expect(t(k), `${lang} ${k}`).not.toMatch(/SVG Studio/);
    }
    initStrings("en");
    expect([t("cmd.new"), t("cmd.edit"), t("block.edit")]).toEqual(["New SVG", "Edit SVG", "Edit in SVG Studio"]);
    initStrings("de");
    expect([t("cmd.new"), t("cmd.edit"), t("block.edit")]).toEqual(["Neues SVG", "SVG bearbeiten", "In SVG Studio bearbeiten"]);
  });
  it("Platzhalter werden ersetzt, ein unbekannter Schlüssel gibt den Schlüssel", () => {
    initStrings("de");
    expect(t("panel.targetEdit", "logo.svg")).toBe("Ändern: logo.svg");
    expect(t("gibt.es.nicht")).toBe("gibt.es.nicht");
  });
  it("jeder Schlüssel, den der Code benutzt, ist definiert", () => {
    const used = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "vendor") walk(p); }
        else if (e.name.endsWith(".ts")) for (const m of readFileSync(p, "utf8").matchAll(/\bt\("([a-zA-Z.]+)"/g)) used.add(m[1]!);
      }
    };
    walk("src");
    for (const k of used) expect(STRINGS.en, k).toHaveProperty(k);
  });
});

describe("Messzeile ist einsprachig", () => {
  it("der Zusatz 'plans:2/3' erscheint in der Sprache der Oberfläche, nie als deutscher Rest im englischen Satz", async () => {
    const { qualityTexts } = await import("../src/i18n/strings");
    const { MEASUREMENTS } = await import("../src/core/quality");
    const row = MEASUREMENTS.find((m) => m.model.startsWith("google") && m.task === "create")!;
    initStrings("en");
    expect(qualityTexts().measured(row)).toContain("floor plans 2 of 3");
    expect(qualityTexts().measured(row)).not.toMatch(/Grundrisse|plans:/);
    initStrings("de");
    expect(qualityTexts().measured(row)).toContain("Grundrisse 2 von 3");
    initStrings("en");
  });

  it("qwen: der Zusatz 'ohne top_p gemessen' erscheint in beiden Sprachen, gemma trägt ihn nicht", async () => {
    const { qualityTexts } = await import("../src/i18n/strings");
    const { MEASUREMENTS } = await import("../src/core/quality");
    const qwen = MEASUREMENTS.find((m) => m.model.startsWith("qwen") && m.task === "create")!;
    const gemma = MEASUREMENTS.find((m) => m.model.startsWith("google") && m.task === "create")!;
    initStrings("en");
    expect(qualityTexts().measured(qwen)).toContain("measured without top_p");
    expect(qualityTexts().measured(qwen)).toContain("floor plans 3 of 3");
    expect(qualityTexts().measured(gemma)).not.toContain("top_p");
    initStrings("de");
    expect(qualityTexts().measured(qwen)).toContain("ohne top_p gemessen");
    initStrings("en");
  });
});

describe("Zahlenfelder", () => {
  it("das Wort des Rundentitels im Kern stimmt mit dem der Oberfläche überein (`review.author.hand`)", () => {
    expect(HAND_LABEL.de).toBe(STRINGS.de["review.author.hand"]);
    expect(HAND_LABEL.en).toBe(STRINGS.en["review.author.hand"]);
  });

  it("jeder Schreibschutzgrund hat einen Text, und field-readonly setzt ihn in den Satz", () => {
    for (const reason of ["unit", "value", "style", "markup", "unnamed", "ambiguous", "matrix", "scale", "skew", "transform"]) {
      expect(STRINGS.en[`fields.readonly.${reason}`], reason).toBeTruthy();
      expect(STRINGS.de[`fields.readonly.${reason}`], reason).toBeTruthy();
    }
    initStrings("en");
    expect(problemText({ code: "field-readonly", params: ["rotate", "matrix"] })).toBe("The field “rotate” is write-protected: The transform is a matrix: change it in the code.");
    initStrings("de");
    expect(problemText({ code: "field-readonly", params: ["rotate", "matrix"] })).toBe("Das Feld „rotate“ ist schreibgeschützt: Das transform ist eine Matrix: im Code ändern.");
    initStrings("en");
  });
});

describe("faultText: die Ursache einer ungültigen Modellantwort in der Sprache der Oberfläche", () => {
  const guard = { code: "too-costly", kind: "cost" as const, cost: 2_000_000, limit: 1_000_000, detail: "estimated render cost 2000000 exceeds the limit of 1000000" };
  it("englisch: kein deutscher Satz des Modells in der Oberfläche", () => {
    initStrings("en");
    expect(faultText({ code: "no-svg" })).toBe("The answer contains no <svg>…</svg>.");
    expect(faultText({ code: "not-wellformed", detail: "x", offset: 4 })).toBe("The SVG is not well-formed: x (offset 4).");
    expect(faultText({ code: "no-id", tag: "rect", n: 2 })).toBe("Element <rect> (number 2) has no id.");
    expect(faultText({ code: "unchanged" })).toBe("The answer changes nothing in the original; carry out the instruction.");
    const g = faultText({ code: "guard", problems: [guard] });
    expect(g).toMatch(/^The checker rejects the SVG: too-costly: this SVG would take too long to draw \(about 2 times/);
    expect(g).not.toMatch(/Bereiniger|Weichzeichner/);
  });
  it("deutsch: dieselben Ursachen", () => {
    initStrings("de");
    expect(faultText({ code: "no-svg" })).toBe("Die Antwort enthält kein <svg>…</svg>.");
    expect(faultText({ code: "guard", problems: [guard] })).toMatch(/^Der Bereiniger lehnt ab: too-costly: dieses SVG wäre zu aufwendig/);
  });
});
