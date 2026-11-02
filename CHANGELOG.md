# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Pure core: element scanner with UTF-16 source offsets and stable element keys, byte-preserving change lists (`change`, `add`, `remove`, `move`) with an all-or-nothing round-trip guard, id assignment and `data-unit`, canvas measurement from `viewBox` or `width`/`height`.
- SVG sanitizer `svg-guard` vendored from code-kit 0.45.0 (rejects instead of stripping).
- Measurement lab for local models (`npm run lab`) with recorded answers from two models.
