# SVG Studio — documentation

Organised after [Diátaxis](https://diataxis.fr/): learning, doing, looking up and understanding are four different needs, so they get four kinds of pages.

**New here?** → [Getting started](#getting-started) — from installation to your first SVG in a note.

**Something not working?** → [Troubleshooting](#troubleshooting) — symptoms, causes, fixes, and where to get help.

| | |
|---|---|
| **[How-to guides](how-to/index.md)** | Task-oriented. How do I change one element by hand, repair an SVG from Inkscape, or turn off automatic drawing? |
| **[Reference](reference/index.md)** | Information-oriented. Commands, settings, the `svg-studio` code block, the fields you can edit by hand. |
| **[Explanation](explanation/index.md)** | Understanding-oriented. Why the SVG itself is the source, why changes are edited in place, and what the safety net can and cannot do. |

## Getting started

SVG Studio needs a language model. It has no keys of its own: endpoints and models come from the plugin [LLM Endpoint Manager](https://github.com/johannes-kaindl/llm-endpoint-manager), or from a list of endpoints in this plugin's own settings (any OpenAI-compatible server, for example a local one).

1. Install the plugin: Settings → Community plugins → Browse → „SVG Studio“ → Install → Enable.
2. Set up a language model: install LLM Endpoint Manager and add an endpoint there, or open Settings → Community plugins → SVG Studio and add one under „Language model“. The panel shows „No language model is set up yet.“ until one is reachable.
3. Open the command palette and run **SVG Studio: New SVG**. The panel opens in the right sidebar.
4. Type what you want in the field „Your instruction“, for example *A moon icon, 48 × 48, flat, one colour.* — or click one of the example lines — and press **Create**. Small local models can take minutes; **Stop** ends the run.
5. Check the preview. Press **Apply** to put the result in your vault, or write a change request (for example *Make the door 10 cm wider.*) and press **Change** to start another round.

You should now see the SVG in your note: as a file in the attachment folder with its link at the cursor, or as a code block with the language `svg-studio`, depending on the setting „Apply new SVG as“ (default: file in the attachment folder).

To change an SVG later, put the cursor in an `svg-studio` block or on an embedded `.svg` file and run **SVG Studio: Edit SVG**, or use the **Edit** button that appears on the block and on `![[name.svg]]` embeds. Every change a round makes is shown as a card; you accept or reject each one on its own.

## Troubleshooting

### No language model is set up yet.

**Cause:** The panel found no usable endpoint, or the model list could not be read. The line below it („Reason: …“) names the cause.

**Fix:** Open Settings → Community plugins → SVG Studio (the panel's „Open settings“ button does this) and check the endpoint under „Language model“. If you use LLM Endpoint Manager, check there that the endpoint is enabled and reachable.

### This SVG cannot be shown: the sanitizer rejected it.

**Cause:** SVG Studio only draws SVG that passes its sanitizer, and rejects instead of removing parts. Typical reasons: a `<style>` block with a `/*` comment, `<a>` or `<image>` elements, Inkscape namespaces (`sodipodi:`, `inkscape:`), a backslash in an attribute or in CSS, or an SVG that would take too long to draw (`too-costly`).

**Fix:** Open the block with the **Repair** button. For editor data from Inkscape the panel offers „Remove editor data“, which needs no model. For `too-costly`, use fewer nested masks, markers or filters and fewer blurred shapes.

### This SVG is expensive to draw … it is shown in the note only after a click.

**Cause:** A block that costs about a quarter of the allowed drawing cost or more is drawn only after you click **Show**. The cost is an estimate, see [the safety net](explanation/index.md#the-safety-net).

**Fix:** Click **Show**. If you want a lighter picture, ask the model for fewer masks, filters and blurred shapes.

### This image blocked the display last time.

**Cause:** Obsidian froze while this SVG was being drawn. SVG Studio noticed on the next start and holds the image back.

**Fix:** Click **Edit** to simplify it in the panel, or **Show anyway** if you want to draw it again. Under Settings → SVG Studio, „Show SVG in notes automatically“ turns automatic drawing off for all notes.

### {n} element(s) have no name (id). Changing needs a name on every element.

**Cause:** Changes are anchored to the `id` of each element, and an SVG from another tool often has none.

**Fix:** Press **Assign names**. No model is involved; you see the change as a round and apply it.

### Nothing was written (Block changed / The target changed while applying / The note is in reading view)

**Cause:** SVG Studio writes only if the text it would change is still the text the round started from. A hand edit in the meantime, a block that moved, or a note in reading view stops it before anything is written.

**Fix:** Read the line in the notice, switch the note to editing if it says reading view, then press **Apply** again. Rounds you have not applied stay in the panel.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/svg-studio/issues) with your Obsidian version, the plugin version (Settings → Community plugins) and what you expected to happen.
