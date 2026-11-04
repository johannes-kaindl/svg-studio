// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/core/changes";
import { stripEditorMetadata } from "../../src/core/editor-metadata";
import { scanElements } from "../../src/core/elements";
import { checkSvg } from "../../src/vendor/kit/svg-guard";

const PROBE = readFileSync(join(process.cwd(), "tests", "fixtures", "inkscape-probe.svg"), "utf8");

describe("stripEditorMetadata", () => {
  it("Inkscape-Bestand: remove für namedview und metadata (per id), null für sodipodi:- und inkscape:-Attribute und ihre xmlns-Deklarationen", () => {
    const r = stripEditorMetadata(PROBE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const removes = r.changes.filter((c) => c.op === "remove").map((c) => (c as { id: string }).id).sort();
    expect(removes).toEqual(["metadata1", "namedview1"]);
    const changed = new Map(r.changes.flatMap((c) => (c.op === "change" ? [[c.id, c.attrs] as const] : [])));
    expect(Object.keys(changed.get("#wurzel") ?? {}).sort()).toEqual(
      ["inkscape:version", "sodipodi:docname", "xmlns:cc", "xmlns:dc", "xmlns:inkscape", "xmlns:rdf", "xmlns:sodipodi"].sort(),
    );
    expect(Object.values(changed.get("#wurzel") ?? {}).every((v) => v === null)).toBe(true);
    expect(Object.keys(changed.get("ebene1") ?? {}).sort()).toEqual(["inkscape:groupmode", "inkscape:label"]);
    expect(Object.keys(changed.get("mond") ?? {})).toEqual(["sodipodi:nodetypes"]);
  });

  it("das Ergebnis von applyChanges besteht checkSvg und trägt kein Editor-Zeichen mehr", () => {
    expect(checkSvg(PROBE).ok).toBe(false); // Ausgangslage: der Bereiniger lehnt den Bestand ab
    const r = stripEditorMetadata(PROBE);
    if (!r.ok) throw new Error(r.problem);
    const out = applyChanges(PROBE, r.changes);
    expect(out.ok, out.ok ? "" : out.problems.join("; ")).toBe(true);
    if (!out.ok) return;
    expect(checkSvg(out.text).ok, JSON.stringify(checkSvg(out.text))).toBe(true);
    expect(out.text).not.toMatch(/sodipodi|inkscape|rdf:|cc:|dc:/);
    // Was nicht Editor-Angabe war, bleibt.
    expect(out.text).toContain(`<circle id="mond" cx="50" cy="50" r="40" fill="#fff"/>`);
    expect(out.text).toContain(`<g id="ebene1">`);
    expect(scanElements(out.text).issues).toEqual([]);
  });

  it("ein Bild ohne Editor-Angaben ergibt keine Änderungen", () => {
    expect(stripEditorMetadata(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>`)).toEqual({ ok: true, changes: [] });
  });

  it("Zielelement ohne id → ok:false 'erst Namen vergeben'", () => {
    const t = PROBE.replace(`<sodipodi:namedview id="namedview1"`, `<sodipodi:namedview`);
    const r = stripEditorMetadata(t);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("Namen vergeben");
  });

  it("ein Präfix, das noch gebraucht wird, behält seine Deklaration", () => {
    const t = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1"><title id="t1">x</title><desc id="d1" dc:foo="1">y</desc></svg>`;
    const r = stripEditorMetadata(t);
    if (!r.ok) throw new Error(r.problem);
    const root = r.changes.find((c) => c.op === "change" && c.id === "#wurzel") as { attrs: Record<string, string | null> };
    expect(Object.keys(root.attrs).sort()).toEqual(["inkscape:version", "xmlns:inkscape"]);
  });

  it("Syntaxfehler im Text → ok:false", () => {
    expect(stripEditorMetadata(`<svg><rect></svg>`).ok).toBe(false);
  });
});
