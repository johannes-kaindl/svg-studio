// vendored from obsidian-kit@0.88.0, src/pure/fence-scan.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Herkunft: 3d-codeblocks `src/core/shapes/fence.ts` (`listFences`, `findFenceAt`, Kit-Kandidat aus der Extraktionsprüfung SVG Studio 2026-11-02),
// hier mit `noUncheckedIndexedAccess`-Zugriffen und ohne die Sprache `shapes` im Namen. Der Zaun-Scanner liegt im obsidian-kit und nicht in
// code-kit/fences: code-kit nennt ihn ausdrücklich „bleibt beim Träger“, und er gehört zur Domäne dieser Schicht (Zäune einer Notiz als Zeilenbereiche
// in der Form, die `block-writer` und `panel-accept` brauchen). Kein obsidian-Import.
//
// Welcher Codezaun umschließt eine Zeile? Pure. Gerendertes Markdown kennt mehr (Zäune in Zitaten, Callouts, Listen): der Scanner liest die
// Notiz als flachen Text und meldet nur Zäune mit höchstens drei Leerzeichen Einzug. Wer das Ergebnis zum Schreiben nutzt, prüft zusätzlich den
// Rumpf-Fingerabdruck (`panel-accept` → `locateBlock`).

export interface Fence {
  /** Sprache des Info-Strings, klein geschrieben; leer ohne Info-String. */
  lang: string;
  /** 0-basiert: Zeile des öffnenden Zauns. */
  openLine: number;
  /** 0-basiert: Zeile des schließenden Zauns, bei offenem Zaun die letzte Zeile. */
  closeLine: number;
  /** Zeilen dazwischen, mit `\n` verbunden (auch bei CRLF-Notizen). */
  body: string;
}

const OPEN = /^ {0,3}(`{3,}|~{3,}) *([^\s`]*)/;

/** Alle Zäune einer Notiz in Reihenfolge; ein offener Zaun läuft bis zum Ende. */
export function listFences(text: string): Fence[] {
  const lines = text.split(/\r?\n/);
  const out: Fence[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const open = OPEN.exec(line.replace(/^\uFEFF/, ""));
    const marker = open?.[1];
    if (!open || marker === undefined) {
      i += 1;
      continue;
    }
    // CommonMark: der Info-String eines Backtick-Zauns darf keinen Backtick enthalten ("```svg``` text" ist kein Zaun).
    if (marker.startsWith("`") && line.slice(line.indexOf(marker) + marker.length).includes("`")) {
      i += 1;
      continue;
    }
    const ch = marker.startsWith("`") ? "`" : "~";
    const closeRe = new RegExp(`^ {0,3}${ch}{${String(marker.length)},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j] ?? "")) j += 1;
    const closed = j < lines.length;
    const closeLine = closed ? j : lines.length - 1;
    out.push({ lang: (open[2] ?? "").toLowerCase(), openLine: i, closeLine, body: lines.slice(i + 1, closed ? j : lines.length).join("\n") });
    i = closeLine + 1;
  }
  return out;
}

/** Der Zaun, in dem die (0-basierte) Zeile liegt, einschließlich Öffnungs- und Schlusszeile; sonst `null`. */
export function findFenceAt(text: string, line: number): Fence | null {
  return listFences(text).find((f) => line >= f.openLine && line <= f.closeLine) ?? null;
}

// ── Zäune, die der flache Scanner nicht sieht ──────────────────────────────────────────────────────────────────────────────────────
//
// Ein Zaun in einem Zitat oder Callout (`> ```js`) und ein Zaun mit vier und mehr Leerzeichen Einzug unter einem Listenpunkt sind für `listFences` keine: Schreiben in einen
// solchen Block lehnt `locateBlock` sicher ab, aber `insertAtCursor` setzte den neuen Block mitten in den Zaun des Callouts (Opus-Review A3, 2026-11-04). Dieser Leser
// beantwortet nur die eine Frage „liegt die Zeile in einem solchen Zaun?“ und liefert dafür dieselbe Form; zum Schreiben taugt er nicht (Rumpf ohne Zitatzeichen, kein Fingerabdruck).

const QUOTE = /^ {0,3}> ?/;
const NESTED_OPEN = /^( *)(`{3,}|~{3,}) *([^\s`]*)/;
const LIST_ITEM = /^ *(?:[-*+]|\d{1,9}[.)])(?: |$)/;

/** Zitatzeichen (`>`, auch geschachtelt) vorn abziehen: wie viele es waren und was bleibt. */
function stripQuote(line: string): { depth: number; rest: string } {
  let rest = line;
  let depth = 0;
  for (let m = QUOTE.exec(rest); m; m = QUOTE.exec(rest)) {
    rest = rest.slice(m[0].length);
    depth += 1;
  }
  return { depth, rest };
}

/** Ein Listenpunkt steht über der Zeile: die nächste nichtleere Zeile mit weniger Einzug ist ein Listenpunkt (`-`, `*`, `+`, `1.`, `1)`). */
function underListItem(rows: readonly { rest: string }[], index: number, indent: number): boolean {
  for (let k = index - 1; k >= 0; k -= 1) {
    const r = rows[k]?.rest ?? "";
    if (r.trim() === "") continue;
    const own = r.length - r.trimStart().length;
    if (own < indent) return LIST_ITEM.test(r);
  }
  return false;
}

/** Der Zaun in einem Zitat, Callout oder Listenpunkt (Einzug ab vier Leerzeichen), in dem die (0-basierte) Zeile liegt, einschließlich Öffnungs- und Schlusszeile; sonst `null`.
 *  Zäune, die `listFences` schon sieht, und Zeilen innerhalb von ihnen (ein Beispiel in einem Markdown-Zaun) zählen hier nicht. Ein Zaun ohne Schlusszeile endet mit seinem Zitat
 *  (die erste Zeile mit weniger Zitatzeichen) bzw. am Textende. `body` trägt die Zeilen ohne Zitatzeichen. */
export function findNestedFenceAt(text: string, line: number): Fence | null {
  const lines = text.split(/\r?\n/);
  const flat = listFences(text);
  const inFlat = (i: number): boolean => flat.some((f) => i >= f.openLine && i <= f.closeLine);
  const rows = lines.map((l) => stripQuote(l.replace(/^\uFEFF/, "")));
  let i = 0;
  while (i < lines.length) {
    const row = rows[i];
    if (!row || inFlat(i)) { i += 1; continue; }
    const open = NESTED_OPEN.exec(row.rest);
    const marker = open?.[2];
    const indent = open?.[1]?.length ?? 0;
    // Unter einem Zitat zählt jeder Einzug, sonst nur der ab vier Leerzeichen unter einem Listenpunkt (alles darunter sah der flache Scanner schon, alles andere ist Code-Einrückung).
    const nested = row.depth > 0 ? indent >= 0 : indent >= 4 && underListItem(rows, i, indent);
    if (!open || marker === undefined || !nested) { i += 1; continue; }
    if (marker.startsWith("`") && row.rest.slice(row.rest.indexOf(marker) + marker.length).includes("`")) { i += 1; continue; }
    const ch = marker.startsWith("`") ? "`" : "~";
    const closeRe = new RegExp(`^ *${ch}{${String(marker.length)},}[ \\t]*$`);
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const r = rows[j];
      if (!r || r.depth < row.depth) break;          // das Zitat ist zu Ende
      if (closeRe.test(r.rest)) { closed = true; break; }
      j += 1;
    }
    const closeLine = closed ? j : j - 1;
    if (line >= i && line <= closeLine) {
      return { lang: (open[3] ?? "").toLowerCase(), openLine: i, closeLine, body: rows.slice(i + 1, closed ? closeLine : closeLine + 1).map((r) => r.rest).join("\n") };
    }
    i = closeLine + 1;
  }
  return null;
}
