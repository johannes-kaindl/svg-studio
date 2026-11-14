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
    // Eine Konstante, die eine andere einsetzt (`${COPY_BUTTON_CSS}` in STREAM_AREA_CSS), steht in styles.css ohne die Einsetzung; die eingesetzte steht als eigener Block
    // (der Wächter des Kits prüft den Rohtext und würde ein `${…}` im Stylesheet verlangen, das dort kein CSS ist: Scorecard 0.1.3 „Unknown word COPY_BUTTON_CSS“).
    const vendored = findVendoredCss("src/vendor/kit-obsidian");
    const missing = missingKitCss("src/vendor/kit-obsidian", css).filter((n) => {
      const c = vendored.find((v) => v.name === n)!.css;
      return !(/\$\{[A-Z0-9_]+\}/.test(c) && css.includes(c.replace(/\$\{[A-Z0-9_]+\}/g, "")));
    });
    expect(missing).toEqual([]);
  });
  it("kein Platzhalter `${…}` im Stylesheet (ungültiges CSS, die Scorecard meldet „Unknown word“)", () => {
    expect(css).not.toMatch(/\$\{/);
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
  it("das Panel gibt am Handy unten Platz in Höhe der offenen Tastatur (Zahlentastatur ohne Fertig-Taste, Messung iPhone 2026-11-05)", () => {
    const rule = own.replace(/\/\*[\s\S]*?\*\//g, "").match(/([^{}]*\.svg-studio-panel[^{}]*)\{([^}]*padding-bottom[^}]*)\}/g)?.find((r) => /\.is-mobile/.test(r));
    expect(rule, "Regel .is-mobile … .svg-studio-panel mit padding-bottom").toBeDefined();
    expect(rule).toMatch(/padding-bottom:\s*max\(var\(--size-4-8\),\s*var\(--keyboard-height,\s*0px\)\)/);
    // Obsidians eigene Regel (.workspace-leaf-content .view-content) trägt zwei Klassen, die Panel-Regel braucht mehr, sonst entscheidet die Reihenfolge der Stylesheets.
    const selector = rule!.slice(0, rule!.indexOf("{")).trim();
    expect(selector.match(/\.[\w-]+/g)!.length).toBeGreaterThan(2);
  });
  it("die Knöpfe an Block und Einbettung sind am Handy mindestens 44 × 44 (40 + 4 aus Theme-Größen, Plan M2)", () => {
    const rule = own.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.is-mobile \.svg-studio-block > \.svg-studio-edit,\s*\.is-mobile \.internal-embed > \.svg-studio-embed-button\s*\{([^}]*)\}/);
    expect(rule, "Regel für Block- und Einbettungsknopf unter .is-mobile").not.toBeNull();
    const body = rule![1]!;
    expect(body).toMatch(/min-width:\s*calc\(var\(--size-4-10\)\s*\+\s*var\(--size-4-1\)\)/);
    expect(body).toMatch(/min-height:\s*calc\(var\(--size-4-10\)\s*\+\s*var\(--size-4-1\)\)/);
  });
});
