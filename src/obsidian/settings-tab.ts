// Einstellungen, zweigleisig (REGISTRY „Zweigleisige deklarative Settings“): `getSettingDefinitions()` ist die einzige Definition, `display()` zeichnet
// dieselbe Struktur für Obsidian < 1.13 nach. Die Hilfe-Zeile steht zuerst (UI-STANDARD § 8), dann „Übernehmen als“, dann der Abschnitt „Sprachmodell“
// der Kit-Verbindung (Endpunkte, Modell, Anfrage-Einstellungen; ein `render`-Notausgang der deklarativen Liste).
import { PluginSettingTab, type App, type Plugin, type Setting, type SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, type SvgStudioSettings } from "../core/settings";
import { getLang, t } from "../i18n/strings";
import { githubHelpUrls, HELP_SETTING_TEXTS_DE, HELP_SETTING_TEXTS_EN, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import { renderSettingDefinitions, settingBodyHost } from "../vendor/kit-obsidian/settings_walker";

export interface SettingsHost extends Plugin {
  settings: SvgStudioSettings;
  llm: LlmConnection;
  saveSettings(): Promise<void>;
}

export class SvgStudioSettingTab extends PluginSettingTab {
  private cleanupPrevious: () => void = () => {};

  constructor(app: App, private readonly host: SettingsHost) {
    super(app, host);
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof SvgStudioSettings>[] {
    return [
      helpSettingDefinition({ ...githubHelpUrls("svg-studio"), texts: getLang() === "de" ? HELP_SETTING_TEXTS_DE : HELP_SETTING_TEXTS_EN }),
      {
        name: t("settings.acceptAs"),
        desc: t("settings.acceptAs.desc"),
        control: {
          type: "dropdown",
          key: "acceptAs",
          options: { file: t("settings.acceptAs.file"), block: t("settings.acceptAs.block"), ask: t("settings.acceptAs.ask") },
        },
      },
      // Die Texte des Abschnitts kommen aus dem Kit (EN/DE nach `lang`), kein eigenes Bündel.
      { name: t("settings.model"), desc: "", render: (setting: Setting) => { this.host.llm.renderSettings(settingBodyHost(setting), { lang: getLang() }); } },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.host.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Durch `loadSettings`: die einzige Stelle, die ungültige Werte abfängt (der Host prüft nur den Typ).
    this.host.settings = loadSettings({ ...DEFAULT_SETTINGS, ...this.host.settings, [key]: value }).settings;
    await this.host.saveSettings();
  }

  override hide(): void {
    super.hide?.();
    this.host.llm.hideSettings();
  }

  display(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(this.containerEl, this.getSettingDefinitions(), this, this.app);
  }
}
