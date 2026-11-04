import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../../src/core/settings";

describe("loadSettings", () => {
  it("Vorgaben: Übernehmen als Datei, Hintergrund an und hell", () => {
    const { settings, dropped } = loadSettings(undefined);
    expect(settings.acceptAs).toBe("file");
    expect(settings.background).toEqual({ on: true, tone: "light", hex: "#ffffff" });
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
    const { settings, dropped } = loadSettings({ acceptAs: "überall", background: { on: "ja", tone: "bunt", hex: "rot" } });
    expect(settings.acceptAs).toBe("file");
    expect(settings.background).toEqual({ on: true, tone: "light", hex: "#ffffff" });
    expect(dropped.sort()).toEqual(["acceptAs", "background.hex"]);
  });

  it("gültige Werte bleiben, auch der eigene Hex-Wert", () => {
    const { settings } = loadSettings({ acceptAs: "ask", background: { on: false, tone: "custom", hex: "#abc" } });
    expect(settings.acceptAs).toBe("ask");
    expect(settings.background).toEqual({ on: false, tone: "custom", hex: "#abc" });
    expect(loadSettings({ background: { hex: "#A1B2C3" } }).settings.background.hex).toBe("#A1B2C3");
    expect(loadSettings({ background: { hex: "#12345" } }).settings.background.hex).toBe("#ffffff");
  });

  it("llm: Zeilen, Wahl und Anfrage werden gelesen", () => {
    const { settings, dropped } = loadSettings({
      llm: {
        endpoints: [{ url: "http://127.0.0.1:1234/v1", model: "qwen/qwen3.8-27b", id: "a" }, "http://localhost:11434"],
        choice: { endpointId: "e1", model: "m" },
        request: { thinking: { transform: "high" } },
      },
    });
    expect(settings.llm.endpoints.map((e) => e.url)).toEqual(["http://127.0.0.1:1234/v1", "http://localhost:11434"]);
    expect(settings.llm.choice).toEqual({ endpointId: "e1", model: "m" });
    expect(settings.llm.request.thinking.transform).toBe("high");
    expect(dropped).toEqual([]);
  });

  it("llm: Müll fällt weg, ohne zu werfen, und meldet sich", () => {
    const { settings, dropped } = loadSettings({ llm: { endpoints: [5, null, { url: 7 }, { model: "x" }], choice: { endpointId: 5, model: 6 }, request: [], alt: 1 } });
    expect(settings.llm.endpoints).toEqual([]);
    expect(settings.llm.choice).toEqual({});
    expect(settings.llm.request).toEqual(DEFAULT_SETTINGS.llm.request);
    expect(dropped).toContain("llm.alt");
  });

  it("llm: Schlüssel gehören nicht in die Daten, der Klartext-Schlüssel einer Zeile wird vom Kit migriert, nicht verdoppelt", () => {
    const { settings } = loadSettings({ llm: { endpoints: [{ url: "http://x/v1", apiKey: "geheim" }] } });
    expect(settings.llm.endpoints).toHaveLength(1);
    expect(settings.llm.endpoints[0]!.url).toBe("http://x/v1");
  });

  it("verändert die Vorgaben nicht", () => {
    const a = loadSettings({}).settings;
    a.background.on = false;
    expect(DEFAULT_SETTINGS.background.on).toBe(true);
    expect(loadSettings({}).settings.background.on).toBe(true);
  });
});
