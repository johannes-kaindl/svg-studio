import { describe, expect, it } from "vitest";
import { canonDocument } from "../../src/core/canon";
import { scanElements } from "../../src/core/elements";
import { fieldChange } from "../../src/core/fields";
import { diffSvg, type DiffEntry } from "../../src/core/diff";
import type { Problem } from "../../src/core/problem";
import { acceptText, addHandChange, addRound, applyRound, canRefine, decide, feedbackOf, refineBaseText, type SvgRound, type SvgSession } from "../../src/core/session";
import { EMPTY_ROUNDS, selectRound } from "../../src/vendor/kit/rounds";

const S = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>\n`;
const BASE = S(`  <circle id="mond" r="40"/>\n  <rect id="tuer" x="80"/>\n  <rect id="haus" x="1"/>`);

const open = (startText: string | null): SvgSession => ({
  target: startText === null ? { kind: "new" } : { kind: "file", path: "a.svg", label: "a" },
  rounds: EMPTY_ROUNDS,
  startText,
});
const ok = (r: SvgSession | { problem: Problem }): SvgSession => {
  if ("problem" in r) throw new Error(`erwartet Sitzung, bekam: ${r.problem.code}`);
  return r;
};
const problem = (r: SvgSession | { problem: Problem }): Problem => {
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

  describe("Text ersetzen (remove mit expect plus add) und weitere Handänderungen am selben Element", () => {
    const T = S(`  <circle id="mond" r="40"/>\n  <text id="titel" x="1">Hallo</text>`);
    const fields = (t: string, field: string, input: string) => {
      const el = scanElements(t).elements.find((e) => e.id === "titel")!;
      const r = fieldChange(el, t, field, input, { lang: "de" });
      if (!r.ok) throw new Error(r.problem.code);
      return r.changes;
    };

    it("ein Text ist EIN Eintrag der Art replace, beschriftet mit dem Schlüssel", () => {
      const s = ok(addHandChange(open(T), fields(T, "text", "Welt"), "Von Hand"));
      const r = s.rounds.rounds[0];
      expect(r.instruction).toBe("Von Hand: titel");
      expect(r.body.form === "list" && r.body.entries).toMatchObject([{ kind: "replace", key: "titel", tag: "text", reason: "text" }]);
      expect(r.result).toBe(T.replace("Hallo", "Welt"));
    });

    it("Text zweimal geändert: ein Eintrag, das Entfernen gilt dem Ausgang, der Inhalt dem letzten Stand", () => {
      let s = ok(addHandChange(open(T), fields(T, "text", "Welt"), "Von Hand"));
      s = ok(addHandChange(s, fields(s.rounds.rounds[0].result, "text", "Mond"), "Von Hand"));
      const b = s.rounds.rounds[0].body;
      expect(b.form === "list" && b.entries).toHaveLength(1);
      expect(s.rounds.rounds[0].result).toBe(T.replace("Hallo", "Mond"));
      expect(acceptText(s, T)).toEqual({ ok: true, text: T.replace("Hallo", "Mond") });
    });

    it("Text, dann ein Attribut desselben Elements, dann wieder Text: ein Eintrag, alles im Ergebnis", () => {
      let s = ok(addHandChange(open(T), fields(T, "text", "Welt"), "Von Hand"));
      s = ok(addHandChange(s, fields(s.rounds.rounds[0].result, "x", "9"), "Von Hand"));
      let b = s.rounds.rounds[0].body;
      expect(b.form === "list" && b.entries).toHaveLength(1);
      expect(s.rounds.rounds[0].result).toBe(T.replace("Hallo", "Welt").replace(`x="1"`, `x="9"`));
      s = ok(addHandChange(s, fields(s.rounds.rounds[0].result, "text", "Neu"), "Von Hand"));
      b = s.rounds.rounds[0].body;
      expect(b.form === "list" && b.entries).toHaveLength(1);
      expect(s.rounds.rounds[0].result).toBe(T.replace("Hallo", "Neu").replace(`x="1"`, `x="9"`));
      expect(acceptText(s, T)).toMatchObject({ ok: true, text: s.rounds.rounds[0].result });
    });

    it("erst ein Attribut, dann der Text desselben Elements: ein Eintrag, das Entfernen gilt dem Ausgang", () => {
      let s = ok(addHandChange(open(T), fields(T, "x", "9"), "Von Hand"));
      s = ok(addHandChange(s, fields(s.rounds.rounds[0].result, "text", "Welt"), "Von Hand"));
      const b = s.rounds.rounds[0].body;
      expect(b.form === "list" && b.entries).toHaveLength(1);
      expect(s.rounds.rounds[0].result).toBe(T.replace("Hallo", "Welt").replace(`x="1"`, `x="9"`));
    });

    it("ein anderes Element dazwischen bleibt eigener Eintrag; ablehnen des Ersetzens lässt den Rest", () => {
      let s = ok(addHandChange(open(T), fields(T, "text", "Welt"), "Von Hand"));
      s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "9" } }], "Von Hand"));
      const b = s.rounds.rounds[0].body;
      expect(b.form === "list" && b.entries).toHaveLength(2);
      const rejected = ok(decide(s, 0, 0, { state: "rejected" }));
      expect(rejected.rounds.rounds[0].result).toBe(T.replace(`r="40"`, `r="9"`));
    });
  });

  it("ohne Text keine Handänderung", () => {
    expect(problem(addHandChange(open(null), [{ op: "change", id: "a", attrs: { x: "1" } }], "Von Hand"))).toMatchObject({ code: "hand-no-text", params: [] });
  });
});

describe("Rundenmodell: Sperren und Brüche", () => {
  it("Entscheidung in einer Runde mit Nachfolger → Problem", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="50"`))));
    s = ok(addRound(s, prompt(s.rounds.rounds[0].result, s.rounds.rounds[0].result.replace(`x="80"`, `x="81"`), 0)));
    expect(problem(decide(s, 0, 0, { state: "rejected" }))).toEqual({ code: "round-locked", params: [1] });
    expect(decide(s, 1, 0, { state: "rejected" })).not.toHaveProperty("problem");
  });

  it("entferntes Element seither von Hand geändert → acceptText ok:false (Review-Fokus 2)", () => {
    const answer = BASE.replace(/  <rect id="tuer"[^\n]*\n/, "");
    const s = ok(addRound(open(BASE), prompt(BASE, answer)));
    expect(acceptText(s, BASE)).toMatchObject({ ok: true });
    const hand = BASE.replace(`x="80"`, `x="99"`);
    const r = acceptText(s, hand);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "element-changed", params: ["tuer"], round: 1 });
  });

  it("Attribut seither von Hand geändert → nicht still überschrieben", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    const r = acceptText(s, BASE.replace(`r="40"`, `r="50"`));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "attr-changed", params: ["mond", "r", "50", "40"], round: 1 });
  });

  it("das Element ist weg: acceptText ok:false mit Meldung statt Wurf", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    expect(acceptText(s, S(`  <rect id="haus" x="1"/>`)).ok).toBe(false);
  });

  it("kaputte Kette → Problem", () => {
    const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    expect(problem(addRound(s, prompt(BASE, BASE.replace(`r="40"`, `r="61"`), 5)))).toEqual({ code: "round-missing", params: [6] });
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

describe("acceptText: ein ganzes Bild ersetzt nur den Ausgang, den die Runde kannte (Review C4, B1)", () => {
  const neu = S(`  <g id="gruppe">\n    <circle id="mond" r="60"/>\n  </g>\n  <rect id="haus" x="1"/>`);
  const whole = (startText: string, text: string, art: "prompt" | "repair" = "prompt"): SvgSession =>
    ok(addRound(open(startText), { art, instruction: "x", basedOn: null, body: { form: "whole", text, decision: "accepted" } }));

  it("die Datei ist, wie die Runde sie sah → das ganze Bild wird übernommen", () => {
    expect(acceptText(whole(BASE, neu), BASE)).toEqual({ ok: true, text: neu });
  });

  it("eine Handänderung seither (ein Element ergänzt) → Abbruch mit Meldung, nichts wird ersetzt", () => {
    const hand = BASE.replace("</svg>", `  <text id="notiz">Wichtig</text>\n</svg>`);
    const r = acceptText(whole(BASE, neu), hand);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "target-changed", params: [], round: 1 });
  });

  it("dasselbe als Reparatur eines unlesbaren Ausgangs (roher Vergleich, weil kanonisch nichts zu vergleichen ist)", () => {
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><g id="g"><circle id="mond" r="4"/></svg>`;
    const fixed = `<svg xmlns="http://www.w3.org/2000/svg"><g id="g"><circle id="mond" r="4"/></g></svg>`;
    const s = whole(broken, fixed, "repair");
    expect(acceptText(s, broken)).toEqual({ ok: true, text: fixed });
    const hand = broken.replace("</svg>", `<text id="notiz">Wichtig</text></svg>`);
    expect(acceptText(s, hand).ok).toBe(false);
  });

  it("anderer Zeilenumbruch und Einzug allein sind keine Handänderung (kanonisch gleich)", () => {
    const reformatted = BASE.replace(/\n {2}/g, "\n      ").replace(/\n/g, "\r\n");
    expect(acceptText(whole(BASE, neu), reformatted)).toEqual({ ok: true, text: neu });
  });

  it("eine abgelehnte ganze Runde ändert nichts und prüft nichts", () => {
    const rej = ok(addRound(open(BASE), { art: "prompt", instruction: "x", basedOn: null, body: { form: "whole", text: neu, decision: "rejected" } }));
    const hand = BASE.replace(`x="1"`, `x="9"`);
    expect(acceptText(rej, hand)).toEqual({ ok: true, text: hand });
  });

  it("Kette: Einträge, dann ein ganzes Bild auf deren Ergebnis → übernommen; mit Handänderung dazwischen nicht", () => {
    let s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
    const after = s.rounds.rounds[0].result;
    s = ok(addRound(s, { art: "prompt", instruction: "y", basedOn: 0, body: { form: "whole", text: neu, decision: "accepted" } }));
    expect(acceptText(s, BASE)).toEqual({ ok: true, text: neu });
    expect(after).not.toBe(BASE);
    const r = acceptText(s, BASE.replace(`x="1"`, `x="9"`));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toMatchObject({ code: "target-changed", round: 2 });
  });
});

describe("acceptText: „Namen vergeben“ mit Folgerunde (Review C4, B2)", () => {
  const UNNAMED = S(`  <rect x="1"/>\n  <rect x="2"/>`);
  const withFollow = (): SvgSession => {
    let s = ok(addRound(open(UNNAMED), { art: "names", instruction: "n", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    s = ok(addHandChange(s, [{ op: "change", id: "rect-2", attrs: { fill: "red" } }], "Von Hand"));
    return s;
  };

  it("unverändert → beide Runden greifen, das zweite Rechteck wird rot", () => {
    const r = acceptText(withFollow(), UNNAMED);
    expect(r).toEqual({ ok: true, text: S(`  <rect x="1" id="rect-1"/>\n  <rect x="2" id="rect-2" fill="red"/>`) });
  });

  it("ein Element ohne id davor eingefügt → Abbruch, es wird nie das falsche Rechteck rot", () => {
    const hand = UNNAMED.replace(`  <rect x="1"/>`, `  <rect x="0" data-hand="ja"/>\n  <rect x="1"/>`);
    const r = acceptText(withFollow(), hand);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "names-changed", params: [], round: 1 });
  });

  it("ein Element ohne id HINTER den vergebenen Namen (am Ende ergänzt) verschiebt nichts: das zweite Rechteck wird rot, das neue bekommt rect-3", () => {
    const hand = UNNAMED.replace("</svg>", `  <rect x="3"/>\n</svg>`);
    const r = acceptText(withFollow(), hand);
    expect(r).toEqual({ ok: true, text: S(`  <rect x="1" id="rect-1"/>\n  <rect x="2" id="rect-2" fill="red"/>\n  <rect x="3" id="rect-3"/>`) });
  });

  it("das benannte Element ist seither gelöscht → Abbruch mit der Meldung zu den Namen (nicht erst die Folgerunde)", () => {
    const hand = UNNAMED.replace(`  <rect x="2"/>\n`, "");
    const r = acceptText(withFollow(), hand);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "names-changed", params: [], round: 1 });
  });

  it("eine Handänderung an anderer Stelle (benannte Elemente) ist kein Grund abzubrechen", () => {
    const withNamed = S(`  <circle id="mond" r="4"/>\n  <rect x="1"/>\n  <rect x="2"/>`);
    let s = ok(addRound(open(withNamed), { art: "names", instruction: "n", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    s = ok(addHandChange(s, [{ op: "change", id: "rect-2", attrs: { fill: "red" } }], "Von Hand"));
    const hand = withNamed.replace(`r="4"`, `r="7"`);
    const r = acceptText(s, hand);
    expect(r).toEqual({ ok: true, text: S(`  <circle id="mond" r="7"/>\n  <rect x="1" id="rect-1"/>\n  <rect x="2" id="rect-2" fill="red"/>`) });
  });

  it("der Text ist inzwischen nicht mehr lesbar → Abbruch mit Meldung, kein Wurf", () => {
    const r = acceptText(withFollow(), `<svg xmlns="http://www.w3.org/2000/svg"><rect x="1"/><g></svg>`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toEqual({ code: "names-changed", params: [], round: 1 });
  });

  it("als LETZTE Runde darf auch ein Element ohne id VOR den anderen stehen: die Regel benennt auf dem Text von JETZT, es hängt nichts an den alten Namen", () => {
    const s = ok(addRound(open(UNNAMED), { art: "names", instruction: "n", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    const hand = UNNAMED.replace(`  <rect x="1"/>`, `  <rect x="0"/>\n  <rect x="1"/>`);
    const r = acceptText(s, hand);
    expect(r.ok && r.text).toContain(`<rect x="0" id="rect-1"/>`);
  });

  it("ohne Folgerunde wird die Regel weiter auf dem Text von JETZT abgeleitet (auch ein neues Element bekommt eine id)", () => {
    const s = ok(addRound(open(UNNAMED), { art: "names", instruction: "n", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    const hand = UNNAMED.replace("</svg>", `  <rect x="3"/>\n</svg>`);
    const r = acceptText(s, hand);
    expect(r.ok && r.text).toContain(`id="rect-3"`);
  });
});

describe("acceptText: ein führendes BOM der Datei bleibt (code-kit 0.58.0 nimmt es an)", () => {
  const BOM = "\uFEFF";
  const answer = BASE.replace(`r="40"`, `r="60"`);

  it("Spannen-Runde: das BOM bleibt, weil nur die Spanne ersetzt wird", () => {
    const s = ok(addRound(open(BOM + BASE), prompt(BASE, answer)));
    const r = acceptText(s, BOM + BASE);
    expect(r).toEqual({ ok: true, text: BOM + answer });
  });

  it("Runde „ganzes Bild“ (Modellantwort ohne BOM): das BOM wird wieder vorangestellt", () => {
    const s = ok(addRound(open(BOM + BASE), { art: "prompt", instruction: "x", basedOn: null, body: { form: "whole", text: answer, decision: "accepted" } }));
    expect(acceptText(s, BOM + BASE)).toEqual({ ok: true, text: BOM + answer });
  });

  it("Erzeugen ohne Vorlage (current null) und Datei ohne BOM: kein BOM dazu", () => {
    const s = ok(addRound(open(null), { art: "create", instruction: "Mond", basedOn: null, body: { form: "whole", text: BASE, decision: "accepted" } }));
    expect(acceptText(s, null)).toEqual({ ok: true, text: BASE });
    expect(acceptText(s, BASE)).toEqual({ ok: true, text: BASE });
  });

  it("trägt der Text der Runde selbst schon ein BOM, kommt keines dazu (nie zwei)", () => {
    const s = ok(addRound(open(null), { art: "create", instruction: "Mond", basedOn: null, body: { form: "whole", text: BOM + BASE, decision: "accepted" } }));
    expect(acceptText(s, BOM + BASE)).toEqual({ ok: true, text: BOM + BASE });
  });
});
