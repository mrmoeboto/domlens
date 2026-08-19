# Changelog

All notable changes to domlens are documented here.

domlens is a fork of html2canvas. Everything that happened up to html2canvas 1.4.1 (January 2022)
is in [CHANGELOG-html2canvas.md](CHANGELOG-html2canvas.md); this file starts where that one stops.

## 0.1.0 — unreleased

First release under the domlens name. The version resets to 0.1.0 rather than continuing from
html2canvas's 1.4.1: this is a new package with a different API, and pre-1.0 is an honest signal
that the surface may still move before it settles.

### Added

- **SVG `foreignObject` engine, and it is the default.** The captured subtree is serialized to SVG
  and handed to the browser to lay out, so CSS support is the browser's rather than a
  reimplementation's. Scores 99% of a 99-case fidelity suite at ≥0.90 SSIM against a real
  screenshot, on both Chromium and Firefox, against 88% for the canvas engine.
- **Automatic engine selection.** `engine: 'auto'` (the default) prefers the SVG engine and falls
  back to the canvas engine when `foreignObject` drawing is unsupported, when a render fails, or
  when the output canvas would be tainted.
- **`capture()` and `CaptureResult`.** A grouped option schema (`output`, `resources`, `viewport`,
  `fonts`, `debug`) and a result object exposing `toCanvas()`, `toSvg()`, `toPng()`, `toJpeg()`,
  `toWebp()`, `toBlob()` and `download()`.
- **`@font-face` embedding** with unicode-range pruning, so text renders with the right typeface
  without shipping whole font files.
- **Shadow DOM expansion and same-origin iframe capture.**
- **A plugin pipeline** with `beforeClone`, `afterClone`, `beforeRender`, `afterRender` and
  `beforeExport` hooks.
- **`domlens-html2canvas`**, a separate package keeping the classic `html2canvas(element, options)`
  signature and html2canvas 1.4.1's canvas-engine behavior, with `foreignObjectRendering: true`
  opting into the SVG engine.
- **`prewarm()`**, which does a capture's cacheable work ahead of time. The dominant
  first-capture cost is probing the browser for UA default styles, and a one-shot capture
  (a bug-report widget, an export button) pays it while the user waits. Calling `prewarm()`
  at idle cuts the first capture of the benchmark's simple-card page from 51ms to 33ms, with
  no change to output.
- **A cold-capture benchmark** (`npm run bench:cold`) measuring the first screenshot on a
  fresh browser context, alongside the existing steady-state one. The two disagree sharply:
  snapdom leads three of four scenarios warm and loses all four cold, because its advantage
  is cache reuse a single capture never sees.
- **A cross-library benchmark suite** (`npm run bench`) measuring domlens against snapdom,
  html-to-image, modern-screenshot and html2canvas 1.4.1 in one process on one machine, plus a
  perf regression gate normalized against a reference library so a slower host does not read as a
  regression.

### Changed

- Rasterization is deferred. `capture()` returns once serialization is done; the browser paints
  when pixels are first requested. On a 26-megapixel capture this moves ~2.8s out of `capture()`.
- Resource caching is configurable across captures (`resources.cache`: `'off'`, `'soft'`, `'hard'`).
- Styles are inlined by diffing against the browser's own defaults rather than serializing every
  computed property, which cuts emitted SVG to 0.39x the naive size on a small card.

### Known limitations

- On very deep trees (thousands of nodes) the SVG engine is several times slower than the canvas
  engine and than html2canvas, because the browser rasterizes a very large output area. Pass
  `engine: 'canvas'` for that shape of content.
- WebKit's SVG-engine fidelity is 93.9% of cases at ≥0.90 SSIM, against 99% on Chromium and
  Firefox. It is gated on in CI, so it cannot silently regress, but it is the weakest of the
  three engines today.
- There is no glyph subsetting. Embedding prunes `@font-face` rules whose `unicode-range` cannot
  match the captured text, but the font binaries themselves are embedded whole.
