// Rundenmodell des Panels (Spec § 6.3), auf dem Kit-Baustein `panel-session` und `rounds`. Pure.
// Eine Runde speichert, was geschah (`art`, `instruction`, `body`) und das Ergebnis (`result`: der Text nach den angenommenen Einträgen). Das Modell bekommt beim
// Verfeinern den Text der aktiven Runde; Übernehmen wendet die angenommenen Einträge aller Runden bis zur aktiven, in Reihenfolge, auf den Text an, der JETZT dasteht:
// Handänderungen dazwischen bleiben erhalten, ein Eintrag, dessen Element sich seither geändert hat, bricht ab (alles oder nichts).
import { buildCanonTree, canonDocument, canonNode, normalizeValue } from "./canon";
import { applyChanges, type SvgChange } from "./changes";
import { changesFor, type DiffEntry } from "./diff";
import { stripEditorMetadata } from "./editor-metadata";
import { attr, scanElements } from "./elements";
import { assignMissingIds } from "./format";
import type { Problem } from "./problem";
import type { Feedback } from "./protocol";
import { baseTextForRefine, chainOf, type PanelSession } from "../vendor/kit/panel-session";
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

/** Ergebnis eines Schritts, der einen Text liefert: der Text oder ein Problem als Wert (Code und Parameter, nie ein Satz). */
export type SvgStep = { ok: true; text: string } | { ok: false; problem: Problem };
type Failed = { problem: Problem };
const problem = (code: Problem["code"], ...params: Problem["params"]): Problem => ({ code, params });
const fail = (code: Problem["code"], ...params: Problem["params"]): { ok: false; problem: Problem } => ({ ok: false, problem: problem(code, ...params) });

/** Wert des Attributs im Text, `null` wenn das Element oder das Attribut fehlt (Vergleichsform). */
function attrNow(text: string, key: string, name: string): string | null | undefined {
  const hits = scanElements(text).elements.filter((e) => e.key === key);
  if (hits.length !== 1) return undefined; // fehlt oder mehrdeutig: das meldet applyChanges
  const v = attr(hits[0], name);
  return v === null ? null : normalizeValue(v);
}

/** Vorabprüfung der beiden Fälle, die ein Übernehmen nach einer Handänderung wirklich trifft (Review-Fokus 2): ein Element, das die Liste anfasst, ist weg, oder eines, das sie
 *  entfernen will, hat sich verändert. `applyChanges` meldet beides auch, aber auf Deutsch und als Satz; hier wird es ein Wert. Alles Übrige bleibt bei `applyChanges`. */
function preflight(text: string, changes: readonly SvgChange[]): Problem | null {
  const tree = buildCanonTree(text);
  if (tree === null) return null; // nicht lesbar: das meldet applyChanges
  const index = (key: string): number[] => tree.elements.flatMap((e, i) => (e.key === key ? [i] : []));
  for (const c of changes) {
    const keys = c.op === "add" ? [c.parent, c.after] : c.op === "move" ? [c.id, c.parent, c.after] : [c.id];
    for (const k of keys) if (k !== null && index(k).length === 0) return problem("element-missing", k);
    if (c.op === "remove" && c.expect !== undefined) {
      const hits = index(c.id);
      if (hits.length === 1 && canonNode(tree, hits[0]) !== c.expect) return problem("element-changed", c.id);
    }
  }
  return null;
}

/** Die Runde auf den Text anwenden, der gerade gilt (`null`: es gibt keinen). */
export function applyRound(text: string | null, r: SvgRound): SvgStep {
  const b = r.body;
  if (b.form === "whole") {
    if (b.decision === "accepted") return { ok: true, text: b.text };
    return text === null ? fail("no-base") : { ok: true, text };
  }
  if (text === null) return fail("no-base");
  if (b.form === "rule") {
    if (b.rule === "assign-ids") {
      const r2 = assignMissingIds(text);
      return r2.issues !== undefined ? fail("names-unreadable") : { ok: true, text: r2.text };
    }
    const s = stripEditorMetadata(text);
    if (!s.ok) return s;
    const out = applyChanges(text, s.changes);
    return out.ok ? { ok: true, text: out.text } : fail("apply-failed", out.problems.join("; "));
  }
  const accepted = new Set(b.entries.flatMap((_, i) => (b.decisions[i]?.state === "accepted" ? [i] : [])));
  // Ein Attribut, das seit der Runde von Hand geändert wurde, wird nicht still überschrieben (Spec § 3: eine Handänderung geht nie verloren).
  for (const i of accepted) {
    const e = b.entries[i];
    if (e.kind !== "attr") continue;
    const now = attrNow(text, e.key, e.attr);
    const was = e.from === null ? null : normalizeValue(e.from);
    if (now !== undefined && now !== was) return fail("attr-changed", e.key, e.attr, now, was);
  }
  const changes = changesFor(b.entries, accepted);
  if (changes.length === 0) return { ok: true, text };
  const gone = preflight(text, changes);
  if (gone !== null) return { ok: false, problem: gone };
  const out = applyChanges(text, changes);
  return out.ok ? { ok: true, text: out.text } : fail("apply-failed", out.problems.join("; "));
}

/** Der Text, auf dem eine Runde mit diesem `basedOn` aufsetzt: das Ergebnis der Vorgänger-Runde, sonst der Text beim Öffnen. */
function baseOf(s: SvgSession, basedOn: number | null): string | null {
  return basedOn === null ? s.startText : (s.rounds.rounds[basedOn]?.result ?? null);
}

/** Der Text, auf dem diese Runde aufsetzt (das Ergebnis ihrer Vorgängerin, sonst der Text beim Öffnen); `null`: es gibt keinen (ein neues SVG). */
export function baseTextOfRound(s: SvgSession, r: SvgRound): string | null {
  return baseOf(s, r.basedOn);
}

/** Entscheidungen vervollständigen: ohne Angabe gilt ein Eintrag als angenommen (Plan 2, E3). */
function withDecisions(b: RoundBody): RoundBody {
  if (b.form !== "list") return b;
  return { ...b, decisions: b.entries.map((_, i): Decision => b.decisions[i] ?? { state: "accepted" }) };
}

export function addRound(s: SvgSession, r: Omit<SvgRound, "result">): SvgSession | Failed {
  if (r.basedOn !== null && (!Number.isInteger(r.basedOn) || r.basedOn < 0 || r.basedOn >= s.rounds.rounds.length)) {
    return { problem: problem("round-missing", r.basedOn + 1) };
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
export function addHandChange(s: SvgSession, changes: SvgChange[], label: string): SvgSession | Failed {
  const active = activeRound(s.rounds);
  const last = s.rounds.rounds.length - 1;
  const merge = active !== null && active.art === "hand" && active.body.form === "list" && s.rounds.active === last;
  const basedOn = merge ? active.basedOn : s.rounds.active >= 0 ? s.rounds.active : null;
  const startFrom = baseOf(s, basedOn);
  if (startFrom === null) return { problem: problem("hand-no-text") };
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
export function decide(s: SvgSession, round: number, entry: number, d: Decision): SvgSession | Failed {
  const r = s.rounds.rounds[round];
  if (r === undefined) return { problem: problem("round-unknown", round + 1) };
  if (s.rounds.rounds.some((x) => x.basedOn === round)) return { problem: problem("round-locked", round + 1) };
  let body: RoundBody;
  if (r.body.form === "list") {
    if (!Number.isInteger(entry) || entry < 0 || entry >= r.body.entries.length) return { problem: problem("entry-unknown", entry + 1) };
    body = { ...r.body, decisions: r.body.decisions.map((x, i) => (i === entry ? d : x)) };
  } else if (r.body.form === "whole") {
    if (entry !== 0) return { problem: problem("entry-single") };
    body = { ...r.body, decision: d.state };
  } else {
    return { problem: problem("entry-none") };
  }
  const step = applyRound(baseOf(s, r.basedOn), { ...r, body });
  if (!step.ok) return { problem: step.problem };
  const rounds = s.rounds.rounds.map((x, k) => (k === round ? { ...x, body, result: step.text } : x));
  return { ...s, rounds: { rounds, active: s.rounds.active } };
}

/** Zwei Texte, die für die Runde derselbe Ausgang sind: byte-gleich oder kanonisch gleich (Einzug und Zeilenumbruch zählen nicht). Ist einer nicht lesbar, zählt nur Byte-Gleichheit. */
function sameStand(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = canonDocument(a);
  return ca !== null && ca === canonDocument(b);
}

/** Die Elemente, denen `assign-ids` auf `text` Namen gibt, samt ihrer kanonischen Form (ohne `id`-Unterschied nach Vergabe); `null`: der Text ist nicht lesbar. */
function nameAssignment(text: string): Map<string, string> | null {
  const r = assignMissingIds(text);
  if (r.issues !== undefined) return null;
  const tree = buildCanonTree(r.text);
  if (tree === null) return null;
  const out = new Map<string, string>();
  for (const id of r.assigned) {
    const i = tree.elements.findIndex((e) => e.key === id);
    if (i >= 0) out.set(id, canonNode(tree, i));
  }
  return out;
}

/** Tragen die Elemente, denen die Runde Namen gab (`then`), jetzt (`now`) dieselben Namen? Nur dann hängen die Einträge späterer Runden (sie nennen `rect-2`) noch am gemeinten
 *  Element. Ein Element ohne Namen, das seither hinzukam und hinter allen steht, schadet nicht; davor eingefügt verschiebt es die Namen, und der Vergleich fällt auf. */
function sameNaming(now: Map<string, string> | null, then: Map<string, string> | null): boolean {
  if (now === null || then === null) return false;
  for (const [id, canon] of then) if (now.get(id) !== canon) return false;
  return true;
}

/** Eine Runde der Kette auf den Text anwenden, der JETZT gilt. Zwei Runden hängen an dem Stand, den sie sahen, und prüfen ihn:
 *  - ein ganzes Bild (`whole`, angenommen) ersetzt den Text; hat der Nutzer die Datei seither verändert, ginge seine Änderung lautlos verloren (Spec § 3 Punkt 3);
 *  - „Namen vergeben“ mit einer Folgerunde: deren Einträge nennen die vergebenen Namen, und die leitet die Regel auf dem Text von JETZT ab; ein Element ohne Namen mehr
 *    oder weniger davor verschöbe die Namen auf andere Elemente. Als letzte Runde der Kette bleibt die Regel frei (ein neues Element bekommt auch einen Namen).
 *  Einträge von Runden mit Regel `strip-editor-metadata` hängen an ids, nicht an Nummern: dort genügt die Neuableitung. */
function applyChained(s: SvgSession, text: string | null, r: SvgRound, index: number): SvgStep {
  const base = baseOf(s, r.basedOn);
  const b = r.body;
  if (b.form === "whole" && b.decision === "accepted" && text !== null && base !== null && !sameStand(text, base)) {
    return fail("target-changed");
  }
  if (b.form === "rule" && b.rule === "assign-ids" && index !== s.rounds.active && text !== null && base !== null && !sameStand(text, base)) {
    if (!sameNaming(nameAssignment(text), nameAssignment(base))) return fail("names-changed");
  }
  return applyRound(text, r);
}

/** Der Text, den Übernehmen schreibt: die angenommenen Einträge aller Runden bis zur aktiven, in Reihenfolge, auf den Text, der jetzt gilt. */
export function acceptText(s: SvgSession, current: string | null): SvgStep {
  // Die Kette der Runden kommt vom Kit (`chainOf`); die Schleife ist eigen, weil das Kit-`acceptChain` nur Zeichenketten durchreicht und „round n:“ englisch voranstellt.
  const resolved = chainOf(s.rounds, (r) => r.basedOn);
  if (!resolved.ok) return fail("chain-broken");
  if (resolved.chain.length === 0) return fail("nothing-to-apply");
  let text: string | null = current;
  for (const index of resolved.chain) {
    const round = s.rounds.rounds[index];
    if (round === undefined) return fail("chain-broken");
    const step = applyChained(s, text, round, index);
    if (!step.ok) return { ok: false, problem: { ...step.problem, round: index + 1 } };
    text = step.text;
  }
  return text === null ? fail("nothing-to-apply") : { ok: true, text };
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
