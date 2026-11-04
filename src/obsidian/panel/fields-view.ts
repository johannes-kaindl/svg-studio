// Die Zahlenfelder des gewählten Elements unter der Vorschau (Spec § 7.5, Plan 2 D2). Die Felder und ihre Regeln stehen in `core/fields.ts`; hier steht nur das Zeichnen und das
// Bestätigen: Enter oder Verlassen des Felds (`change`, `blur`) gibt EINE Änderungsliste an `commit`, das daraus eine Handrunde macht. Ein ungültiger Wert zeigt das Problem am Feld und
// verändert die Sitzung nicht. Während eines Laufs oder Übernehmens (`busy`) sind die Felder gesperrt und bestätigen nichts: ein Enter dort schriebe sonst ein zweites Mal.
import type { SvgChange } from "../../core/changes";
import { scanElements } from "../../core/elements";
import { fieldChange, fieldsFor, type FieldSpec } from "../../core/fields";
import type { Problem } from "../../core/problem";
import { getLang, labelTexts, problemText, STRINGS, t } from "../../i18n/strings";

export interface FieldsInput {
  /** Der Text der aktiven Runde und die `id` des gewählten Elements. */
  text: string;
  id: string;
  /** Mitte des Elements im eigenen Koordinatenraum (Mitte von `getBBox()`), `null` wo der Browser nichts misst; nur die erste Drehung fragt danach. */
  center: () => [number, number] | null;
  /** Läuft ein Lauf oder Übernehmen? Dann ist alles gesperrt. */
  busy: () => boolean;
  /** Die Änderung als Handrunde festhalten; ein Problem (Wert wird nicht übernommen) zeigt das Feld. */
  commit: (changes: SvgChange[], label: string) => Problem | null;
  /** Nach Enter zeichnet sich das Panel neu; das Feld, in dem Enter kam, bekommt den Fokus zurück (Tastatur, CORE-META-20). */
  focus: { name: string | null };
}

let counter = 0;

const label = (name: string): string => {
  const key = `fields.label.${name}`;
  return STRINGS[getLang()][key] === undefined ? name : t(key);
};

function build(row: HTMLElement, spec: FieldSpec, o: FieldsInput, run: (name: string, input: string) => { problem: Problem | null; changed: boolean }): void {
  const n = ++counter;
  const id = `svg-studio-field-${n}`;
  const noteId = `${id}-note`;
  row.createEl("label", { text: label(spec.name), attr: { for: id } });
  const numeric = spec.kind === "number" || spec.kind === "translate" || spec.kind === "rotate";
  const input = row.createEl("input", {
    cls: "svg-studio-field-input",
    attr: { id, type: "text", "data-field": spec.name, autocomplete: "off", spellcheck: "false", ...(numeric ? { inputmode: "decimal" } : {}) },
  });
  input.value = spec.value;
  const start = input.value; // was das Feld wirklich hält (ein Textfeld nimmt keine Zeilenumbrüche an)
  const note = row.createDiv({ cls: "svg-studio-field-note", attr: { id: noteId } });
  if (spec.readonly !== undefined) {
    input.readOnly = true;
    input.setAttribute("aria-readonly", "true");
    input.addClass("is-readonly");
    note.setText(t(`fields.readonly.${spec.readonly}`));
    input.setAttribute("aria-describedby", noteId);
  } else {
    note.setAttribute("role", "alert");
  }
  if (o.busy()) input.disabled = true;
  if (o.focus.name === spec.name && spec.readonly === undefined) {
    o.focus.name = null;
    input.focus();
  }
  if (spec.readonly !== undefined) return;

  /** Pro Zeichnen genau eine Bestätigung: Enter, `change` und `blur` können nacheinander kommen (und das Feld ist danach schon aus dem Baum). */
  let settled = false;
  const showError = (text: string): void => {
    note.setText(text);
    input.toggleClass("is-invalid", text !== "");
    if (text === "") {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    } else {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", noteId);
    }
  };
  const confirm = (viaEnter: boolean): void => {
    if (settled || o.busy() || input.disabled) return;
    if (input.value === start) {
      showError("");
      return;
    }
    settled = true;
    if (viaEnter) o.focus.name = spec.name;
    const r = run(spec.name, input.value);
    if (r.problem !== null) {
      settled = false;
      o.focus.name = null;
      showError(problemText(r.problem));
    } else if (!r.changed) {
      settled = false;
      showError("");
    }
  };
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm(true);
    } else if (e.key === "Escape" && input.value !== start) {
      e.preventDefault();
      input.value = start;
      showError("");
    }
  });
  input.addEventListener("change", () => { confirm(false); });
  input.addEventListener("blur", () => { confirm(false); });
  input.addEventListener("input", () => { if (note.textContent !== "") showError(""); });
}

/** Zeichnet die Felder des gewählten Elements in `host` (leer, wenn das Element keine hat). */
export function renderFields(host: HTMLElement, o: FieldsInput): void {
  const el = scanElements(o.text).elements.find((e) => e.id === o.id);
  if (el === undefined) return;
  const specs = fieldsFor(el, o.text);
  if (specs.length === 0) return;
  const lang = getLang() === "de" ? "de" : "en";
  const heading = t("fields.heading", labelTexts().tag(el.tag), o.id);
  const group = host.createDiv({ cls: "svg-studio-fields", attr: { role: "group", "aria-label": heading } });
  group.createDiv({ cls: "svg-studio-fields-head", text: heading });
  const grid = group.createDiv({ cls: "svg-studio-fields-grid" });
  const run = (name: string, input: string): { problem: Problem | null; changed: boolean } => {
    const c = o.center();
    const r = fieldChange(el, o.text, name, input, c === null ? { lang } : { lang, center: c });
    if (!r.ok) return { problem: r.problem, changed: false };
    if (r.changes.length === 0) return { problem: null, changed: false };
    return { problem: o.commit(r.changes, r.label), changed: true };
  };
  for (const spec of specs) build(grid.createDiv({ cls: "svg-studio-field" }), spec, o, run);
}
