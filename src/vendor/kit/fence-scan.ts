// vendored from obsidian-kit@0.80.0, src/pure/fence-scan.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
