import { describe, expect, it } from "vitest";
import { canonDocument } from "../../src/core/canon";
import { diffSvg, type DiffEntry } from "../../src/core/diff";
import { acceptText, addHandChange, addRound, applyRound, canRefine, decide, feedbackOf, refineBaseText, type SvgRound, type SvgSession } from "../../src/core/session";
import { EMPTY_ROUNDS, selectRound } from "../../src/vendor/kit/rounds";

const S = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>\n`;
const BASE = S(`  <circle id="mond" r="40"/>\n  <rect id="tuer" x="80"/>\n  <rect id="haus" x="1"/>`);

const open = (startText: string | null): SvgSession => ({
  target: startText === null ? { kind: "new" } : { kind: "file", path: "a.svg", label: "a" },
  rounds: EMPTY_ROUNDS,
  startText,
});
const ok = (r: SvgSession | { problem: string }): SvgSession => {
  if ("problem" in r) throw new Error(`erwartet Sitzung, bekam: ${r.problem}`);
  return r;
};
const problem = (r: SvgSession | { problem: string }): string => {
  if (!("problem" in r)) throw new Error("erwartet Problem");
  return r.problem;
};
const entriesOf = (base: string, answer: string): DiffEntry[] => {
  const d = diffSvg(base, answer);
  if (!d.decomposable) throw new Error(d.why);
  return d.entries;
};
/** Verfeinern-Runde aus einer Antwort. */
const prompt = (base: string, answer: string, basedOn: number | null = null, instruction = "x"): Omit<SvgRound, "result"> => ({
  art: "prompt", instruction, basedOn, body: { form: "list", entries: entriesOf(base, answer), decisions: [] },
});

describe("Rundenmodell: Erzeugen", () => {
  it("Wurzel create: acceptText liefert den Text der Runde, egal was jetzt dasteht", () => {
    const s = ok(addRound(open(null), { art: "create", instruction: "Mond", basedOn: null, body: { form: "whole", text: BASE, decision: "accepted" } }));
    expect(s.rounds.rounds[0].result).toBe(BASE);
    expect(acceptText(s, "<svg>was ganz anderes</svg>")).toEqual({ ok: true, text: BASE });
    expect(acceptText(s, null)).toEqual({ ok: true, text: BASE });
  });
});

describe("Rundenmodell: Verfeinern auf dem Bestand", () => {
  const answer = BASE.replace(`r="40"`, `r="60"`).replace(`x="80"`, `x="90"`);

  it("angenommene Einträge gehen auf den AKTUELLEN Text; eine Handänderung dazwischen bleibt (Review-Fokus 2)", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, answer)));
    const current = BASE.replace(`<rect id="haus" x="1"/>`, `<rect id="haus" x="1" fill="red"/>`);
    const r = acceptText(s, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain(`r="60"`);
    expect(r.text).toContain(`x="90"`);
    expect(r.text).toContain(`<rect id="haus" x="1" fill="red"/>`);
  });

  it("ein abgelehnter Eintrag wird nicht angewendet; refineBaseText ohne ihn", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, answer)));
    const i = (s.rounds.rounds[0].body as { entries: DiffEntry[] }).entries.findIndex((e) => e.kind === "attr" && e.key === "tuer");
    s = ok(decide(s, 0, i, { state: "rejected" }));
    const base = refineBaseText(s, BASE)!;
    expect(base).toContain(`r="60"`);
    expect(base).toContain(`x="80"`);
    const r = acceptText(s, BASE);
    expect(r.ok && r.text).toBe(base);
  });

  it("Vorgabe der Entscheidung: angenommen (E3)", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, answer)));
    const b = s.rounds.rounds[0].body;
    expect(b.form === "list" && b.decisions.map((d) => d.state)).toEqual(["accepted", "accepted"]);
  });

  it("ohne Runde: der Ausgang ist der aktuelle Text; mit neuem Ziel gibt es nichts zu verfeinern", () => {
    expect(refineBaseText(open(BASE), "aktuell")).toBe("aktuell");
    expect(refineBaseText(open(null), null)).toBeNull();
  });
});

describe("Rundenmodell: ganzes Bild", () => {
  it("abgelehnt → Text unverändert; angenommen → ganz ersetzt", () => {
    const neu = S(`  <circle id="sonne" r="9"/>`);
    const rej = ok(addRound(open(BASE), { art: "prompt", instruction: "x", basedOn: null, body: { form: "whole", text: neu, decision: "rejected" } }));
    expect(rej.rounds.rounds[0].result).toBe(BASE);
    expect(acceptText(rej, BASE)).toEqual({ ok: true, text: BASE });
    const acc = ok(decide(rej, 0, 0, { state: "accepted" }));
    expect(acc.rounds.rounds[0].result).toBe(neu);
    expect(acceptText(acc, BASE)).toEqual({ ok: true, text: neu });
  });
});

describe("Rundenmodell: Handänderungen", () => {
  it("sammeln sich in einer hand-Runde; die nächste Prompt-Runde schließt sie; Beschriftung 'Von Hand: …'", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="50"`))));
    s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "60" } }], "Von Hand"));
    expect(s.rounds.rounds).toHaveLength(2);
    s = ok(addHandChange(s, [{ op: "change", id: "tuer", attrs: { x: "85" } }], "Von Hand"));
    expect(s.rounds.rounds).toHaveLength(2);
    const hand = s.rounds.rounds[1];
    expect(hand.art).toBe("hand");
    expect(hand.instruction).toBe("Von Hand: mond r 60, tuer x 85");
    expect(hand.basedOn).toBe(0);
    expect(hand.result).toContain(`r="60"`);
    expect(hand.result).toContain(`x="85"`);
    // eine Prompt-Runde schließt die Handrunde
    s = ok(addRound(s, prompt(hand.result, hand.result.replace(`x="1"`, `x="2"`), 1)));
    expect(s.rounds.rounds).toHaveLength(3);
    s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "70" } }], "Von Hand"));
    expect(s.rounds.rounds).toHaveLength(4);
    expect(s.rounds.rounds[3].basedOn).toBe(2);
  });

  it("dasselbe Attribut zweimal geändert: ein Eintrag mit dem ersten Ausgangswert; zurück auf den Ausgangswert: kein Eintrag", () => {
    let s = ok(addHandChange(open(BASE), [{ op: "change", id: "mond", attrs: { r: "60" } }], "Von Hand"));
    s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "70" } }], "Von Hand"));
    const b = s.rounds.rounds[0].body;
    expect(b.form === "list" && b.entries).toHaveLength(1);
    expect(b.form === "list" && b.entries[0]).toMatchObject({ kind: "attr", from: "40", to: "70" });
    s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "40" } }], "Von Hand"));
    expect(s.rounds.rounds[0].body.form === "list" && s.rounds.rounds[0].body.entries).toHaveLength(0);
    expect(s.rounds.rounds[0].result).toBe(BASE);
  });

  it("Handänderung nach Rückwahl → neue hand-Runde mit basedOn der gewählten; spätere Runden bleiben wählbar", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="50"`))));
    s = ok(addRound(s, prompt(s.rounds.rounds[0].result, s.rounds.rounds[0].result.replace(`x="80"`, `x="81"`), 0)));
    s = { ...s, rounds: selectRound(s.rounds, 0) };
    s = ok(addHandChange(s, [{ op: "change", id: "haus", attrs: { x: "5" } }], "Von Hand"));
    expect(s.rounds.rounds).toHaveLength(3);
    expect(s.rounds.rounds[2]).toMatchObject({ art: "hand", basedOn: 0 });
    expect(s.rounds.active).toBe(2);
    expect(s.rounds.rounds[1].result).toContain(`x="81"`); // die später gewählte Runde bleibt erhalten
    expect(selectRound(s.rounds, 1).active).toBe(1);
  });

  it("ohne Text keine Handänderung", () => {
    expect(problem(addHandChange(open(null), [{ op: "change", id: "a", attrs: { x: "1" } }], "Von Hand"))).toContain("keinen Text");
  });
});

describe("Rundenmodell: Sperren und Brüche", () => {
  it("Entscheidung in einer Runde mit Nachfolger → Problem", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="50"`))));
    s = ok(addRound(s, prompt(s.rounds.rounds[0].result, s.rounds.rounds[0].result.replace(`x="80"`, `x="81"`), 0)));
    expect(problem(decide(s, 0, 0, { state: "rejected" }))).toContain("gesperrt");
    expect(decide(s, 1, 0, { state: "rejected" })).not.toHaveProperty("problem");
  });

  it("entferntes Element seither von Hand geändert → acceptText ok:false (Review-Fokus 2)", () => {
    const answer = BASE.replace(/  <rect id="tuer"[^\n]*\n/, "");
    const s = ok(addRound(open(BASE), prompt(BASE, answer)));
    expect(acceptText(s, BASE)).toMatchObject({ ok: true });
    const hand = BASE.replace(`x="80"`, `x="99"`);
    const r = acceptText(s, hand);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("hat sich seit der Runde geändert");
    expect(!r.ok && r.problem).toMatch(/^round 1: /);
  });

  it("Attribut seither von Hand geändert → nicht still überschrieben", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    const r = acceptText(s, BASE.replace(`r="40"`, `r="50"`));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("hat sich seit der Runde geändert");
  });

  it("das Element ist weg: acceptText ok:false mit Meldung statt Wurf", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    expect(acceptText(s, S(`  <rect id="haus" x="1"/>`)).ok).toBe(false);
  });

  it("kaputte Kette → Problem", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    expect(problem(addRound(s, prompt(BASE, BASE.replace(`r="40"`, `r="61"`), 5)))).toContain("Runde 6");
  });
});

describe("Rundenmodell: Regelrunden", () => {
  it("names-Runde wird beim Übernehmen auf dem aktuellen Text neu abgeleitet", () => {
    const start = S(`  <circle r="4"/>\n  <rect id="a"/>`);
    const s = ok(addRound(open(start), { art: "names", instruction: "Namen vergeben", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    expect(s.rounds.rounds[0].result).toContain(`id="circle-1"`);
    // zwischen Runde und Übernehmen kommt von Hand ein weiteres unbenanntes Element dazu
    const current = start.replace("</svg>", `  <path d="M0 0"/>\n</svg>`);
    const r = acceptText(s, current);
    expect(r.ok && r.text).toContain(`id="circle-1"`);
    expect(r.ok && r.text).toContain(`<path d="M0 0" id="path-1"/>`);
  });

  it("cleanup-Runde entfernt Editor-Angaben auf dem aktuellen Text", () => {
    const ink = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1"><rect id="a" inkscape:label="x"/></svg>`;
    const s = ok(addRound(open(ink), { art: "cleanup", instruction: "Editor-Angaben entfernen", basedOn: null, body: { form: "rule", rule: "strip-editor-metadata" } }));
    expect(s.rounds.rounds[0].result).toBe(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>`);
  });

  it("applyRound ohne Text scheitert mit Meldung", () => {
    const r = applyRound(null, { art: "names", instruction: "", basedOn: null, body: { form: "rule", rule: "assign-ids" }, result: "" });
    expect(r.ok).toBe(false);
  });
});

describe("canRefine und feedbackOf", () => {
  it("canRefine mit drei Elementen ohne id → { ok: false, unnamed: 3 } (Review-Fokus 5)", () => {
    expect(canRefine(S(`  <rect/>\n  <circle id="a"/>\n  <rect/>\n  <path d="M0 0"/>`))).toEqual({ ok: false, unnamed: 3 });
    expect(canRefine(BASE)).toEqual({ ok: true });
  });

  it("feedbackOf liefert abgelehnte und kommentierte Einträge", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`).replace(`x="80"`, `x="90"`))));
    s = ok(decide(s, 0, 0, { state: "rejected" }));
    s = ok(decide(s, 0, 1, { state: "accepted", comment: "gern kleiner" }));
    const label = (e: DiffEntry): string => (e.kind === "attr" ? `${e.key}.${e.attr}` : e.key);
    const f = feedbackOf(s.rounds.rounds[0], label);
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.decision).sort()).toEqual(["comment", "rejected"]);
    expect(f.find((x) => x.decision === "comment")).toMatchObject({ comment: "gern kleiner" });
  });
});

describe("Ergebnis stimmt mit der Antwort", () => {
  it("alle Einträge angenommen ergeben kanonisch die Antwort", () => {
    const answer = BASE.replace(`r="40"`, `r="60"`).replace(`<rect id="haus" x="1"/>`, `<rect id="haus" x="1"/>\n  <rect id="neu"/>`);
    const s = ok(addRound(open(BASE), prompt(BASE, answer)));
    expect(canonDocument(s.rounds.rounds[0].result)).toBe(canonDocument(answer));
  });
});
