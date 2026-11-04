import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStrings } from "../../src/i18n/strings";
import { commentDialog } from "../../src/obsidian/panel/comment-dialog";

const seen: Array<{ app: unknown; opts: Record<string, unknown> }> = [];
vi.mock("../../src/vendor/kit-obsidian/prompt-text", () => ({
  promptText: (app: unknown, opts: Record<string, unknown>) => { seen.push({ app, opts }); return Promise.resolve("Antwort"); },
}));

beforeEach(() => { seen.length = 0; });

describe("Kommentar-Dialog: promptText mit den Texten des Plugins", () => {
  it("mehrzeilig, leer ist keine Antwort, die bisherige Eingabe ist die Vorbelegung; das Ergebnis geht unverändert durch", async () => {
    initStrings("en");
    const app = {};
    await expect(commentDialog(app as never)("vorher")).resolves.toBe("Antwort");
    expect(seen[0]!.app).toBe(app);
    expect(seen[0]!.opts).toEqual({
      title: "Comment",
      message: "Your note goes to the model with your next change request.",
      placeholder: "e.g. The door was already right.",
      initial: "vorher",
      okLabel: "OK",
      cancelLabel: "Cancel",
      multiline: true,
      allowEmpty: false,
    });
  });

  it("auf Deutsch", async () => {
    initStrings("de");
    await commentDialog({} as never)("");
    expect(seen[0]!.opts).toMatchObject({ title: "Kommentar", okLabel: "OK", cancelLabel: "Abbrechen", multiline: true, allowEmpty: false, initial: "" });
    expect(seen[0]!.opts.message).toBe("Deine Anmerkung geht mit der nächsten Änderungsanfrage ans Modell.");
    initStrings("en");
  });
});
