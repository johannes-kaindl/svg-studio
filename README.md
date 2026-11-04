# SVG Studio

> **Work in progress — not released.** This plugin is under construction and not yet available in the Obsidian community store.

Describe an icon, logo, diagram or floor plan in words and get an exact, editable SVG in your note. Refine it in rounds with a local or OpenAI-compatible model, either by prompt or by editing individual numbers, and accept or reject each change to a single element.

## Status

Version 1 is built and tested but not released. A code block with the language `svg-studio` is shown as an image; a panel in the sidebar creates and refines SVGs in rounds with a local or OpenAI-compatible model, shows every change as a card you accept or reject, lets you edit numbers of a selected element, and applies the result to a file or a code block in your note. Local models have been measured: a 27B model wrote 10 of 10 valid, sanitized SVGs and all three floor plans to exact measurements. The first release waits for the maintainer's go-ahead.

## Development

```bash
npm install
npm run gate
```

## License

Source code: AGPL-3.0-or-later, see [`LICENSE`](LICENSE). Documentation: CC BY-SA 4.0, see [`LICENSE-DOCS`](LICENSE-DOCS). Commercial licensing: [`LICENSING.md`](LICENSING.md).
