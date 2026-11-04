import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCreateMessages, buildRefineMessages, buildRepairMessages, CREATE_SYSTEM, extractSvg, hasRealMeasures, promptFingerprint,
  REFINE_SYSTEM, RETRY_INSTRUCTION, validateCreate, validateRefine, validateRepair, type GuardFn,
} from "../../src/core/protocol";

// So setzt `loadSystem` in scripts/svg-lab.ts die Prompts der Messung zusammen.
function labSystem(): { create: string; refine: string } {
  const md = readFileSync(new URL("../../scripts/lab/system-prompt.md", import.meta.url), "utf8");
  const sec = new Map<string, string>();
  const parts = md.split(/^## (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) sec.set(parts[i].trim(), parts[i + 1].trim());
  const common = sec.get("Gemeinsam")!;
  return { create: `${common}\n\n${sec.get("Erzeugen")!}`, refine: `${common}\n\n${sec.get("Verfeinern (vollständiges SVG)")!}` };
}

const okGuard: GuardFn = () => ({ ok: true });
const badGuard: GuardFn = () => ({ ok: false, problems: [{ code: "style-comment", detail: "Kommentar in <style>" }, { code: "element", detail: "<a> nicht erlaubt" }] });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="mond" r="4"/></svg>`;

describe("Prompts der Messung", () => {
  it("CREATE_SYSTEM und REFINE_SYSTEM sind wortgleich mit dem gemessenen Prompt", () => {
    const lab = labSystem();
    expect(CREATE_SYSTEM).toBe(lab.create);
    expect(REFINE_SYSTEM).toBe(lab.refine);
  });

  // Ändert sich einer dieser Werte, ist es ein anderer Prompt als der gemessene: neue Messung, neue Tabellenzeilen (Plan 2, Entscheidung 4 und 5).
  it("Fingerabdruck ist gepinnt", () => {
    expect(promptFingerprint("create")).toBe("0fa92f19b3be7c3c");
    expect(promptFingerprint("refine")).toBe("a3d4d0cbf132cce9");
    expect(promptFingerprint("create")).not.toBe(promptFingerprint("refine"));
  });

  it("Erzeugen: System und Beschreibung", () => {
    expect(buildCreateMessages("Ein Mond")).toEqual([{ role: "system", content: CREATE_SYSTEM }, { role: "user", content: "Ein Mond" }]);
  });

  it("Verfeinern ohne Rückmeldung entspricht der gemessenen Vorlage", () => {
    expect(buildRefineMessages(SVG, "Mach ihn rot")).toEqual([
      { role: "system", content: REFINE_SYSTEM },
      { role: "user", content: `Ausgangs-SVG:\n\n${SVG}\n\nAnweisung: Mach ihn rot` },
    ]);
    expect(buildRefineMessages(SVG, "x", [])[1].content).toBe(buildRefineMessages(SVG, "x")[1].content);
  });

  it("Verfeinern mit Rückmeldung hängt genau den Block an", () => {
    const base = buildRefineMessages(SVG, "x")[1].content;
    const m = buildRefineMessages(SVG, "x", [
      { label: "mond.r", decision: "rejected" },
      { label: "tuer", decision: "comment", comment: "kleiner" },
    ]);
    expect(m[1].content).toBe(`${base}\n\nRückmeldung zur letzten Runde:\n- mond.r: abgelehnt\n- tuer: kleiner`);
  });

  it("Reparatur am Bestand: System REFINE_SYSTEM, Problem und Rückfrage-Anweisung", () => {
    expect(buildRepairMessages("<svg>", "nicht wohlgeformt")).toEqual([
      { role: "system", content: REFINE_SYSTEM },
      { role: "user", content: `Ausgangs-SVG:\n\n<svg>\n\nAnweisung: Das SVG ist fehlerhaft: nicht wohlgeformt\n${RETRY_INSTRUCTION}` },
    ]);
  });

  it("RETRY_INSTRUCTION nennt die Regeln, die Modelle brechen", () => {
    for (const w of ["<style>", "<a>", "<image>", "Backslashes", "sodipodi:", "inkscape:", "id"]) expect(RETRY_INSTRUCTION).toContain(w);
  });
});

describe("extractSvg", () => {
  it("nimmt von <svg bis zum letzten </svg>, auch aus Zaun und Prosa", () => {
    expect(extractSvg(SVG)).toBe(SVG);
    expect(extractSvg(`Hier ist es:\n\`\`\`svg\n${SVG}\n\`\`\`\nViel Spaß!`)).toBe(SVG);
    expect(extractSvg(`<?xml version="1.0"?>\n${SVG}\n`)).toBe(SVG);
  });
  it("Denken fällt weg", () => {
    expect(extractSvg(`<think>vielleicht <svg></svg>?</think>\n${SVG}`)).toBe(SVG);
  });
  it("ein nie geschlossenes <think> verschluckt den Rest: nichts", () => {
    expect(extractSvg(`<think>ich überlege ${SVG}`)).toBeNull();
  });
  it("ein loses </think> schneidet alles davor weg", () => {
    expect(extractSvg(`Gedanke <svg></svg></think>\n${SVG}`)).toBe(SVG);
  });
  it("ohne <svg>…</svg> null", () => {
    expect(extractSvg("kein Bild")).toBeNull();
    expect(extractSvg("<svg>")).toBeNull();
  });
});

describe("hasRealMeasures", () => {
  it.each([
    ["Raum 420 × 385 cm", true], ["Icon 24 × 24", false], ["3 m breit", true], ["Ein Tisch, 1,5 m lang", true], ["5 Minuten", false],
    ["Wand 12 mm dick", true], ["Fläche 20 m²", true], ["2 Meter hoch", true], ["Mond als Sichel", false],
  ])("%s → %s", (prompt, want) => expect(hasRealMeasures(prompt)).toBe(want));
});

describe("validateCreate", () => {
  const o = (guard: GuardFn, prompt = "Ein Mond"): { guard: GuardFn; prompt: string } => ({ guard, prompt });
  const problem = (raw: string, g: GuardFn = okGuard): string => {
    const v = validateCreate(raw, o(g));
    if (v.ok) throw new Error("erwartet Problem");
    return v.problem;
  };
  it("ohne <svg> → Problem", () => expect(problem("nur Text")).toBe("Die Antwort enthält kein <svg>…</svg>."));
  it("Syntaxbefund → Problem mit Meldung und Offset", () => {
    expect(problem(`<svg><rect id="a"></svg>`)).toMatch(/^Das SVG ist nicht wohlgeformt: .+ \(Offset \d+\)\.$/);
  });
  it("Bereiniger-Problem → alle Gründe", () => {
    expect(problem(SVG, badGuard)).toBe("Der Bereiniger lehnt ab: style-comment: Kommentar in <style>; element: <a> nicht erlaubt.");
  });
  it("gültig → ids vergeben, data-unit nur mit Maßen", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1"/><circle id="mond" r="4"/></svg>`;
    const v = validateCreate(raw, o(okGuard, "Ein Raum, 4 m breit"));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.assignedIds).toEqual(["rect-1"]);
    expect(v.value.svg).toContain(`<rect x="1" id="rect-1"/>`);
    expect(v.value.svg).toContain(`data-unit="cm"`);
    const w = validateCreate(raw, o(okGuard, "Ein Mond"));
    expect(w.ok && w.value.svg.includes("data-unit")).toBe(false);
  });
});

describe("validateRefine", () => {
  const BASE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="mond" r="4"/></svg>`;
  const o = { guard: okGuard, base: BASE };
  it("neues Element ohne id → Problem nennt das Tag", () => {
    const v = validateRefine(BASE.replace("</svg>", `<rect x="1"/></svg>`), o);
    expect(!v.ok && v.problem).toBe("Element <rect> (Nummer 3) hat keine id.");
  });
  it("style, title und desc brauchen keine id", () => {
    const v = validateRefine(BASE.replace("</svg>", `<style>.a{}</style><title>T</title></svg>`), o);
    expect(v.ok).toBe(true);
  });
  it("identisch → 'ändert nichts'", () => {
    const v = validateRefine(`\n${BASE.replace("<circle", "\n  <circle")}`, o);
    expect(!v.ok && v.problem).toBe("Die Antwort ändert nichts am Ausgang; setze die Anweisung um.");
  });
  it("zerlegbar → ok mit Diff", () => {
    const v = validateRefine(BASE.replace(`r="4"`, `r="6"`), o);
    expect(v.ok && v.value.diff.decomposable).toBe(true);
    expect(v.ok && v.value.svg).toBe(BASE.replace(`r="4"`, `r="6"`));
  });
  it("nicht zerlegbar bleibt ok mit decomposable false", () => {
    const base = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="d" x="1"/><rect id="d" x="2"/></svg>`;
    const v = validateRefine(base.replace(`x="1"`, `x="5"`), { guard: okGuard, base });
    expect(v.ok).toBe(true);
    expect(v.ok && v.value.diff.decomposable).toBe(false);
  });
  it("Bereiniger und Syntax wie beim Erzeugen", () => {
    expect(validateRefine(SVG, { guard: badGuard, base: BASE }).ok).toBe(false);
    expect(validateRefine("nichts", o)).toEqual({ ok: false, problem: "Die Antwort enthält kein <svg>…</svg>." });
  });
});

describe("validateRepair", () => {
  it("unlesbarer Ausgang → ok mit nicht zerlegbarem Diff", () => {
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"></svg>`;
    const v = validateRepair(SVG, { guard: okGuard, base: broken });
    expect(v.ok).toBe(true);
    expect(v.ok && v.value.diff).toEqual({ decomposable: false, why: "Ausgang nicht lesbar" });
  });
});
