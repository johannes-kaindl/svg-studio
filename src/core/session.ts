// Rundenmodell des Panels (Spec § 6.3), auf dem Kit-Baustein `panel-session` und `rounds`. Pure.
// Eine Runde speichert, was geschah (`art`, `instruction`, `body`) und das Ergebnis (`result`: der Text nach den angenommenen Einträgen). Das Modell bekommt beim
// Verfeinern den Text der aktiven Runde; Übernehmen wendet die angenommenen Einträge aller Runden bis zur aktiven, in Reihenfolge, auf den Text an, der JETZT dasteht:
// Handänderungen dazwischen bleiben erhalten, ein Eintrag, dessen Element sich seither geändert hat, bricht ab (alles oder nichts).
import { normalizeValue } from "./canon";
import { applyChanges, type SvgChange } from "./changes";
import { changesFor, type DiffEntry } from "./diff";
import { stripEditorMetadata } from "./editor-metadata";
import { attr, scanElements } from "./elements";
import { assignMissingIds } from "./format";
import type { Feedback } from "./protocol";
import { acceptChain, baseTextForRefine, type PanelSession, type Step } from "../vendor/kit/panel-session";
import { activeRound, pushRound } from "../vendor/kit/rounds";

export type RoundArt = "create" | "prompt" | "hand" | "repair" | "names" | "cleanup";
export type Decision = { state: "accepted" | "rejected"; comment?: string };
export type RoundBody =
  | { form: "list"; entries: DiffEntry[]; decisions: Decision[] } // decisions[i] gehört zu entries[i]; Vorgabe nach E3: angenommen
  | { form: "whole"; text: string; decision: "accepted" | "rejected" } // create, „Ganzes Bild ersetzt“, Reparatur eines unlesbaren Bestands
  | { form: "rule"; rule: "assign-ids" | "strip-editor-metadata" }; // auf dem jeweils aktuellen Text neu abgeleitet
export interface SvgRound {
  art: RoundArt;
  instruction: string;
  /** Index der Runde, auf der diese aufbaut; `null`: sie beginnt beim Text, der beim Öffnen stand. */
  basedOn: number | null;
  body: RoundBody;
  /** Text nach dieser Runde (nur Angenommenes), für Vorschau und als Ausgang der nächsten Runde. */
  result: string;
}
export interface SvgSession extends PanelSession<SvgRound> {
  /** Text beim Öffnen; `null` beim neuen SVG. */
  startText: string | null;
}

type Problem = { problem: string };
const fail = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

/** Wert des Attributs im Text, `null` wenn das Element oder das Attribut fehlt (Vergleichsform). */
function attrNow(text: string, key: string, name: string): string | null | undefined {
  const hits = scanElements(text).elements.filter((e) => e.key === key);
  if (hits.length !== 1) return undefined; // fehlt oder mehrdeutig: das meldet applyChanges
  const v = attr(hits[0], name);
  return v === null ? null : normalizeValue(v);
}

/** Die Runde auf den Text anwenden, der gerade gilt (`null`: es gibt keinen). */
export function applyRound(text: string | null, r: SvgRound): Step {
  const b = r.body;
  if (b.form === "whole") {
    if (b.decision === "accepted") return { ok: true, text: b.text };
    return text === null ? fail("Es gibt keinen Text, auf dem die Runde aufsetzt.") : { ok: true, text };
  }
  if (text === null) return fail("Es gibt keinen Text, auf dem die Runde aufsetzt.");
  if (b.form === "rule") {
    if (b.rule === "assign-ids") {
      const r2 = assignMissingIds(text);
      return r2.issues !== undefined ? fail("Der Text ist nicht lesbar; Namen lassen sich nicht vergeben.") : { ok: true, text: r2.text };
    }
    const s = stripEditorMetadata(text);
    if (!s.ok) return fail(s.problem);
    const out = applyChanges(text, s.changes);
    return out.ok ? { ok: true, text: out.text } : fail(out.problems.join("; "));
  }
  const accepted = new Set(b.entries.flatMap((_, i) => (b.decisions[i]?.state === "accepted" ? [i] : [])));
  // Ein Attribut, das seit der Runde von Hand geändert wurde, wird nicht still überschrieben (Spec § 3: eine Handänderung geht nie verloren).
  for (const i of accepted) {
    const e = b.entries[i];
    if (e.kind !== "attr") continue;
    const now = attrNow(text, e.key, e.attr);
    const was = e.from === null ? null : normalizeValue(e.from);
    if (now !== undefined && now !== was) return fail(`„${e.key}“: ${e.attr} hat sich seit der Runde geändert (jetzt ${now === null ? "nicht gesetzt" : `„${now}“`}, die Runde ging von ${was === null ? "nicht gesetzt" : `„${was}“`} aus).`);
  }
  const changes = changesFor(b.entries, accepted);
  if (changes.length === 0) return { ok: true, text };
  const out = applyChanges(text, changes);
  return out.ok ? { ok: true, text: out.text } : fail(out.problems.join("; "));
}

/** Der Text, auf dem eine Runde mit diesem `basedOn` aufsetzt: das Ergebnis der Vorgänger-Runde, sonst der Text beim Öffnen. */
function baseOf(s: SvgSession, basedOn: number | null): string | null {
  return basedOn === null ? s.startText : (s.rounds.rounds[basedOn]?.result ?? null);
}

/** Entscheidungen vervollständigen: ohne Angabe gilt ein Eintrag als angenommen (Plan 2, E3). */
function withDecisions(b: RoundBody): RoundBody {
  if (b.form !== "list") return b;
  return { ...b, decisions: b.entries.map((_, i): Decision => b.decisions[i] ?? { state: "accepted" }) };
}

export function addRound(s: SvgSession, r: Omit<SvgRound, "result">): SvgSession | Problem {
  if (r.basedOn !== null && (!Number.isInteger(r.basedOn) || r.basedOn < 0 || r.basedOn >= s.rounds.rounds.length)) {
    return { problem: `Die Runde baut auf Runde ${String(r.basedOn + 1)}, die es nicht gibt.` };
  }
  const body = withDecisions(r.body);
  const step = applyRound(baseOf(s, r.basedOn), { ...r, body, result: "" });
  if (!step.ok) return { problem: step.problem };
  return { ...s, rounds: pushRound(s.rounds, { ...r, body, result: step.text }) };
}

/** Einträge für Handänderungen: dieselbe Form wie die des Diffs, damit Anzeige und Entscheidungen gleich laufen. */
function entriesFromChanges(base: string, changes: readonly SvgChange[]): DiffEntry[] {
  const els = scanElements(base).elements;
  const find = (key: string) => els.find((e) => e.key === key);
  return changes.flatMap((c): DiffEntry[] => {
    if (c.op === "change") {
      const el = find(c.id);
      return Object.entries(c.attrs).map(([name, to]): DiffEntry => ({
        kind: "attr", key: c.id, tag: el?.tag ?? "", attr: name, from: el === undefined ? null : attr(el, name), to, changes: [{ op: "change", id: c.id, attrs: { [name]: to } }],
      }));
    }
    if (c.op === "remove") return [{ kind: "remove", key: c.id, tag: find(c.id)?.tag ?? "", changes: [c] }];
    if (c.op === "move") return [{ kind: "move", key: c.id, tag: find(c.id)?.tag ?? "", parentKey: c.parent, changes: [c] }];
    const top = scanElements(c.markup).elements[0];
    return [{ kind: "add", key: top?.key ?? "", tag: top?.tag ?? "", changes: [c] }];
  });
}

const labelOfEntry = (e: DiffEntry): string => {
  switch (e.kind) {
    case "attr": return `${e.key} ${e.attr} ${e.to ?? "–"}`;
    case "add": return `+${e.key}`;
    case "remove": return `−${e.key}`;
    case "move": return `${e.key} ↕`;
    case "replace": return e.key;
  }
};

/** Handänderungen (Zahlenfelder, Knoten) sammeln sich in EINER Runde, solange sie die letzte und aktive ist; jede andere Runde schließt sie. */
export function addHandChange(s: SvgSession, changes: SvgChange[], label: string): SvgSession | Problem {
  const active = activeRound(s.rounds);
  const last = s.rounds.rounds.length - 1;
  const merge = active !== null && active.art === "hand" && active.body.form === "list" && s.rounds.active === last;
  const basedOn = merge ? active.basedOn : s.rounds.active >= 0 ? s.rounds.active : null;
  const startFrom = baseOf(s, basedOn);
  if (startFrom === null) return { problem: "Es gibt keinen Text, an dem sich etwas von Hand ändern ließe." };
  // Neue Einträge gegen den Text bis zur Runde davor (merge) bzw. die aktive (neue Runde) berechnen.
  const before = merge ? active.result : startFrom;
  const fresh = entriesFromChanges(before, changes);
  let entries: DiffEntry[] = merge && active.body.form === "list" ? [...active.body.entries] : [];
  for (const e of fresh) {
    const i = e.kind === "attr" ? entries.findIndex((x) => x.kind === "attr" && x.key === e.key && x.attr === e.attr) : -1;
    if (i < 0) {
      entries.push(e);
      continue;
    }
    const old = entries[i];
    if (old.kind !== "attr" || e.kind !== "attr") continue;
    const from = old.from;
    const same = (from === null ? null : normalizeValue(from)) === (e.to === null ? null : normalizeValue(e.to));
    entries = entries.filter((_, k) => k !== i || !same).map((x, k) => (k === i && !same ? { ...e, from, changes: e.changes } : x));
  }
  const instruction = `${label}: ${entries.map(labelOfEntry).join(", ")}`;
  const body: RoundBody = { form: "list", entries, decisions: entries.map((): Decision => ({ state: "accepted" })) };
  const step = applyRound(merge ? baseOf(s, basedOn) : startFrom, { art: "hand", instruction, basedOn, body, result: "" });
  if (!step.ok) return { problem: step.problem };
  if (merge) {
    const rounds = s.rounds.rounds.map((x, k) => (k === last ? { ...x, instruction, body, result: step.text } : x));
    return { ...s, rounds: { rounds, active: s.rounds.active } };
  }
  return { ...s, rounds: pushRound(s.rounds, { art: "hand", instruction, basedOn, body, result: step.text }) };
}

/** Entscheidung zu einem Eintrag. Gesperrt, sobald eine andere Runde auf dieser aufbaut (deren Ergebnis hinge am alten Stand). */
export function decide(s: SvgSession, round: number, entry: number, d: Decision): SvgSession | Problem {
  const r = s.rounds.rounds[round];
  if (r === undefined) return { problem: `Es gibt keine Runde ${String(round + 1)}.` };
  if (s.rounds.rounds.some((x) => x.basedOn === round)) return { problem: `Auf Runde ${String(round + 1)} baut schon eine weitere auf; ihre Entscheidungen sind gesperrt.` };
  let body: RoundBody;
  if (r.body.form === "list") {
    if (!Number.isInteger(entry) || entry < 0 || entry >= r.body.entries.length) return { problem: `Die Runde hat keinen Eintrag ${String(entry + 1)}.` };
    body = { ...r.body, decisions: r.body.decisions.map((x, i) => (i === entry ? d : x)) };
  } else if (r.body.form === "whole") {
    if (entry !== 0) return { problem: "Die Runde hat nur einen Eintrag." };
    body = { ...r.body, decision: d.state };
  } else {
    return { problem: "Diese Runde hat keine Einträge, über die sich einzeln entscheiden ließe." };
  }
  const step = applyRound(baseOf(s, r.basedOn), { ...r, body });
  if (!step.ok) return { problem: step.problem };
  const rounds = s.rounds.rounds.map((x, k) => (k === round ? { ...x, body, result: step.text } : x));
  return { ...s, rounds: { rounds, active: s.rounds.active } };
}

/** Der Text, den Übernehmen schreibt: die angenommenen Einträge aller Runden bis zur aktiven, in Reihenfolge, auf den Text, der jetzt gilt. */
export function acceptText(s: SvgSession, current: string | null): Step {
  return acceptChain(s.rounds, current, { basedOnOf: (r) => r.basedOn, applyRound: (text, r) => applyRound(text, r) });
}

/** Der Text, auf dem die nächste Verfeinerung aufsetzt: der der aktiven Runde (nur Angenommenes), sonst der aktuelle. */
export function refineBaseText(s: SvgSession, current: string | null): string | null {
  return baseTextForRefine(s, current, { textOf: (r) => r.result });
}

/** Darf verfeinert werden? Elemente ohne `id` kann keine Änderungsliste ansprechen: dann erst „Namen vergeben“ (Review-Fokus 5 des Plans). */
export function canRefine(base: string): { ok: true } | { ok: false; unnamed: number } {
  const unnamed = scanElements(base).elements.filter((e) => e.key.startsWith("@")).length;
  return unnamed === 0 ? { ok: true } : { ok: false, unnamed };
}

/** Rückmeldungen für die nächste Runde: abgelehnte und kommentierte Einträge. */
export function feedbackOf(r: SvgRound, labelOf: (e: DiffEntry) => string): Feedback[] {
  const b = r.body;
  const out: Feedback[] = [];
  if (b.form === "list") {
    b.entries.forEach((e, i) => {
      const d = b.decisions[i];
      if (d === undefined) return;
      const comment = d.comment?.trim();
      if (d.state === "rejected") out.push({ label: labelOf(e), decision: "rejected", ...(comment ? { comment } : {}) });
      else if (comment) out.push({ label: labelOf(e), decision: "comment", comment });
    });
  } else if (b.form === "whole" && b.decision === "rejected") {
    out.push({ label: r.instruction, decision: "rejected" });
  }
  return out;
}
