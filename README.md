# SVG Studio

> **Work in progress — not released.** This plugin is under construction and not yet available in the Obsidian community store.

Describe an icon, logo, diagram or floor plan in words and get an exact, editable SVG in your note. Refine it in rounds with a local or OpenAI-compatible model, either by prompt or by editing individual numbers, and accept or reject each change to a single element.

## Status

The pure core is in place (element scanner with source offsets, byte-preserving change lists, id assignment, canvas measurement) and local models have been measured: a 27B model wrote 10 of 10 valid, sanitized SVGs and all three floor plans to exact measurements. The plugin itself does not render or generate anything yet. The first usable version will cover generating an SVG from a description, rounds with rollback, repair of broken answers, a background switch and a streaming status with cancel, plus number fields for single elements and an element-level diff.

## Development

```bash
npm install
npm run gate
```

## License

Source code: AGPL-3.0-or-later, see [`LICENSE`](LICENSE). Documentation: CC BY-SA 4.0, see [`LICENSE-DOCS`](LICENSE-DOCS). Commercial licensing: [`LICENSING.md`](LICENSING.md).
