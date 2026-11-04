// Einstellungen des Plugins. Pure.
// `loadSettings` liest, was in `data.json` steht, und gibt Vorgaben für alles Fehlende oder Ungültige; unbekannte Schlüssel melden sich in `dropped`
// (das Plugin schreibt sie beim nächsten Speichern nicht zurück, sagt es aber nicht still: der Aufrufer darf sie loggen).
export type AcceptAs = "file" | "block" | "ask";

/** Hintergrund der Vorschau (Spec § 7.3): betrifft nur die Vorschau, nie das SVG. */
export interface BackgroundState {
  on: boolean;
  shade: "light" | "dark";
  /** Eigener Wert als `#rgb` oder `#rrggbb`; sonst `null` (dann gilt `shade`). */
  hex: string | null;
}

export interface SvgStudioSettings {
  acceptAs: AcceptAs;
  background: BackgroundState;
  /** Wahl des Endpunkts und der Anfrage-Einstellungen; die Form schärft C2 mit den Kit-Bausteinen. */
  llm: { choice: { endpoint: string | null; model: string }; request: Record<string, unknown> };
}

export const DEFAULT_SETTINGS: SvgStudioSettings = {
  acceptAs: "file",
  background: { on: true, shade: "light", hex: null },
  llm: { choice: { endpoint: null, model: "" }, request: {} },
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function loadSettings(raw: unknown): { settings: SvgStudioSettings; dropped: string[] } {
  const dropped: string[] = [];
  const src = isRecord(raw) ? raw : {};
  for (const k of Object.keys(src)) if (!(k in DEFAULT_SETTINGS)) dropped.push(k);

  const acceptAs: AcceptAs = src.acceptAs === "file" || src.acceptAs === "block" || src.acceptAs === "ask" ? src.acceptAs : DEFAULT_SETTINGS.acceptAs;
  if ("acceptAs" in src && acceptAs !== src.acceptAs) dropped.push("acceptAs");

  const b = isRecord(src.background) ? src.background : {};
  const hex = typeof b.hex === "string" && HEX.test(b.hex) ? b.hex : null;
  if (typeof b.hex === "string" && hex === null) dropped.push("background.hex");
  const background: BackgroundState = {
    on: typeof b.on === "boolean" ? b.on : DEFAULT_SETTINGS.background.on,
    shade: b.shade === "dark" ? "dark" : "light",
    hex,
  };

  const l = isRecord(src.llm) ? src.llm : {};
  const c = isRecord(l.choice) ? l.choice : {};
  const llm: SvgStudioSettings["llm"] = {
    choice: { endpoint: typeof c.endpoint === "string" && c.endpoint !== "" ? c.endpoint : null, model: typeof c.model === "string" ? c.model : "" },
    request: isRecord(l.request) ? { ...l.request } : {},
  };
  return { settings: { acceptAs, background, llm }, dropped };
}
