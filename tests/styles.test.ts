import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

const css = readFileSync("styles.css", "utf8");
// Kit-Vertrag: vendort wird das Verhalten, die Darstellung (`*_CSS`) ist eine Kopie in styles.css.
describe("Kit-CSS in styles.css", () => {
  it("der Wächter findet vendorte Konstanten", () => {
    expect(findVendoredCss("src/vendor/kit-obsidian").length).toBeGreaterThan(0);
  });
  it("jede steht wortgleich in styles.css", () => {
    expect(missingKitCss("src/vendor/kit-obsidian", css)).toEqual([]);
  });
});

// Eigene Klassen: nur Theme-Variablen (kein fester Farbwert, UI-STANDARD).
describe("eigene Regeln", () => {
  const own = css.slice(css.indexOf("/* ── SVG Studio"));
  it("kein fester Farbwert", () => {
    expect(own.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)).toBeNull();
  });
  it("alle Selektoren tragen die Namensräume des Plugins oder der Einbettung", () => {
    const selectors = [...own.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
    for (const s of selectors) expect(s, s).toMatch(/svg-studio|\.internal-embed|\.is-mobile/);
  });
  it("die Knöpfe sind auf Touch-Geräten sichtbar", () => {
    expect(own).toMatch(/\.is-mobile \.svg-studio-block > \.svg-studio-edit[\s\S]*?opacity:\s*1/);
  });
  it("die Knöpfe an Block und Einbettung sind am Handy mindestens 44 × 44 (40 + 4 aus Theme-Größen, Plan M2)", () => {
    const rule = own.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.is-mobile \.svg-studio-block > \.svg-studio-edit,\s*\.is-mobile \.internal-embed > \.svg-studio-embed-button\s*\{([^}]*)\}/);
    expect(rule, "Regel für Block- und Einbettungsknopf unter .is-mobile").not.toBeNull();
    const body = rule![1]!;
    expect(body).toMatch(/min-width:\s*calc\(var\(--size-4-10\)\s*\+\s*var\(--size-4-1\)\)/);
    expect(body).toMatch(/min-height:\s*calc\(var\(--size-4-10\)\s*\+\s*var\(--size-4-1\)\)/);
  });
});
