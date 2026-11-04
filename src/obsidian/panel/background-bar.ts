// Regler für den Hintergrund der Vorschau (Spec § 7.3): Schalter an/aus, Segment hell/dunkel/eigene (Kit `segmented-control`), Hex-Feld (nur bei „eigene“ bedienbar).
// Die Regler betreffen nur die Vorschau, nie das SVG. Die Leiste hält den Zustand nicht selbst: jede Änderung geht als neuer `BackgroundState` an `onChange`
// (das Plugin speichert sie), die Leiste zeichnet danach nur ihre Bedienbarkeit nach.
import { isHexColor } from "../../vendor/kit/css-color";
import type { BackgroundState, BackgroundTone } from "../../core/background";
import { buildSegmentedControl } from "../../vendor/kit-obsidian/segmented-control";

export interface BackgroundBarTexts {
  toggle(on: boolean): string;
  toggleHint: string;
  toneLabel: string;
  light: string;
  dark: string;
  custom: string;
  hexLabel: string;
}

export interface BackgroundBarOptions {
  state: BackgroundState;
  texts: BackgroundBarTexts;
  onChange: (state: BackgroundState) => void;
}

/** „f4f0e8“ und „#F4F0E8“ sind beide gemeint; was danach kein gültiges Hex ist, bleibt `null`. */
function parseHex(input: string): string | null {
  const v = input.trim();
  const withHash = /^[0-9a-f]+$/i.test(v) ? `#${v}` : v;
  return isHexColor(withHash) ? withHash : null;
}

export function buildBackgroundBar(parent: HTMLElement, o: BackgroundBarOptions): HTMLElement {
  const rootEl = parent.createDiv({ cls: "svg-studio-bg-bar" });
  let state: BackgroundState = { ...o.state };

  const toggle = rootEl.createEl("button", { cls: "svg-studio-bg-toggle", attr: { type: "button", title: o.texts.toggleHint } });
  const tone = buildSegmentedControl<BackgroundTone>(rootEl, {
    options: [
      { value: "light", label: o.texts.light },
      { value: "dark", label: o.texts.dark },
      { value: "custom", label: o.texts.custom },
    ],
    value: state.tone,
    ariaLabel: o.texts.toneLabel,
    onChange: (value) => { commit({ ...state, tone: value }); },
  });
  const hex = rootEl.createEl("input", { cls: "svg-studio-bg-hex", attr: { type: "text", maxlength: "7", spellcheck: "false", "aria-label": o.texts.hexLabel } });

  function paint(): void {
    toggle.setText(o.texts.toggle(state.on));
    toggle.setAttribute("aria-pressed", String(state.on));
    tone.setValue(state.tone);
    tone.setDisabled(!state.on);
    hex.value = state.hex;
    hex.disabled = !state.on || state.tone !== "custom";
    hex.removeClass("is-invalid");
    hex.removeAttribute("aria-invalid");
  }

  function commit(next: BackgroundState): void {
    state = next;
    paint();
    o.onChange({ ...state });
  }

  toggle.addEventListener("click", () => { commit({ ...state, on: !state.on }); });
  // Beim Tippen nur anzeigen, ob der Wert gilt; gespeichert wird erst bei `change` (Enter oder Verlassen des Felds).
  hex.addEventListener("input", () => {
    const bad = hex.value.trim() !== "" && parseHex(hex.value) === null;
    hex.toggleClass("is-invalid", bad);
    if (bad) hex.setAttribute("aria-invalid", "true");
    else hex.removeAttribute("aria-invalid");
  });
  hex.addEventListener("change", () => {
    const parsed = parseHex(hex.value);
    if (parsed === null) paint(); // ungültig: der letzte gültige Wert kommt zurück
    else commit({ ...state, hex: parsed });
  });
  paint();
  return rootEl;
}
