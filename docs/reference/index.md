# Reference

## Commands

| Command | What it does |
|---|---|
| **SVG Studio: New SVG** | Opens the panel for a new image. |
| **SVG Studio: Edit SVG** | Opens the panel on the SVG under the cursor (an `svg-studio` block or an embedded `.svg` file) or on the open `.svg` file. Not offered when there is no such target. |

The file menu of an `.svg` file also offers **Edit SVG**. The block and the `![[name.svg]]` embed show an edit button.

## The `svg-studio` code block

A fenced block with the language `svg-studio` whose content is one SVG is drawn as an image. The SVG must pass the sanitizer, which rejects instead of removing parts; if it does not, the block lists the reasons and offers **Repair** and **Edit**.

````markdown
```svg-studio
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">
  <path id="moon" d="M 12 2 A 10 10 0 1 0 22 12 A 8 8 0 0 1 12 2 Z" fill="#f5f5dc"/>
</svg>
```
````

Every element under the root should carry an `id`; changes and the number fields hang on it.

## Settings

| Setting | Values | Default |
|---|---|---|
| Apply new SVG as | File in the attachment folder · Code block at the cursor · Ask every time | File in the attachment folder |
| Show SVG in notes automatically | on · off | on |
| Language model | endpoint, model and request settings (shown from the endpoint source; with LLM Endpoint Manager installed, the endpoints come from there) | — |

## Fields you can edit by hand

Click an element in the preview. Depending on the element: move x and move y, rotate (°), text, and the element's own numeric and colour attributes. Numbers take digits with a point or a comma and no unit; colours take `#rgb`, `#rrggbb`, a colour name, `none` or `rgb(…)`.

## Rounds

Each model answer, repair, name assignment, cleanup or hand edit is a round with a number, an author (model, rule, by hand) and cards for its changes. A round builds on the text of its predecessor and is applied to the text of the target as it is now; if the target changed in the meantime, nothing is written.
