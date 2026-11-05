// vendored from obsidian-kit@0.80.1, src/obsidian/panel-accept.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Herkunft: 3d-codeblocks `src/obsidian/panel-accept.ts:20-287` (Übernehmen im Prompt-Panel, Spec Modell per Prompt § 6.3/§ 5), dazu
// `json-editor/src/obsidian/repair-flow.ts:70-76` (Anhangpfad nie überschreiben, Text und binär) — Kit-Kandidat aus der Extraktionsprüfung SVG Studio
// (2026-11-02, Gegenleser K6). Das Format steckt in `AcceptSpec` (Zaun-Sprache, Berechnung, Prüfung, Haken vor dem Schreiben), die Texte in
// `AcceptStrings`; das Kit hat kein `t()`.
//
// ## Was das Modul tut
//
// `acceptPanel(env, spec, target, kind)` schreibt das Ergebnis eines Prompt-Panels dorthin, wo es hingehört: in einen Codeblock einer Notiz
// (`target.kind === "block"`), in eine Datei (`"file"`) oder, für das Ziel `new`, in einen neuen Block am Cursor oder in eine neue Anhangdatei samt
// Verweis. Es **wirft nie**; jede Unsicherheit ist eine Ablehnung mit Meldung und ohne Schreibversuch (Datenschutz vor Komfort, die Nutzernotiz ist
// fremder Inhalt). Alles oder nichts: `compute` liefert den ganzen Text oder ein Problem.
//
// - **Block:** der Block wird nur geschrieben, wenn seine Zeilen, seine Sprache UND sein Rumpf noch die sind, die der Nutzer angeklickt hat
//   (`locateBlock`, Fingerabdruck wie in REGISTRY „Zeilenbasiertes Ziel braucht einen Inhalts-Fingerabdruck“): Zeilennummern allein treffen nach
//   einer Änderung darüber einen anderen Block. Geschrieben wird über `writeBlockBody` (Editor mit Strg+Z, sonst `vault.process`), das den Rumpf
//   ein zweites Mal vor dem Schreiben prüft. **Wiederfinden (0.80.1):** steht der Block unverändert woanders (der Nutzer tippt während des Laufs eine Zeile
//   darüber), findet `locateBlock` ihn nach Inhalt, aber nur bei **genau einem** Zaun gleicher Sprache, Länge und gleichen Rumpfs; die neue Lage kommt als
//   `retarget` zurück (auch bei `unchanged`). Zwei gleiche Blöcke bleiben `blockMoved`, ein geänderter Rumpf bleibt `blockChanged`.
// - **Datei:** lesen, `compute(aktueller Text)`, `checkWrite`, dann `beforeWrite(path, alterText)` (der Haken für den Schnappschuss, `file-snapshot`),
//   dann `vault.process`, das nur schreibt, wenn die Datei seit dem Lesen unverändert ist. Wirft `beforeWrite`, wird nichts geschrieben: ein
//   Schreibvorgang ohne Rückweg findet nicht statt.
// - **Neu:** `acceptAs` der Einstellung (`block`, `file`, `ask` → `env.choose()`); ein Spec ohne `newFile` kennt nur den Block und fragt nie.
// - **Frontmatter ist Sperrzone (0.79.2):** `insertAtCursor` setzt den Text hinter die schließende `---`-Zeile, wenn der Cursor (bei einer Auswahl: deren Ende) in oder vor der Frontmatter
//   steht (`0:0`, eine YAML-Zeile). Was Frontmatter ist, sagt Obsidians `getFrontMatterInfo`; gemessen in 1.15.1: Obsidian öffnet eine Notiz mit Frontmatter mit dem Cursor auf der ersten Zeile
//   DAHINTER, `0:0` ist der Ausnahmefall (Strg+Pos1, Klick in den YAML-Text). Entscheidung „dahinter einfügen statt ablehnen“: Begründung im CHANGELOG 0.79.2.
// - **Lesemodus:** `view.editor` ist dort nicht der Puffer, den Obsidian zeigt; ein `replaceRange` verpuffte lautlos. `readingMode: "refuse"` lehnt ab,
//   `"append"` hängt den Text am Notizende über `vault.process` an und sagt das in der Meldung.
// - **`compute` und die Meldungen:** `problem` aus `compute` (etwa aus `acceptChain` von code-kit `panel-session`, dessen Probleme englisch sind) geht
//   unverändert durch `strings.notApplied(problem)`; das Modul übersetzt oder verändert es nicht.
//
// - **Grenzen, die der Aufrufer kennt (Opus-Review 2026-11-04):** (1) **Keine Sperre gegen einen zweiten Aufruf.** Block und Datei lehnen einen gleichzeitigen zweiten
//   Aufruf ab (`noteChanged`: der Fingerabdruck bzw. der Datei-Stand trägt), das Ziel `new` schreibt aber zweimal. Der Aufrufer sperrt den Knopf während des Laufs und
//   leert die Runden nach einem Erfolg. (2) **Der Zaun-Scanner liest flach:** ein Zaun in einem Zitat oder Callout (`> ```js`) oder mit vier und mehr Leerzeichen Einzug
//   ist für ihn keiner. Schreiben in einen solchen Block wird sicher abgelehnt (`blockMoved`/`blockChanged`), Einfügen am Cursor dort landet aber im Zaun des Zitats.
//   (3) `insertAtCursor` nutzt `replaceSelection`; bei mehreren Cursorn ist das Verhalten ungemessen.
// Nicht Teil des Bausteins: ungespeicherte Puffer einer Plugin-eigenen Dateiansicht (der Aufrufer speichert sie vor `acceptPanel`), die
// Zwei-Wege-Wahl bei `ask` (`env.choose`, das Kit-`confirm` ist Ja/Nein) und das Zeichnen des Panels.

import { MarkdownView, TFile, getFrontMatterInfo, type App } from "obsidian";
import { BlockChangedError, writeBlockBody, type WritePorts } from "../kit/block-writer";
import { findFenceAt, listFences, type Fence } from "../kit/fence-scan";
import { closesFence } from "../kit/fences";
import type { Target } from "../kit/panel-session";

export type BlockTarget = Extract<Target, { kind: "block" }>;

/** Wo `insertAtCursor` den Text hingesetzt hat. */
export type InsertWhere = "after-block-at-selection" | "after-block-at-cursor" | "after-frontmatter" | "after-selection" | "at-cursor";

/** Der Zaun am Cursor oder am Ende der Auswahl wird nie geschlossen: hinter ihm einzufügen hieße, im Zaun einzufügen. */
export class UnclosedFenceError extends Error {
  readonly selected: boolean;
  constructor(selected: boolean) {
    super("the cursor or selection is in a code block that is never closed");
    this.name = "UnclosedFenceError";
    this.selected = selected;
  }
}

export interface AcceptStrings {
  unsupported(label: string): string;
  /** Umschlag um ein Problem aus `compute`/`checkWrite` („… — nothing was applied.“). Das Problem selbst kommt unverändert an. */
  notApplied(problem: string): string;
  unchanged: string;
  /** `create` auf ein bestehendes Ziel (Block oder Datei): würde dessen Inhalt kommentarlos ersetzen. */
  cannotReplace: string;
  blockMoved: string;
  blockChanged: string;
  noteChanged: string;
  /** Eine Zeile des neuen Rumpfs würde den Zaun des Blocks schließen. */
  closesFence: string;
  cancelled: string;
  noNoteOpen: string;
  noteInReadingView: string;
  appliedTo(label: string): string;
  appliedAsBlock(where: InsertWhere): string;
  /** Lesemodus mit `readingMode: "append"`: Block am Ende der Notiz angehängt. */
  appendedToNote: string;
  fileGone(path: string): string;
  fileExists(path: string): string;
  couldNotCreate(path: string, reason: string): string;
  savedFileWithReference(path: string): string;
  savedFileNoReference(path: string, why: "reading" | "no-note" | "note-changed"): string;
  /** Lesemodus mit `readingMode: "append"`: Datei angelegt, Verweis am Ende der Notiz angehängt. */
  savedFileAppended(path: string): string;
  savedFileReferenceFailed(path: string, reason: string): string;
  unclosedFence(selected: boolean): string;
  couldNotApply(reason: string): string;
}

export interface AcceptSpec {
  /** Sprache des Zauns, in dem der Block steht (`"svg"`); der Fingerabdruck prüft sie mit. */
  fenceLang: string;
  /** Der Block, wie er in die Notiz kommt (Zaun samt Sprache). */
  wrap(text: string): string;
  /** Neue Anhangdatei für das Ziel `new`; fehlt sie, kennt der Spec nur den Block. `reference` baut den Verweis aus dem Linktext. */
  newFile?: (text: string) => { name: string; content: string | ArrayBuffer; reference: (linktext: string) => string };
  /** Der Text, den die Übernahme schreibt, aus dem Text des Ziels JETZT (`null` für das Ziel `new`). Alles oder nichts. */
  compute(current: string | null): { ok: true; text: string } | { ok: false; problem: string };
  /** Letzte Prüfung des fertigen Textes; ein Problem verhindert das Schreiben. */
  checkWrite?(text: string): string | null;
  /** Vor dem Überschreiben einer bestehenden Datei (`file-snapshot`); wirft → nichts wird geschrieben. */
  beforeWrite?(path: string, oldText: string): Promise<void>;
}

export interface AcceptEnv {
  app: App;
  ports: WritePorts;
  settings(): { acceptAs: "block" | "file" | "ask" };
  /** Die zuletzt bediente Notiz (Quell- oder Lesemodus), sonst `null`. */
  lastEditor(): MarkdownView | null;
  choose(): Promise<"block" | "file" | null>;
  strings: AcceptStrings;
  readingMode: "append" | "refuse";
}

/** `retarget`: nach einem erfolgreichen Block-Apply das neue Ziel (geschriebener Rumpf, neue Schlusszeile), damit das Panel weiterarbeiten kann. */
export type AcceptOutcome = { ok: true; message: string; retarget?: Target } | { ok: false; message: string };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Vergleichsform eines Rumpfs: CRLF → LF, ein Zeilenende am Ende zählt nicht. */
const normBody = (t: string): string => t.replace(/\r\n/g, "\n").replace(/\n$/, "");

/* ── Anhang anlegen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type CreateAttachmentResult =
  | { ok: true; file: TFile; path: string }
  | { ok: false; code: "exists" | "error"; path: string; message: string };

/** Legt eine Anhangdatei an und überschreibt nie: der Pfad kommt von Obsidian (`getAvailablePathForAttachment`, Anhangordner der Notiz oder der
 *  Standardordner bei `notePath: null`), und ein Pfad, den Vault oder Adapter schon kennen (auch in anderer Schreibweise), wird abgelehnt, falls die
 *  Pfadvergabe ihn übersieht. `ArrayBuffer` geht über `createBinary`. Wirft nie. */
export async function createAttachmentFile(
  app: App,
  o: { name: string; notePath: string | null; content: string | ArrayBuffer },
): Promise<CreateAttachmentResult> {
  let path = "";
  try {
    path = await app.fileManager.getAvailablePathForAttachment(o.name, o.notePath ?? "");
    if (app.vault.getAbstractFileByPath(path) || (await app.vault.adapter.exists(path))) {
      return { ok: false, code: "exists", path, message: `${path} already exists` };
    }
    const file = typeof o.content === "string" ? await app.vault.create(path, o.content) : await app.vault.createBinary(path, o.content);
    return { ok: true, file, path };
  } catch (error) {
    return { ok: false, code: "error", path, message: errorText(error) };
  }
}

/* ── Einfügen am Cursor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Einfügen, ohne Nutzerinhalt zu zerstören: **die Frontmatter ist Sperrzone** (Cursor oder Auswahlende in ihr, auch `0:0` vor ihr: der Text steht hinter ihrer schließenden
 *  `---`-Zeile, `after-frontmatter`; eine Einfügung davor machte sie zur Nicht-Frontmatter, eine in einer YAML-Zeile zerrisse sie). Was Frontmatter ist, sagt Obsidian
 *  selbst (`getFrontMatterInfo`, gemessen 1.15.1: erste Zeile genau `---`, schließende Zeile genau `---`, ein leerer Block zählt, ohne schließende Zeile gibt es keine). Ein Zaun unter dem Cursor
 *  bzw. am Ende der Auswahl bekommt den Text dahinter (sonst entstünde ein Block im Block); eine Auswahl außerhalb von Frontmatter und Zaun bleibt (Einfügung an ihrem Ende). Ein Zaun, der nie
 *  geschlossen wird, hat kein „dahinter“: `UnclosedFenceError`, nichts geschrieben. Die Zeilenenden der Notiz bleiben einheitlich. */
export function insertAtCursor(view: MarkdownView, text: string): InsertWhere {
  const editor = view.editor;
  const value = editor.getValue();
  const lines = value.split(/\r?\n/);
  const selected = editor.somethingSelected();
  const anchor = selected ? editor.getCursor("to") : editor.getCursor();
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const fmEnd = frontmatterCloseLine(value);
  if (fmEnd !== null && anchor.line <= fmEnd) {
    editor.replaceRange(`${eol}${text.replace(/\r?\n/g, eol)}`, { line: fmEnd, ch: (lines[fmEnd] ?? "").length });
    return "after-frontmatter";
  }
  const fence = findFenceAt(value, anchor.line);
  if (fence) {
    if (isUnclosed(fence, lines)) throw new UnclosedFenceError(selected);
    editor.replaceRange(`${eol}${text.replace(/\r?\n/g, eol)}`, { line: fence.closeLine, ch: (lines[fence.closeLine] ?? "").length });
    return selected ? "after-block-at-selection" : "after-block-at-cursor";
  }
  if (selected) {
    editor.replaceRange(text, anchor);
    return "after-selection";
  }
  editor.replaceSelection(text);
  return "at-cursor";
}

/** 0-basierte Zeile der schließenden `---` der Frontmatter, `null` ohne Frontmatter (Regel und Grenzfälle: `insertAtCursor`). */
function frontmatterCloseLine(value: string): number | null {
  const info = getFrontMatterInfo(value);
  if (!info.exists) return null;
  return value.slice(0, info.contentStart).replace(/\r?\n$/, "").split("\n").length - 1;
}

/** Ist der Zaun nie geschlossen? Dann ist seine letzte Zeile Inhalt. */
function isUnclosed(fence: Fence, lines: string[]): boolean {
  const open = /^ {0,3}(`{3,}|~{3,})/.exec((lines[fence.openLine] ?? "").replace(/^\uFEFF/, ""));
  const marker = open?.[1];
  if (!marker || fence.closeLine <= fence.openLine) return true;
  const close = new RegExp(`^ {0,3}${marker.startsWith("`") ? "`" : "~"}{${String(marker.length)},}[ \\t]*$`);
  return !close.test(lines[fence.closeLine] ?? "");
}

/** Die zuletzt bediente Notiz im Quellmodus (`{ view }`), im Lesemodus (`{ reading }`) oder keine (`{ none }`: keine Ansicht oder ohne Datei). */
export function sourceViewOf(last: MarkdownView | null): { view: MarkdownView } | { reading: MarkdownView } | { none: true } {
  if (!last?.file) return { none: true };
  return last.getMode() === "source" ? { view: last } : { reading: last };
}

/* ── Schreiben mit Wächter ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** `vault.process` mit zwei Ausgängen: `fn` liefert den neuen Text, oder `null` (und derselbe Text) für „nichts schreiben“; ein Wurf in `fn` schreibt
 *  nichts und kommt als `ok: false` zurück. */
export async function processGuarded(
  app: App,
  file: TFile,
  fn: (current: string) => string | null,
): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  let changed = false;
  try {
    await app.vault.process(file, (current) => {
      const next = fn(current);
      if (next === null || next === current) return current;
      changed = true;
      return next;
    });
    return { ok: true, changed };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

/* ── Block finden ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** `relocated`: der Block stand nicht mehr auf den gemerkten Zeilen und wurde an `fence.openLine`/`closeLine` wiedergefunden (0.80.1). */
export type Located = { fence: Fence; text: string; relocated: boolean } | { problem: "moved" | "changed" };

/** Notiztext aus derselben Quelle wie der Schreiber: offener Quell-Editor, sonst Vault. */
async function readNoteText(ports: WritePorts, path: string): Promise<string> {
  return ports.editorFor(path)?.getValue() ?? (await ports.vault.read(path));
}

/** Zaun des Blocks finden UND prüfen, dass es noch der Block ist, den der Nutzer angeklickt hat: gleiche Öffnungs- und Schlusszeile, gleiche Sprache,
 *  gleicher Rumpf (Fingerabdruck `t.body`). Zeilennummern allein tragen nicht: nach dem Löschen eines Blocks darüber trifft eine veraltete Position
 *  einen anderen. `moved`: an der Stelle steht kein Block dieser Sprache mit diesen Zeilen; `changed`: es ist derselbe Ort, aber ein anderer Rumpf.
 *
 *  **Wiederfinden (0.80.1):** Tippt der Nutzer während eines Panel-Laufs eine Zeile über den Block, steht er unverändert eine Zeile tiefer, und die gemerkten
 *  Zeilen zeigen ins Leere. Das ist kein `moved`: steht auf den gemerkten Zeilen KEIN Block dieser Sprache und Länge, wird der Block nach Inhalt gesucht
 *  (Sprache, Länge in Zeilen, Rumpf, der Zaun muss geschlossen sein) und genau dann wiedergefunden (`relocated: true`), wenn es **genau einen** solchen Zaun gibt.
 *  Zwei oder mehr gleiche Blöcke bleiben `moved`: eine falsche Zuordnung überschriebe einen fremden Block, ein verlorener Lauf kostet nur eine Runde
 *  (REGISTRY „Zeilenbasiertes Ziel braucht einen Inhalts-Fingerabdruck“). Ebenso bleibt `changed`, wenn auf den gemerkten Zeilen ein Block gleicher Sprache und
 *  Länge mit anderem Rumpf steht: ob der Nutzer ihn geändert hat oder ein Nachbar nachgerutscht ist, sagt der Text nicht, und die Umlenkung träfe im ersten Fall
 *  eine Kopie. Welcher Zaun die Zeilen schließt (Backtick, Tilde), ist für das Wiederfinden gleich: der Schreiber ersetzt nur Zeilen zwischen den Zäunen. */
export async function locateBlock(ports: WritePorts, t: BlockTarget, lang: string): Promise<Located> {
  const text = await readNoteText(ports, t.path);
  const want = lang.toLowerCase();
  const fences = listFences(text);
  const here = fences.find((f) => f.openLine === t.lineStart && f.lang === want && f.closeLine === t.lineEnd);
  if (here) return normBody(here.body) === normBody(t.body) ? { fence: here, text, relocated: false } : { problem: "changed" };
  const lines = text.split(/\r?\n/);
  const span = t.lineEnd - t.lineStart;
  const same = fences.filter((f) => f.lang === want && f.closeLine - f.openLine === span && !isUnclosed(f, lines) && normBody(f.body) === normBody(t.body));
  const only = same.length === 1 ? same[0] : undefined;
  return only ? { fence: only, text, relocated: true } : { problem: "moved" };
}

/** Der Rumpf des Blocks jetzt (LF-normalisiert) für das Panel; `null`, wenn Block oder Notiz nicht (mehr) auffindbar oder verändert sind. Wirft nie. */
export async function readBlockText(ports: WritePorts, t: BlockTarget, lang: string): Promise<string | null> {
  try {
    const found = await locateBlock(ports, t, lang);
    return "fence" in found ? found.fence.body : null;
  } catch {
    return null;
  }
}

/* ── Übernehmen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Schreibt das Ergebnis des Panels in `target`. Wirft nie; `kind: "create"` verweigert ein bestehendes Ziel. */
export async function acceptPanel(env: AcceptEnv, spec: AcceptSpec, target: Target, kind: "create" | "refine"): Promise<AcceptOutcome> {
  try {
    if (target.kind === "other") return { ok: false, message: env.strings.unsupported(target.label) };
    // Ein `create` baut aus dem Nichts: auf einem bestehenden Block oder einer Datei würde es dessen Inhalt kommentarlos ersetzen.
    if (kind === "create" && (target.kind === "block" || target.kind === "file")) return { ok: false, message: env.strings.cannotReplace };
    if (target.kind === "block") return await acceptIntoBlock(env, spec, target);
    if (target.kind === "file") return await acceptIntoFile(env, spec, target);
    return await acceptAsNew(env, spec);
  } catch (error) {
    return { ok: false, message: env.strings.couldNotApply(errorText(error)) };
  }
}

/** Die letzte Prüfung vor jedem Schreiben; `null` = darf geschrieben werden. */
function refuse(env: AcceptEnv, spec: AcceptSpec, text: string): AcceptOutcome | null {
  const problem = spec.checkWrite?.(text) ?? null;
  return problem === null ? null : { ok: false, message: env.strings.notApplied(problem) };
}

async function acceptIntoBlock(env: AcceptEnv, spec: AcceptSpec, t: BlockTarget): Promise<AcceptOutcome> {
  const { strings } = env;
  const found = await locateBlock(env.ports, t, spec.fenceLang);
  if ("problem" in found) return { ok: false, message: found.problem === "moved" ? strings.blockMoved : strings.blockChanged };
  const { fence, text } = found;
  const result = spec.compute(fence.body);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  // Wiedergefundener Block: auch ohne Schreiben bekommt der Aufrufer die neue Lage, sonst sucht das Panel in der nächsten Runde wieder an der alten Stelle.
  const moved: Target | undefined = found.relocated ? { ...t, lineStart: fence.openLine, lineEnd: fence.closeLine, body: fence.body } : undefined;
  if (normBody(result.text) === normBody(fence.body)) return moved ? { ok: true, message: strings.unchanged, retarget: moved } : { ok: true, message: strings.unchanged };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  if (closesFence(text.split(/\r?\n/)[fence.openLine] ?? "", result.text)) return { ok: false, message: strings.closesFence };
  try {
    // `fence.body` ist der Text, gegen den der Schreiber vor dem Schreiben noch einmal prüft (Rumpf unverändert).
    await writeBlockBody(env.ports, { path: t.path, lineStart: fence.openLine, lineEnd: fence.closeLine, fence: spec.fenceLang }, fence.body, result.text);
  } catch (error) {
    if (error instanceof BlockChangedError) return { ok: false, message: strings.noteChanged };
    throw error;
  }
  // Schlusszeile = Öffnungszeile + Rumpfzeilen + 1.
  const lineEnd = fence.openLine + result.text.split("\n").length + 1;
  return { ok: true, message: strings.appliedTo(t.label), retarget: { ...t, lineStart: fence.openLine, lineEnd, body: result.text } };
}

async function acceptIntoFile(env: AcceptEnv, spec: AcceptSpec, t: Extract<Target, { kind: "file" }>): Promise<AcceptOutcome> {
  const { strings, app } = env;
  const file = app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return { ok: false, message: strings.fileGone(t.path) };
  const current = await app.vault.read(file);
  const result = spec.compute(current);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  if (result.text === current) return { ok: true, message: strings.unchanged };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  // Der Rückweg zuerst: wirft der Haken, wird nichts geschrieben.
  await spec.beforeWrite?.(t.path, current);
  // Geschrieben wird nur, wenn die Datei noch der Text ist, von dem der Schnappschuss und `compute` ausgingen.
  let stale = false;
  const written = await processGuarded(app, file, (now) => {
    if (now !== current) { stale = true; return null; }
    return result.text;
  });
  if (stale) return { ok: false, message: strings.noteChanged };
  if (!written.ok) return { ok: false, message: strings.couldNotApply(written.message) };
  return { ok: true, message: strings.appliedTo(t.label) };
}

async function acceptAsNew(env: AcceptEnv, spec: AcceptSpec): Promise<AcceptOutcome> {
  const { strings } = env;
  const result = spec.compute(null);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  let where: "block" | "file" | null = "block";
  if (spec.newFile) {
    const setting = env.settings().acceptAs;
    where = setting === "ask" ? await env.choose() : setting;
    if (where === null) return { ok: false, message: strings.cancelled };
  }
  return where === "block" ? insertAsBlock(env, spec, result.text) : createAsFile(env, spec, result.text);
}

/** Text ans Ende der Notiz hängen (Lesemodus), mit Leerzeile davor, in den Zeilenenden der Notiz. Endet die Notiz in einem nie geschlossenen Zaun, würde der
 *  Text zu dessen Inhalt und unser Schlusszaun schlösse den Zaun des Nutzers: `UnclosedFenceError`, nichts geschrieben (derselbe Wächter wie `insertAtCursor`). */
async function appendToNote(env: AcceptEnv, path: string, text: string): Promise<void> {
  await env.ports.vault.process(path, (cur) => {
    const last = listFences(cur).at(-1);
    if (last && isUnclosed(last, cur.split(/\r?\n/))) throw new UnclosedFenceError(false);
    const eol = cur.includes("\r\n") ? "\r\n" : "\n";
    const gap = cur === "" ? "" : cur.endsWith("\n") ? eol : eol + eol;
    return `${cur}${gap}${text.replace(/\r?\n/g, eol)}${eol}`;
  });
}

async function insertAsBlock(env: AcceptEnv, spec: AcceptSpec, text: string): Promise<AcceptOutcome> {
  const { strings } = env;
  const src = sourceViewOf(env.lastEditor());
  if ("none" in src) return { ok: false, message: strings.noNoteOpen };
  if ("reading" in src) {
    if (env.readingMode === "refuse") return { ok: false, message: strings.noteInReadingView };
    try {
      await appendToNote(env, src.reading.file?.path ?? "", spec.wrap(text));
    } catch (error) {
      if (error instanceof UnclosedFenceError) return { ok: false, message: strings.unclosedFence(error.selected) };
      throw error;
    }
    return { ok: true, message: strings.appendedToNote };
  }
  try {
    return { ok: true, message: strings.appliedAsBlock(insertAtCursor(src.view, `\n${spec.wrap(text)}\n`)) };
  } catch (error) {
    if (error instanceof UnclosedFenceError) return { ok: false, message: strings.unclosedFence(error.selected) };
    throw error;
  }
}

async function createAsFile(env: AcceptEnv, spec: AcceptSpec, text: string): Promise<AcceptOutcome> {
  const { strings, app } = env;
  const make = spec.newFile;
  if (!make) return { ok: false, message: strings.couldNotApply("no file format") };
  const src = sourceViewOf(env.lastEditor());
  const noteView = "view" in src ? src.view : "reading" in src ? src.reading : null;
  const notePath = noteView?.file?.path ?? null;
  const spec1 = make(text);
  const created = await createAttachmentFile(app, { name: spec1.name, notePath, content: spec1.content });
  if (!created.ok) {
    return { ok: false, message: created.code === "exists" ? strings.fileExists(created.path) : strings.couldNotCreate(created.path, created.message) };
  }
  const { path } = created;
  // Ab hier besteht die Datei: nichts darf mehr als `ok: false` („nichts angewendet“) enden, sonst legt der nächste Versuch `bild 1.svg` daneben an.
  try {
    if ("none" in src) return { ok: true, message: strings.savedFileNoReference(path, "no-note") };
    const reference = spec1.reference(app.metadataCache.fileToLinktext(created.file, notePath ?? "", false));
    // Das Anlegen hatte `await`s: die zuletzt aktive Notiz kann inzwischen eine andere sein oder im Lesemodus stehen. Der Verweis geht nur dorthin, wo er gebaut wurde.
    const now = sourceViewOf(env.lastEditor());
    const nowView = "view" in now ? now.view : "reading" in now ? now.reading : null;
    if (nowView?.file?.path !== notePath || "view" in now !== "view" in src) return { ok: true, message: strings.savedFileNoReference(path, "note-changed") };
    if ("reading" in now) {
      if (env.readingMode === "refuse") return { ok: true, message: strings.savedFileNoReference(path, "reading") };
      await appendToNote(env, notePath ?? "", reference);
      return { ok: true, message: strings.savedFileAppended(path) };
    }
    insertAtCursor((now as { view: MarkdownView }).view, `\n${reference}\n`);
    return { ok: true, message: strings.savedFileWithReference(path) };
  } catch (error) {
    const reason = error instanceof UnclosedFenceError ? strings.unclosedFence(error.selected) : errorText(error);
    return { ok: true, message: strings.savedFileReferenceFailed(path, reason) };
  }
}
