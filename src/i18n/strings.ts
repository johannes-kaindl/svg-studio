// Oberflächentexte, englisch und deutsch (UI-STANDARD § i18n). Die Engine kommt aus code-kit `i18n`; die Sprache setzt `main.ts` einmal im `onload`.
// Befehlsnamen: Verb plus Gegenstand, ohne Plugin-Namen (Obsidian stellt „SVG Studio:“ voran, UI-STANDARD).
import { HELP_SETTING_TEXTS_DE, HELP_SETTING_TEXTS_EN } from "../vendor/kit-obsidian/help-setting";
import { defineStrings, getLang, setLang, t, type Lang } from "../vendor/kit/i18n";

export type T = (key: string, ...args: (string | number)[]) => string;
export { getLang, setLang, t, type Lang };

const EN: Record<string, string> = {
  "cmd.new": "New SVG",
  "cmd.edit": "Edit SVG",
  "menu.edit": "Edit SVG",
  "panel.title": "SVG Studio",
  "panel.targetNew": "New SVG",
  "panel.targetEdit": "Edit: {0}",
  "panel.soon": "The panel follows with the next step.",
  "block.edit": "Edit in SVG Studio",
  "block.repair": "Repair",
  "block.editShort": "Edit",
  "block.alt": "SVG",
  "block.rejected": "This SVG cannot be shown: the sanitizer rejected it.",
  "block.problem": "{0}: {1}",
  "embed.edit": "Edit in SVG Studio",
  "notice.noTarget": "Open an .svg file, or put the cursor in a svg-studio block or on an embedded .svg file.",
  "settings.acceptAs": "Apply new SVG as",
  "settings.acceptAs.desc": "Where Apply puts a SVG that was created from scratch.",
  "settings.acceptAs.file": "File in the attachment folder",
  "settings.acceptAs.block": "Code block at the cursor",
  "settings.acceptAs.ask": "Ask every time",
  "help.docs": "https://github.com/johannes-kaindl/svg-studio",
};

const DE: Record<string, string> = {
  "cmd.new": "Neues SVG",
  "cmd.edit": "SVG bearbeiten",
  "menu.edit": "SVG bearbeiten",
  "panel.title": "SVG Studio",
  "panel.targetNew": "Neues SVG",
  "panel.targetEdit": "Ändern: {0}",
  "panel.soon": "Das Panel folgt mit dem nächsten Schritt.",
  "block.edit": "In SVG Studio bearbeiten",
  "block.repair": "Reparieren",
  "block.editShort": "Bearbeiten",
  "block.alt": "SVG",
  "block.rejected": "Dieses SVG lässt sich nicht anzeigen: der Bereiniger hat es abgelehnt.",
  "block.problem": "{0}: {1}",
  "embed.edit": "In SVG Studio bearbeiten",
  "notice.noTarget": "Öffne eine .svg-Datei oder setze den Cursor in einen svg-studio-Block oder auf eine eingebettete .svg-Datei.",
  "settings.acceptAs": "Neues SVG übernehmen als",
  "settings.acceptAs.desc": "Wohin Übernehmen ein SVG legt, das neu erzeugt wurde.",
  "settings.acceptAs.file": "Datei im Anhangordner",
  "settings.acceptAs.block": "Codeblock am Cursor",
  "settings.acceptAs.ask": "Jedes Mal fragen",
  "help.docs": "https://github.com/johannes-kaindl/svg-studio",
};

export const STRINGS: Record<Lang, Record<string, string>> = { en: EN, de: DE };
export const HELP_TEXTS = { en: HELP_SETTING_TEXTS_EN, de: HELP_SETTING_TEXTS_DE } as const;

/** Registriert die Texte; einmal vor dem ersten `t()` (im `onload`). */
export function initStrings(lang: Lang): void {
  defineStrings(STRINGS);
  setLang(lang);
}
