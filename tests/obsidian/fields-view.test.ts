// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SvgSession } from "../../src/core/session";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import { buildPanelShell, type PanelDeps, type PanelShell } from "../../src/obsidian/panel/shell";
import { freshSession, svgSlots } from "../../src/obsidian/panel/slots";
import type { Target } from "../../src/vendor/kit/panel-session";
import { answer, fakeLlm, type Responder } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

const NS = `xmlns="http://www.w3.org/2000/svg"`;
const BASE = `<svg ${NS} viewBox="0 0 100 100">\n  <circle id="mond" r="40" fill="#fff"/>\n  <rect id="tuer" x="80" width="5%"/>\n  <path id="weg" d="M0 0L9 9"/>\n  <text id="titel" x="1">Hallo</text>\n</svg>\n`;
const ANSWER = BASE.replace(`r="40"`, `r="45"`);
const FILE: Target = { kind: "file", path: "logo.svg", label: "logo.svg" };
const BG = { get: () => ({ on: true, tone: "light" as const, hex: "#ffffff" }), set: () => undefined };

beforeEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); initStrings("de"); });

interface Setup { root: HTMLElement; shell: PanelShell<SvgSession>; accept: ReturnType<typeof vi.fn>; releaseAccept: () => void }

function setup(responders: Responder[] = [answer(ANSWER)], o: { hangAccept?: boolean } = {}): Setup {
  const { llm } = fakeLlm(responders);
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const read = vi.fn(async () => BASE);
  const slots = svgSlots({ llm, readTargetText: read, thinkingOn: () => false, background: BG });
  let release: () => void = () => undefined;
  const accept = vi.fn(() => (o.hangAccept === true ? new Promise<never>((res) => { release = () => { res({ ok: false, message: "x" } as never); }; }) : Promise.resolve({ ok: false as const, message: "x" })));
  const deps: PanelDeps<SvgSession> = {
    app: {} as never, llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: read, accept, openSettings: () => undefined,
    confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
  };
  return { root, shell: buildPanelShell(root, deps, slots, freshSession(FILE)), accept, releaseAccept: () => { release(); } };
}

async function send(s: Setup, text: string): Promise<void> {
  s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!.value = text;
  s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
  await s.shell.settled();
}
const shadow = (s: Setup): ShadowRoot => s.root.querySelector<HTMLElement>(".svg-studio-preview-host .svg-studio-stage")!.shadowRoot!;
const clickEl = (s: Setup, id: string): void => { shadow(s).querySelector(`#${id}`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true })); };
const field = (s: Setup, name: string): HTMLInputElement => s.root.querySelector<HTMLInputElement>(`.svg-studio-fields input[data-field="${name}"]`)!;
const fieldNames = (s: Setup): string[] => [...s.root.querySelectorAll<HTMLInputElement>(".svg-studio-fields input")].map((i) => i.dataset.field!);
const key = (input: HTMLInputElement, k: string): void => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
const type = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
const enter = (s: Setup, name: string, value: string): void => { const i = field(s, name); type(i, value); key(i, "Enter"); };
const rounds = (s: Setup) => s.shell.session().rounds.rounds;
const previewSvg = (s: Setup): Element => shadow(s).querySelector("svg")!;

async function ready(): Promise<Setup> {
  const s = setup();
  await send(s, "größer");
  return s;
}

describe("Zahlenfelder im Panel: Auswahl zeigt die Felder", () => {
  it("ohne Auswahl steht ein Hinweis, nach einem Klick die Felder des Elements in der Reihenfolge der Spec", async () => {
    const s = await ready();
    expect(s.root.querySelector(".svg-studio-fields")).toBeNull();
    expect(s.root.querySelector(".svg-studio-fields-hint")!.textContent).toBe("Ein Element in der Vorschau anklicken, um seine Werte von Hand zu ändern.");
    clickEl(s, "mond");
    expect(s.root.querySelector(".svg-studio-fields-hint")).toBeNull();
    expect(fieldNames(s)).toEqual(["cx", "cy", "r", "fill", "stroke", "stroke-width", "rotate"]);
    expect(field(s, "r").value).toBe("45");
    expect(field(s, "fill").value).toBe("#fff");
    clickEl(s, "weg");
    expect(fieldNames(s)).toEqual(["translate-x", "translate-y", "fill", "stroke", "stroke-width", "rotate"]);
    clickEl(s, "titel");
    expect(fieldNames(s)).toContain("text");
    expect(field(s, "text").value).toBe("Hallo");
  });

  it("die Überschrift nennt Art und id; die Felder liegen unter Vorschau und Maßzeile, in der Vorschau-Hülle", async () => {
    const s = await ready();
    clickEl(s, "mond");
    expect(s.root.querySelector(".svg-studio-fields-head")!.textContent).toBe("Werte von Kreis mond");
    const wrap = s.root.querySelector(".svg-studio-preview")!;
    expect([...wrap.children].map((c) => c.className.split(" ")[0])).toEqual(["svg-studio-preview-caption", "svg-studio-preview-host", "svg-studio-fields-host"]);
  });

  it("Zahlenfelder tragen inputmode=\"decimal\", Text und Farbe nicht; jedes Feld hat ein Label mit for", async () => {
    const s = await ready();
    clickEl(s, "titel");
    for (const n of ["x", "y", "font-size", "stroke-width", "rotate"]) expect(field(s, n).getAttribute("inputmode"), n).toBe("decimal");
    expect(field(s, "text").getAttribute("inputmode")).toBeNull();
    expect(field(s, "fill").getAttribute("inputmode")).toBeNull();
    for (const input of s.root.querySelectorAll<HTMLInputElement>(".svg-studio-fields input")) {
      const label = s.root.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
      expect(label, input.dataset.field).not.toBeNull();
      expect(input.tabIndex).toBeGreaterThanOrEqual(0);
    }
    expect(s.root.querySelector(`label[for="${field(s, "rotate").id}"]`)!.textContent).toBe("Drehen (°)");
  });

  it("Auswahl über die Prüfliste (Sprung) zeigt die Felder ebenfalls", async () => {
    const s = await ready();
    s.root.querySelector<HTMLElement>(".svg-studio-changes .okit-review-main")!.click();
    expect(fieldNames(s)).toContain("r");
  });
});

describe("Zahlenfelder im Panel: Handrunden", () => {
  it("Enter erzeugt eine Handrunde „Von Hand: mond r 60“; die Vorschau zeigt den neuen Stand, die Auswahl bleibt, die Maßzeile misst neu", async () => {
    // Das Maß des Kreises folgt seinem Radius, wie der Browser es messen würde.
    let p: object | null = Object.getPrototypeOf(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
    while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
    vi.spyOn(p as { getBBox: () => unknown }, "getBBox").mockImplementation(function (this: Element) {
      const r = Number(this.getAttribute("r") ?? 0);
      return { x: 0, y: 0, width: r * 2, height: r * 2 };
    });
    const s = await ready();
    clickEl(s, "mond");
    expect(s.root.querySelector(".svg-studio-measure")!.textContent).toContain("mond: 90 × 90");
    enter(s, "r", "60");
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]).toMatchObject({ art: "hand", instruction: "Von Hand: mond r 60", basedOn: 0 });
    expect(rounds(s)[1]!.result).toBe(ANSWER.replace(`r="45"`, `r="60"`));
    expect(previewSvg(s).querySelector("#mond")!.getAttribute("r")).toBe("60");
    expect(field(s, "r").value).toBe("60"); // Felder nach der Auswahl neu gezeichnet, Auswahl bleibt
    expect(s.root.querySelector(".svg-studio-fields-head")!.textContent).toBe("Werte von Kreis mond");
    expect(s.root.querySelector(".svg-studio-measure")!.textContent).toContain("mond: 120 × 120");
    expect(s.root.querySelector(".svg-studio-rounds")!.textContent).toContain("Von Hand: mond r 60");
  });

  it("englisch: „By hand: mond r 60“", async () => {
    initStrings("en");
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "r", "60");
    expect(rounds(s)[1]!.instruction).toBe("By hand: mond r 60");
  });

  it("die zweite Änderung landet in derselben Runde (anderes Element, anderes Feld)", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "r", "60");
    clickEl(s, "tuer");
    enter(s, "x", "90,5");
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]!.instruction).toBe("Von Hand: mond r 60, tuer x 90.5");
    expect(rounds(s)[1]!.result).toBe(ANSWER.replace(`r="45"`, `r="60"`).replace(`x="80"`, `x="90.5"`));
  });

  it("nach Enter hat dasselbe Feld wieder den Fokus (Tastaturbedienung)", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "cx", "5");
    expect(document.activeElement).toBe(field(s, "cx"));
    expect(field(s, "cx").value).toBe("5");
  });

  it("Verlassen des Felds (change) bestätigt ebenfalls; blur ohne Änderung nicht", async () => {
    const s = await ready();
    clickEl(s, "mond");
    field(s, "r").dispatchEvent(new Event("blur"));
    expect(rounds(s)).toHaveLength(1);
    const i = field(s, "r");
    i.value = "7";
    i.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]!.instruction).toBe("Von Hand: mond r 7");
  });

  it("Farbe und Text gehen denselben Weg; leeres fill-Feld entfernt das Attribut", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "fill", "");
    expect(rounds(s)[1]!.result).not.toContain(`fill="#fff"`);
    clickEl(s, "titel");
    enter(s, "text", "Welt & mehr");
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]!.result).toContain(`<text id="titel" x="1">Welt &amp; mehr</text>`);
    expect(rounds(s)[1]!.instruction).toBe("Von Hand: mond fill –, titel");
  });

  it("geschrieben wird nichts: weder accept noch die Notiz; die Handrunde wartet auf Übernehmen", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "r", "60");
    expect(s.accept).not.toHaveBeenCalled();
  });

  it("Rückwahl auf Runde 1 und Handänderung: neue Handrunde auf Runde 1, die erste Handrunde bleibt wählbar", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "r", "60");
    s.root.querySelectorAll<HTMLElement>(".svg-studio-rounds .okit-vlist-row")[0]!.click();
    expect(s.shell.session().rounds.active).toBe(0);
    clickEl(s, "tuer");
    enter(s, "x", "5");
    expect(rounds(s)).toHaveLength(3);
    expect(rounds(s)[2]).toMatchObject({ art: "hand", basedOn: 0, instruction: "Von Hand: tuer x 5" });
    expect(rounds(s)[1]!.result).toContain(`r="60"`);
    expect(rounds(s)[2]!.result).toContain(`r="45"`);
  });
});

describe("Zahlenfelder im Panel: ungültige Eingaben und Schreibschutz", () => {
  it("keine Zahl: das Problem steht am Feld (übersetzt), aria-invalid, die Sitzung bleibt", async () => {
    const s = await ready();
    clickEl(s, "mond");
    const before = s.shell.session();
    enter(s, "r", "abc");
    expect(s.shell.session()).toBe(before);
    const i = field(s, "r");
    expect(i.getAttribute("aria-invalid")).toBe("true");
    expect(i.classList.contains("is-invalid")).toBe(true);
    const note = document.getElementById(i.getAttribute("aria-describedby")!)!;
    expect(note.textContent).toBe("„abc“ ist keine Zahl für „r“. Ziffern mit Punkt oder Komma, ohne Einheit.");
    expect(i.value).toBe("abc"); // die Eingabe bleibt zum Korrigieren stehen
    type(i, "50"); // Tippen nimmt die Meldung zurück
    expect(i.getAttribute("aria-invalid")).toBeNull();
    key(i, "Enter");
    expect(rounds(s)).toHaveLength(2);
  });

  it("englisch: Meldung auf Englisch; negativer Radius, leeres Geometriefeld, falsche Farbe", async () => {
    initStrings("en");
    const s = await ready();
    clickEl(s, "mond");
    const note = (n: string): string => document.getElementById(field(s, n).getAttribute("aria-describedby")!)!.textContent!;
    enter(s, "r", "-3");
    expect(note("r")).toBe("The field “r” cannot be negative.");
    enter(s, "cx", "5");
    clickEl(s, "mond");
    enter(s, "cy", "  ");
    expect(rounds(s).length).toBe(2); // nur die gültige Änderung
    enter(s, "stroke", "rot;");
    expect(note("stroke")).toContain("is not a colour for “stroke”");
    expect(rounds(s).length).toBe(2);
  });

  it("Escape verwirft die Eingabe", async () => {
    const s = await ready();
    clickEl(s, "mond");
    const i = field(s, "r");
    type(i, "99");
    key(i, "Escape");
    expect(i.value).toBe("45");
    expect(rounds(s)).toHaveLength(1);
  });

  it("Wert mit Prozent: Feld schreibgeschützt, mit Grund; Enter schreibt nichts", async () => {
    const s = await ready();
    clickEl(s, "tuer");
    const w = field(s, "width");
    expect(w.readOnly).toBe(true);
    expect(w.getAttribute("aria-readonly")).toBe("true");
    expect(document.getElementById(w.getAttribute("aria-describedby")!)!.textContent).toBe("Ein Wert mit Einheit oder Prozent: im Code ändern.");
    w.value = "7";
    key(w, "Enter");
    w.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rounds(s)).toHaveLength(1);
  });
});

describe("Zahlenfelder im Panel: Drehen misst die Mitte im Browser", () => {
  const proto = (): { getBBox: () => unknown } => {
    let p: object | null = Object.getPrototypeOf(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
    while (p !== null && !Object.getOwnPropertyDescriptor(p, "getBBox")) p = Object.getPrototypeOf(p);
    return p as { getBBox: () => unknown };
  };

  it("rotate(30 cx cy) mit der Mitte von getBBox des Elements; eine zweite Drehung behält die Mitte", async () => {
    vi.spyOn(proto(), "getBBox").mockImplementation(function (this: Element) {
      return this.getAttribute("id") === "weg" ? { x: 200, y: 180, width: 20, height: 25 } : { x: 0, y: 0, width: 0, height: 0 };
    });
    const s = await ready();
    clickEl(s, "weg");
    enter(s, "rotate", "30");
    expect(rounds(s)[1]!.result).toContain(`<path id="weg" d="M0 0L9 9" transform="rotate(30 210 192.5)"/>`);
    expect(field(s, "rotate").value).toBe("30");
    enter(s, "rotate", "45");
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]!.result).toContain(`transform="rotate(45 210 192.5)"`);
  });

  it("ohne messbare Mitte (kein Layout): Problem am Feld, nichts geändert", async () => {
    const s = await ready();
    clickEl(s, "weg");
    enter(s, "rotate", "30");
    expect(rounds(s)).toHaveLength(1);
    expect(document.getElementById(field(s, "rotate").getAttribute("aria-describedby")!)!.textContent).toBe("Die Mitte des Elements ließ sich nicht messen; jetzt lässt es sich nicht drehen.");
  });

  it("Verschieben: translate-x setzt translate", async () => {
    const s = await ready();
    clickEl(s, "weg");
    enter(s, "translate-x", "12");
    expect(rounds(s)[1]!.result).toContain(`transform="translate(12 0)"`);
    expect(rounds(s)[1]!.instruction).toBe("Von Hand: weg transform translate(12 0)");
  });
});

describe("Zahlenfelder im Panel: Gleichzeitigkeit (Review-Fokus 4)", () => {
  it("Enter, danach change und blur auf demselben Feld: genau EINE Änderung, genau ein Eintrag", async () => {
    const s = await ready();
    clickEl(s, "mond");
    const i = field(s, "r");
    type(i, "60");
    key(i, "Enter");
    const after = s.shell.session();
    i.dispatchEvent(new Event("change", { bubbles: true })); // das Feld ist schon aus dem Baum
    i.dispatchEvent(new Event("blur"));
    key(i, "Enter");
    expect(s.shell.session()).toBe(after); // keine zweite Sitzung: kein zweiter Schreibvorgang auf die Runden
    expect(rounds(s)).toHaveLength(2);
    const b = rounds(s)[1]!.body;
    expect(b.form === "list" && b.entries).toHaveLength(1);
  });

  it("zweimal Enter hintereinander im neu gezeichneten Feld: der zweite sieht keine Änderung mehr", async () => {
    const s = await ready();
    clickEl(s, "mond");
    enter(s, "r", "60");
    const after = s.shell.session();
    key(field(s, "r"), "Enter");
    expect(s.shell.session()).toBe(after);
    expect(rounds(s)).toHaveLength(2);
    expect(rounds(s)[1]!.instruction).toBe("Von Hand: mond r 60");
  });

  it("während eines Laufs sind die Felder gesperrt, Enter schreibt nichts; nach dem Abbruch gehen sie wieder", async () => {
    let release: (r: unknown) => void = () => undefined;
    const hang: Responder = () => new Promise((res) => { release = res; });
    const s = setup([answer(ANSWER), hang]);
    await send(s, "größer");
    clickEl(s, "mond");
    s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!.value = "mehr";
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
    await vi.waitFor(() => { expect(s.shell.running()).toBe(true); });
    const inputs = [...s.root.querySelectorAll<HTMLInputElement>(".svg-studio-fields input")];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.disabled)).toBe(true);
    type(field(s, "r"), "99");
    key(field(s, "r"), "Enter");
    field(s, "r").dispatchEvent(new Event("change", { bubbles: true }));
    expect(rounds(s)).toHaveLength(1);
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-stop")!.click();
    release({ ok: false, kind: "aborted", detail: "aborted", partial: "", reasoning: "", timing: { startedAt: 0, endedAt: 0 }, facts: null, deviations: [], source: { kind: "local" } });
    await s.shell.settled();
    expect(field(s, "r").disabled).toBe(false);
    enter(s, "r", "99");
    expect(rounds(s)).toHaveLength(2);
  });

  it("während Übernehmen schreibt (accept hängt): Felder gesperrt, Enter erzeugt keine Runde, accept wurde genau einmal gerufen", async () => {
    const s = setup([answer(ANSWER)], { hangAccept: true });
    await send(s, "größer");
    clickEl(s, "mond");
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-accept")!.click();
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-accept")!.click();
    expect(s.accept).toHaveBeenCalledTimes(1);
    expect(field(s, "r").disabled).toBe(true);
    type(field(s, "r"), "99");
    key(field(s, "r"), "Enter");
    field(s, "r").dispatchEvent(new Event("change", { bubbles: true }));
    expect(rounds(s)).toHaveLength(1);
    s.releaseAccept();
    await s.shell.settled();
    expect(s.accept).toHaveBeenCalledTimes(1);
    expect(rounds(s)).toHaveLength(1);
    expect(field(s, "r").disabled).toBe(false);
  });
});
