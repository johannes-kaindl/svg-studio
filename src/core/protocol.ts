// Protokoll mit dem Modell: die Prompts der Messung (wortgleich), Antwortleser und Prüfer für `askUntilValid`. Pure.
// Die Texte unten sind die Abschnitte „Gemeinsam“, „Erzeugen“ und „Verfeinern (vollständiges SVG)“ aus `scripts/lab/system-prompt.md`,
// zusammengesetzt wie `loadSystem` im Messlabor (`Gemeinsam` + Leerzeile + Abschnitt). Eine Messzeile (`quality.ts`) gilt nur für DIESEN
// Wortlaut: wer ihn ändert, ändert den Fingerabdruck und braucht eine neue Messung (`npm run lab`). Ein Test hält beide Texte gleich.
// Der JSON-Abschnitt („Änderungsliste“) bleibt als Messartefakt in der Datei des Labors und kommt hier nicht vor.
import { type TextMessage } from "../vendor/kit/answer-retry";
import { promptFingerprint as kitFingerprint } from "../vendor/kit/measured-quality";
import { stripThinkBlocks } from "../vendor/kit/think-splitter";
import { canonDocument } from "./canon";
import { diffSvg, type DiffResult } from "./diff";
import { scanElements } from "./elements";
import { assignMissingIds, ensureUnit } from "./format";
import type { SvgProblem } from "../vendor/kit/svg-guard";

export const COMMON_SYSTEM: string = [
  "Du bist ein Zeichenwerkzeug und schreibst SVG-Code für Obsidian-Notizen. Du antwortest ausschließlich mit dem verlangten Ergebnis, ohne Einleitung, ohne Erklärung, ohne Markdown-Zaun (kein ```), ohne Gedankenprotokoll in der Antwort.",
  "",
  "Regeln für jedes SVG:",
  "",
  "- Die Wurzel ist `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"…\">`. `xmlns` und `viewBox` stehen immer da.",
  "- Jedes Element unterhalb der Wurzel trägt eine eindeutige, sprechende `id` (zum Beispiel `mond`, `kasten-a`, `pfeil-a-b`, `wand-nord`), auch Elemente in `<defs>` wie Verläufe. Ausgenommen sind nur `<style>`, `<title>` und `<desc>`.",
  "- Keine Skripte, keine Ereignis-Attribute, keine externen Verweise, keine eingebetteten Bilder, kein `<foreignObject>`, keine DOCTYPE-Zeile.",
  "- Hat die Beschreibung reale Maße (Zentimeter, Meter, Millimeter), gilt: 1 Einheit = 1 cm. Setze `data-unit=\"cm\"` an die Wurzel. Die `viewBox` deckt die gezeichnete Fläche plus einen kleinen Rand ab. Alle Längen im Dokument sind dann in cm, ohne `transform`-Skalierung.",
  "- Benennt die Beschreibung Elemente mit festen Namen, ist das die `id` dieses Elements, genau in dieser Schreibweise.",
].join("\n");

const CREATE_PART: string = [
  "Du bekommst die Beschreibung eines Bildes. Antworte mit genau einem vollständigen SVG-Dokument nach den Regeln oben.",
].join("\n");

const REFINE_PART: string = [
  "Du bekommst ein bestehendes SVG und eine Anweisung. Antworte mit dem vollständigen, geänderten SVG-Dokument.",
  "",
  "- Behalte alle `id`s bei. Neue Elemente bekommen eine neue, sprechende `id`.",
  "- Ändere nur, was die Anweisung verlangt. Alles andere bleibt Zeichen für Zeichen wie im Ausgang: gleiche Werte, gleiche Reihenfolge, gleiche Namen.",
  "- Antworte nur mit dem SVG.",
].join("\n");

/** System-Prompt zum Erzeugen: Gemeinsam + Leerzeile + Erzeugen. */
export const CREATE_SYSTEM: string = `${COMMON_SYSTEM}\n\n${CREATE_PART}`;
/** System-Prompt zum Verfeinern (Antwortform: vollständiges SVG): Gemeinsam + Leerzeile + Verfeinern. */
export const REFINE_SYSTEM: string = `${COMMON_SYSTEM}\n\n${REFINE_PART}`;

const CREATE_TEMPLATE = "{prompt}";
const REFINE_TEMPLATE = "Ausgangs-SVG:\n\n{svg}\n\nAnweisung: {anweisung}";

/** Anweisung der Rückfrage bei ungültiger Antwort (`askUntilValid`). NEU und ungemessen: sie steht nicht im gemessenen Prompt, weil ein
 *  Verbot im System-Prompt die Tabellenzeilen entwerten würde (Plan 2, Entscheidung 4). Sie nennt, was `svg-guard` ablehnt und Modelle gelegentlich schreiben. */
export const RETRY_INSTRUCTION =
  "Antworte nur mit dem vollständigen, korrigierten SVG-Dokument, ohne Erklärung und ohne Markdown-Zaun. Behalte alle ids bei und gib jedem neuen Element eine eindeutige id. " +
  "Nicht erlaubt sind Kommentare in <style>, die Elemente <a> und <image>, Backslashes in Attributen oder CSS sowie Elemente und Attribute fremder Namensräume (zum Beispiel sodipodi: oder inkscape:).";

export interface Feedback {
  label: string;
  decision: "rejected" | "comment";
  comment?: string;
}

export function buildCreateMessages(prompt: string): TextMessage[] {
  return [
    { role: "system", content: CREATE_SYSTEM },
    { role: "user", content: CREATE_TEMPLATE.replace("{prompt}", () => prompt) },
  ];
}

function refineUser(svg: string, instruction: string): string {
  return REFINE_TEMPLATE.replace("{svg}", () => svg).replace("{anweisung}", () => instruction);
}

/** Verfeinern: die gemessene Vorlage; nur wenn es Rückmeldungen zur letzten Runde gibt, hängt ein Block daran (Plan 2, Entscheidung 16). */
export function buildRefineMessages(base: string, instruction: string, feedback?: readonly Feedback[]): TextMessage[] {
  const lines = (feedback ?? []).flatMap((f) => {
    if (f.decision === "rejected") return [f.comment !== undefined && f.comment.trim() !== "" ? `- ${f.label}: abgelehnt (${f.comment.trim()})` : `- ${f.label}: abgelehnt`];
    return f.comment !== undefined && f.comment.trim() !== "" ? [`- ${f.label}: ${f.comment.trim()}`] : [];
  });
  const block = lines.length === 0 ? "" : `\n\nRückmeldung zur letzten Runde:\n${lines.join("\n")}`;
  return [
    { role: "system", content: REFINE_SYSTEM },
    { role: "user", content: refineUser(base, instruction) + block },
  ];
}

/** Reparatur am Bestand: das fehlerhafte SVG samt Befund, in der Form der Verfeinern-Vorlage. */
export function buildRepairMessages(broken: string, problem: string): TextMessage[] {
  return [
    { role: "system", content: REFINE_SYSTEM },
    { role: "user", content: refineUser(broken, `Das SVG ist fehlerhaft: ${problem}\n${RETRY_INSTRUCTION}`) },
  ];
}

/** Bindet eine Messzeile an genau diese Prompts: die Kit-Funktion `promptFingerprint` (sha256 über System, NUL und Vorlage, 16 Zeichen) mit den Texten dieser Datei. */
export function promptFingerprint(task: "create" | "refine"): string {
  return task === "create" ? kitFingerprint(CREATE_SYSTEM, CREATE_TEMPLATE) : kitFingerprint(REFINE_SYSTEM, REFINE_TEMPLATE);
}

/** Das SVG aus der Rohantwort: Denken weg (auch ein loses `</think>`), von `<svg` bis zum letzten `</svg>` (Zaun und Prosa fallen so weg).
 *  Ein nie geschlossenes `<think>` verschluckt den Rest: dann ist nichts Antwort.
 *  Denkkanal von Gemma (`reasoning_effort: none`, im content): die Rohantwort ist „Entwurf, `<channel|>`, Antwort“ (gemessen in 18 von 18 Gemma-Antworten).
 *  Gelesen wird die Antwort hinter dem Tag; ist dort kein SVG (Gemma schreibt es manchmal in den Kanal und lässt die Antwort leer: 9 von 26 aufgezeichneten Antworten), der Text davor. */
export function extractSvg(raw: string): string | null {
  const find = (text: string): string | null => {
    const start = text.search(/<svg[\s>]/i);
    const end = text.lastIndexOf("</svg>");
    return start < 0 || end < start ? null : text.slice(start, end + "</svg>".length);
  };
  const opts = { dropStrayClose: true, dropUnclosed: true } as const;
  return find(stripThinkBlocks(raw, { ...opts, channel: true })) ?? find(stripThinkBlocks(raw, opts));
}

/** Nennt die Beschreibung reale Maße (Zahl und Einheit mm, cm, m)? Dann setzt das Erzeugen `data-unit="cm"` (Spec § 5.2). */
export function hasRealMeasures(prompt: string): boolean {
  return /\d(?:[.,]\d+)?\s*(?:mm|cm|m|meter|metern|zentimeter|millimeter)\b/i.test(prompt);
}

/** Der Bereiniger (`svg-guard`), als Funktion hereingereicht: der Kern kennt weder DOM noch Obsidian. */
export type GuardFn = (svg: string) => { ok: true } | { ok: false; problems: Array<{ code: string; detail: string }> };

export interface CreateValue {
  svg: string;
  assignedIds: string[];
}
export interface RefineValue {
  svg: string;
  diff: DiffResult;
}

/** Woran eine Modellantwort scheitert, als Wert ohne Sprache: `faultLine` macht den deutschen Satz für das Modell (Rückfrage), die Oberfläche übersetzt dieselbe Ursache für den Nutzer (`faultText` in `i18n/strings.ts`). */
export type AnswerFault =
  | { code: "no-svg" }
  | { code: "not-wellformed"; detail: string; offset: number }
  | { code: "guard"; problems: ReadonlyArray<GuardProblem> }
  | { code: "no-id"; tag: string; n: number }
  | { code: "unchanged" };

/** Ein Verdict des Kerns: wie das des Kits, im Fehlerfall zusätzlich mit der Ursache als Wert. */
export type AnswerVerdict<V> = { ok: true; value: V } | { ok: false; problem: string; fault: AnswerFault };

const failWith = (fault: AnswerFault): { ok: false; problem: string; fault: AnswerFault } => ({ ok: false, problem: faultLine(fault), fault });

/** Der Satz für das Modell zu einer Ursache (deutsch, geht in die Rückfrage). */
export function faultLine(f: AnswerFault): string {
  switch (f.code) {
    case "no-svg": return "Die Antwort enthält kein <svg>…</svg>.";
    case "not-wellformed": return `Das SVG ist nicht wohlgeformt: ${f.detail} (Offset ${String(f.offset)}).`;
    case "guard": return guardProblemsLine(f.problems);
    case "no-id": return `Element <${f.tag}> (Nummer ${String(f.n)}) hat keine id.`;
    case "unchanged": return "Die Antwort ändert nichts am Ausgang; setze die Anweisung um.";
  }
}

/** Zusatz für das Modell, wenn der Bereiniger `too-costly` wegen der Zeichenkosten meldet (nicht bei einer Mengengrenze: ein größeres Dokument wird nicht durch weniger Masken kleiner) (code-kit 0.58.0: das SVG ist klein und wohlgeformt, würde aber die Anzeige einfrieren). */
export const COST_HINT = "Das SVG ist zu aufwendig zu zeichnen; nimm weniger verschachtelte Masken, Marker, Filter und Weichzeichner.";

/** Ein Befund des Bereinigers, soweit der Kern ihn liest (`code`, `detail` und bei `too-costly` die Felder des Kits seit code-kit 0.59.0: `kind`, `cost`, `limit`). */
export type GuardProblem = Pick<SvgProblem, "detail" | "kind" | "cost" | "limit"> & { code: string };

/** Der Satz für das Modell zu den Befunden des Bereinigers (Rückfrage und Reparatur). Den Rat zu weniger Masken und Filtern gibt es nur, wenn die Zeichenkosten die Ursache sind (`kind: "cost"`) und kein
 *  Befund eine Mengengrenze oder eine nicht schätzbare Zeichnung meldet (`kind: "limit"`): ein größeres Dokument wird nicht durch weniger Masken kleiner, und eine Mengengrenze bringt im Kit einen zweiten Eintrag
 *  `kind: "cost"` mit unendlichen Kosten mit. */
export function guardProblemsLine(problems: ReadonlyArray<GuardProblem>): string {
  const list = problems.map((p) => `${p.code}: ${p.detail}`).join("; ");
  const costOnly = problems.some((p) => p.kind === "cost") && !problems.some((p) => p.kind === "limit");
  return `Der Bereiniger lehnt ab: ${list}.${costOnly ? ` ${COST_HINT}` : ""}`;
}

/** Gemeinsame Prüfung: SVG finden, wohlgeformt, vom Bereiniger angenommen. Liefert das SVG oder die Ursache. */
function check(raw: string, guard: GuardFn): { svg: string } | { fault: AnswerFault } {
  const svg = extractSvg(raw);
  if (svg === null) return { fault: { code: "no-svg" } };
  const syntax = scanElements(svg).issues.find((i) => i.kind === "syntax");
  if (syntax !== undefined) return { fault: { code: "not-wellformed", detail: syntax.message, offset: syntax.offset } };
  const g = guard(svg);
  if (!g.ok) return { fault: { code: "guard", problems: g.problems } };
  return { svg };
}

export function validateCreate(raw: string, o: { guard: GuardFn; prompt: string }): AnswerVerdict<CreateValue> {
  const c = check(raw, o.guard);
  if ("fault" in c) return failWith(c.fault);
  const withIds = assignMissingIds(c.svg);
  const svg = hasRealMeasures(o.prompt) ? ensureUnit(withIds.text, "cm") : withIds.text;
  return { ok: true, value: { svg, assignedIds: withIds.assigned } };
}

/** Elemente ohne `id` (außer `style`, `title`, `desc`): das Modell soll sie nicht anlegen (Spec § 5.1). */
function missingId(svg: string): AnswerFault | null {
  const els = scanElements(svg).elements;
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e.parentKey === null || e.id !== null || e.tag === "style" || e.tag === "title" || e.tag === "desc") continue;
    return { code: "no-id", tag: e.tag, n: i + 1 };
  }
  return null;
}

export function validateRefine(raw: string, o: { guard: GuardFn; base: string }): AnswerVerdict<RefineValue> {
  const c = check(raw, o.guard);
  if ("fault" in c) return failWith(c.fault);
  const noId = missingId(c.svg);
  if (noId !== null) return failWith(noId);
  const was = canonDocument(o.base);
  if (was !== null && was === canonDocument(c.svg)) return failWith({ code: "unchanged" });
  return { ok: true, value: { svg: c.svg, diff: diffSvg(o.base, c.svg) } };
}

/** Reparatur am Bestand: der Ausgang ist fehlerhaft, oft nicht lesbar; dann ist der Diff „nicht zerlegbar“ und die Oberfläche bietet nur „ganz ersetzen“. */
export function validateRepair(raw: string, o: { guard: GuardFn; base: string }): AnswerVerdict<RefineValue> {
  const c = check(raw, o.guard);
  if ("fault" in c) return failWith(c.fault);
  const noId = missingId(c.svg);
  if (noId !== null) return failWith(noId);
  return { ok: true, value: { svg: c.svg, diff: diffSvg(o.base, c.svg) } };
}
