// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diffSvg } from "../../src/core/diff";
import type { Problem } from "../../src/core/problem";
import { addRound, decide, type SvgRound, type SvgSession } from "../../src/core/session";
import { initStrings, panelStrings } from "../../src/i18n/strings";
import type { RenderGuard } from "../../src/obsidian/render-guard";
import { renderReview } from "../../src/obsidian/panel/review";
import { MID_COST_SVG } from "../helpers/costly-svg";
import { runSvgPrompt } from "../../src/obsidian/panel/run";
import { buildPanelShell, type ChangesCtx, type PanelDeps, type PanelShell, type RunIo } from "../../src/obsidian/panel/shell";
import { freshSession, svgSlots } from "../../src/obsidian/panel/slots";
import type { Target } from "../../src/vendor/kit/panel-session";
import { activeRound, EMPTY_ROUNDS, selectRound } from "../../src/vendor/kit/rounds";
import { answer, fakeLlm, type Responder } from "../helpers/fake-llm";
import { installObsidianDom } from "../helpers/obsidian-dom";

installObsidianDom();
(globalThis as { activeDocument?: Document }).activeDocument = document;

const BASE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="mond" r="40"/>\n  <rect id="tuer" x="80"/>\n</svg>\n`;
const ANSWER = BASE.replace(`r="40"`, `r="60"`).replace(`x="80"`, `x="90"`);
const FILE: Target = { kind: "file", path: "logo.svg", label: "logo.svg" };
const BG = { get: () => ({ on: true, tone: "light" as const, hex: "#ffffff" }), set: () => undefined };

beforeEach(() => { document.body.replaceChildren(); initStrings("en"); });

const ok = <T>(r: T | { problem: Problem }): T => {
  if (typeof r === "object" && r !== null && "problem" in r) throw new Error(r.problem.code);
  return r;
};
const entriesOf = (base: string, answerText: string): SvgRound["body"] => {
  const d = diffSvg(base, answerText);
  if (!d.decomposable) throw new Error(d.why);
  return { form: "list", entries: d.entries, decisions: [] };
};
const open = (startText: string | null): SvgSession => ({ target: startText === null ? { kind: "new" } : FILE, rounds: EMPTY_ROUNDS, startText });
const withRound = (): SvgSession => ok(addRound(open(BASE), { art: "prompt", instruction: "größer", basedOn: null, body: entriesOf(BASE, ANSWER) }));

// ---- Ohne Shell: die Prüfliste mit einem Kontext, der die Sitzung hält ------------------------------------------------------------
function harness(start: SvgSession, o: { renderGuard?: RenderGuard; busy?: boolean; busyNow?: () => boolean; comment?: (initial: string) => Promise<string | null>; track?: (destroy: () => void) => void } = {}) {
  let session = start;
  const host = document.body.createDiv();
  const statuses: string[] = [];
  const jumps: string[] = [];
  const ctx: ChangesCtx<SvgSession> = {
    busy: () => o.busy === true || o.busyNow?.() === true,
    session: () => session,
    setSession: (s) => { session = s; draw(); },
    setStatus: (_p, text) => { statuses.push(text); },
  };
  function draw(): void {
    host.empty();
    renderReview(host, activeRound(session.rounds), session, ctx, { background: BG, ...(o.renderGuard === undefined ? {} : { renderGuard: o.renderGuard }), ...(o.track === undefined ? {} : { track: o.track }), jump: (id) => { jumps.push(id); }, ...(o.comment === undefined ? {} : { comment: o.comment }) });
  }
  draw();
  const cards = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".okit-review-card")];
  const click = (card: HTMLElement, cls: string): void => { card.querySelector<HTMLButtonElement>(`button.${cls}`)!.click(); };
  /** Die Sitzung hinter dem Rücken der gezeichneten Karten ersetzen (eine Runde kam dazu, das Zeichnen steht noch). */
  const swap = (next: SvgSession): void => { session = next; };
  return { host, session: () => session, statuses, jumps, cards, click, swap };
}

describe("Prüfliste: Karten aus den Einträgen der aktiven Runde", () => {
  it("eine Karte je Eintrag, Vorgabe angenommen (E3), mit Beschriftung und Redline", () => {
    const h = harness(withRound());
    const cards = h.cards();
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.classList.contains("is-accepted")).toBe(true);
      expect(c.querySelector("button.okit-review-accept")!.getAttribute("aria-pressed")).toBe("true");
      expect(c.querySelector("button.okit-review-reject")!.getAttribute("aria-pressed")).toBe("false");
      expect(c.querySelector(".okit-review-decided")!.textContent).toBe("Accepted");
    }
    expect(cards[0]!.querySelector(".okit-redline")!.textContent).toBe("Circle mond: r 40 → 60");
    expect(cards[0]!.querySelector(".okit-redline-del")!.textContent).toBe("40");
    expect(cards[0]!.querySelector(".okit-redline-ins")!.textContent).toBe("60");
    expect(cards[1]!.querySelector(".okit-redline")!.textContent).toContain("Rectangle tuer: x");
    expect(cards[0]!.querySelector(".okit-review-meta")!.textContent).toBe("Model · Round 1 · changed");
    expect(h.host.querySelector(".okit-review-count")!.textContent).toBe("2 change(s)");
  });

  it("auf Deutsch: Kreis, Annehmen, Angenommen", () => {
    initStrings("de");
    const h = harness(withRound());
    expect(h.cards()[0]!.querySelector(".okit-redline")!.textContent).toBe("Kreis mond: r 40 → 60");
    expect(h.cards()[0]!.querySelector("button.okit-review-accept")!.textContent).toBe("Annehmen");
    expect(h.cards()[0]!.querySelector(".okit-review-decided")!.textContent).toBe("Angenommen");
    expect(h.host.querySelector(".okit-review-bulk")!.textContent).toBe("Alle annehmenAlle ablehnen");
  });

  it("Ablehnen: die Sitzung ist aktualisiert (decide), das Ergebnis der Runde ohne den Eintrag; Karte abgelehnt, Annehmen holt ihn zurück", () => {
    const h = harness(withRound());
    h.click(h.cards()[0]!, "okit-review-reject");
    const r = h.session().rounds.rounds[0]!;
    expect(r.body).toMatchObject({ form: "list", decisions: [{ state: "rejected" }, { state: "accepted" }] });
    expect(r.result).toBe(BASE.replace(`x="80"`, `x="90"`)); // r bleibt 40, die Tür ist angenommen
    expect(h.cards()[0]!.classList.contains("is-rejected")).toBe(true);
    expect(h.cards()[0]!.querySelector("button.okit-review-reject")!.getAttribute("aria-pressed")).toBe("true");
    expect(h.cards()[0]!.querySelector(".okit-review-decided")!.textContent).toBe("Rejected");
    h.click(h.cards()[0]!, "okit-review-accept");
    expect(h.session().rounds.rounds[0]!.result).toBe(ANSWER);
  });

  it("Alle ablehnen und Alle annehmen", () => {
    const h = harness(withRound());
    h.host.querySelector<HTMLButtonElement>("button.okit-review-reject-all")!.click();
    expect(h.session().rounds.rounds[0]!.result).toBe(BASE);
    expect(h.cards().every((c) => c.classList.contains("is-rejected"))).toBe(true);
    h.host.querySelector<HTMLButtonElement>("button.okit-review-accept-all")!.click();
    expect(h.session().rounds.rounds[0]!.result).toBe(ANSWER);
    expect(h.cards().every((c) => c.classList.contains("is-accepted"))).toBe(true);
  });

  it("während eines Laufs oder Übernehmens passiert nichts (busy)", () => {
    const h = harness(withRound(), { busy: true });
    h.click(h.cards()[0]!, "okit-review-reject");
    h.host.querySelector<HTMLButtonElement>("button.okit-review-reject-all")!.click();
    expect(h.session().rounds.rounds[0]!.result).toBe(ANSWER);
  });

  it("ohne Kommentar-Dialog gibt es keine Kommentar-Taste, mit Dialog an jeder Karte (kein Ausblenden per CSS mehr)", () => {
    expect(harness(withRound()).host.querySelector(".okit-review-comment")).toBeNull();
    const h = harness(withRound(), { comment: () => Promise.resolve(null) });
    expect(h.host.querySelectorAll(".okit-review-comment")).toHaveLength(2);
    expect(h.host.querySelector(".okit-review-comment")!.textContent).toBe("Comment");
  });

  it("Klick auf den Kartenrumpf: die Vorschau springt zum Element; Wurzel, Stil und Titel springen nicht", () => {
    const h = harness(withRound());
    h.cards()[1]!.querySelector<HTMLElement>(".okit-review-main")!.click();
    expect(h.jumps).toEqual(["tuer"]);
    const root = BASE.replace(`viewBox="0 0 100 100"`, `viewBox="0 0 200 100"`);
    const r = harness(ok(addRound(open(BASE), { art: "prompt", instruction: "x", basedOn: null, body: entriesOf(BASE, root) })));
    r.cards()[0]!.querySelector<HTMLElement>(".okit-review-main")!.click();
    expect(r.jumps).toEqual([]);
    expect(r.cards()[0]!.querySelector(".okit-redline")!.textContent).toContain("Canvas: viewBox");
  });
});

describe("Prüfliste: Kommentar (obsidian-kit 0.80.0 promptText)", () => {
  const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); };

  it("die Taste öffnet den Dialog mit leerer Vorbelegung; der Text wird Decision.comment, der Zustand bleibt angenommen, die Karte zeigt ihn", async () => {
    const initials: string[] = [];
    const h = harness(withRound(), { comment: (initial) => { initials.push(initial); return Promise.resolve("Die Tür war schon richtig\nbitte so lassen"); } });
    h.click(h.cards()[1]!, "okit-review-comment");
    await flush();
    expect(initials).toEqual([""]);
    expect(h.session().rounds.rounds[0]!.body).toMatchObject({ decisions: [{ state: "accepted" }, { state: "accepted", comment: "Die Tür war schon richtig\nbitte so lassen" }] });
    expect(h.session().rounds.rounds[0]!.result).toBe(ANSWER); // angenommen bleibt angenommen
    const line = h.cards()[1]!.querySelector(".svg-studio-card-comment")!;
    expect(line.textContent).toBe("Comment: Die Tür war schon richtig\nbitte so lassen");
    expect(h.cards()[0]!.querySelector(".svg-studio-card-comment")).toBeNull();
    expect(h.cards()[1]!.classList.contains("is-accepted")).toBe(true);
  });

  it("ein Kommentar zu einem abgelehnten Eintrag lässt ihn abgelehnt; der bisherige Kommentar ist die Vorbelegung; Ablehnen danach behält den Kommentar", async () => {
    const initials: string[] = [];
    let answerWith: string | null = "erster";
    const h = harness(withRound(), { comment: (initial) => { initials.push(initial); return Promise.resolve(answerWith); } });
    h.click(h.cards()[0]!, "okit-review-reject");
    h.click(h.cards()[0]!, "okit-review-comment");
    await flush();
    expect(h.session().rounds.rounds[0]!.body).toMatchObject({ decisions: [{ state: "rejected", comment: "erster" }, { state: "accepted" }] });
    expect(h.session().rounds.rounds[0]!.result).toBe(BASE.replace(`x="80"`, `x="90"`));
    answerWith = "zweiter";
    h.click(h.cards()[0]!, "okit-review-comment");
    await flush();
    expect(initials).toEqual(["", "erster"]);
    h.click(h.cards()[0]!, "okit-review-accept");
    expect(h.session().rounds.rounds[0]!.body).toMatchObject({ decisions: [{ state: "accepted", comment: "zweiter" }, { state: "accepted" }] });
  });

  it("Abbruch (null) ändert nichts; mitten im Lauf (busy) auch nicht", async () => {
    const h = harness(withRound(), { comment: () => Promise.resolve(null) });
    const before = h.session();
    h.click(h.cards()[0]!, "okit-review-comment");
    await flush();
    expect(h.session()).toBe(before);
    let asked = 0;
    const b = harness(withRound(), { busy: true, comment: () => { asked++; return Promise.resolve("x"); } });
    b.click(b.cards()[0]!, "okit-review-comment");
    await flush();
    expect(asked).toBe(0);
  });

  it("läuft während des offenen Dialogs ein Lauf an, wird der Kommentar verworfen (kein Schreiben in die Sitzung)", async () => {
    let busy = false;
    const h = harness(withRound(), { busyNow: () => busy, comment: () => { busy = true; return Promise.resolve("zu spät"); } });
    const before = h.session();
    h.click(h.cards()[0]!, "okit-review-comment");
    await flush();
    expect(h.session()).toBe(before);
  });

  it("hinter einer späteren Runde und bei „ganzes Bild“ gibt es keine Taste", () => {
    const comment = (): Promise<string | null> => Promise.resolve("x");
    const first = withRound();
    const two = ok(addRound(first, { art: "prompt", instruction: "mehr", basedOn: 0, body: entriesOf(ANSWER, ANSWER.replace(`r="60"`, `r="70"`)) }));
    expect(harness({ ...two, rounds: selectRound(two.rounds, 0) }, { comment }).host.querySelector(".okit-review-comment")).toBeNull();
    expect(harness(two, { comment }).host.querySelector(".okit-review-comment")).not.toBeNull();
    const whole = ok(addRound(open(BASE), { art: "prompt", instruction: "neu", basedOn: null, body: { form: "whole", text: BASE.replace("40", "9"), decision: "accepted" } }));
    expect(harness(whole, { comment }).host.querySelector(".okit-review-comment")).toBeNull();
  });

  it("ein abgelehnter Kern-Schritt zeigt den Grund im Status (Runde bekam hinter den Karten einen Nachfolger)", async () => {
    const s = withRound();
    const two = ok(addRound(s, { art: "prompt", instruction: "mehr", basedOn: 0, body: entriesOf(ANSWER, ANSWER.replace(`r="60"`, `r="70"`)) }));
    const h = harness(s, { comment: () => Promise.resolve("x") });
    h.swap({ ...two, rounds: selectRound(two.rounds, 0) });
    h.click(h.cards()[0]!, "okit-review-comment");
    await flush();
    expect(h.statuses).toEqual(["That did not work: Another round builds on round 1; its decisions are locked."]);
  });
});

describe("Prüfliste: Runde mit Nachfolger", () => {
  function twoRounds(): SvgSession {
    const first = withRound();
    return ok(addRound(first, { art: "prompt", instruction: "mehr", basedOn: 0, body: entriesOf(ANSWER, ANSWER.replace(`r="60"`, `r="70"`)) }));
  }

  it("die Karten der früheren Runde sind gesperrt (stale) mit Hinweis; Alle … gesperrt; die letzte Runde bleibt bedienbar", () => {
    const s = twoRounds();
    const old = harness({ ...s, rounds: selectRound(s.rounds, 0) });
    expect(old.cards()).toHaveLength(2);
    for (const c of old.cards()) {
      expect(c.querySelector(".okit-review-stale")!.textContent).toBe("A later round builds on this one");
      expect(c.querySelector<HTMLButtonElement>("button.okit-review-accept")!.disabled).toBe(true);
      expect(c.querySelector<HTMLButtonElement>("button.okit-review-reject")!.disabled).toBe(true);
    }
    for (const b of old.host.querySelectorAll<HTMLButtonElement>(".okit-review-bulk button")) expect(b.disabled).toBe(true);
    old.click(old.cards()[0]!, "okit-review-reject");
    expect(old.session().rounds.rounds[0]!.body).toMatchObject({ decisions: [{ state: "accepted" }, { state: "accepted" }] });
    // Der Kern verweigert dieselbe Entscheidung auch ohne die Sperre der Karte (decide → „gesperrt“).
    expect(decide(s, 0, 0, { state: "rejected" })).toEqual({ problem: { code: "round-locked", params: [1] } });
    const last = harness(s);
    expect(last.cards()).toHaveLength(1);
    expect(last.cards()[0]!.querySelector(".okit-review-stale")).toBeNull();
    expect(last.cards()[0]!.querySelector<HTMLButtonElement>("button.okit-review-reject")!.disabled).toBe(false);
  });

  it("verweigert der Kern eine Entscheidung (die Runde bekam hinter den Karten einen Nachfolger), steht der Grund im Status, in der Sprache der Oberfläche; die Sitzung bleibt", () => {
    initStrings("de");
    const s = twoRounds();
    const h = harness(withRound());
    h.swap({ ...s, rounds: selectRound(s.rounds, 0) });
    h.click(h.cards()[0]!, "okit-review-reject");
    expect(h.statuses).toEqual(["Das hat nicht geklappt: Auf Runde 1 baut schon eine weitere auf; ihre Entscheidungen sind gesperrt."]);
    expect(h.session().rounds.rounds[0]!.body).toMatchObject({ decisions: [{ state: "accepted" }, { state: "accepted" }] });
    initStrings("en");
    h.click(h.cards()[1]!, "okit-review-reject");
    expect(h.statuses[1]).toBe("That did not work: Another round builds on round 1; its decisions are locked.");
  });
});

describe("Prüfliste: Runde „ganzes Bild“", () => {
  const WHOLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g"><circle id="mond" r="9"/></g></svg>`;
  const whole = (art: SvgRound["art"] = "prompt", start = BASE): SvgSession => ok(addRound(open(start), { art, instruction: "alles neu", basedOn: null, body: { form: "whole", text: WHOLE, decision: "accepted" } }));

  it("EINE Karte „Whole image replaced“ mit zwei kleinen Vorschauen Vorher/Nachher, angenommen", () => {
    const h = harness(whole());
    expect(h.cards()).toHaveLength(1);
    const card = h.cards()[0]!;
    expect(card.querySelector(".okit-redline")!.textContent).toBe("Whole image replaced");
    expect(card.classList.contains("is-accepted")).toBe(true);
    const cells = [...card.querySelectorAll(".svg-studio-compare-cell")];
    expect(cells.map((c) => c.querySelector(".svg-studio-compare-label")!.textContent)).toEqual(["Before", "After"]);
    const shadows = cells.map((c) => c.querySelector<HTMLElement>(".svg-studio-stage")!.shadowRoot!);
    expect(shadows[0]!.querySelector("#tuer")).not.toBeNull();
    expect(shadows[1]!.querySelector("#g #mond")).not.toBeNull();
    expect(shadows[0]!.querySelector("#g")).toBeNull();
  });

  it("jede kleine Vorschau meldet ihren Abbau (track); der Aufrufer baut sie beim Neuzeichnen und Schließen ab", () => {
    const destroys: Array<() => void> = [];
    const h = harness(whole(), { track: (d) => { destroys.push(d); } });
    expect(destroys).toHaveLength(2); // Vorher und Nachher
    expect(h.host.querySelectorAll(".svg-studio-stage-wrap")).toHaveLength(2);
    for (const d of destroys) d();
    expect(h.host.querySelectorAll(".svg-studio-stage-wrap")).toHaveLength(0);
  });

  it("svgSlots: renderChanges baut die kleinen Vorschauen der letzten Zeichnung ab, dispose die der letzten", () => {
    const { llm } = fakeLlm([]);
    const slots = svgSlots({ llm, readTargetText: () => Promise.resolve(null), thinkingOn: () => false, background: BG });
    const session = whole();
    const ctx: ChangesCtx<SvgSession> = { busy: () => false, session: () => session, setSession: () => undefined, setStatus: () => undefined };
    const host = document.body.createDiv();
    const round = activeRound(session.rounds);
    slots.renderChanges(host, round, session, ctx);
    slots.renderChanges(host, round, session, ctx); // der Aufrufer (Shell) leert den Host; hier bewusst nicht: übrig bleiben nur die Vorschauen der zweiten Zeichnung
    expect(host.querySelectorAll(".svg-studio-stage-wrap")).toHaveLength(2);
    slots.dispose?.();
    expect(host.querySelectorAll(".svg-studio-stage-wrap")).toHaveLength(0);
  });

  it("ein teurer Text in einer Vergleichszelle: Platzhalter mit „Show“, der Klick gibt ihn frei (auch für andere Ansichten) und zeichnet die Zelle; die andere Zelle wird gezeichnet", () => {
    const freed = new Set<string>();
    const log: string[] = [];
    const renderGuard: RenderGuard = {
      isMarked: () => false, clear: () => undefined, dispose: () => undefined,
      released: (text) => freed.has(text), release: (text) => { freed.add(text); log.push("release"); },
      begin: () => ({ settle: () => undefined, abort: () => undefined }),
    };
    const h = harness(whole("prompt", MID_COST_SVG), { renderGuard });
    const cells = [...h.cards()[0]!.querySelectorAll(".svg-studio-compare-cell")];
    expect(cells[0]!.querySelector(".svg-studio-stage")).toBeNull();
    expect(cells[0]!.querySelector(".svg-studio-compare-none")!.textContent).toMatch(/expensive to draw \(about \d+ % of the allowed cost\), so the preview is shown only after a click\./);
    expect(cells[1]!.querySelector(".svg-studio-stage")).not.toBeNull();
    cells[0]!.querySelector<HTMLButtonElement>("button.svg-studio-show")!.click();
    expect(log).toEqual(["release"]);
    expect(freed.has(MID_COST_SVG)).toBe(true);
    expect(cells[0]!.querySelector(".svg-studio-stage")).not.toBeNull();
    expect(cells[0]!.querySelector("button.svg-studio-show")).toBeNull();
  });

  it("Reparatur: „Repair: whole image“; ist der Ausgang kaputt, steht bei Vorher der Hinweis statt einer Vorschau", () => {
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><g id="g"><circle id="mond" r="4"/></svg>`;
    const h = harness(whole("repair", broken));
    const card = h.cards()[0]!;
    expect(card.querySelector(".okit-redline")!.textContent).toBe("Repair: whole image");
    const cells = [...card.querySelectorAll(".svg-studio-compare-cell")];
    expect(cells[0]!.querySelector(".svg-studio-compare-none")!.textContent).toBe("Cannot be shown");
    expect(cells[0]!.querySelector(".svg-studio-stage")).toBeNull();
    expect(cells[1]!.querySelector(".svg-studio-stage")).not.toBeNull();
  });

  it("Ablehnen über decide(…, 0, …): das Ergebnis ist der Ausgang; Annehmen ersetzt wieder ganz", () => {
    const h = harness(whole());
    h.click(h.cards()[0]!, "okit-review-reject");
    expect(h.session().rounds.rounds[0]).toMatchObject({ body: { form: "whole", decision: "rejected" }, result: BASE });
    expect(h.cards()[0]!.classList.contains("is-rejected")).toBe(true);
    h.host.querySelector<HTMLButtonElement>("button.okit-review-accept-all")!.click();
    expect(h.session().rounds.rounds[0]).toMatchObject({ body: { decision: "accepted" }, result: WHOLE });
  });

  it("ein neues SVG (Erzeugen) hat nichts, was ersetzt würde: keine Karte", () => {
    const h = harness(ok(addRound(open(null), { art: "create", instruction: "Mond", basedOn: null, body: { form: "whole", text: WHOLE, decision: "accepted" } })));
    expect(h.cards()).toHaveLength(0);
    expect(h.host.querySelector(".okit-review")).toBeNull();
  });
});

describe("Prüfliste: Regelrunde", () => {
  it("zeigt, was die Regel ändert, als Redline-Zeilen, ohne Knöpfe zum Entscheiden", () => {
    const unnamed = `<svg xmlns="http://www.w3.org/2000/svg"><rect x="1"/><rect x="2"/></svg>`;
    const s = ok(addRound(open(unnamed), { art: "names", instruction: "Assign names", basedOn: null, body: { form: "rule", rule: "assign-ids" } }));
    const h = harness(s);
    expect(h.host.querySelector(".svg-studio-rule-head")!.textContent).toBe("This rule changes:");
    expect(h.host.querySelectorAll(".svg-studio-rule-line").length).toBeGreaterThan(0);
    expect(h.host.querySelector("button")).toBeNull();
  });
});

// ---- Mit Shell: Ablehnen im Panel, Vorschau und nächste Anfrage ---------------------------------------------------------------------
interface Setup { root: HTMLElement; shell: PanelShell<SvgSession>; requests: ReturnType<typeof fakeLlm>["requests"] }

function setup(responders: Responder[], comment?: (initial: string) => Promise<string | null>): Setup {
  const { llm, requests } = fakeLlm(responders);
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const read = vi.fn(async () => BASE);
  const slots = svgSlots({ llm, readTargetText: read, thinkingOn: () => false, background: BG, ...(comment === undefined ? {} : { comment }) });
  const deps: PanelDeps<SvgSession> = {
    app: {} as never, llm,
    thinking: { family: () => null, backend: () => "unknown", current: () => "off", onLevel: () => "low", setLevel: () => Promise.resolve(), levelPicker: () => false },
    readTargetText: read, accept: () => Promise.resolve({ ok: false, message: "x" }), openSettings: () => undefined,
    confirm: () => Promise.resolve(true), managerPresent: () => false, strings: panelStrings(),
  };
  return { root, shell: buildPanelShell(root, deps, slots, freshSession(FILE)), requests };
}

async function send(s: Setup, text: string): Promise<void> {
  s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!.value = text;
  s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
  await s.shell.settled();
}
const card = (s: Setup, i: number): HTMLElement => s.root.querySelectorAll<HTMLElement>(".svg-studio-changes .okit-review-card")[i]!;
const previewSvg = (s: Setup): Element => s.root.querySelector<HTMLElement>(".svg-studio-preview-host .svg-studio-stage")!.shadowRoot!.querySelector("svg")!;

describe("Prüfliste im Panel", () => {
  it("nach dem Verfeinern stehen die Karten unter der Vorschau; Ablehnen zeichnet die Vorschau ohne den Eintrag", async () => {
    const s = setup([answer(ANSWER)]);
    await send(s, "größer");
    expect(s.root.querySelectorAll(".svg-studio-changes .okit-review-card")).toHaveLength(2);
    expect(previewSvg(s).querySelector("#mond")!.getAttribute("r")).toBe("60");
    card(s, 0).querySelector<HTMLButtonElement>("button.okit-review-reject")!.click();
    expect(card(s, 0).classList.contains("is-rejected")).toBe(true);
    expect(previewSvg(s).querySelector("#mond")!.getAttribute("r")).toBe("40");
    expect(previewSvg(s).querySelector("#tuer")!.getAttribute("x")).toBe("90");
    expect(s.shell.session().rounds.rounds[0]!.result).toBe(BASE.replace(`x="80"`, `x="90"`));
  });

  it("Klick auf den Kartenrumpf markiert das Element in der Vorschau (Marke im Shadow Root, nie im Quelltext)", async () => {
    const s = setup([answer(ANSWER)]);
    await send(s, "größer");
    card(s, 1).querySelector<HTMLElement>(".okit-review-main")!.click();
    const shadow = s.root.querySelector<HTMLElement>(".svg-studio-preview-host .svg-studio-stage")!.shadowRoot!;
    const mark = /\[(data-m[a-z0-9]+)\]/.exec(shadow.querySelector("style")!.textContent ?? "")![1]!;
    expect(shadow.querySelector(`[${mark}]`)?.id).toBe("tuer");
    expect(s.shell.session().rounds.rounds[0]!.result).not.toContain("data-m");
  });

  it("während eines Laufs sind die Knöpfe der Prüfliste gesperrt, danach wieder bedienbar; eine gesperrte Karte bleibt gesperrt", async () => {
    let release: (r: unknown) => void = () => undefined;
    const hang: Responder = () => new Promise((res) => { release = res; });
    const s = setup([answer(ANSWER), hang]);
    await send(s, "größer");
    const input = s.root.querySelector<HTMLTextAreaElement>("textarea.svg-studio-input")!;
    input.value = "mehr";
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-send")!.click();
    await vi.waitFor(() => { expect(s.shell.running()).toBe(true); });
    const buttons = [...s.root.querySelectorAll<HTMLButtonElement>(".svg-studio-changes button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    s.root.querySelector<HTMLButtonElement>("button.svg-studio-stop")!.click();
    release({ ok: false, kind: "aborted", detail: "aborted", partial: "", reasoning: "", timing: { startedAt: 0, endedAt: 0 }, facts: null, deviations: [], source: { kind: "local" } });
    await s.shell.settled();
    expect(s.root.querySelector<HTMLButtonElement>(".svg-studio-changes button.okit-review-reject")!.disabled).toBe(false);
  });

  it("die nächste Verfeinern-Anfrage trägt die Ablehnung unter „Rückmeldung zur letzten Runde“ mit dem Titel der Karte; ohne Ablehnung bleibt die gemessene Vorlage", async () => {
    const s = setup([answer(ANSWER), answer(ANSWER.replace(`r="60"`, `r="70"`)), answer(ANSWER.replace(`r="60"`, `r="80"`))]);
    await send(s, "größer");
    card(s, 0).querySelector<HTMLButtonElement>("button.okit-review-reject")!.click();
    await send(s, "noch größer");
    const user = s.requests[1]!.messages!.at(-1)!.content;
    const base = s.shell.session().rounds.rounds[0]!.result;
    expect(user).toBe(`Ausgangs-SVG:\n\n${base}\n\nAnweisung: noch größer\n\nRückmeldung zur letzten Runde:\n- Circle mond: r 40 → 60: abgelehnt`);
    // Die Folgerunde hat keine Ablehnung: nur die Rückmeldungen der Runde, auf der sie aufbaut (die aktive).
    await send(s, "und weiter");
    expect(s.requests[2]!.messages!.at(-1)!.content).not.toContain("Rückmeldung");
    expect(s.requests[2]!.messages!.at(-1)!.content).toBe(`Ausgangs-SVG:\n\n${s.shell.session().rounds.rounds[1]!.result}\n\nAnweisung: und weiter`);
  });
});

describe("Kommentar-Taste im Panel", () => {
  it("Taste, Dialog, Entscheidung, nächste Verfeinern-Anfrage: der Kommentar steht unter „Rückmeldung zur letzten Runde“", async () => {
    const asked: string[] = [];
    const s = setup([answer(ANSWER), answer(ANSWER.replace(`r="60"`, `r="70"`))], (initial) => { asked.push(initial); return Promise.resolve("Die Tür war schon richtig"); });
    await send(s, "größer");
    card(s, 1).querySelector<HTMLButtonElement>("button.okit-review-comment")!.click();
    await vi.waitFor(() => { expect(card(s, 1).querySelector(".svg-studio-card-comment")).not.toBeNull(); });
    expect(asked).toEqual([""]);
    expect(card(s, 1).classList.contains("is-accepted")).toBe(true);
    expect(s.shell.session().rounds.rounds[0]!.result).toBe(ANSWER);
    await send(s, "noch größer");
    const user = s.requests[1]!.messages!.at(-1)!.content;
    expect(user.endsWith("Rückmeldung zur letzten Runde:\n- Rectangle tuer: x 80 → 90: Die Tür war schon richtig")).toBe(true);
  });
});

describe("Rückmeldungen im Lauf", () => {
  const noopIo: RunIo = { start: () => undefined, clearAnswer: () => undefined, onToken: () => undefined, onReasoning: () => undefined, onContentReset: () => undefined, setStatus: () => undefined };

  it("ein Kommentar und eine Ablehnung erscheinen in der Verfeinern-Nachricht, mit den Titeln der Karten", async () => {
    let s = withRound();
    s = ok(decide(s, 0, 0, { state: "rejected" }));
    s = ok(decide(s, 0, 1, { state: "accepted", comment: "Die Tür war schon richtig" }));
    const { llm, requests } = fakeLlm([answer(ANSWER.replace(`x="90"`, `x="80"`))]);
    const res = await runSvgPrompt({ session: s, instruction: "Tür zurück", signal: new AbortController().signal, model: "qwen/qwen3.8-27b", io: noopIo }, { llm, readTargetText: async () => null });
    expect(res.ok).toBe(true);
    const user = requests[0]!.messages!.at(-1)!.content;
    expect(user).toContain("\n\nRückmeldung zur letzten Runde:\n- Circle mond: r 40 → 60: abgelehnt\n- Rectangle tuer: x 80 → 90: Die Tür war schon richtig");
    expect(user.endsWith("Die Tür war schon richtig")).toBe(true);
  });

  it("ein abgelehnter Eintrag mit Kommentar nennt beides", async () => {
    let s = withRound();
    s = ok(decide(s, 0, 1, { state: "rejected", comment: "zu breit" }));
    const { llm, requests } = fakeLlm([answer(BASE)]);
    await runSvgPrompt({ session: s, instruction: "x", signal: new AbortController().signal, model: "m", io: noopIo }, { llm, readTargetText: async () => null });
    expect(requests[0]!.messages!.at(-1)!.content).toContain("- Rectangle tuer: x 80 → 90: abgelehnt (zu breit)");
  });

  it("auf Deutsch trägt die Rückmeldung die deutsche Karten-Beschriftung", async () => {
    initStrings("de");
    const s = ok(decide(withRound(), 0, 0, { state: "rejected" }));
    const { llm, requests } = fakeLlm([answer(BASE)]);
    await runSvgPrompt({ session: s, instruction: "x", signal: new AbortController().signal, model: "m", io: noopIo }, { llm, readTargetText: async () => null });
    expect(requests[0]!.messages!.at(-1)!.content).toContain("- Kreis mond: r 40 → 60: abgelehnt");
  });
});
