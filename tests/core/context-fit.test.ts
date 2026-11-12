import { describe, expect, it } from "vitest";
import { inputOverflow, OPTIMISTIC_CHARS_PER_TOKEN } from "../../src/core/context-fit";

const msg = (n: number) => [{ content: "x".repeat(n) }];

describe("inputOverflow (Befund 9: Eingabe gegen den Kontext des Modells)", () => {
  it("ohne bekannte Grenze oder mit kleiner Eingabe: kein Befund", () => {
    expect(inputOverflow(msg(1_000_000), null)).toBeNull();
    expect(inputOverflow(msg(1_000), 8192)).toBeNull();
  });

  it("zählt alle Nachrichten und rechnet optimistisch (4 Zeichen je Token), damit nie eine Anfrage fälschlich gesperrt wird", () => {
    expect(OPTIMISTIC_CHARS_PER_TOKEN).toBe(4);
    // 300 KB gegen 8k: sicher zu groß, selbst bei 4 Zeichen je Token (75 000 Tokens).
    expect(inputOverflow([{ content: "a".repeat(100_000) }, { content: "b".repeat(200_000) }], 8192)).toEqual({ tokens: 75_000, limit: 8192 });
  });

  it("genau an der Grenze passt es noch, ein Token darüber nicht", () => {
    expect(inputOverflow(msg(8192 * 4), 8192)).toBeNull();
    expect(inputOverflow(msg(8192 * 4 + 1), 8192)).toEqual({ tokens: 8193, limit: 8192 });
  });

  it("eine unsinnige Grenze (0, negativ, NaN) gilt als unbekannt", () => {
    expect(inputOverflow(msg(100_000), 0)).toBeNull();
    expect(inputOverflow(msg(100_000), -1)).toBeNull();
    expect(inputOverflow(msg(100_000), Number.NaN)).toBeNull();
  });
});
