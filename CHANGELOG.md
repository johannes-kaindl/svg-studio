# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Pure core: element diff with a completeness check (the answer of the model is split into entries you accept or reject one by one), canonical form, the prompts of the measurement, answer reader and validators (`protocol.ts`).
- Pure core: round model for the panel (rounds with accept/reject per entry, hand edits, rule rounds for ids and editor metadata, apply against the text that stands now) and removal of editor metadata (Inkscape `sodipodi:`/`inkscape:`) as a visible rule round.
- Pure core: quality line from the measurement of 2026-11-02 (what was measured per model and task, tied to the measured prompt); not shown yet.
- Pure core: element scanner with UTF-16 source offsets and stable element keys, byte-preserving change lists (`change`, `add`, `remove`, `move`) with an all-or-nothing round-trip guard, id assignment and `data-unit`, canvas measurement from `viewBox` or `width`/`height`.
- SVG sanitizer `svg-guard` vendored from code-kit (rejects instead of stripping).
- Measurement lab for local models (`npm run lab`) with recorded answers from two models.

### Changed

- Internal: vendored code-kit 0.52.1 and obsidian-kit 0.78.0 (retry on an invalid answer, status indicator, choice dialog, block writer, unwrapping of model answers, measured-quality, fences, panel-session, rounds and run-slot from code-kit 0.54.0); `svg-guard` and `safe-markdown` are byte-identical to the 0.45.0 snapshot apart from the header line. No visible effect: the plugin has no user interface yet and carried none of the building blocks. Skipped kit releases read: code-kit 0.46.0 to 0.52.1 (audio, recording, diarization, MIDI/DAWproject, loopback and asset helpers, test timing, `answer-retry`) and obsidian-kit 0.76.0 to 0.78.0 (chat window and model bar on phones, host spacing, chat leaf placement, `canonVaultDir`) — none touches a module this plugin vendors, and the audio and Python releases do not concern it at all.
