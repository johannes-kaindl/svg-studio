// Obsidian-Mock für die Tests: der des Kits (tests/vendor/kit/obsidian-mock.ts), dazu was dieses Plugin braucht.
// Neue Stubs erst ergänzen, wenn ein Test sie braucht.
import { Plugin as KitPlugin } from "../vendor/kit/obsidian-mock";
export * from "../vendor/kit/obsidian-mock";

export class Plugin extends KitPlugin {
  cleanups: Array<() => void> = [];
  registeredEvents: unknown[] = [];
  register(cb: () => void): void { this.cleanups.push(cb); }
  override registerEvent(evt: unknown): void { this.registeredEvents.push(evt); }
  /** Wie Obsidian beim Entladen. */
  unload(): void { for (const c of this.cleanups.splice(0)) c(); this.onunload(); }
}

/** Das Dropdown für Tests im happy-dom: das Kit-Mock hängt ein Fake-Element in den Container (`appendChild` eines Nicht-Knotens wirft im echten DOM);
 *  hier ist es ein echtes `<select>`, das der Kit-Baustein `thinking-control` wie in Obsidian benutzt. */
export class DropdownComponent {
  readonly selectEl: HTMLSelectElement;
  private changed: ((v: string) => unknown) | null = null;
  constructor(containerEl: HTMLElement) {
    this.selectEl = containerEl.createEl("select", { cls: "dropdown" });
    this.selectEl.addEventListener("change", () => { void this.changed?.(this.selectEl.value); });
  }
  addOption(value: string, display: string): this { this.selectEl.createEl("option", { text: display, attr: { value } }); return this; }
  getValue(): string { return this.selectEl.value; }
  setValue(v: string): this { this.selectEl.value = v; return this; }
  setDisabled(d: boolean): this { this.selectEl.disabled = d; return this; }
  onChange(cb: (v: string) => unknown): this { this.changed = cb; return this; }
}
