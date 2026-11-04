// Einstellungen des Plugins. Pure.
// `loadSettings` liest, was in `data.json` steht, und gibt Vorgaben für alles Fehlende oder Ungültige; unbekannte Schlüssel melden sich in `dropped`
// (das Plugin schreibt sie beim nächsten Speichern nicht zurück, sagt es aber nicht still: der Aufrufer darf sie loggen).
import { isHexColor } from "../vendor/kit/css-color";
import { DEFAULT_BACKGROUND, sanitizeBackground, type BackgroundState } from "./background";
import { migrateEndpointList, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { sanitizeChoice, type EndpointChoice } from "../vendor/kit/endpoint-source";
import { DEFAULT_REQUEST_SETTINGS, sanitizeRequestSettings, type RequestSettings } from "../vendor/kit/sampling-profiles";

export type AcceptAs = "file" | "block" | "ask";

export interface SvgStudioSettings {
  acceptAs: AcceptAs;
  background: BackgroundState;
  /** Die LLM-Anbindung (Kit `createLlmConnection`): lokale Endpunkt-Zeilen (Schlüssel liegen im Schlüsselbund, nie hier), die Wahl bei einem Endpunkt-Manager und die Anfrage-Einstellungen (Denkstufe, Überschreibungen). */
  llm: { endpoints: EndpointConfig[]; choice: EndpointChoice; request: RequestSettings };
}

export const DEFAULT_SETTINGS: SvgStudioSettings = {
  acceptAs: "file",
  background: { ...DEFAULT_BACKGROUND },
  llm: { endpoints: [], choice: {}, request: DEFAULT_REQUEST_SETTINGS },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Vor der Kit-Migration: nur Texte und Objekte mit Text-`url` gehen durch, alles andere fällt weg; ein Objekt mit einem Nicht-Text in `url`, `model`, `id` oder `secretId` verwirft die Kit-Migration selbst, ohne zu werfen. */
const isEndpointEntry = (v: unknown): v is string | EndpointConfig => typeof v === "string" || (isRecord(v) && typeof v.url === "string");

export function loadSettings(raw: unknown): { settings: SvgStudioSettings; dropped: string[] } {
  const dropped: string[] = [];
  const src = isRecord(raw) ? raw : {};
  for (const k of Object.keys(src)) if (!(k in DEFAULT_SETTINGS)) dropped.push(k);

  const acceptAs: AcceptAs = src.acceptAs === "file" || src.acceptAs === "block" || src.acceptAs === "ask" ? src.acceptAs : DEFAULT_SETTINGS.acceptAs;
  if ("acceptAs" in src && acceptAs !== src.acceptAs) dropped.push("acceptAs");

  const rawBackground = isRecord(src.background) ? src.background : {};
  if (typeof rawBackground.hex === "string" && !isHexColor(rawBackground.hex)) dropped.push("background.hex");
  const background: BackgroundState = sanitizeBackground(rawBackground);

  const l = isRecord(src.llm) ? src.llm : {};
  for (const k of Object.keys(l)) if (!(k in DEFAULT_SETTINGS.llm)) dropped.push(`llm.${k}`);
  const request = sanitizeRequestSettings(l.request);
  for (const d of request.dropped) dropped.push(`llm.request.${d}`);
  const llm: SvgStudioSettings["llm"] = {
    endpoints: Array.isArray(l.endpoints) ? migrateEndpointList(undefined, l.endpoints.filter(isEndpointEntry)) : [],
    choice: sanitizeChoice(l.choice),
    request: request.settings,
  };
  return { settings: { acceptAs, background, llm }, dropped };
}
