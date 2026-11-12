// Übernehmen (Spec § 7.6): das Ergebnis des Panels dorthin schreiben, wo es hingehört. Die Mechanik (Fingerabdruck des Blocks, Anhang anlegen und nie
// überschreiben, Cursor, Lesemodus, Schnappschuss-Haken) trägt der Kit-Baustein `panel-accept`; hier steht, was SVG ist: Zaun-Sprache, Dateiname aus dem Prompt,
// der Text aus den Runden (`acceptText`), die letzte Prüfung mit dem Bereiniger und der Schnappschuss vor dem Überschreiben einer Datei.
// Lesemodus: `readingMode: "append"` (Plan 2, E2). Der Aufrufer (das Panel) sperrt den Knopf während des Laufs und des Schreibens und leert die Runden nach einem
// Erfolg (Grenze 1 im Kopf von `panel-accept`).
import type { App, MarkdownView } from "obsidian";
import { distinctGuardProblems } from "../core/protocol";
import type { AcceptAs } from "../core/settings";
import { acceptText, type SvgSession } from "../core/session";
import { acceptStrings, guardProblemText, problemText, t } from "../i18n/strings";
import { listFences } from "../vendor/kit/fence-scan";
import { wrapInFence } from "../vendor/kit/fences";
import { slugify } from "../vendor/kit/slug";
import type { WritePorts } from "../vendor/kit/block-writer";
import type { checkSvg } from "../vendor/kit/svg-guard";
import { askChoice, type ChoiceOption } from "../vendor/kit-obsidian/choice-modal";
import { snapshotFile } from "../vendor/kit-obsidian/file-snapshot";
import { acceptPanel, type AcceptEnv, type AcceptOutcome, type AcceptSpec } from "../vendor/kit-obsidian/panel-accept";
import type { Target } from "../vendor/kit/panel-session";
import { BLOCK_LANG } from "./entry";

/** Der Kit-`AcceptEnv` für SVG Studio: Meldungen aus `src/i18n`, Lesemodus hängt ans Notizende an (E2), „jedes Mal fragen“ über den Auswahl-Dialog. */
export function buildAcceptEnv(d: { app: App; ports: WritePorts; settings: () => { acceptAs: AcceptAs }; lastEditor: () => MarkdownView | null }): AcceptEnv {
  return {
    app: d.app,
    ports: d.ports,
    settings: d.settings,
    lastEditor: d.lastEditor,
    choose: () => chooseNewTarget(d.app, d.lastEditor() !== null),
    strings: acceptStrings(),
    readingMode: "append",
  };
}

/** Wohin mit einem neuen SVG? Ohne offene Notiz gibt es den Codeblock nicht; der Dialog sagt warum, statt ihn stumm wegzulassen. */
function chooseNewTarget(app: App, hasNote: boolean): Promise<"block" | "file" | null> {
  const options: ChoiceOption<"block" | "file">[] = [{ value: "file", label: t("settings.acceptAs.file"), cta: true }];
  if (hasNote) options.push({ value: "block", label: t("settings.acceptAs.block") });
  return askChoice(app, { title: t("accept.title"), message: hasNote ? t("accept.message") : [t("accept.message"), t("accept.noNote")], options, cancelLabel: t("accept.cancel") });
}

/** Der Grund, aus dem Übernehmen jetzt nicht geht (sichtbar neben dem gesperrten Knopf), sonst `null`: ein neues SVG als Codeblock braucht eine offene Notiz. */
export function acceptBlockReason(s: SvgSession, acceptAs: AcceptAs, hasNote: boolean): string | null {
  return s.target.kind === "new" && acceptAs === "block" && !hasNote ? t("accept.blockNeedsNote") : null;
}

/** Die erste Zeile des ersten Prompts der Sitzung (Grundlage des Dateinamens eines neuen SVG). */
export function firstPromptLineOf(s: SvgSession): string {
  const first = s.rounds.rounds.find((r) => r.art === "create" || r.art === "prompt");
  return (first?.instruction ?? "").split(/\r?\n/, 1)[0] ?? "";
}

/** Der Schnappschuss vor dem Überschreiben einer Datei (Obsidians Dateiwiederherstellung erfasst nur Markdown, Messung A4); wirft, wenn er scheitert. */
async function backup(app: App, pluginId: string, path: string, oldText: string): Promise<void> {
  const r = await snapshotFile(app, { pluginId, path, content: oldText });
  if (!r.ok) throw new Error(t("accept.backupFailed", path, r.message));
}

/** Der Block, den ein Schreibvorgang neu in die Notiz gesetzt hat: der erste Block `svg-studio` mit diesem Rumpf ab der ersten Zeile, in der sich die Notiz geändert hat.
 *  Was davor steht, ist unverändert (auch ein gleicher Block weiter oben); der neue steht an der Änderung oder dahinter, vor einem gleichen weiter unten. `null`: nichts Passendes. */
export function blockAfterInsert(notePath: string, before: string, after: string, body: string): Target | null {
  const lines = (text: string): string[] => text.split(/\r?\n/);
  const was = lines(before);
  const now = lines(after);
  let changed = 0;
  while (changed < was.length && changed < now.length && was[changed] === now[changed]) changed++;
  const norm = (b: string): string => b.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const hit = listFences(after).find((f) => f.openLine >= changed && f.lang === BLOCK_LANG && norm(f.body) === norm(body));
  if (hit === undefined) return null;
  const name = notePath.split("/").pop() ?? notePath;
  return { kind: "block", path: notePath, lineStart: hit.openLine, lineEnd: hit.closeLine, label: `${name.replace(/\.md$/i, "")}:${String(hit.openLine + 1)}`, body: hit.body };
}

/** Der Dateiname eines neuen SVG aus der ersten Prompt-Zeile: höchstens 60 Zeichen Name (mit `.svg` bleibt er weit unter den 255 Byte der Dateisysteme), ohne Wörter
 *  `svg`. Ein von Windows reservierter Name (`con`, `nul`, `aux`, `prn`, `com1`–`com9`, `lpt1`–`lpt9`; dort auch mit Endung nicht anlegbar, und Vaults wandern zwischen
 *  Rechnern) bekommt `-svg` angehängt: das behält den Sinn des Prompts, wo ein Rückfall auf `svg` ihn verwürfe. */
function fileNameFor(line: string): string {
  const slug = slugify(line, { maxLength: 60 }) || "svg";
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug) ? `${slug}-svg` : slug}.svg`;
}

/** Der Text einer Notiz aus derselben Quelle wie der Schreiber: offener Quell-Editor, sonst Vault. */
async function readNote(env: AcceptEnv, path: string): Promise<string> {
  return env.ports.editorFor(path)?.getValue() ?? (await env.ports.vault.read(path));
}

/** Schreibt das Ergebnis der Sitzung. Wirft nie; jede Unsicherheit ist eine Ablehnung ohne Schreibversuch. */
export async function acceptSvgSession(env: AcceptEnv, s: SvgSession, o: { guard: typeof checkSvg; firstPromptLine: string; pluginId: string }): Promise<AcceptOutcome> {
  // Wo die neue Datei gelandet ist, erfährt man nur aus den Meldungen des Bausteins: sie tragen den Pfad.
  const seen = { created: null as string | null };
  const keep = (path: string): string => { seen.created = path; return path; };
  const strings: AcceptEnv["strings"] = {
    ...env.strings,
    savedFileWithReference: (p) => env.strings.savedFileWithReference(keep(p)),
    savedFileNoReference: (p, why) => env.strings.savedFileNoReference(keep(p), why),
    savedFileAppended: (p) => env.strings.savedFileAppended(keep(p)),
    savedFileReferenceFailed: (p, reason) => env.strings.savedFileReferenceFailed(keep(p), reason),
  };
  const wrapped: AcceptEnv = { ...env, strings };

  const spec: AcceptSpec = {
    fenceLang: BLOCK_LANG,
    wrap: (text) => wrapInFence(BLOCK_LANG, text),
    newFile: (text) => ({
      name: fileNameFor(o.firstPromptLine),
      content: text,
      reference: (linktext) => `![[${linktext}]]`,
    }),
    // Das Kit reicht nur Zeichenketten durch: die Übersetzung des Problems geschieht hier, vor der Rückgabe an das Kit.
    compute: (current) => {
      const r = acceptText(s, current);
      return r.ok ? r : { ok: false, problem: problemText(r.problem) };
    },
    checkWrite: (text) => {
      const r = o.guard(text);
      return r.ok ? null : t("accept.invalid", distinctGuardProblems(r.problems).map((p) => guardProblemText(p)).join("; "));
    },
    beforeWrite: (path, oldText) => backup(env.app, o.pluginId, path, oldText),
  };

  // Notiz und Text VOR dem Schreiben merken: die zuletzt aktive Notiz kann während des Schreibens wechseln, und nur der Vergleich vorher/nachher findet den neuen Block.
  const notePath = s.target.kind === "new" ? (env.lastEditor()?.file?.path ?? null) : null;
  const before = notePath === null ? null : await readNote(env, notePath).catch(() => null);

  const outcome = await acceptPanel(wrapped, spec, s.target, s.target.kind === "new" ? "create" : "refine");
  if (!outcome.ok || outcome.retarget !== undefined || s.target.kind !== "new") return outcome;

  // Das Ziel `new` wird nach dem ersten Übernehmen die Datei bzw. der Block: das Panel arbeitet dort weiter, ohne ein zweites neues SVG anzulegen.
  const wrote = seen.created;
  if (wrote !== null) return { ...outcome, retarget: { kind: "file", path: wrote, label: wrote.split("/").pop() ?? wrote } };
  if (notePath !== null && before !== null) {
    const result = acceptText(s, null);
    const after = await readNote(env, notePath).catch(() => null);
    const block = result.ok && after !== null ? blockAfterInsert(notePath, before, after, result.text) : null;
    if (block !== null) return { ...outcome, retarget: block };
  }
  return outcome;
}
