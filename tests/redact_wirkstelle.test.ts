import { describe, it, expect } from "vitest";
import { redactMessages } from "../src/vendor/kit-obsidian/chat-client";
import { createPiiRedactor } from "../src/vendor/kit/redact";

/** Sicherheitsfix code-kit 0.79.1 (Geheimnis hinter Wortzeichen) und 0.82.0 (IBAN hinter `_`). Wirkstelle ist `redactMessages`, die Schwärzung der gesendeten
 *  Nachrichten der Kit-Verbindung: ein an ein Wort geklebtes Geheimnis blieb mit dem alten Stand (code-kit 0.78.0) im Klartext. */
describe("redact an der Wirkstelle (code-kit 0.87.0)", () => {
  const KEY = "sk-proj-abcdefghijklmnop1234";

  it("schwärzt key_sk-proj-… in gesendeten Nachrichten", () => {
    const r = redactMessages([{ role: "user", content: `Text: key_${KEY}` }]);
    expect(JSON.stringify(r.messages)).not.toContain(KEY);
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it("liest eine IBAN hinter `_` als IBAN (iban_DE89…)", () => {
    const out = createPiiRedactor().text("Konto iban_DE89370400440532013000 bitte");
    expect(out).toContain("[IBAN_1]");
    expect(out).not.toContain("DE89");
  });
});
