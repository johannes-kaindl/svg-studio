import { describe, expect, it } from "vitest";
import { measureCanvas } from "../../src/core/measure";

describe("measureCanvas", () => {
  it("liest viewBox und data-unit", () => {
    expect(measureCanvas(`<svg viewBox="0 0 460 425" data-unit="cm"></svg>`)).toEqual({
      width: 460,
      height: 425,
      unit: "cm",
      source: "viewBox",
    });
  });

  it("fällt auf width/height zurück", () => {
    expect(measureCanvas(`<svg width="120" height="80"/>`)).toEqual({
      width: 120,
      height: 80,
      unit: null,
      source: "size",
    });
  });

  it("viewBox hat Vorrang vor width/height", () => {
    const c = measureCanvas(`<svg width="1" height="2" viewBox="0 0 30 40"/>`);
    expect(c).toMatchObject({ width: 30, height: 40, source: "viewBox" });
  });

  it("akzeptiert Kommas und Dezimalzahlen", () => {
    expect(measureCanvas(`<svg viewBox="0,0,10,20"/>`)).toMatchObject({ width: 10, height: 20 });
    expect(measureCanvas(`<svg viewBox="-5 -5 10.5 2e1"/>`)).toMatchObject({ width: 10.5, height: 20 });
  });

  it("ignoriert kaputte viewBox und nimmt die Größe", () => {
    expect(measureCanvas(`<svg viewBox="0 0 x 5" width="7" height="9"/>`)).toMatchObject({ width: 7, height: 9, source: "size" });
    expect(measureCanvas(`<svg viewBox="0 0 0 5" width="7" height="9"/>`)).toMatchObject({ source: "size" });
  });

  it("liest Einheiten-Suffix bei width/height", () => {
    expect(measureCanvas(`<svg width="10cm" height="5cm"/>`)).toMatchObject({ width: 10, height: 5, unit: "cm" });
    expect(measureCanvas(`<svg width="10px" height="5px"/>`)).toMatchObject({ unit: null });
    expect(measureCanvas(`<svg width="50%" height="5"/>`)).toBeNull();
  });

  it("liefert null ohne SVG oder Maße", () => {
    expect(measureCanvas(`<div>kein svg</div>`)).toBeNull();
    expect(measureCanvas(``)).toBeNull();
    expect(measureCanvas(`<svg></svg>`)).toBeNull();
  });
});
