// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/vendor/kit-obsidian/choice-modal", () => ({ askChoice: vi.fn() }));

import { diffSvg } from "../../src/core/diff";
import { addHandChange, addRound, type SvgSession } from "../../src/core/session";
import { acceptBlockReason, acceptSvgSession, blockAfterInsert, firstPromptLineOf } from "../../src/obsidian/accept";
import { BLOCK_LANG } from "../../src/obsidian/entry";
import { buildPanelShell, type PanelDeps } from "../../src/obsidian/panel/shell";
import { svgSlots } from "../../src/obsidian/panel/slots";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import { slugify } from "../../src/vendor/kit/slug";
import { EMPTY_ROUNDS } from "../../src/vendor/kit/rounds";
import type { Target } from "../../src/vendor/kit/panel-session";
import { askChoice } from "../../src/vendor/kit-obsidian/choice-modal";
import { answer, fakeLlm } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { acceptSetup } from "../helpers/fake-accept";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

const NEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="mond" r="4"/></svg>`;
const BASE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="mond" r="40"/>\n  <rect id="haus" x="1"/>\n</svg>\n`;
const FILE: Target = { kind: "file", path: "Anhänge/logo.svg", label: "logo.svg" };
const NOTE = ["intro", "", "```svg-studio", BASE.trimEnd(), "```", "", "outro"].join("\n");
const BLOCK: Target = { kind: "block", path: "n.md", lineStart: 2, lineEnd: 7, label: "n:3", body: BASE.trimEnd() };

const ok = <T>(r: T | { problem: string }): T => {
  if (typeof r === "object" && r !== null && "problem" in r) throw new Error((r as { problem: string }).problem);
  return r as T;
};
/** Ein neues SVG: eine `create`-Runde. */
const newSession = (prompt = "Ein Mond"): SvgSession =>
  ok(addRound({ target: { kind: "new" }, rounds: EMPTY_ROUNDS, startText: null }, { art: "create", instruction: prompt, basedOn: null, body: { form: "whole", text: NEW_SVG, decision: "accepted" } }));
/** Ein bestehendes SVG, `mond` auf r=60 (Handrunde). */
const refineSession = (target: Target, start = BASE): SvgSession =>
  ok(addHandChange({ target, rounds: EMPTY_ROUNDS, startText: start }, [{ op: "change", id: "mond", attrs: { r: "60" } }], "Von Hand"));
const O = { guard: checkSvg, pluginId: "svg-studio" };
const run = (env: ReturnType<typeof acceptSetup>["env"], s: SvgSession) => acceptSvgSession(env, s, { ...O, firstPromptLine: "Ein Mond" });

beforeEach(() => { document.body.replaceChildren(); initStrings("en"); vi.mocked(askChoice).mockReset(); });

describe("Übernehmen: neues SVG als Datei (Vorgabe)", () => {
  it("legt die Datei im Anhangordner an, Name aus der ersten Zeile des Prompts, und setzt ![[…]] an den Cursor der Notiz", async () => {
    const t = acceptSetup({ "n.md": "intro\n" });
    const name = `${slugify("Ein Mond")}.svg`;
    expect(name).toBe("ein-mond.svg");
    const r = await run(t.env, newSession());
    expect(t.store[`Anhänge/${name}`]).toBe(NEW_SVG);
    expect(t.store["n.md"]).toContain(`![[${name}]]`);
    expect(r).toMatchObject({ ok: true, message: `Saved Anhänge/${name} and inserted its link at the cursor.` });
  });

  it("der Name kommt aus der ERSTEN Zeile des ersten Prompts; ohne Wörter heißt die Datei svg.svg", async () => {
    const a = acceptSetup({ "n.md": "" });
    await acceptSvgSession(a.env, newSession("Ein Mond\nmit Sternen"), { ...O, firstPromptLine: "Ein Mond" });
    expect(Object.keys(a.store).filter((k) => k.endsWith(".svg"))).toEqual(["Anhänge/ein-mond.svg"]);
    const b = acceptSetup({ "n.md": "" });
    await acceptSvgSession(b.env, newSession("???"), { ...O, firstPromptLine: "???" });
    expect(Object.keys(b.store).filter((k) => k.endsWith(".svg"))).toEqual(["Anhänge/svg.svg"]);
  });

  it("ein vorhandener Dateiname wird nummeriert, nie überschrieben", async () => {
    const t = acceptSetup({ "n.md": "", "Anhänge/ein-mond.svg": "ALT" });
    const r = await run(t.env, newSession());
    expect(t.store["Anhänge/ein-mond.svg"]).toBe("ALT");
    expect(t.store["Anhänge/ein-mond 1.svg"]).toBe(NEW_SVG);
    expect(r.ok && r.message).toContain("ein-mond 1.svg");
  });

  it("das Ziel wird nach dem Übernehmen die neue Datei (retarget), damit die nächste Runde sie ändert", async () => {
    const t = acceptSetup({ "n.md": "" });
    const r = await run(t.env, newSession());
    expect(r).toMatchObject({ ok: true, retarget: { kind: "file", path: "Anhänge/ein-mond.svg", label: "ein-mond.svg" } });
  });

  it("ohne offene Notiz entsteht nur die Datei (Standardordner), die Meldung sagt es", async () => {
    const t = acceptSetup({}, { noView: true });
    const r = await run(t.env, newSession());
    expect(t.store["Standard/ein-mond.svg"]).toBe(NEW_SVG);
    expect(r).toMatchObject({ ok: true, message: "Saved Standard/ein-mond.svg. No note is open, so no link was inserted.", retarget: { kind: "file", path: "Standard/ein-mond.svg" } });
  });

  it("Lesemodus (Entscheidung E2): die Datei entsteht, der Verweis wird ans Notizende angehängt und die Meldung sagt es", async () => {
    const t = acceptSetup({ "n.md": "intro" }, { reading: true });
    const r = await run(t.env, newSession());
    expect(t.store["n.md"]).toBe("intro\n\n![[ein-mond.svg]]\n");
    expect(t.order).toContain("ports.process:n.md");
    expect(t.order).not.toContain("editor.replaceSelection");
    expect(r).toMatchObject({ ok: true, message: "Saved Anhänge/ein-mond.svg. The note is in reading view, so its link was added at the end of the note." });
  });
});

describe("Übernehmen: neues SVG als Codeblock", () => {
  it("setzt ```svg-studio mit dem SVG an den Cursor und findet den Block für das neue Ziel", async () => {
    const t = acceptSetup({ "n.md": "intro\n" }, { acceptAs: "block" });
    const r = await run(t.env, newSession());
    expect(t.store["n.md"]).toBe(`intro\n\n\`\`\`${BLOCK_LANG}\n${NEW_SVG}\n\`\`\`\n`);
    expect(t.app.vault.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, message: "Code block inserted at the cursor.", retarget: { kind: "block", path: "n.md", lineStart: 2, lineEnd: 4, body: NEW_SVG } });
  });

  it("ohne offene Notiz: nichts geschrieben, Begründung in der Meldung; acceptBlockReason sperrt den Knopf schon vorher", async () => {
    const t = acceptSetup({}, { acceptAs: "block", noView: true });
    const r = await run(t.env, newSession());
    expect(r).toEqual({ ok: false, message: "No note is open to put a code block in; nothing was written." });
    expect(t.order).toEqual([]);
    expect(acceptBlockReason(newSession(), "block", false)).toContain("needs an open note");
    expect(acceptBlockReason(newSession(), "block", true)).toBeNull();
    expect(acceptBlockReason(newSession(), "file", false)).toBeNull();
    expect(acceptBlockReason(newSession(), "ask", false)).toBeNull();
    expect(acceptBlockReason(refineSession(FILE), "block", false)).toBeNull();
  });

  it("Lesemodus (E2): der Block wird ans Ende der Notiz angehängt, die Meldung sagt es", async () => {
    const t = acceptSetup({ "n.md": "intro" }, { acceptAs: "block", reading: true });
    const r = await run(t.env, newSession());
    expect(t.store["n.md"]).toBe(`intro\n\n\`\`\`${BLOCK_LANG}\n${NEW_SVG}\n\`\`\`\n`);
    expect(t.order).toContain("ports.process:n.md");
    expect(t.order).not.toContain("editor.replaceSelection");
    expect(r).toMatchObject({ ok: true, message: "The note is in reading view, so the code block was added at the end of the note.", retarget: { kind: "block", lineStart: 2, lineEnd: 4 } });
  });
});

describe("Übernehmen: jedes Mal fragen", () => {
  it("fragt per askChoice mit Datei und Codeblock (und Abbrechen); die Wahl bestimmt den Weg", async () => {
    vi.mocked(askChoice).mockResolvedValueOnce("block");
    const t = acceptSetup({ "n.md": "" }, { acceptAs: "ask" });
    await run(t.env, newSession());
    expect(askChoice).toHaveBeenCalledTimes(1);
    const o = vi.mocked(askChoice).mock.calls[0]![1];
    expect(o.options.map((x) => x.value)).toEqual(["file", "block"]);
    expect(o.cancelLabel).toBe("Cancel");
    expect(t.store["n.md"]).toContain("```svg-studio");
    expect(t.app.vault.create).not.toHaveBeenCalled();

    vi.mocked(askChoice).mockResolvedValueOnce("file");
    const u = acceptSetup({ "n.md": "" }, { acceptAs: "ask" });
    await run(u.env, newSession());
    expect(u.store["Anhänge/ein-mond.svg"]).toBe(NEW_SVG);
  });

  it("Abbrechen schreibt nichts", async () => {
    vi.mocked(askChoice).mockResolvedValueOnce(null);
    const t = acceptSetup({ "n.md": "" }, { acceptAs: "ask" });
    const r = await run(t.env, newSession());
    expect(r).toEqual({ ok: false, message: "Cancelled; nothing was written." });
    expect(t.order).toEqual([]);
  });

  it("ohne offene Notiz fehlt der Codeblock in der Wahl, der Grund steht im Dialog", async () => {
    vi.mocked(askChoice).mockResolvedValueOnce(null);
    const t = acceptSetup({}, { acceptAs: "ask", noView: true });
    await run(t.env, newSession());
    const o = vi.mocked(askChoice).mock.calls[0]![1];
    expect(o.options.map((x) => x.value)).toEqual(["file"]);
    expect(JSON.stringify(o.message)).toContain("No note is open, so a code block is not possible.");
  });
});

describe("Übernehmen: bestehender Block", () => {
  it("schreibt den Rumpf über den Block-Schreiber und gibt das neue Ziel zurück (Schlusszeile, Rumpf)", async () => {
    const t = acceptSetup({ "n.md": NOTE });
    const r = await run(t.env, refineSession(BLOCK));
    expect(t.store["n.md"]).toContain(`r="60"`);
    expect(t.store["n.md"].split("\n")[0]).toBe("intro");
    expect(r).toMatchObject({ ok: true, message: "Applied to n:3.", retarget: { kind: "block", lineStart: 2 } });
    expect(r.ok && r.retarget?.kind === "block" && r.retarget.body).toContain(`r="60"`);
  });

  it("ein verschobener Block (Zeile darüber eingefügt) → „Block geändert“, nichts geschrieben", async () => {
    const t = acceptSetup({ "n.md": `eine neue Zeile\n${NOTE}` });
    const r = await run(t.env, refineSession(BLOCK));
    expect(r).toEqual({ ok: false, message: "Block changed: it moved or was deleted since the panel opened; nothing was written." });
    expect(t.store["n.md"]).toBe(`eine neue Zeile\n${NOTE}`);
    expect(t.order).toEqual([]);
  });

  it("derselbe Ort, anderer Rumpf (Fingerabdruck der Position) → „Block geändert“, nichts geschrieben", async () => {
    const changed = NOTE.replace(`x="1"`, `x="9"`);
    const t = acceptSetup({ "n.md": changed });
    const r = await run(t.env, refineSession(BLOCK));
    expect(r).toEqual({ ok: false, message: "Block changed: its content differs from what the panel opened; nothing was written." });
    expect(t.store["n.md"]).toBe(changed);
    expect(t.order).toEqual([]);
  });

  it("eine Handänderung `onclick` per change hält checkWrite an: nichts geschrieben, Meldung nennt das ungültige Ergebnis", async () => {
    const s = ok(addHandChange({ target: BLOCK, rounds: EMPTY_ROUNDS, startText: BASE }, [{ op: "change", id: "mond", attrs: { onclick: "alert(1)" } }], "Von Hand"));
    const t = acceptSetup({ "n.md": NOTE });
    const r = await run(t.env, s);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^The result is not a valid SVG: .*onclick.*; nothing was written\.$/);
    expect(t.store["n.md"]).toBe(NOTE);
    expect(t.order).toEqual([]);
  });
});

describe("Übernehmen: Zeichen, die erst der Parser im Schreibweg fängt (B2-Rest 4)", () => {
  // `applyChanges` lässt U+FFFE und U+FFFF durch (`hasBadControl`); das Chromium des Obsidian-Fensters lehnt sie ab (gemessen mit scripts/lab/chrome.ts am 2026-11-04:
  // „parse-error: the text is not well-formed XML“). happy-dom tut das nicht; der Prüfer ist hier deshalb ein Stand-in mit Chromiums Urteil, geprüft wird der Weg.
  const chromiumLike: typeof checkSvg = (text, options) => (/[\uFFFE\uFFFF]/.test(text)
    ? { ok: false, problems: [{ code: "parse-error", detail: "the text is not well-formed XML" }] }
    : checkSvg(text, options));
  for (const ch of ["\uFFFE", "\uFFFF"]) {
    it(`${JSON.stringify(ch)} in einem Attribut: nichts geschrieben, kein Schnappschuss`, async () => {
      const s = ok(addHandChange({ target: FILE, rounds: EMPTY_ROUNDS, startText: BASE }, [{ op: "change", id: "mond", attrs: { "data-x": `a${ch}b` } }], "Von Hand"));
      expect(s.rounds.rounds[0]!.result).toContain(ch); // die Runde selbst lässt es durch
      const t = acceptSetup({ "Anhänge/logo.svg": BASE });
      const r = await acceptSvgSession(t.env, s, { guard: chromiumLike, firstPromptLine: "", pluginId: "svg-studio" });
      expect(r).toEqual({ ok: false, message: "The result is not a valid SVG: parse-error: the text is not well-formed XML; nothing was written." });
      expect(t.store["Anhänge/logo.svg"]).toBe(BASE);
      expect(t.order).toEqual([]);
    });
  }
});

describe("Übernehmen: bestehende Datei", () => {
  it("der Schnappschuss entsteht VOR vault.process und trägt den alten Text", async () => {
    const t = acceptSetup({ "Anhänge/logo.svg": BASE });
    const r = await run(t.env, refineSession(FILE));
    expect(r).toEqual({ ok: true, message: "Applied to logo.svg." });
    expect(t.store["Anhänge/logo.svg"]).toContain(`r="60"`);
    const snap = t.order.indexOf("snapshot.write");
    const write = t.order.indexOf("vault.process:Anhänge/logo.svg");
    expect(snap).toBeGreaterThanOrEqual(0);
    expect(snap).toBeLessThan(write);
    expect([...t.snaps.values()]).toEqual([BASE]);
    expect([...t.snaps.keys()][0]).toMatch(/^\.config-x\/plugins\/svg-studio\/snapshots\/.+\/Anhänge\/logo\.svg$/);
  });

  it("scheitert der Schnappschuss, wird nichts geschrieben", async () => {
    const t = acceptSetup({ "Anhänge/logo.svg": BASE }, { failSnapshot: true });
    const r = await run(t.env, refineSession(FILE));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Could not back up Anhänge/logo.svg first");
    expect(t.store["Anhänge/logo.svg"]).toBe(BASE);
    expect(t.order.some((o) => o.startsWith("vault.process"))).toBe(false);
  });

  it("eine Handänderung seit der Runde bleibt (Review-Fokus 2): beide Änderungen stehen im Ergebnis", async () => {
    const s = refineSession(FILE);
    const handEdited = BASE.replace(`x="1"`, `x="7"`);
    const t = acceptSetup({ "Anhänge/logo.svg": handEdited });
    const r = await run(t.env, s);
    expect(r.ok).toBe(true);
    expect(t.store["Anhänge/logo.svg"]).toBe(handEdited.replace(`r="40"`, `r="60"`));
  });

  it("ein Attribut, das seit der Runde von Hand geändert wurde, wird nicht still überschrieben (attr.from, B3-Rest 3)", async () => {
    const t = acceptSetup({ "Anhänge/logo.svg": BASE.replace(`r="40"`, `r="50"`) });
    const r = await run(t.env, refineSession(FILE));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mond.*r hat sich seit der Runde geändert.*; nothing was written\.$/);
    expect(t.store["Anhänge/logo.svg"]).toContain(`r="50"`);
    expect(t.order).toEqual([]);
  });

  it("ein Element, das die Runde entfernen will, wurde seither von Hand geändert → Abbruch mit Meldung, nichts geschrieben", async () => {
    const answerText = BASE.replace(/  <rect id="haus" x="1"\/>\n/, "");
    const diff = diffSvg(BASE, answerText);
    if (!diff.decomposable) throw new Error(diff.why);
    const s = ok(addRound({ target: FILE, rounds: EMPTY_ROUNDS, startText: BASE }, { art: "prompt", instruction: "Haus weg", basedOn: null, body: { form: "list", entries: diff.entries, decisions: [] } }));
    const edited = BASE.replace(`x="1"`, `x="2"`);
    const t = acceptSetup({ "Anhänge/logo.svg": edited });
    const r = await run(t.env, s);
    expect(r.ok).toBe(false);
    expect(t.store["Anhänge/logo.svg"]).toBe(edited);
    expect(t.order).toEqual([]);
  });

  it("die Datei ist weg → Meldung, nichts angelegt", async () => {
    const t = acceptSetup({});
    const r = await run(t.env, refineSession(FILE));
    expect(r).toEqual({ ok: false, message: "Anhänge/logo.svg no longer exists; nothing was written." });
  });

  it("ein Ziel 'other' ist nicht übernehmbar", async () => {
    const t = acceptSetup({});
    const r = await run(t.env, { ...newSession(), target: { kind: "other", label: "Foto" } });
    expect(r.ok).toBe(false);
  });
});

describe("Übernehmen im Panel: Sperren und Zustand danach", () => {
  function panel(o: { session: SvgSession; setup: ReturnType<typeof acceptSetup>; hang?: boolean; reason?: () => string | null }) {
    const { llm } = fakeLlm([o.hang === true ? () => new Promise(() => undefined) : answer(NEW_SVG)]);
    const root = document.body.createDiv({ cls: "view-content" }).createDiv();
    const slots = svgSlots({ llm, readTargetText: async () => null, thinkingOn: () => false, background: { get: () => ({ on: true, tone: "light", hex: "#ffffff" }), set: () => {} } });
    const accept = vi.fn((s: SvgSession) => acceptSvgSession(o.setup.env, s, { ...O, firstPromptLine: "Ein Mond" }));
    const deps: PanelDeps<SvgSession> = {
      app: {} as never, llm,
      thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
      readTargetText: async () => null, accept, openSettings: () => {}, confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
      ...(o.reason !== undefined ? { acceptBlockedReason: o.reason } : {}),
    };
    const shell = buildPanelShell(root, deps, slots, o.session);
    const btn = root.querySelector<HTMLButtonElement>("button.svg-studio-accept")!;
    return { root, shell, accept, btn };
  }

  it("zweimal Übernehmen (Doppelklick, auch am gesperrten Knopf vorbei) → genau EIN Schreibvorgang", async () => {
    const setup = acceptSetup({ "n.md": "" });
    const p = panel({ session: newSession(), setup });
    p.btn.dispatchEvent(new Event("click"));
    p.btn.dispatchEvent(new Event("click"));
    await p.shell.settled();
    expect(p.accept).toHaveBeenCalledTimes(1);
    expect(setup.app.vault.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(setup.store).filter((k) => k.endsWith(".svg"))).toHaveLength(1);
  });

  it("während des Schreibens sind Übernehmen, Verwerfen und Neu gesperrt", async () => {
    const setup = acceptSetup({ "n.md": "" });
    const p = panel({ session: newSession(), setup });
    p.btn.click();
    expect(p.btn.disabled).toBe(true);
    expect(p.root.querySelector<HTMLButtonElement>("button.svg-studio-discard")!.disabled).toBe(true);
    expect(p.root.querySelector<HTMLButtonElement>("button.svg-studio-new")!.disabled).toBe(true);
    await p.shell.settled();
    expect(p.root.querySelector<HTMLButtonElement>("button.svg-studio-new")!.disabled).toBe(false);
  });

  it("Übernehmen während eines Laufs ist gesperrt: Knopf aus, auch ein erzwungener Klick schreibt nichts", async () => {
    const setup = acceptSetup({ "n.md": "" });
    const withRound = refineSession(FILE);
    const q = panel({ session: withRound, setup, hang: true });
    q.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!.value = "mach den Mond größer";
    q.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
    await vi.waitFor(() => { expect(q.shell.running()).toBe(true); });
    expect(q.btn.disabled).toBe(true);
    q.btn.dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(q.accept).not.toHaveBeenCalled();
    expect(setup.order).toEqual([]);
  });

  it("nach dem Übernehmen sind die Runden leer und das Ziel ist die neue Datei (retarget)", async () => {
    const setup = acceptSetup({ "n.md": "" });
    const p = panel({ session: newSession(), setup });
    p.btn.click();
    await p.shell.settled();
    const s = p.shell.session();
    expect(s.rounds.rounds).toHaveLength(0);
    expect(s.target).toMatchObject({ kind: "file", path: "Anhänge/ein-mond.svg" });
  });

  it("nach einem Fehler bleiben die Runden und das Ziel", async () => {
    const setup = acceptSetup({}, { acceptAs: "block", noView: true });
    const p = panel({ session: newSession(), setup });
    p.btn.click();
    await p.shell.settled();
    expect(p.shell.session().rounds.rounds).toHaveLength(1);
    expect(p.shell.session().target).toEqual({ kind: "new" });
  });

  it("acceptBlockedReason: Knopf aus, Grund sichtbar; refreshAccept nimmt ihn zurück", () => {
    const setup = acceptSetup({ "n.md": "" });
    let reason: string | null = "Open a note first.";
    const p = panel({ session: newSession(), setup, reason: () => reason });
    expect(p.btn.disabled).toBe(true);
    expect(p.root.querySelector(".svg-studio-accept-hint")!.textContent).toBe("Open a note first.");
    reason = null;
    p.shell.refreshAccept();
    expect(p.btn.disabled).toBe(false);
    expect(p.root.querySelector(".svg-studio-accept-hint")!.textContent).toBe("");
  });
});

describe("Übernehmen am Cursor (Review C4, S2)", () => {
  const NOTE3 = "oben\nmitte\nunten\n";
  it("Datei: der Verweis steht am Cursor in der Mitte der Notiz, nicht am Ende", async () => {
    const t = acceptSetup({ "n.md": NOTE3 }, { cursor: { line: 1, ch: 5 } });
    await run(t.env, newSession());
    expect(t.store["n.md"]).toBe("oben\nmitte\n![[ein-mond.svg]]\n\nunten\n");
  });

  it("Block: der Codeblock steht am Cursor in der Mitte der Notiz; das neue Ziel zeigt auf genau diesen Block", async () => {
    const t = acceptSetup({ "n.md": NOTE3 }, { acceptAs: "block", cursor: { line: 1, ch: 5 } });
    const r = await run(t.env, newSession());
    expect(t.store["n.md"]).toBe(`oben\nmitte\n\`\`\`svg-studio\n${NEW_SVG}\n\`\`\`\n\nunten\n`);
    expect(r).toMatchObject({ ok: true, retarget: { kind: "block", lineStart: 2, lineEnd: 4, body: NEW_SVG } });
  });

  it("steht schon derselbe Block weiter oben, zeigt das neue Ziel auf den NEUEN (Zeilenvergleich vorher/nachher)", async () => {
    const block = `\`\`\`svg-studio\n${NEW_SVG}\n\`\`\``;
    const t = acceptSetup({ "n.md": `${block}\n\nmitte\n` }, { acceptAs: "block", cursor: { line: 4, ch: 5 } });
    const r = await run(t.env, newSession());
    expect(r).toMatchObject({ ok: true, retarget: { kind: "block", lineStart: 5, lineEnd: 7 } });
  });

  it("steht derselbe Block weiter unten, zeigt das neue Ziel auf den neuen davor", async () => {
    const block = `\`\`\`svg-studio\n${NEW_SVG}\n\`\`\``;
    const t = acceptSetup({ "n.md": `mitte\n\n${block}\n` }, { acceptAs: "block", cursor: { line: 0, ch: 5 } });
    const r = await run(t.env, newSession());
    expect(r).toMatchObject({ ok: true, retarget: { kind: "block", lineStart: 1, lineEnd: 3 } });
  });

  it("Lesemodus, derselbe Block steht schon oben: das neue Ziel ist der ANGEHÄNGTE am Notizende", async () => {
    const block = `\`\`\`svg-studio\n${NEW_SVG}\n\`\`\``;
    const t = acceptSetup({ "n.md": `oben\n${block}\nText` }, { acceptAs: "block", reading: true });
    const r = await run(t.env, newSession());
    expect(r).toMatchObject({ ok: true, retarget: { kind: "block", lineStart: 6, lineEnd: 8 } });
  });

  it("die zuletzt aktive Notiz wechselt während des Anhängens: das Ziel liegt in der Notiz, in die geschrieben wurde", async () => {
    const block = `\`\`\`svg-studio\n${NEW_SVG}\n\`\`\``;
    const t = acceptSetup({ "n.md": "intro", "m.md": `x\n${block}\ny` }, { acceptAs: "block", reading: true, switchNoteTo: "m.md" });
    const r = await run(t.env, newSession());
    expect(t.store["n.md"]).toContain("```svg-studio");
    expect(r).toMatchObject({ ok: true, retarget: { kind: "block", path: "n.md" } });
  });

  // Ein Fehler des Kits (`insertAtCursor`), nicht des Plugins: bei Cursor 0:0 in einer frisch geöffneten Notiz mit Frontmatter landet der Text VOR dem Frontmatter
  // und zerstört es. Gehört ins obsidian-kit (Rest-Task C4, Punkt 8); `it.fails` hält ihn sichtbar, bis das Kit ihn behebt.
  it.fails("Cursor 0:0 in einer Notiz mit Frontmatter: die Notiz beginnt weiter mit dem Frontmatter (offener Kit-Fehler)", async () => {
    const note = "---\ntags: [plan]\n---\n# Wohnung\n";
    const t = acceptSetup({ "n.md": note }, { cursor: { line: 0, ch: 0 } });
    await run(t.env, newSession());
    expect(t.store["n.md"]!.startsWith("---\ntags: [plan]\n---\n")).toBe(true);
  });
});

describe("blockAfterInsert (Review C4, S4)", () => {
  const block = (body: string): string => `\`\`\`svg-studio\n${body}\n\`\`\``;
  it("nimmt den ersten passenden Block ab der Stelle, an der sich der Text ändert", () => {
    const before = `a\n${block(NEW_SVG)}\nb`;
    const after = `a\n${block(NEW_SVG)}\nb\n${block(NEW_SVG)}`;
    // Die Gleichheit der beiden Blöcke macht die Stelle mehrdeutig; die Zeilen des NEUEN zählen ab dem ersten Unterschied (hier: nach dem alten Block).
    const t = blockAfterInsert("n.md", before, after, NEW_SVG);
    expect(t).toMatchObject({ kind: "block", path: "n.md", lineStart: 5, lineEnd: 7, body: NEW_SVG });
  });
  it("ein anderer svg-studio-Block ab der Änderung ist nicht der neue (Rumpf-Vergleich) → null", () => {
    const before = "a\nb";
    const after = `a\n${block("<svg xmlns='http://www.w3.org/2000/svg'/>")}\nb`;
    expect(blockAfterInsert("n.md", before, after, NEW_SVG)).toBeNull();
  });
  it("Zeilenenden CRLF stören nicht, und unverändert (nichts eingefügt) → null", () => {
    const before = "a\r\nb";
    const after = `a\r\n${block(NEW_SVG).replace(/\n/g, "\r\n")}\r\nb`;
    expect(blockAfterInsert("n.md", before, after, NEW_SVG)).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(blockAfterInsert("n.md", before, before, NEW_SVG)).toBeNull();
  });
});

describe("Dateiname eines neuen SVG (Review C4, S1)", () => {
  const nameFor = async (prompt: string): Promise<string> => {
    const t = acceptSetup({ "n.md": "" });
    await acceptSvgSession(t.env, newSession(prompt), { ...O, firstPromptLine: prompt });
    return Object.keys(t.store).find((k) => k.endsWith(".svg"))!.replace("Anhänge/", "");
  };
  it("ein sehr langer erster Prompt ergibt einen Namen, den jedes Dateisystem anlegt (höchstens 64 Zeichen samt .svg)", async () => {
    const name = await nameFor("Ein Grundriss einer Wohnung mit ".repeat(30));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/^ein-grundriss-einer-wohnung-mit.*[a-z]\.svg$/);
  });
  it("von Windows reservierte Namen bekommen -svg angehängt (con.svg ist dort kein anlegbarer Name)", async () => {
    for (const w of ["CON", "nul", "Aux", "COM1", "lpt9"]) expect(await nameFor(w)).toBe(`${w.toLowerCase()}-svg.svg`);
  });
  it("ein Wort, das nur mit einem reservierten beginnt, bleibt unverändert", async () => {
    expect(await nameFor("console")).toBe("console.svg");
  });
});

describe("firstPromptLineOf (Review C4, S4)", () => {
  it("die erste Zeile des ersten Prompts; Regel- und Handrunden davor zählen nicht", () => {
    expect(firstPromptLineOf(newSession("Ein Mond\nmit Sternen"))).toBe("Ein Mond");
    let s: SvgSession = ok(addRound({ target: FILE, rounds: EMPTY_ROUNDS, startText: BASE }, { art: "names", instruction: "Assign names", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    s = ok(addHandChange(s, [{ op: "change", id: "mond", attrs: { r: "60" } }], "Von Hand"));
    expect(firstPromptLineOf(s)).toBe("");
    s = ok(addRound(s, { art: "prompt", instruction: "Tür breiter\nund höher", basedOn: s.rounds.active, body: { form: "whole", text: NEW_SVG, decision: "accepted" } }));
    expect(firstPromptLineOf(s)).toBe("Tür breiter");
  });
});

describe("Übernehmen: eine Handänderung geht nie verloren (Review C4, B1)", () => {
  const BROKEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g"><circle id="mond" r="4"/></svg>`;
  const FIXED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g"><circle id="mond" r="4"/></g></svg>`;
  const repair = (): SvgSession => ok(addRound({ target: FILE, rounds: EMPTY_ROUNDS, startText: BROKEN }, { art: "repair", instruction: "Repair", basedOn: null, body: { form: "whole", text: FIXED, decision: "accepted" } }));

  it("Reparatur als ganzes Bild, die Datei wurde seither ergänzt → nichts geschrieben, kein Schnappschuss", async () => {
    const hand = BROKEN.replace("</svg>", `<text id="notiz">Wichtig</text></svg>`);
    const t = acceptSetup({ "Anhänge/logo.svg": hand });
    const r = await run(t.env, repair());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Das Ziel hat sich seit der Runde geändert");
    expect(t.store["Anhänge/logo.svg"]).toBe(hand);
    expect(t.order).toEqual([]);
  });

  it("unverändert → die Reparatur wird übernommen (mit Schnappschuss)", async () => {
    const t = acceptSetup({ "Anhänge/logo.svg": BROKEN });
    const r = await run(t.env, repair());
    expect(r.ok).toBe(true);
    expect(t.store["Anhänge/logo.svg"]).toBe(FIXED);
    expect([...t.snaps.values()]).toEqual([BROKEN]);
  });

  it("Verfeinern als „ganzes Bild“ auf einer von Hand ergänzten Datei → nichts geschrieben", async () => {
    const answer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="neu"><circle id="mond" r="60"/></g><rect id="haus" x="1"/></svg>`;
    const s = ok(addRound({ target: FILE, rounds: EMPTY_ROUNDS, startText: BASE }, { art: "prompt", instruction: "gruppiere", basedOn: null, body: { form: "whole", text: answer, decision: "accepted" } }));
    const hand = BASE.replace("</svg>", `  <path id="handarbeit" d="M0 0L9 9"/>\n</svg>`);
    const t = acceptSetup({ "Anhänge/logo.svg": hand });
    const r = await run(t.env, s);
    expect(r.ok).toBe(false);
    expect(t.store["Anhänge/logo.svg"]).toBe(hand);
  });
});

describe("Übernehmen: Namen vergeben mit Folgerunde (Review C4, B2)", () => {
  const UNNAMED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect x="1"/>\n  <rect x="2"/>\n</svg>\n`;
  const session = (): SvgSession => {
    const s = ok(addRound({ target: FILE, rounds: EMPTY_ROUNDS, startText: UNNAMED }, { art: "names", instruction: "Assign names", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    return ok(addHandChange(s, [{ op: "change", id: "rect-2", attrs: { fill: "red" } }], "Von Hand"));
  };
  it("ein Rechteck ohne id wurde davor eingefügt → nichts geschrieben (nie das falsche Rechteck rot)", async () => {
    const hand = UNNAMED.replace(`  <rect x="1"/>`, `  <rect x="0"/>\n  <rect x="1"/>`);
    const t = acceptSetup({ "Anhänge/logo.svg": hand });
    const r = await run(t.env, session());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Die Elemente ohne Namen haben sich seit der Runde geändert");
    expect(t.store["Anhänge/logo.svg"]).toBe(hand);
    expect(t.order).toEqual([]);
  });
  it("unverändert → das zweite Rechteck wird rot", async () => {
    const t = acceptSetup({ "Anhänge/logo.svg": UNNAMED });
    const r = await run(t.env, session());
    expect(r.ok).toBe(true);
    expect(t.store["Anhänge/logo.svg"]).toContain(`<rect x="2" id="rect-2" fill="red"/>`);
  });
});

describe("Übernehmen: Meldungen (Review C4)", () => {
  it("Lesemodus, die Notiz endet in einem offenen Zaun: die Meldung nennt weder Cursor noch Auswahl, nichts geschrieben", async () => {
    const t = acceptSetup({ "n.md": "intro\n```js\nlet x" }, { acceptAs: "block", reading: true });
    const r = await run(t.env, newSession());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("never closed");
    expect(r.message).not.toMatch(/cursor|selection/i);
    expect(t.store["n.md"]).toBe("intro\n```js\nlet x");
  });
});
