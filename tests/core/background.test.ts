import { describe, expect, it } from "vitest";
import { backgroundColor, DEFAULT_BACKGROUND, sanitizeBackground } from "../../src/core/background";

describe("sanitizeBackground", () => {
  it("Vorgabe: an, hell, weiß", () => {
    expect(sanitizeBackground(undefined)).toEqual({ on: true, tone: "light", hex: "#ffffff" });
    expect(sanitizeBackground(null)).toEqual(DEFAULT_BACKGROUND);
    expect(sanitizeBackground("Müll")).toEqual(DEFAULT_BACKGROUND);
    expect(sanitizeBackground([])).toEqual(DEFAULT_BACKGROUND);
  });

  it("gültige Werte bleiben", () => {
    expect(sanitizeBackground({ on: false, tone: "dark", hex: "#abc" })).toEqual({ on: false, tone: "dark", hex: "#abc" });
    expect(sanitizeBackground({ on: true, tone: "custom", hex: "#A1B2C3" })).toEqual({ on: true, tone: "custom", hex: "#A1B2C3" });
  });

  it("ungültiges Hex fällt auf die Vorgabe, die übrigen Felder bleiben", () => {
    for (const hex of ["rot", "#12345", "#1234567", "#ggg", "abc", "", 5, null, "#abc\n", " #abc"]) {
      expect(sanitizeBackground({ on: false, tone: "custom", hex }).hex, String(hex)).toBe("#ffffff");
    }
    expect(sanitizeBackground({ on: false, tone: "custom", hex: "rot" })).toEqual({ on: false, tone: "custom", hex: "#ffffff" });
  });

  it("ungültiger Ton und ungültiger Schalter fallen auf die Vorgabe", () => {
    expect(sanitizeBackground({ on: "ja", tone: "bunt", hex: "#000" })).toEqual({ on: true, tone: "light", hex: "#000" });
    expect(sanitizeBackground({ tone: "constructor" }).tone).toBe("light");
  });

  it("liefert eine Kopie, die Vorgabe bleibt unverändert", () => {
    const a = sanitizeBackground({});
    a.on = false;
    a.hex = "#000";
    expect(sanitizeBackground({})).toEqual({ on: true, tone: "light", hex: "#ffffff" });
    expect(DEFAULT_BACKGROUND).toEqual({ on: true, tone: "light", hex: "#ffffff" });
  });
});

describe("backgroundColor", () => {
  it("aus → null, auch bei eigenem Ton", () => {
    expect(backgroundColor({ on: false, tone: "light", hex: "#ffffff" })).toBeNull();
    expect(backgroundColor({ on: false, tone: "custom", hex: "#123456" })).toBeNull();
  });

  it("hell und dunkel sind feste Werte, der Hex-Wert zählt dann nicht", () => {
    expect(backgroundColor({ on: true, tone: "light", hex: "#123456" })).toBe("#ffffff");
    expect(backgroundColor({ on: true, tone: "dark", hex: "#123456" })).toBe("#1e1e1e");
  });

  it("eigen: gültiges #rgb und #rrggbb", () => {
    expect(backgroundColor({ on: true, tone: "custom", hex: "#abc" })).toBe("#abc");
    expect(backgroundColor({ on: true, tone: "custom", hex: "#A1B2C3" })).toBe("#A1B2C3");
  });

  it("eigen mit ungültigem Wert (von Hand gebaut) nimmt nie Text ins CSS: Vorgabe", () => {
    expect(backgroundColor({ on: true, tone: "custom", hex: "red; background:url(x)" })).toBe("#ffffff");
  });
});
