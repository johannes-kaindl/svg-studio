# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Code blocks with the language `svg-studio` are shown as an image (the SVG is checked by the sanitizer first; a rejected SVG shows the reasons and buttons to repair or edit it instead of a picture). The image never runs scripts and its styles cannot reach Obsidian.
- A button "Edit in SVG Studio" on code blocks and on embedded `.svg` files (also in pop-out windows), and a context-menu entry "Edit SVG" on `.svg` files.
- Commands "New SVG" and "Edit SVG" (German: "Neues SVG", "SVG bearbeiten"); "Edit SVG" works on the active `.svg` file, in a `svg-studio` block at the cursor, or on an embedded `.svg` at the cursor.
- Settings: help row first, then "Apply new SVG as" (file in the attachment folder, code block at the cursor, ask every time). The panel itself is a shell for now.
- Panel (first part): a sidebar view with the target line, the model row (model, reload, thinking level, "other endpoint"), the quality line, the prompt field (Cmd/Ctrl+Enter sends), a streaming answer area with status and Stop, the list of rounds and Apply/Discard buttons. An invalid answer goes back to the model up to twice ("Attempt 2 of 3: answer invalid …"); an answer that is invalid and was cut off at the limit is not asked again ("Too big for one round with this model"). Changing an image whose elements have no `id` asks nothing and says so. The settings get the section "Language model" (endpoints, model, request). Sampling is the one that was measured: temperature 0.2, thinking off, 16384 tokens.

- Apply: a new SVG becomes a file in the attachment folder (name from the first line of your prompt, never overwrites, numbered when taken) with `![[name.svg]]` at the cursor of the note you used last, or a `svg-studio` code block at the cursor, or you are asked each time. Without an open note only the file is created (a code block is greyed out with the reason). If that note is in reading view, the block or link is added at the end of the note and the message says so. An existing code block is rewritten only if it is still the one the panel opened ("Block changed" otherwise); an existing file gets a backup copy first (plugin folder `snapshots/`) and keeps your hand edits made since. The finished text is checked by the sanitizer before anything is written; if it fails, nothing is written. A round that replaces the whole image, or "Assign names" followed by further rounds, stops when the file was changed by hand since the round (nothing is lost silently). Applying twice in a row or during a run writes once or not at all.
- Opening an existing SVG shows what is wrong with it: unreadable or rejected by the sanitizer (button "Repair", asks the model, you check the result as a round), elements without a name (button "Assign names", no model) and editor data from Inkscape (button "Remove editor data", no model, the result is shown as a list of changes).

- Pure core: element diff with a completeness check (the answer of the model is split into entries you accept or reject one by one), canonical form, the prompts of the measurement, answer reader and validators (`protocol.ts`).
- Pure core: round model for the panel (rounds with accept/reject per entry, hand edits, rule rounds for ids and editor metadata, apply against the text that stands now) and removal of editor metadata (Inkscape `sodipodi:`/`inkscape:`) as a visible rule round.
- Pure core: quality line from the measurement of 2026-11-02 (what was measured per model and task, tied to the measured prompt); not shown yet.
- Pure core: element scanner with UTF-16 source offsets and stable element keys, byte-preserving change lists (`change`, `add`, `remove`, `move`) with an all-or-nothing round-trip guard, id assignment and `data-unit`, canvas measurement from `viewBox` or `width`/`height`.
- SVG sanitizer `svg-guard` vendored from code-kit (rejects instead of stripping).
- Measurement lab for local models (`npm run lab`) with recorded answers from two models.

### Changed

- Internal: the language-model connection and the panel modules (`llm-connection`, `model-bar`, `thinking-control`, `stream-area`, `version-list`, `request-section`, `chat-host` and their dependencies) from obsidian-kit 0.79.1, the matching code-kit modules (endpoint, sampling profiles, SSE, redaction, …) from code-kit 0.55.0. The base pin of code-kit stays 0.52.1.
- Internal: vendored code-kit 0.52.1 and obsidian-kit 0.78.0 (retry on an invalid answer, status indicator, choice dialog, block writer, unwrapping of model answers, measured-quality (0.55.0), fences, panel-session, rounds and run-slot (0.54.0) from code-kit); `svg-guard` and `safe-markdown` are byte-identical to the 0.45.0 snapshot apart from the header line. No visible effect: the plugin has no user interface yet and carried none of the building blocks. Skipped kit releases read: code-kit 0.46.0 to 0.52.1 (audio, recording, diarization, MIDI/DAWproject, loopback and asset helpers, test timing, `answer-retry`) and obsidian-kit 0.76.0 to 0.78.0 (chat window and model bar on phones, host spacing, chat leaf placement, `canonVaultDir`) — none touches a module this plugin vendors, and the audio and Python releases do not concern it at all.
- Internal: vendored obsidian-kit 0.79.1 (was 0.78.0) with help row, settings walker, confirm dialog, segmented control, accept-into-note, review list, redline, file snapshot (grandfather-father-son rotation), fence scan. The skipped kit releases 0.76.0 to 0.79.1 read: choice dialog and status indicator (0.76.0), chat window and model bar on phones (0.76.0, 0.76.1, 0.77.1), chat leaf placement (0.77.0), `canonVaultDir` (0.78.0), accept-into-note, file snapshot, fence scan and the decision state of the review list (0.79.0), snapshot rotation by grandfather-father-son (0.79.1). The plugin carried none of the chat window and model-bar modules, so nothing changes for you; the new modules are used from the next steps on.
