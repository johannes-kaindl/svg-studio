import { beforeEach, describe, expect, it } from "vitest";
import { diffSvg } from "../src/core/diff";
import { PROBLEM_CODES, type Problem } from "../src/core/problem";
import { acceptText, addRound, decide, type SvgRound, type SvgSession } from "../src/core/session";
import { initStrings, problemText, STRINGS } from "../src/i18n/strings";
import { EMPTY_ROUNDS } from "../src/vendor/kit/rounds";

const S = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>\n`;
const BASE = S(`  <circle id="mond" r="40"/>\n  <rect id="tuer" x="80"/>\n  <rect id="haus" x="1"/>`);
const open = (start: string): SvgSession => ({ target: { kind: "file", path: "a.svg", label: "a" }, rounds: EMPTY_ROUNDS, startText: start });
const ok = <T>(r: T | { problem: Problem }): T => {
  if (typeof r === "object" && r !== null && "problem" in r) throw new Error(r.problem.code);
  return r;
};
const prompt = (base: string, answer: string, basedOn: number | null = null): Omit<SvgRound, "result"> => {
  const d = diffSvg(base, answer);
  if (!d.decomposable) throw new Error(d.why);
  return { art: "prompt", instruction: "x", basedOn, body: { form: "list", entries: d.entries, decisions: [] } };
};

/** Typische deutsche Wörter der alten Kerntexte; im englischen UI darf keines vorkommen, im deutschen kein englisches der neuen. */
const GERMAN = /hat sich|Eintrag|Elemente ohne Namen|Das Ziel|[äöüß]|gesperrt|Namen vergeben|Runde \d|nicht gesetzt/;
const ENGLISH = /\b(has changed|since the round|The target|elements without|Round \d|not set|locked|assign names)\b/i;

beforeEach(() => { initStrings("en"); });

/** Ein Problem je Code aus dem echten Kern, wo der Kern es wirklich liefert. */
function realProblems(): Problem[] {
  const out: Problem[] = [];
  const fromAccept = (s: SvgSession, current: string | null): void => { const r = acceptText(s, current); if (!r.ok) out.push(r.problem); };
  const s = ok(addRound(open(BASE), prompt(BASE, BASE.replace(`r="40"`, `r="60"`))));
  fromAccept(s, BASE.replace(`r="40"`, `r="50"`)); // attr-changed
  fromAccept(ok(addRound(open(BASE), prompt(BASE, BASE.replace(/  <rect id="tuer"[^\n]*\n/, "")))), BASE.replace(`x="80"`, `x="99"`)); // element-changed
  fromAccept(s, S(`  <rect id="haus" x="1"/>`)); // element-missing
  const neu = S(`  <g id="gruppe">\n    <circle id="mond" r="60"/>\n  </g>`);
  fromAccept(ok(addRound(open(BASE), { art: "prompt", instruction: "x", basedOn: null, body: { form: "whole", text: neu, decision: "accepted" } })), BASE.replace(`x="1"`, `x="9"`)); // target-changed
  const unnamed = S(`  <rect x="1"/>\n  <rect x="2"/>`);
  let n = ok(addRound(open(unnamed), { art: "names", instruction: "n", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
  n = ok(addRound(n, prompt(n.rounds.rounds[0]!.result, n.rounds.rounds[0]!.result.replace(`x="2"`, `x="3"`), 0)));
  fromAccept(n, unnamed.replace(`  <rect x="1"/>`, `  <rect x="0" data-hand="ja"/>\n  <rect x="1"/>`)); // names-changed
  const locked = ok(addRound(s, prompt(s.rounds.rounds[0]!.result, s.rounds.rounds[0]!.result.replace(`x="80"`, `x="81"`), 0)));
  const d = decide(locked, 0, 0, { state: "rejected" });
  if ("problem" in d) out.push(d.problem); // round-locked
  const miss = addRound(s, prompt(BASE, BASE.replace(`r="40"`, `r="61"`), 5));
  if ("problem" in miss) out.push(miss.problem); // round-missing
  return out;
}

describe("Probleme des Kerns erscheinen in der Sprache der Oberfläche, ohne fremdsprachigen Rest", () => {
  it("jeder Code hat in beiden Sprachen einen Text", () => {
    for (const code of PROBLEM_CODES) {
      expect(STRINGS.en[`problem.${code}`], code).toBeTruthy();
      expect(STRINGS.de[`problem.${code}`], code).toBeTruthy();
    }
  });

  it("der Kern liefert echte Probleme für die Fälle des Übernehmens (keine Sätze, nur Code und Parameter)", () => {
    const codes = realProblems().map((p) => p.code).sort();
    expect(codes).toEqual(["attr-changed", "element-changed", "element-missing", "names-changed", "round-locked", "round-missing", "target-changed"].sort());
    for (const p of realProblems()) expect(Object.keys(p).sort()).toEqual(p.round === undefined ? ["code", "params"] : ["code", "params", "round"]);
  });

  it("Englisch: kein Umlaut und kein deutsches Wort, mit „Round n:“ davor", () => {
    initStrings("en");
    const texts = realProblems().map(problemText);
    expect(texts.length).toBeGreaterThanOrEqual(7);
    for (const text of texts) expect(text, text).not.toMatch(GERMAN);
    expect(texts.find((x) => x.startsWith("Round 1: mond: r has changed"))).toBe("Round 1: mond: r has changed since the round (now 50, the round assumed 40).");
    expect(texts.some((x) => x === "Round 1: The target has changed since the round; the round replaces the whole image.")).toBe(true);
    expect(texts.some((x) => x.includes("The elements without names have changed since the round"))).toBe(true);
  });

  it("Deutsch: kein englischer Rest", () => {
    initStrings("de");
    const texts = realProblems().map(problemText);
    for (const text of texts) expect(text, text).not.toMatch(ENGLISH);
    expect(texts).toContain("Runde 1: mond: r hat sich seit der Runde geändert (jetzt 50, die Runde ging von 40 aus).");
    expect(texts).toContain("Runde 1: Das Ziel hat sich seit der Runde geändert; die Runde ersetzt das ganze Bild.");
    expect(texts.some((x) => x.includes("Die Elemente ohne Namen haben sich seit der Runde geändert"))).toBe(true);
  });

  it("‚nicht gesetzt‘ ist ein Wort der Oberfläche, kein Rest des Kerns", () => {
    const p: Problem = { code: "attr-changed", params: ["mond", "fill", null, "red"] };
    initStrings("en");
    expect(problemText(p)).toBe("mond: fill has changed since the round (now not set, the round assumed red).");
    initStrings("de");
    expect(problemText(p)).toBe("mond: fill hat sich seit der Runde geändert (jetzt nicht gesetzt, die Runde ging von red aus).");
  });
});
