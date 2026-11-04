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
