# How-to guides

Short recipes for one task each. For a first run, start with [Getting started](../README.md#getting-started).

## Change one value by hand

1. Open the SVG in the panel: put the cursor in an `svg-studio` block or on an embedded `.svg` file and run **SVG Studio: Edit SVG**, or right-click an `.svg` file and choose **Edit SVG**.
2. Click an element in the preview. Its values appear under „Values of …“.
3. Change a number, a colour or a text and confirm. The change becomes a round „by hand“ that you see as a card.
4. Press **Apply**.

A value the fields cannot show is greyed out with the reason next to it (for example a value with a unit or percent, a transform that scales or skews, or a value set by `style`). Change those in the code. If an element has no id, or an element before it has none, press **Assign names** first.

## Accept or reject single changes

Every round the model makes is a list of cards, one per changed element, each marked „added“, „removed“ or „changed“, with the old and new value. Press **Accept** or **Reject** on a card, or **Accept all** and **Reject all**. **Comment** sends a note to the model with your next change request (for example „The door was already right.“). Only accepted changes are written when you press **Apply**.

## Repair an SVG from another tool

Open the file or block in the panel. If the SVG carries editor data (for example from Inkscape), the panel offers **Remove editor data**; if it has elements without an id, **Assign names**. Both work without a model and show the result as a round before anything is written. **Repair** asks the model to fix an SVG the sanitizer rejects; you check that result as a round too.

## Decide where a new SVG goes

Settings → Community plugins → SVG Studio → „Apply new SVG as“: a file in the attachment folder (the link is inserted at the cursor), a code block at the cursor, or ask every time. A code block needs an open note in editing mode.

## Turn off automatic drawing

Settings → Community plugins → SVG Studio → „Show SVG in notes automatically“. With it off, each `svg-studio` block shows a button instead of the image, so a drawing that freezes Obsidian can be edited or removed without opening it.

## Pick the model and the thinking level

The model row at the top of the panel lists the models of your endpoints. The thinking level appears there for models that support it. For some models the panel shows how many of the plugin's test descriptions they turned into an accepted SVG; models that were not measured say so.
