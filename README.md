# SVG Studio

> **Work in progress — not released.** This plugin is under construction and not yet available in the Obsidian community store.

Describe an icon, logo, diagram or floor plan in words and get an exact, editable SVG in your note. Refine it in rounds with a local or OpenAI-compatible model, either by prompt or by editing individual numbers, and accept or reject each change to a single element.

## Status

Version 1 is built and tested but not released. A code block with the language `svg-studio` is shown as an image; a panel in the sidebar creates and refines SVGs in rounds with a local or OpenAI-compatible model, shows every change as a card you accept or reject, lets you edit numbers of a selected element, and applies the result to a file or a code block in your note. Local models have been measured: a 27B model wrote 10 of 10 valid, sanitized SVGs and all three floor plans to exact measurements. The first release waits for the maintainer's go-ahead.

## Known limits

- **Drawing cost is an estimate, not a protection.** The sanitizer estimates how long a SVG takes to draw and rejects what is clearly too much (`too-costly`); a block that costs a quarter of the limit or more is drawn only after a click. The estimate was measured in Chromium and misses whole classes: shapes, clips and masks set by CSS, text used as a clip or mask, large colour emoji, gradients with thousands of stops, scales it does not follow, CSS animations. It assumes a picture about 600 px wide. WebKit (iOS) and Firefox were not measured, and a phone is probably several times slower than the measuring machine (an estimate), so the click threshold is an estimate on mobile too. What actually protects Obsidian is the safety net: a mark is written before an SVG is drawn, a watchdog notices a frozen window, and a block that froze Obsidian waits for a click the next time. It cannot catch a freeze shorter than about one second or a freeze that starts late (a CSS animation with a long delay); a switch in the settings turns off automatic drawing in notes. SVGs embedded with `![[name.svg]]` are drawn by Obsidian itself and are not covered.

## Development

```bash
npm install
npm run gate
```

## License

Source code: AGPL-3.0-or-later, see [`LICENSE`](LICENSE). Documentation: CC BY-SA 4.0, see [`LICENSE-DOCS`](LICENSE-DOCS). Commercial licensing: [`LICENSING.md`](LICENSING.md).
