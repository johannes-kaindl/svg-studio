// Die Erweiterungen, die Obsidian an DOM-Klassen hängt (`createEl`, `createDiv`, `empty`, `instanceOf`, …), für happy-dom. Nur was die Tests brauchen.
interface CreateOptions { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null>; prepend?: boolean }
type AnyWin = any;

export function installObsidianDom(win: AnyWin = globalThis): void {
  const node = win.Node.prototype;
  const el = win.HTMLElement.prototype;
  // Wie Obsidian: fensterübergreifend, die Klasse des Fensters, in dem der Knoten lebt (nach Namen).
  node.instanceOf = function (this: AnyWin, type: { name: string }): boolean {
    const w = this.ownerDocument?.defaultView ?? win;
    const own = w[type.name];
    return typeof own === "function" ? this instanceof own : false;
  };
  el.createEl = function (this: AnyWin, tag: string, o: CreateOptions | string = {}): AnyWin {
    const opts: CreateOptions = typeof o === "string" ? { cls: o } : o;
    const child = this.ownerDocument.createElement(tag);
    if (opts.cls !== undefined) child.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
    if (opts.text !== undefined) child.textContent = opts.text;
    for (const [k, v] of Object.entries(opts.attr ?? {})) if (v !== null) child.setAttribute(k, String(v));
    if (opts.prepend === true) this.insertBefore(child, this.firstChild);
    else this.appendChild(child);
    return child;
  };
  el.createDiv = function (this: AnyWin, o?: CreateOptions | string): AnyWin { return this.createEl("div", o); };
  el.createSpan = function (this: AnyWin, o?: CreateOptions | string): AnyWin { return this.createEl("span", o); };
  el.empty = function (this: AnyWin): void { this.replaceChildren(); };
  el.addClass = function (this: AnyWin, ...c: string[]): void { this.classList.add(...c); };
  el.removeClass = function (this: AnyWin, ...c: string[]): void { this.classList.remove(...c); };
}
