# Explanation

## Why the SVG itself is the source

SVG Studio has no language of its own for 2D images. The model writes an SVG, and the SVG stays the thing in your note. Every element under the root gets an `id`; the diff, the number fields and any later hand-over to other tools hang on those names. A model can be asked to name things, and a rule can name them for it.

## Why changes are edited in place

A change is a replacement of a span of text, applied against the current text, all or nothing, and checked afterwards by reading the result back. What is not touched stays byte for byte the same, so a hand edit you made is never lost, and you can accept or reject each element's change on its own.

## What is drawn, and how

Another tool's SVG is parsed and sanitized before it is drawn; the sanitizer rejects what it cannot vouch for instead of silently removing it. In the panel the checked tree is inserted into an isolated shadow root. In a note, the checked SVG is shown as an image.

## The safety net

Some SVGs are small and well-formed and still freeze the window while they are drawn. The sanitizer estimates the drawing cost and rejects what is clearly too much. The estimate is a guess, not a protection: it was measured in Chromium and misses whole classes (for example shapes and clips set by CSS, large colour emoji, gradients with thousands of stops, CSS animations). WebKit (iOS) and Firefox were not measured, and a phone is probably several times slower than the measuring machine. A block that costs a quarter of the limit or more is drawn only after a click.

What protects Obsidian is the safety net: a mark is written before an SVG is drawn, a watchdog notices a frozen window, and a block that froze Obsidian waits for a click the next time. It cannot catch a freeze shorter than about one second or one that starts late (a CSS animation with a long delay). The setting „Show SVG in notes automatically“ turns automatic drawing off. SVGs embedded with `![[name.svg]]` are drawn by Obsidian itself and are not covered.

## What the quality line means

For some models the panel prints „Measured: X of Y test descriptions gave an SVG the sanitizer accepted“. That is one run per description with a stub-free model on the plugin's own test set, not a promise for your wording. Models that were not measured say so.
