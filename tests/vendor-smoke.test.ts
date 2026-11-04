// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { askUntilValid, type AskReply, type Verdict } from "../src/vendor/kit/answer-retry";
import { unwrapAnswer } from "../src/vendor/kit/llm-answer";
import { checkSvg } from "../src/vendor/kit/svg-guard";

// Belegt, dass die gepinnten Kit-Module (code-kit 0.52.1) in dieser Testumgebung laufen — nicht ihr Verhalten im Einzelnen.
describe("vendorte Kit-Module", () => {
  it("svg-guard nimmt ein gültiges SVG an und liefert den geprüften Baum", () => {
    const r = checkSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="c" r="4"/></svg>');
    expect(r.ok).toBe(true);
  });

  it("svg-guard lehnt ein Skript ab, statt es zu entfernen", () => {
    const r = checkSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    expect(r.ok).toBe(false);
  });

  it("askUntilValid fragt nach zwei ungültigen Antworten ein drittes Mal", async () => {
    const answers = ["kaputt", "noch kaputt", "<svg/>"];
    let n = 0;
    const ask = (): Promise<AskReply> => Promise.resolve({ content: answers[n++] ?? "" });
    const validate = (c: string): Verdict<string> => (c === "<svg/>" ? { ok: true, value: c } : { ok: false, problem: "nicht svg" });
    const r = await askUntilValid(ask, validate, { messages: [{ role: "user", content: "x" }], instruction: "nochmal", maxRetries: 2 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
  });

  it("unwrapAnswer entfernt den Zaun", () => {
    expect(unwrapAnswer("```svg\n<svg/>\n```")).toBe("<svg/>");
  });
});
