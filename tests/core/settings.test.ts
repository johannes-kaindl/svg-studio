import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../../src/core/settings";

describe("loadSettings", () => {
  it("Vorgaben: Übernehmen als Datei, Hintergrund an und hell", () => {
    const { settings, dropped } = loadSettings(undefined);
    expect(settings.acceptAs).toBe("file");
    expect(settings.background).toEqual({ on: true, shade: "light", hex: null });
    expect(dropped).toEqual([]);
    expect(loadSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings("Müll").settings).toEqual(DEFAULT_SETTINGS);
  });

  it("unbekannte Schlüssel stehen in dropped und gehen nicht ins Ergebnis", () => {
    const { settings, dropped } = loadSettings({ acceptAs: "block", altlast: 1, x: { y: 2 } });
    expect(settings.acceptAs).toBe("block");
    expect(dropped.sort()).toEqual(["altlast", "x"]);
    expect(settings).not.toHaveProperty("altlast");
  });

  it("ungültige Werte fallen auf die Vorgabe, melden sich aber", () => {
    const { settings, dropped } = loadSettings({ acceptAs: "überall", background: { on: "ja", shade: "bunt", hex: "rot" } });
    expect(settings.acceptAs).toBe("file");
    expect(settings.background).toEqual({ on: true, shade: "light", hex: null });
    expect(dropped.sort()).toEqual(["acceptAs", "background.hex"]);
  });

  it("gültige Werte bleiben, auch der eigene Hex-Wert", () => {
    const { settings } = loadSettings({ acceptAs: "ask", background: { on: false, shade: "dark", hex: "#abc" } });
    expect(settings.acceptAs).toBe("ask");
    expect(settings.background).toEqual({ on: false, shade: "dark", hex: "#abc" });
    expect(loadSettings({ background: { hex: "#A1B2C3" } }).settings.background.hex).toBe("#A1B2C3");
    expect(loadSettings({ background: { hex: "#12345" } }).settings.background.hex).toBeNull();
  });

  it("llm: Wahl und Anfrage werden gelesen, Müll fällt weg", () => {
    expect(loadSettings({ llm: { choice: { endpoint: "e1", model: "m" }, request: { a: 1 } } }).settings.llm).toEqual({ choice: { endpoint: "e1", model: "m" }, request: { a: 1 } });
    expect(loadSettings({ llm: { choice: { endpoint: 5, model: 6 }, request: [] } }).settings.llm).toEqual({ choice: { endpoint: null, model: "" }, request: {} });
  });

  it("verändert die Vorgaben nicht", () => {
    const a = loadSettings({}).settings;
    a.background.on = false;
    expect(DEFAULT_SETTINGS.background.on).toBe(true);
    expect(loadSettings({}).settings.background.on).toBe(true);
  });
});
