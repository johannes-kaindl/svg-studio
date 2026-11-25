/**
 * Linearität der Funktionen, die SVG-Text von außen lesen (ReDoS-Konvention, CORE-TEST-26 (b)): der erschöpfende Fuzz `pruefeLinearFuzz` aus dem Kit-Testmodul.
 * Gemessen wird ein Quotient t(50 000)/t(10 000), keine Millisekunden.
 *
 * Geprüft sind die Lesewege auf dem Text einer Datei oder einer Modellantwort: `scanElements` (Elementliste), `buildCanonTree` (Kanon-Baum) und `applyChanges`
 * (eine Änderung auf beliebigem Text). Die festen Eingaben (n Kreise in einer Zeile) stehen in `changes.test.ts`; dieser Test ergänzt sie um alle Einheiten
 * bis drei Alphabet-Einträge. Die Gegenprobe (eine absichtlich quadratische Fassung wird rot) steht am Ende dieser Datei.
 */
import { describe, expect, it } from "vitest";
import { lastGeschuetzt, type LinearProbeSkipKontext } from "../vendor/kit/linear-probe";
import { scanElements } from "../../src/core/elements";
import { buildCanonTree } from "../../src/core/canon";
import { applyChanges } from "../../src/core/changes";

const FUZZ_MS = 180_000;

/** Befund als lesbarer Text, damit eine rote Zeile ohne Nachlesen verständlich ist (CORE-TEST-14). */
const befund = (r: { verdaechtig: ReadonlyArray<{ message: string }> }): string => r.verdaechtig.map((v) => v.message).join("\n");

/** Unter Last (über der Schwelle der Probe) wird der Test übersprungen statt rot (obsidian-kit 0.108.0, `lastGeschuetzt`); jeder andere Fehler läuft durch. */
function fuzz(ctx: LinearProbeSkipKontext, fn: (s: string) => unknown, alphabet: string[]): void {
  const f = lastGeschuetzt(ctx).pruefeLinearFuzz(fn, { alphabet, maxLaenge: 3 });
  expect(f.linear, befund(f)).toBe(true);
  expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
}

// Ganze Elemente als Einträge, damit Gruppe, Kommentar und Kreis schon bei zwei Einheiten zusammenkommen.
const ALPHABET = ["<g>", "</g>", '<circle id="a" r="1"/>', "<!--", '"', ">"];

describe("SVG-Text lesen", () => {
  it("scanElements: Fuzz über Gruppen, Kreis, Kommentar und Anführungszeichen", (ctx) => {
    fuzz(ctx, (s) => scanElements(`<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`), ALPHABET);
  }, FUZZ_MS);

  it("buildCanonTree: Fuzz über Gruppen, Kreis, Kommentar und Anführungszeichen", (ctx) => {
    fuzz(ctx, (s) => buildCanonTree(`<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`), ALPHABET);
  }, FUZZ_MS);

  it("applyChanges: Fuzz über Gruppen, Kreis, Kommentar und Anführungszeichen mit einer Änderung", (ctx) => {
    fuzz(ctx, (s) => applyChanges(`<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`, [{ op: "change", id: "a", attrs: { r: "2" } }]), ALPHABET);
  }, FUZZ_MS);
});

describe("Gegenprobe: der Fuzz kann rot werden (CORE-TEST-01)", () => {
  /** Absichtlich quadratisch: dieselbe Form wie `body.replace(/\n*$/, …)` auf dem SVG-Text. */
  const quadratisch = (s: string): string => s.replace(/\n*$/, "\n\n");

  it("pruefeLinearFuzz meldet die quadratische Form als Verdacht", (ctx) => {
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => quadratisch(`<svg>\n${s}\n</svg>`), { alphabet: ["\n", "x"], maxLaenge: 1, verschachtelt: false });
    expect(f.linear).toBe(false);
    expect(f.verdaechtig.map((v) => v.einheit)).toContain("\n");
  }, FUZZ_MS);
});
