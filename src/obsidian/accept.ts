// Übernehmen (Spec § 7.6): was SVG ist. Die Mechanik (Fingerabdruck des Blocks, Anhang anlegen und nie überschreiben, Cursor, Lesemodus, Schnappschuss vor dem
// Überschreiben, `retarget` auf den angelegten Block oder die angelegte Datei) trägt der Rahmen der Auftrags-Fenster (Kit `prompt-panel` über `panel-accept`); er
// setzt den Haken `beforeWrite` selbst, ein Plugin kann den Schnappschuss nicht auslassen. Hier steht nur die Beschreibung: Zaun-Sprache, Dateiname aus dem Prompt,
// der Text aus den Runden (`acceptText`), die letzte Prüfung mit dem Bereiniger, und die Schreibwege als Knöpfe.
// Lesemodus: `readingMode: "append"` (Plan 2, E2).
import type { App, MarkdownView } from "obsidian";
import { distinctGuardProblems } from "../core/protocol";
import type { AcceptAs } from "../core/settings";
import { acceptText, type SvgSession } from "../core/session";
import { acceptStrings, guardProblemText, problemText, t } from "../i18n/strings";
import { wrapInFence } from "../vendor/kit/fences";
import { slugify } from "../vendor/kit/slug";
import type { WritePorts } from "../vendor/kit/block-writer";
import type { checkSvg } from "../vendor/kit/svg-guard";
import type { AcceptEnv, AcceptSpec } from "../vendor/kit-obsidian/panel-accept";
import type { PromptPanelWay } from "../vendor/kit-obsidian/prompt-panel";
import { BLOCK_LANG } from "./entry";

/** Der Kit-`AcceptEnv` für SVG Studio ohne `settings` und `choose` (der Rahmen wählt nichts, beide Wege sind Knöpfe): Meldungen aus `src/i18n`, der Lesemodus hängt ans Notizende an (E2). */
export function buildAcceptEnv(d: { app: App; ports: WritePorts; lastEditor: () => MarkdownView | null }): Omit<AcceptEnv, "settings" | "choose"> {
  return { app: d.app, ports: d.ports, lastEditor: d.lastEditor, strings: acceptStrings(), readingMode: "append" };
}

/** Die erste Zeile des ersten Prompts der Sitzung (Grundlage des Dateinamens eines neuen SVG). */
export function firstPromptLineOf(s: SvgSession): string {
  const first = s.rounds.rounds.find((r) => r.art === "create" || r.art === "prompt");
  return (first?.instruction ?? "").split(/\r?\n/, 1)[0] ?? "";
}

/** Der Dateiname eines neuen SVG aus der ersten Prompt-Zeile: höchstens 60 Zeichen Name (mit `.svg` bleibt er weit unter den 255 Byte der Dateisysteme), ohne Wörter
 *  `svg`. Ein von Windows reservierter Name (`con`, `nul`, `aux`, `prn`, `com1`–`com9`, `lpt1`–`lpt9`; dort auch mit Endung nicht anlegbar, und Vaults wandern zwischen
 *  Rechnern) bekommt `-svg` angehängt: das behält den Sinn des Prompts, wo ein Rückfall auf `svg` ihn verwürfe. */
function fileNameFor(line: string): string {
  const slug = slugify(line, { maxLength: 60 }) || "svg";
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug) ? `${slug}-svg` : slug}.svg`;
}

/** Was geschrieben wird, als Beschreibung für den Rahmen (ohne `beforeWrite`, den setzt der Rahmen). Die Übersetzung eines Problems geschieht hier: das Kit reicht nur Zeichenketten durch. */
export function svgAcceptSpec(s: SvgSession, o: { guard: typeof checkSvg }): Omit<AcceptSpec, "beforeWrite"> {
  return {
    fenceLang: BLOCK_LANG,
    wrap: (text) => wrapInFence(BLOCK_LANG, text),
    newFile: (text) => ({
      name: fileNameFor(firstPromptLineOf(s)),
      content: text,
      reference: (linktext) => `![[${linktext}]]`,
    }),
    compute: (current) => {
      const r = acceptText(s, current);
      return r.ok ? r : { ok: false, problem: problemText(r.problem) };
    },
    checkWrite: (text) => {
      const r = o.guard(text);
      return r.ok ? null : t("accept.invalid", distinctGuardProblems(r.problems).map((p) => guardProblemText(p)).join("; "));
    },
  };
}

/** Die Schreibwege des Fensters. Ein neues SVG hat zwei Knöpfe, „Als Datei“ und „Als Block“; `acceptAs` bestimmt nur, welcher der Hauptknopf (der erste) ist. Der Block braucht eine offene Notiz:
 *  ohne sie ist sein Knopf gesperrt und der Grund steht daneben. Ein bestehendes SVG (Datei oder Block) hat einen Weg. */
export function svgAcceptWays(s: SvgSession, o: { guard: typeof checkSvg; acceptAs: AcceptAs; hasNote: () => boolean }): PromptPanelWay<SvgSession>[] {
  const spec = svgAcceptSpec(s, o);
  if (s.target.kind !== "new") return [{ id: "apply", label: t("panel.accept"), spec, kind: () => "refine" }];
  const file: PromptPanelWay<SvgSession> = { id: "file", label: t("accept.asFile"), spec, kind: () => "create", where: "file" };
  const block: PromptPanelWay<SvgSession> = {
    id: "block",
    label: t("accept.asBlock"),
    spec,
    kind: () => "create",
    where: "block",
    blockedReason: () => (o.hasNote() ? null : t("accept.blockNeedsNote")),
  };
  return o.acceptAs === "block" ? [block, file] : [file, block];
}
