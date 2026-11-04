// Element-Diff: zwei SVG-Texte (Ausgang und Antwort des Modells) → Einträge mit je einer eigenen Änderungsliste. Pure.
// Spec § 6.2 und § 6.3: das Modell schreibt beim Verfeinern das VOLLSTÄNDIGE SVG, der Code bildet daraus die Liste, die der Nutzer
// Eintrag für Eintrag annimmt oder ablehnt. Der Diff ist nur etwas wert, wenn er VOLLSTÄNDIG ist: am Ende werden alle Einträge auf den
// Ausgang angewendet und das Ergebnis kanonisch (`canon.ts`) mit der Antwort verglichen; weicht es ab, ist die Antwort „nicht zerlegbar“
// und die Oberfläche bietet nur „ganzes Bild ersetzen“ an. Jede Heuristik darf sich irren, nie stillschweigend.
//
// Regeln:
// 1. Paarung über den Schlüssel (`id`, feste Schlüssel); doppelte ids werden in Reihenfolge gepaart (`key~n`).
// 2. Verschoben = anderer Elternknoten oder außerhalb der längsten wachsenden Teilfolge der Geschwister.
// 3. Ersetzt = anderer eigener Text (jedes Element) oder jede Abweichung an `style`, `title`, `desc` (deren Schlüssel hängt an der Stelle).
//    Nachkommen eines ersetzten Elements bekommen keine eigenen Einträge.
// 4. Verschoben und ersetzt → `replace` (`moved-and-text`) am neuen Ort.
// 5. Gepaartes Element unter neuem, ungepaartem Elternknoten → ein Eintrag `wrap`: `add` der neuen Gruppe (Markup der Antwort) und je ein
//    `remove` mit `expect` für jedes eingepackte Element am alten Ort.
// 6. Ungepaarter alter Elternknoten mit gepaartem Kind → ein Eintrag `unwrap`: `remove` der Gruppe (mit `expect`) und je ein `add` der
//    herausgelösten Kinder (Markup der Antwort).
// 7. Attribute je Attribut, verglichen mit `normalizeValue`; `to` ist der Wert der Antwort.
// 8. Braucht eine Änderung ein Element ohne id (`@n`) oder mit mehrdeutiger id → nicht zerlegbar.
// 9. Anker (`after`) ist das letzte Geschwister davor (Antwortsicht), das gepaart, unbewegt und nicht ersetzt ist; mehrere Einfügungen
//    hinter demselben Anker stehen in Antwortreihenfolge.
// 10. Einträge, die sich nicht einzeln annehmen lassen, sind EIN Eintrag: Teilen zwei Einträge ein gepaartes Element (das eine entfernt es,
//     das andere fügt es ein: Gruppe umbenannt, Kind aus einem ersetzten Element herausgelöst), oder stehen mehrere Einfügungen und eine
//     Ersetzung in einer Reihe zwischen zwei unbewegten Geschwistern (ein abgelehntes Ersetzen ließe das Alte an falscher Stelle stehen),
//     werden sie zusammengelegt (`replace`, Grund `wrap` oder `unwrap`, sonst der Grund der ersten Ersetzung).
// 11. Ein Text in einem Element mit gemischtem Inhalt (Text zwischen Kindern) ersetzt das Elternelement, nicht das Kind: ein Kind ließe sich
//     nicht an die Stelle zwischen den Textstücken setzen. Ein anderer Tag bei gleicher id ersetzt das Element (`tag`).
//
// Voraussetzung: Ausgang und Antwort haben genau ein Wurzelelement und keinen DOCTYPE; `svg-guard` lehnt beides ab, bevor ein Diff gebildet wird.
import { buildCanonTree, canonDocument, canonNode, normalizeValue, type CanonTree } from "./canon";
import { applyChanges, type SvgChange } from "./changes";
import { scanElements, type SvgElement } from "./elements";

export type ReplaceReason = "text" | "style" | "tag" | "moved-and-text" | "wrap" | "unwrap";
export type DiffEntry =
  | { kind: "attr"; key: string; tag: string; attr: string; from: string | null; to: string | null; changes: SvgChange[] }
  | { kind: "add"; key: string; tag: string; changes: SvgChange[] }
  | { kind: "remove"; key: string; tag: string; changes: SvgChange[] } // remove mit expect
  | { kind: "move"; key: string; tag: string; parentKey: string | null; /** Elternwechsel (sonst nur die Stapelreihenfolge). */ reparent?: boolean; /** Ohne Elternwechsel: weiter vorn (später im Text, über den Geschwistern) statt hinten. */ front?: boolean; changes: SvgChange[] }
  | { kind: "replace"; key: string; tag: string; reason: ReplaceReason; changes: SvgChange[] }; // remove mit expect + add, nur ganz
export type DiffResult = { decomposable: true; entries: DiffEntry[] } | { decomposable: false; why: string };

const no = (why: string): DiffResult => ({ decomposable: false, why });

/** Schlüssel mit laufender Nummer bei doppelten ids ("a", "a\u00002"): gepaart wird in Reihenfolge. Das Trennzeichen kommt in keiner id vor. */
function uniqueKeys(els: readonly SvgElement[]): string[] {
  const seen = new Map<string, number>();
  return els.map((e) => {
    const n = (seen.get(e.key) ?? 0) + 1;
    seen.set(e.key, n);
    return n === 1 ? e.key : `${e.key}\u0000${n}`;
  });
}

/** Längste wachsende Teilfolge: die Indizes in `seq`, die bleiben (O(n log n)). */
function lisKeep(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/** Eigener Text eines Elements ohne die Stellung zwischen den Kindern: Hinzufügen oder Entfernen von Kindern ändert ihn nicht. */
const ownSig = (t: CanonTree, i: number): string => t.ownText[i].filter((p) => p !== "").join("\u0000");

const isFixedKey = (key: string): boolean => key.startsWith("#style-") || key === "#title" || key === "#desc";

export function diffSvg(baseText: string, answerText: string): DiffResult {
  const B = buildCanonTree(baseText);
  if (B === null || B.elements.length === 0) return no("Ausgang nicht lesbar");
  const A = buildCanonTree(answerText);
  if (A === null || A.elements.length === 0) {
    const issue = scanElements(answerText).issues.find((i) => i.kind === "syntax");
    return no(issue === undefined ? "Antwort nicht lesbar" : `Antwort nicht lesbar: ${issue.message} (Offset ${issue.offset})`);
  }
  if (B.parent.filter((p) => p < 0).length > 1) return no("Ausgang nicht lesbar: mehr als ein Wurzelelement");
  if (A.parent.filter((p) => p < 0).length > 1) return no("Antwort nicht lesbar: mehr als ein Wurzelelement");
  if (canonNode(B, 0) === canonNode(A, 0)) return { decomposable: true, entries: [] };

  const nA = A.elements.length;
  const nB = B.elements.length;
  const bk = uniqueKeys(B.elements);
  const ak = uniqueKeys(A.elements);
  const bIdx = new Map(bk.map((k, i) => [k, i]));
  const aToB: number[] = ak.map((k) => bIdx.get(k) ?? -1);
  const bToA: number[] = bk.map(() => -1);
  aToB.forEach((b, a) => {
    if (b >= 0) bToA[b] = a;
  });
  const keyCount = new Map<string, number>();
  for (const e of B.elements) keyCount.set(e.key, (keyCount.get(e.key) ?? 0) + 1);

  let failure: string | null = null;
  const fail = (why: string): void => {
    failure ??= why;
  };
  /** Schlüssel eines Elements des Ausgangs, wie eine Änderungsliste ihn ansprechen kann (Regel 8). */
  const use = (el: SvgElement): string => {
    if (el.key.startsWith("@")) fail(`Element <${el.tag}> ohne id`);
    else if ((keyCount.get(el.key) ?? 0) > 1) fail(`"${el.key}" ist mehrdeutig (${keyCount.get(el.key)} Elemente)`);
    return el.key;
  };

  // --- Regel 3 und 11: ersetzt?
  const replaceReason: Array<"text" | "style" | "tag" | null> = new Array<"text" | "style" | "tag" | null>(nA).fill(null);
  for (let a = 1; a < nA; a++) {
    const b = aToB[a];
    if (b < 0) continue;
    if (A.elements[a].tag !== B.elements[b].tag) replaceReason[a] = "tag";
    else if (isFixedKey(A.elements[a].key)) {
      if (canonNode(A, a) !== canonNode(B, b)) replaceReason[a] = A.elements[a].tag === "style" ? "style" : "text";
    } else if (ownSig(A, a) !== ownSig(B, b)) replaceReason[a] = "text";
  }
  // Ein ersetztes Kind in gemischtem Inhalt (Text zwischen den Kindern) lässt sich nicht an seine Stelle zwischen den Textstücken setzen:
  // das Elternelement wird ersetzt. Von hinten nach vorn, damit auch mehrere Ebenen hochgereicht werden.
  // Ebenso ein neues oder entferntes Kind.
  const mixed = (t: CanonTree, i: number): boolean => t.ownText[i].some((x) => x !== "");
  for (let a = nA - 1; a >= 1; a--) {
    const pa = A.parent[a];
    if ((replaceReason[a] !== null || aToB[a] < 0) && pa >= 1 && aToB[pa] >= 0 && replaceReason[pa] === null && mixed(A, pa)) replaceReason[pa] = "text";
  }
  for (let b = nB - 1; b >= 1; b--) {
    const pb = B.parent[b];
    if (bToA[b] < 0 && pb >= 1 && bToA[pb] >= 0 && replaceReason[bToA[pb]] === null && mixed(B, pb)) replaceReason[bToA[pb]] = "text";
  }

  // --- Bereiche der Antwort, die als Markup eingefügt werden (Wurzeln: neu, ersetzt, herausgelöst) und ihre Nachkommen.
  type RootA = "new" | "replace" | "freed";
  const rootA: Array<RootA | null> = new Array<RootA | null>(nA).fill(null);
  const coverA: number[] = new Array<number>(nA).fill(-1);
  for (let a = 1; a < nA; a++) {
    const pa = A.parent[a];
    if (coverA[pa] >= 0) {
      coverA[a] = coverA[pa];
      continue;
    }
    const b = aToB[a];
    if (b < 0) rootA[a] = "new";
    else if (replaceReason[a] !== null) rootA[a] = "replace";
    else if (bToA[B.parent[b]] < 0) rootA[a] = "freed";
    if (rootA[a] !== null) coverA[a] = a;
  }

  // --- Bereiche des Ausgangs, die verschwinden: entfernt (ungepaart), ersetzt, eingepackt; und ihre Nachkommen.
  type RootB = "remove" | "replace" | "wrapped";
  const rootB: Array<RootB | null> = new Array<RootB | null>(nB).fill(null);
  const coverB: number[] = new Array<number>(nB).fill(-1);
  const wrappedBy = new Map<number, number[]>(); // Wurzel der neuen Gruppe (Antwort) → eingepackte Elemente (Ausgang, Dokumentreihenfolge)
  for (let b = 1; b < nB; b++) {
    const pb = B.parent[b];
    if (coverB[pb] >= 0) {
      coverB[b] = coverB[pb];
      continue;
    }
    const a = bToA[b];
    if (a < 0) rootB[b] = "remove";
    else if (coverA[a] >= 0 && !(coverA[a] === a && rootA[a] === "replace")) {
      // Ein Element, das aus einer unbedeckten Stelle in eine neue, ersetzte oder herausgelöste Gruppe wandert: hier wird es entfernt.
      rootB[b] = "wrapped";
      const l = wrappedBy.get(coverA[a]);
      if (l) l.push(b);
      else wrappedBy.set(coverA[a], [b]);
    } else if (coverA[a] === a && rootA[a] === "replace") rootB[b] = "replace";
    if (rootB[b] !== null) coverB[b] = b;
  }
  for (let a = 1; a < nA; a++) {
    const b = aToB[a];
    if (b >= 0 && coverA[a] >= 0 !== coverB[b] >= 0) {
      return no(`Element "${A.elements[a].key}" wandert in oder aus einem ersetzten oder neu gepackten Element`);
    }
  }

  // --- Regel 2: verschoben? Längste wachsende Teilfolge der gepaarten, nicht eingefügten Geschwister je Elternknoten.
  const stable: boolean[] = new Array<boolean>(nA).fill(false);
  const movedAny: boolean[] = new Array<boolean>(nA).fill(false); // auch ersetzte (für den Grund)
  for (let p = 0; p < nA; p++) {
    if (coverA[p] >= 0 && p !== 0) continue;
    const kids = A.kids[p].filter((k) => {
      const b = aToB[k];
      return b >= 0 && rootA[k] !== "freed" && (coverA[k] < 0 || rootA[k] === "replace");
    });
    const consistent = kids.filter((k) => aToB[p] === B.parent[aToB[k]]);
    const consistentSet = new Set(consistent);
    for (const k of kids) if (!consistentSet.has(k)) movedAny[k] = true;
    const keep = lisKeep(consistent.map((k) => aToB[k]));
    consistent.forEach((k, i) => {
      if (keep.has(i)) stable[k] = rootA[k] === null;
      else movedAny[k] = true;
    });
  }

  // --- Anker (Regel 9) und Elternschlüssel.
  const anchorOf: number[] = new Array<number>(nA).fill(-1); // Index im Ausgang; der Schlüssel wird erst beim Gebrauch geprüft
  for (let p = 0; p < nA; p++) {
    if (coverA[p] >= 0 && p !== 0) continue;
    let last = -1;
    for (const k of A.kids[p]) {
      anchorOf[k] = last;
      if (stable[k]) last = aToB[k];
    }
  }
  const anchorKey = (a: number): string | null => (anchorOf[a] < 0 ? null : use(B.elements[anchorOf[a]]));
  const parentKeyOf = (a: number): string | null => {
    const el = B.elements[aToB[A.parent[a]]];
    return el.key === "#wurzel" ? null : use(el);
  };
  const markupOf = (a: number): string => answerText.slice(A.elements[a].start, A.elements[a].end);
  const addChange = (a: number): SvgChange => ({ op: "add", parent: parentKeyOf(a), after: anchorKey(a), markup: markupOf(a) });
  const removeChange = (b: number): SvgChange => ({ op: "remove", id: use(B.elements[b]), expect: canonNode(B, b) });

  // --- Einheiten in Antwortreihenfolge (Wurzeln der Einfügungen und Ersetzungen) und die Entfernungen des Ausgangs; gekoppelte werden unten zusammengelegt.
  interface Unit { pos: number; key: string; tag: string; reason: ReplaceReason | null; kind: "add" | "remove" | "replace" | "move"; changes: SvgChange[]; freed: boolean; wrap: boolean; parentKey?: string | null; reparent?: boolean; front?: boolean }
  const units: Unit[] = [];
  const unitOfRootA = new Map<number, number>();
  const unitOfRemoveB = new Map<number, number>();
  const plain: DiffEntry[] = []; // attr und move: stehen für sich
  const plainPos: number[] = [];
  for (let a = 0; a < nA; a++) {
    const ea = A.elements[a];
    const root = rootA[a];
    const b = aToB[a];
    const unit = (u: Omit<Unit, "pos" | "key" | "tag">): void => {
      unitOfRootA.set(a, units.length);
      units.push({ pos: a, key: ea.key, tag: ea.tag, ...u });
    };
    if (root === "new") {
      if (ea.key.startsWith("@")) fail(`Element <${ea.tag}> ohne id`);
      let hasPaired = false;
      for (let j = a + 1; j < nA && A.elements[j].start < ea.end; j++) {
        if (aToB[j] >= 0) {
          hasPaired = true;
          break;
        }
      }
      unit(
        hasPaired
          ? { kind: "replace", reason: "wrap", wrap: true, freed: false, changes: [addChange(a), ...(wrappedBy.get(a) ?? []).map(removeChange)] }
          : { kind: "add", reason: null, wrap: false, freed: false, changes: [addChange(a)] },
      );
    } else if (root === "replace") {
      const reason: ReplaceReason = replaceReason[a] === "style" ? "style" : replaceReason[a] === "tag" ? "tag" : movedAny[a] ? "moved-and-text" : "text";
      unit({ kind: "replace", reason, wrap: false, freed: false, changes: [removeChange(b), addChange(a), ...(wrappedBy.get(a) ?? []).map(removeChange)] });
    } else if (root === "freed") {
      unit({ kind: "replace", reason: "unwrap", wrap: false, freed: true, changes: [addChange(a), ...(wrappedBy.get(a) ?? []).map(removeChange)] });
    } else if (coverA[a] < 0 && b >= 0) {
      const eb = B.elements[b];
      const ma = new Map<string, string>();
      for (const x of ea.attrs) if (!ma.has(x.name)) ma.set(x.name, x.value);
      const mb = new Map<string, string>();
      for (const x of eb.attrs) if (!mb.has(x.name)) mb.set(x.name, x.value);
      const attrEntry = (attr: string, from: string | null, to: string | null): void => {
        plain.push({ kind: "attr", key: ea.key, tag: ea.tag, attr, from, to, changes: [{ op: "change", id: use(eb), attrs: { [attr]: to } }] });
        plainPos.push(a);
      };
      for (const [name, v] of ma) {
        const was = mb.get(name);
        if (was === undefined || normalizeValue(was) !== normalizeValue(v)) attrEntry(name, was ?? null, v);
      }
      for (const [name, v] of mb) if (!ma.has(name)) attrEntry(name, v, null);
      if (movedAny[a]) {
        const pk = parentKeyOf(a);
        const reparent = aToB[A.parent[a]] !== B.parent[b];
        let front: boolean | undefined;
        if (!reparent) {
          // Rang unter den Geschwistern, die in beiden Texten unter demselben Elternknoten stehen: später im Text heißt weiter vorn gezeichnet.
          const pa = A.parent[a];
          const common = (k: number): boolean => aToB[k] >= 0 && B.parent[aToB[k]] === aToB[pa];
          const rankA = A.kids[pa].filter(common).indexOf(a);
          const rankB = B.kids[aToB[pa]].filter((k) => bToA[k] >= 0 && A.parent[bToA[k]] === pa).indexOf(b);
          front = rankA > rankB;
        }
        unit({ kind: "move", reason: null, wrap: false, freed: false, parentKey: pk, reparent, ...(front === undefined ? {} : { front }), changes: [{ op: "move", id: use(eb), parent: pk, after: anchorKey(a) }] });
      }
    }
  }
  for (let b = 1; b < nB; b++) {
    if (rootB[b] !== "remove") continue;
    const eb = B.elements[b];
    unitOfRemoveB.set(b, units.length);
    units.push({ pos: nA + b, key: eb.key, tag: eb.tag, reason: null, kind: "remove", changes: [removeChange(b)], freed: false, wrap: false });
  }

  // --- Regel 10: was sich nicht einzeln annehmen lässt, wird ein Eintrag.
  const uf = units.map((_, i) => i);
  const find = (x: number): number => {
    while (uf[x] !== x) {
      uf[x] = uf[uf[x]];
      x = uf[x];
    }
    return x;
  };
  const union = (x: number, y: number): void => {
    uf[find(x)] = find(y);
  };
  // (a) Ein gepaartes Element, das hier entfernt und dort eingefügt wird: beides gehört zusammen.
  for (let a = 1; a < nA; a++) {
    const b = aToB[a];
    if (b < 0 || coverA[a] < 0 || coverB[b] < 0) continue;
    const ua = unitOfRootA.get(coverA[a]);
    const rb = coverB[b];
    const ub = rootB[rb] === "remove" ? unitOfRemoveB.get(rb) : rootB[rb] === "replace" ? unitOfRootA.get(bToA[rb]) : unitOfRootA.get(coverA[bToA[rb]]);
    if (ua !== undefined && ub !== undefined) union(ua, ub);
  }
  // (b) Eine Reihe Einfügungen zwischen zwei unbewegten Geschwistern, in der ersetzt oder herausgelöst wird.
  for (let p = 0; p < nA; p++) {
    if (coverA[p] >= 0 && p !== 0) continue;
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 2 && run.some((u) => units[u].kind === "replace" && units[u].reason !== "wrap")) for (const u of run) union(u, run[0]);
      run = [];
    };
    for (const k of A.kids[p]) {
      if (stable[k]) flush();
      else {
        const u = unitOfRootA.get(k);
        if (u !== undefined) run.push(u);
      }
    }
    flush();
  }
  // Gruppen zu Einträgen, in der Reihenfolge ihres ersten Mitglieds.
  const groups = new Map<number, number[]>();
  units.forEach((_, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(i);
    else groups.set(r, [i]);
  });
  const built: Array<{ pos: number; entry: DiffEntry }> = [];
  for (const members of groups.values()) {
    members.sort((x, y) => units[x].pos - units[y].pos);
    const us = members.map((i) => units[i]);
    // Entfernungen zuerst (ihre Stelle ist gleichgültig), dann die Einfügungen in Antwortreihenfolge.
    const ordered = [...us.filter((u) => u.kind === "remove"), ...us.filter((u) => u.kind !== "remove")];
    const first = us[0];
    const changes = ordered.flatMap((u) => u.changes);
    if (us.length === 1) {
      if (first.kind === "move") {
        built.push({ pos: first.pos, entry: { kind: "move", key: first.key, tag: first.tag, parentKey: first.parentKey ?? null, ...(first.reparent === undefined ? {} : { reparent: first.reparent }), ...(first.front === undefined ? {} : { front: first.front }), changes } });
        continue;
      }
      built.push({ pos: first.pos, entry: first.kind === "replace" ? { kind: "replace", key: first.key, tag: first.tag, reason: first.reason ?? "text", changes } : { kind: first.kind, key: first.key, tag: first.tag, changes } });
      continue;
    }
    const reason: ReplaceReason = us.some((u) => u.freed) ? "unwrap" : us.some((u) => u.wrap) ? "wrap" : (us.find((u) => u.kind === "replace" && u.reason !== null)?.reason ?? "wrap");
    const head = reason === "unwrap" ? (us.find((u) => u.kind === "remove") ?? first) : first;
    built.push({ pos: first.pos, entry: { kind: "replace", key: head.key, tag: head.tag, reason, changes } });
  }
  plain.forEach((entry, i) => built.push({ pos: plainPos[i] + 0.5, entry }));
  built.sort((x, y) => x.pos - y.pos);
  const entries: DiffEntry[] = built.map((x) => x.entry);
  if (failure !== null) return no(failure);

  // --- Regel 10: alle Einträge zusammen müssen die Antwort ergeben.
  const all = entries.flatMap((e) => e.changes);
  const applied = applyChanges(baseText, all);
  if (!applied.ok) return no(`Die Einträge passen nicht zusammen: ${applied.problems[0] ?? "?"}`);
  if (canonDocument(applied.text) !== canonNode(A, 0)) return no("Die Einträge ergeben nicht die Antwort");
  return { decomposable: true, entries };
}

/** Die Änderungsliste der angenommenen Einträge (Indizes in `entries`), in Listenreihenfolge. */
export function changesFor(entries: readonly DiffEntry[], accepted: ReadonlySet<number>): SvgChange[] {
  return entries.flatMap((e, i) => (accepted.has(i) ? e.changes : []));
}
