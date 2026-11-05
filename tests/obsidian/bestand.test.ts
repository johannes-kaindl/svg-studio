// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignMissingIds } from "../../src/core/format";
import type { SvgSession } from "../../src/core/session";
import { bestandProblems, repairProblem } from "../../src/obsidian/panel/bestand";
import { buildPanelShell, type PanelDeps, type PanelShell } from "../../src/obsidian/panel/shell";
import { freshSession, roundMeta, svgSlots } from "../../src/obsidian/panel/slots";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import { checkSvg } from "../../src/vendor/kit/svg-guard";
import type { Target } from "../../src/vendor/kit/panel-session";
import { answer, fakeLlm, type Responder } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

const INKSCAPE = readFileSync("tests/fixtures/inkscape-probe.svg", "utf8");
const CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="mond" r="40"/>\n</svg>\n`;
const UNNAMED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect/>\n  <circle id="a" r="4"/>\n  <rect x="3"/>\n  <path d="M0 0"/>\n</svg>\n`;
const BROKEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g"><circle id="mond" r="4"/></svg>`;
const FIXED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g"><circle id="mond" r="4"/></g></svg>`;
const FILE: Target = { kind: "file", path: "logo.svg", label: "logo.svg" };

beforeEach(() => { document.body.replaceChildren(); initStrings("en"); });

describe("bestandProblems", () => {
  it("ein sauberes SVG hat keinen Befund", () => {
    expect(bestandProblems(CLEAN, checkSvg)).toEqual({ parse: null, guard: [], unnamed: 0, editorMetadata: false });
  });

  it("Inkscape-Fixture: Editor-Angaben erkannt, der Bereiniger lehnt ab; die Kinder der entfernbaren Metadaten zählen nicht als „ohne Namen“", () => {
    const b = bestandProblems(INKSCAPE, checkSvg);
    expect(b.editorMetadata).toBe(true);
    expect(b.parse).toBeNull();
    expect(b.guard.length).toBeGreaterThan(0);
    expect(b.unnamed).toBe(0);
  });

  it("drei Elemente ohne id → unnamed: 3", () => {
    expect(bestandProblems(UNNAMED, checkSvg)).toMatchObject({ parse: null, guard: [], unnamed: 3, editorMetadata: false });
  });

  it("kaputtes XML → parse trägt das Parserproblem, nichts anderes wird gezählt", () => {
    const b = bestandProblems(BROKEN, checkSvg);
    expect(b.parse).toEqual({ message: expect.any(String), offset: expect.any(Number) });
    expect(b).toMatchObject({ unnamed: 0, editorMetadata: false });
    // Der Satz für das Modell bleibt deutsch (gewollt), der für den Nutzer entsteht in der Oberfläche.
    expect(repairProblem(b)).toMatch(/^Das SVG ist nicht wohlgeformt: .*\(Offset \d+\)\.$/);
  });

  it("repairProblem: bei too-costly mit dem Hinweis für das Modell", () => {
    const b = { parse: null, guard: [{ code: "too-costly" as const, detail: "d" }], unnamed: 0, editorMetadata: false };
    expect(repairProblem(b)).toBe("Der Bereiniger lehnt ab: too-costly: d. Das SVG ist zu aufwendig zu zeichnen; nimm weniger verschachtelte Masken, Marker, Filter und Weichzeichner.");
  });

  it("repairProblem: ohne Parserfehler die Bereiniger-Befunde", () => {
    expect(repairProblem(bestandProblems(INKSCAPE, checkSvg))).toMatch(/^Der Bereiniger lehnt ab: .*sodipodi|inkscape/);
  });
});

interface Setup { root: HTMLElement; shell: PanelShell<SvgSession>; requests: ReturnType<typeof fakeLlm>["requests"]; complete: ReturnType<typeof fakeLlm>["complete"] }
function setup(text: string | null, responders: Responder[] = [answer(FIXED)], target: Target = FILE): Setup {
  const { llm, complete, requests } = fakeLlm(responders);
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const read = vi.fn(async () => text);
  const slots = svgSlots({ llm, readTargetText: read, thinkingOn: () => false, background: { get: () => ({ on: true, tone: "light", hex: "#ffffff" }), set: () => {} } });
  const deps: PanelDeps<SvgSession> = {
    app: {} as never, llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: read, accept: () => Promise.resolve({ ok: false, message: "x" }), openSettings: () => {},
    confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
  };
  const shell = buildPanelShell(root, deps, slots, freshSession(target));
  shell.setTarget(target);
  return { root, shell, requests, complete };
}
const notice = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".svg-studio-notice");
const button = (root: HTMLElement, text: string): HTMLButtonElement | null => [...root.querySelectorAll<HTMLButtonElement>(".svg-studio-notice button")].find((b) => b.textContent === text) ?? null;
const shown = async (root: HTMLElement): Promise<HTMLElement> => {
  await vi.waitFor(() => { expect(notice(root)).not.toBeNull(); });
  return notice(root)!;
};
const status = (root: HTMLElement): string => root.querySelector(".svg-studio-status .okit-status-label")?.textContent ?? "";

describe("Bestand beim Öffnen: Editor-Angaben (Inkscape)", () => {
  it("zeigt den Hinweis mit „Remove editor data“ (und „Repair“); das Ergebnis der Regelrunde besteht checkSvg", async () => {
    const s = setup(INKSCAPE);
    await shown(s.root);
    expect(button(s.root, "Remove editor data")).not.toBeNull();
    expect(button(s.root, "Repair")).not.toBeNull();
    expect(button(s.root, "Assign names")).toBeNull();
    button(s.root, "Remove editor data")!.click();
    const session = s.shell.session();
    expect(session.rounds.rounds).toHaveLength(1);
    const round = session.rounds.rounds[0]!;
    expect(round).toMatchObject({ art: "cleanup", body: { form: "rule", rule: "strip-editor-metadata" } });
    expect(checkSvg(round.result).ok).toBe(true);
    expect(round.result).not.toMatch(/inkscape|sodipodi|rdf/);
    expect(session.startText).toBe(INKSCAPE);
    expect(s.complete).not.toHaveBeenCalled(); // ohne Modell
    expect(status(s.root)).toMatch(/^Editor data removed/);
  });

  it("zeigt, was entfernt wird, in der Änderungsliste (das Diff Ausgang → Ergebnis)", async () => {
    const s = setup(INKSCAPE);
    await shown(s.root);
    button(s.root, "Remove editor data")!.click();
    // Eine Regelrunde hat nichts zu entscheiden: sie zeigt ihre Änderungen als Redline-Zeilen, ohne Annehmen und Ablehnen.
    const items = [...s.root.querySelectorAll(".svg-studio-rule-line")].map((li) => li.textContent);
    expect(items.length).toBeGreaterThan(0);
    expect(items.join("|")).toMatch(/namedview1: removed/);
    expect(s.root.querySelector(".svg-studio-changes .okit-review-card")).toBeNull();
  });

  it("nach der Regelrunde ist der Hinweis weg (der Text der aktiven Runde ist sauber)", async () => {
    const s = setup(INKSCAPE);
    await shown(s.root);
    button(s.root, "Remove editor data")!.click();
    await vi.waitFor(() => { expect(notice(s.root)).toBeNull(); });
  });
});

describe("Bestand beim Öffnen: Elemente ohne id (Entscheidung 13)", () => {
  it("zeigt „3 element(s) have no name“ mit „Assign names“; die Runde vergibt die Namen byte-treu", async () => {
    const s = setup(UNNAMED);
    const n = await shown(s.root);
    expect(n.textContent).toContain("3 element(s) have no name (id).");
    expect(button(s.root, "Repair")).toBeNull();
    button(s.root, "Assign names")!.click();
    const round = s.shell.session().rounds.rounds[0]!;
    expect(round).toMatchObject({ art: "names", body: { form: "rule", rule: "assign-ids" } });
    expect(round.result).toBe(assignMissingIds(UNNAMED).text);
    // byte-treu: nimmt man die neu vergebenen ids wieder heraus, steht der Ausgang da
    expect(round.result.replace(/ id="(?!a")[^"]*"/g, "")).toBe(UNNAMED);
    expect(status(s.root)).toMatch(/^Names assigned/);
    await vi.waitFor(() => { expect(notice(s.root)).toBeNull(); });
  });

  it("der Hinweis erscheint ohne Senden; verfeinern geht erst danach (run.unnamed bleibt als Sicherung)", async () => {
    const s = setup(UNNAMED);
    await shown(s.root);
    const input = s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!;
    input.value = "mach es größer";
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
    await s.shell.settled();
    expect(s.complete).not.toHaveBeenCalled();
    expect(status(s.root)).toBe("3 element(s) have no name (id). Changing needs a name on every element.");
  });
});

describe("Bestand beim Öffnen: kaputt oder abgelehnt → Reparieren", () => {
  it("kaputtes XML: „Repair“ baut die Nachricht mit dem Parserproblem; die Runde ist art repair, form whole", async () => {
    const s = setup(BROKEN);
    const n = await shown(s.root);
    // Kein deutscher Rest im englischen Satz (Rest-Task C4, Punkt 9); die Scanner-Meldung selbst ist noch nicht übersetzt.
    expect(n.textContent).toMatch(/^This SVG can't be used as it is: The text is not readable: .* \(offset \d+\)\.Repair$/);
    expect(n.textContent).not.toContain("Das SVG ist nicht wohlgeformt");
    expect(button(s.root, "Assign names")).toBeNull();
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    expect(s.requests).toHaveLength(1);
    const user = s.requests[0]!.messages!.find((m) => m.role === "user")!.content;
    expect(user).toContain(BROKEN);
    expect(user).toContain("Das SVG ist fehlerhaft: Das SVG ist nicht wohlgeformt");
    const round = s.shell.session().rounds.rounds[0]!;
    expect(round).toMatchObject({ art: "repair", body: { form: "whole", text: FIXED, decision: "accepted" }, result: FIXED });
    expect(s.shell.session().startText).toBe(BROKEN);
    expect(status(s.root)).toMatch(/^Repair proposed/);
  });

  it("die Rückfrage läuft wie beim Erzeugen: erst ungültig, dann gültig → eine Runde nach zwei Anfragen", async () => {
    const s = setup(BROKEN, [answer("Tut mir leid."), answer(FIXED)]);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    expect(s.complete).toHaveBeenCalledTimes(2);
    expect(s.shell.session().rounds.rounds).toHaveLength(1);
  });

  it("ist auch die Reparatur ungültig, bleibt es ohne Runde bei einer Fehlermeldung", async () => {
    const s = setup(BROKEN, [answer("Tut mir leid.")]);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    expect(s.complete).toHaveBeenCalledTimes(3);
    expect(s.shell.session().rounds.rounds).toHaveLength(0);
    expect(status(s.root)).toContain("The answer could not be used");
  });

  it("vom Bereiniger abgelehnt (lesbar): die Reparatur zerlegt in Einträge, wenn sie kann", async () => {
    const WITH_COMMENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <style>/* x */ .a{}</style>\n  <circle id="mond" r="4"/>\n</svg>\n`;
    const repaired = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <circle id="mond" r="4"/>\n</svg>\n`;
    const s = setup(WITH_COMMENT, [answer(repaired)]);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    const round = s.shell.session().rounds.rounds[0]!;
    expect(round.art).toBe("repair");
    expect(round.result).toBe(repaired);
    expect(s.requests[0]!.messages!.find((m) => m.role === "user")!.content).toContain("Der Bereiniger lehnt ab: unsafe-css");
  });

  it("ein sauberes Ziel und ein neues SVG zeigen keinen Hinweis", async () => {
    const a = setup(CLEAN);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(notice(a.root)).toBeNull();
    const b = setup(null, [answer(FIXED)], { kind: "new" });
    await new Promise((r) => setTimeout(r, 5));
    expect(notice(b.root)).toBeNull();
  });

  it("während eines Laufs sind die Knöpfe des Hinweises gesperrt", async () => {
    const hang: Responder = () => new Promise(() => undefined);
    const s = setup(BROKEN, [hang]);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await vi.waitFor(() => { expect(s.shell.running()).toBe(true); });
    await vi.waitFor(() => { expect(button(s.root, "Repair")?.disabled ?? true).toBe(true); });
    // ein zweiter Klick startet keinen zweiten Lauf
    button(s.root, "Repair")?.click();
    expect(s.complete).toHaveBeenCalledTimes(1);
  });
});

describe("Bestand: Reihenfolge und Zwei-Schritt-Ablauf (Review C4)", () => {
  // Inkscape-Angaben an Elementen OHNE id: „Editor-Angaben entfernen“ geht erst nach „Namen vergeben“.
  const INK_UNNAMED = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10">\n  <g inkscape:label="Ebene"><circle r="4"/></g>\n</svg>\n`;
  const texts = (root: HTMLElement): string[] => [...root.querySelectorAll(".svg-studio-notice button")].map((b) => b.textContent ?? "");

  it("die Karten stehen in der Reihenfolge, in der sie gehen: Namen, dann Editor-Angaben", async () => {
    const s = setup(INK_UNNAMED);
    await shown(s.root);
    expect(texts(s.root)).toEqual(["Assign names", "Remove editor data"]);
  });

  it("mit abgelehntem SVG (hier: Skript) folgt „Repair“ zuletzt", async () => {
    const s = setup(INK_UNNAMED.replace("</svg>", "<script>x</script></svg>"));
    await shown(s.root);
    expect(texts(s.root)).toEqual(["Assign names", "Remove editor data", "Repair"]);
  });

  it("Namen vergeben, dann Editor-Angaben entfernen: die zweite Runde baut auf der ersten auf (basedOn 0) und der Text besteht checkSvg", async () => {
    const s = setup(INK_UNNAMED);
    await shown(s.root);
    button(s.root, "Assign names")!.click();
    await vi.waitFor(() => { expect(button(s.root, "Assign names")).toBeNull(); });
    button(s.root, "Remove editor data")!.click();
    const rounds = s.shell.session().rounds.rounds;
    expect(rounds.map((r) => r.art)).toEqual(["names", "cleanup"]);
    expect(rounds[1]!.basedOn).toBe(0);
    expect(status(s.root)).toMatch(/^Editor data removed/);
    expect(checkSvg(rounds[1]!.result).ok).toBe(true);
    expect(rounds[1]!.result).not.toMatch(/inkscape/);
    expect(s.shell.session().rounds.active).toBe(1);
  });

  it("ein veralteter Hinweis (langsames Lesen des ersten Ziels) überschreibt den Hinweis des zweiten nicht", async () => {
    const { llm } = fakeLlm([answer(FIXED)]);
    const root = document.body.createDiv({ cls: "view-content" }).createDiv();
    let release!: (t: string) => void;
    const slow = new Promise<string>((res) => { release = res; });
    const A: Target = { kind: "file", path: "a.svg", label: "a.svg" };
    const B: Target = { kind: "file", path: "b.svg", label: "b.svg" };
    const read = vi.fn(async (t: Target) => (t.kind === "file" && t.path === "a.svg" ? slow : CLEAN));
    const slots = svgSlots({ llm, readTargetText: read, thinkingOn: () => false, background: { get: () => ({ on: true, tone: "light", hex: "#ffffff" }), set: () => {} } });
    const deps: PanelDeps<SvgSession> = {
      app: {} as never, llm,
      thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
      readTargetText: read, accept: () => Promise.resolve({ ok: false, message: "x" }), openSettings: () => {},
      confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
    };
    const shell = buildPanelShell(root, deps, slots, freshSession(A));
    shell.setTarget(A);
    shell.setTarget(B); // ohne Runden gilt B sofort; B ist sauber
    await vi.waitFor(() => { expect(read.mock.calls.length).toBeGreaterThanOrEqual(3); }); // Aufbau, A angeboten, B angeboten (die Vorschau ohne Runde liest ebenfalls)
    release(BROKEN);
    await new Promise((r) => setTimeout(r, 10));
    expect(notice(root)).toBeNull();
  });
});

describe("Reparatur: Anzeige (Review C4, S3)", () => {
  it("eine Reparatur als „ganzes Bild“ steht in der Rundenliste als solche und der Änderungsbereich sagt, dass sich das ganze Bild ändert", async () => {
    const s = setup(BROKEN);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    expect(roundMeta(s.shell.session().rounds.rounds[0]!)).toBe("repair · whole image");
    const card = s.root.querySelector(".svg-studio-changes .okit-review-card")!;
    expect(card.querySelector(".okit-redline")!.textContent).toBe("Repair: whole image");
  });

  it("auf Deutsch", async () => {
    initStrings("de");
    const s = setup(BROKEN);
    await shown(s.root);
    button(s.root, "Reparieren")!.click();
    await s.shell.settled();
    expect(roundMeta(s.shell.session().rounds.rounds[0]!)).toBe("Reparatur · ganzes Bild");
    expect(s.root.querySelector(".svg-studio-changes .okit-redline")!.textContent).toBe("Reparatur: ganzes Bild");
  });

  it("scheitert die Reparatur, passt der Hinweis zur Reparatur und nicht zum Ändern („simpler wording“)", async () => {
    const s = setup(BROKEN, [answer("Tut mir leid.")]);
    await shown(s.root);
    button(s.root, "Repair")!.click();
    await s.shell.settled();
    expect(status(s.root)).toContain("The answer could not be used");
    expect(status(s.root)).toContain("The repair did not produce a usable SVG; nothing was changed.");
    expect(status(s.root)).not.toMatch(/simpler|applied to the image/);
  });
});

describe("Karte „Reparieren“: Befunde als Liste, gekürzt (C5)", () => {
  const MANY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${"<script>x</script>".repeat(8)}<a id="a"/><image id="i"/></svg>`;
  const items = (root: HTMLElement): string[] => [...root.querySelectorAll(".svg-studio-notice-list li")].map((li) => li.textContent ?? "");

  it("zehn Befunde: die ersten fünf stehen als Liste, dann „… and 5 more“; der Knopf steht außerhalb der Liste", async () => {
    const s = setup(MANY);
    await shown(s.root);
    const li = items(s.root);
    expect(li).toHaveLength(6);
    expect(li[0]).toMatch(/^forbidden-element: /);
    expect(li[5]).toBe("… and 5 more");
    expect(s.root.querySelector(".svg-studio-notice-list")!.closest(".svg-studio-notice-text")!.textContent).toContain("This SVG can't be used as it is:");
    expect(button(s.root, "Repair")!.closest("ul")).toBeNull();
  });

  it("auf Deutsch: „… und 5 weitere“", async () => {
    initStrings("de");
    const s = setup(MANY);
    await shown(s.root);
    expect(items(s.root).at(-1)).toBe("… und 5 weitere");
  });

  it("genau fünf Befunde: keine Kürzung; ein einzelnes Parserproblem bleibt ein Satz ohne Liste", async () => {
    const five = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${"<script>x</script>".repeat(5)}</svg>`;
    const a = setup(five);
    await shown(a.root);
    expect(items(a.root)).toHaveLength(5);
    expect(items(a.root).join("|")).not.toContain("more");
    const b = setup(BROKEN);
    const n = await shown(b.root);
    expect(items(b.root)).toHaveLength(0);
    expect(n.textContent).toContain("This SVG can't be used as it is: The text is not readable:");
  });
});

// Opus-Gesamtreview 2026-11-05, Befund 9: „Reparieren“ wurde auch bei einem SVG über der Größengrenze angeboten und hätte über 1 MB ans Modell geschickt.
describe("renderBestandNotice: keine Reparatur für zu große SVGs", () => {
  const actions = { repair: vi.fn(), names: vi.fn(), cleanup: vi.fn() };
  it("too-large und too-many-elements: die Karte nennt den Befund, bietet aber keinen Reparaturknopf", async () => {
    const { renderBestandNotice } = await import("../../src/obsidian/panel/bestand");
    for (const code of ["too-large", "too-many-elements"] as const) {
      const host = document.createElement("div");
      renderBestandNotice(host, { parse: null, guard: [{ code, detail: "zu groß" }], unnamed: 0, editorMetadata: false }, actions, false);
      expect(host.textContent).toContain(code);
      expect(host.querySelector("button")).toBeNull();
    }
  });
  it("ein anderer Befund (parse-error) behält den Knopf", async () => {
    const { renderBestandNotice } = await import("../../src/obsidian/panel/bestand");
    const host = document.createElement("div");
    renderBestandNotice(host, { parse: null, guard: [{ code: "not-svg", detail: "x" }], unnamed: 0, editorMetadata: false }, actions, false);
    expect(host.querySelector("button")).not.toBeNull();
  });
});
