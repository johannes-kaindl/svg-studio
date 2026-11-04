// Hintergrund der Vorschau (Spec § 7.3): betrifft nur die Vorschau, nie das SVG. Pure; Besitzer des Typs `BackgroundState` (die Einstellungen tragen ihn nur).

import { isHexColor } from "../vendor/kit/css-color";

export type BackgroundTone = "light" | "dark" | "custom";

export interface BackgroundState {
  on: boolean;
  tone: BackgroundTone;
  /** Eigener Wert als `#rgb` oder `#rrggbb`; gilt nur bei `tone: "custom"`, bleibt sonst gespeichert. */
  hex: string;
}

export const LIGHT_COLOR = "#ffffff";
export const DARK_COLOR = "#1e1e1e";
export const DEFAULT_BACKGROUND: Readonly<BackgroundState> = { on: true, tone: "light", hex: LIGHT_COLOR };

const TONES: readonly BackgroundTone[] = ["light", "dark", "custom"];


/** Liest den Hintergrund aus gespeicherten Daten; jedes ungültige Feld fällt einzeln auf die Vorgabe (an, hell, `#ffffff`). Liefert immer ein neues Objekt. */
export function sanitizeBackground(raw: unknown): BackgroundState {
  const b = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    on: typeof b.on === "boolean" ? b.on : DEFAULT_BACKGROUND.on,
    tone: TONES.find((t) => t === b.tone) ?? DEFAULT_BACKGROUND.tone,
    hex: isHexColor(b.hex) ? b.hex : DEFAULT_BACKGROUND.hex,
  };
}

/** Die Farbe der Vorschaufläche; `null` = aus (Obsidians eigener Grund). Ein von Hand gebauter, ungültiger Hex-Wert wird nie ins CSS gereicht: dann gilt hell. */
export function backgroundColor(s: BackgroundState): string | null {
  if (!s.on) return null;
  if (s.tone === "dark") return DARK_COLOR;
  if (s.tone === "custom" && isHexColor(s.hex)) return s.hex;
  return LIGHT_COLOR;
}
