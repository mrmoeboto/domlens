# domlens

Fast, high-fidelity DOM-to-image capture for the browser.

```js
import {capture} from 'domlens';

const result = await capture(document.querySelector('#invoice'));
document.body.append(result.toCanvas());
```

domlens is a fork and successor of [html2canvas](https://github.com/niklasvh/html2canvas),
which has been unmaintained since January 2022 and still gets ~14M downloads a week. It keeps
that library's job — turn a live DOM subtree into an image, entirely in the browser, with no
server — and replaces how it does it.

**The difference is two engines behind one call.** html2canvas reads the DOM and repaints every
box onto a canvas by hand, so anything its CSS implementation does not cover is silently wrong.
domlens defaults to serializing the subtree into an SVG `foreignObject` and letting the browser
render it — the browser's own layout engine, so its CSS support is by definition complete — and
falls back to the classic repainter automatically when that path is unavailable or the canvas
would be tainted.

## Install

```bash
npm install domlens
```

Already using html2canvas? There is a drop-in package that keeps the old call signature:

```bash
npm install domlens-html2canvas
```

```js
import html2canvas from 'domlens-html2canvas';

const canvas = await html2canvas(element, {scale: 2}); // unchanged from html2canvas
```

Or from a CDN, exposing `window.domlens`:

```html
<script src="https://unpkg.com/domlens/dist/domlens.min.js"></script>
```

## API

### `capture(element, options?) => Promise<CaptureResult>`

`element` is any `HTMLElement` attached to a document. Everything in `options` is optional:

| option | default | what it does |
| --- | --- | --- |
| `engine` | `'auto'` | `'auto'`, `'svg'` or `'canvas'`. See [Engines](#engines). |
| `output.scale` | `devicePixelRatio` | Output pixel ratio. `2` on a 1x display gives a retina-sharp image. |
| `output.width` / `output.height` | element size | Crop the output box. |
| `output.x` / `output.y` | `0` | Crop offset. |
| `output.backgroundColor` | transparent | Paint behind the capture. |
| `output.canvas` | — | Render into a canvas you already own. |
| `resources.cors` | `'off'` | `'anonymous'` or `'use-credentials'` for cross-origin images. |
| `resources.allowTaint` | `false` | Permit a tainted canvas rather than failing. Output cannot be read back. |
| `resources.proxy` | — | URL of a proxy for cross-origin resources. |
| `resources.imageTimeout` | `15000` | Per-image load budget, ms. |
| `resources.cache` | `'soft'` | `'off'`, `'soft'` or `'hard'` resource caching across captures. |
| `filter` | — | `(element) => boolean`; return `false` to omit a subtree. |
| `viewport` | current window | `{width, height, scrollX, scrollY}` to capture as if the viewport were different. |
| `fonts.embed` | `true` | Inline the `@font-face` sources the subtree actually uses, so text renders identically. |
| `plugins` | `[]` | Hooks into the capture pipeline. |
| `debug` | `false` | `true` for logging, or `{logging, timings, keepContainer}`. |

### `CaptureResult`

| member | returns | notes |
| --- | --- | --- |
| `toCanvas()` | `HTMLCanvasElement` | Synchronous. |
| `toSvg()` | `string` | SVG engine only — the serialized markup, no raster. |
| `toPng()` | `Promise<string>` | Data URL. |
| `toJpeg(quality?)` | `Promise<string>` | Data URL. |
| `toWebp(quality?)` | `Promise<string>` | Data URL. |
| `toBlob(format?, quality?)` | `Promise<Blob>` | `'png'` by default. |
| `download(filename?)` | `Promise<void>` | Triggers a browser download. |
| `kind` | `'canvas' \| 'svg'` | Which engine produced this. |
| `width` / `height` | `number` | Output dimensions. |
| `timings` | `Record<string, number> \| null` | Per-stage ms; needs `debug.timings`. |

Rasterization is deferred: `capture()` returns once the subtree is serialized, and the browser
only paints pixels when you first ask for them. On a large capture that keeps `capture()`
roughly an order of magnitude cheaper than it would otherwise be — but the paint cost has not
vanished, it moves to your first `toCanvas()` / `toPng()` call.

## Engines

**`svg`** serializes the cloned subtree into an SVG `foreignObject` and hands it to the browser.
Because the browser lays it out, CSS support is whatever the browser supports — grid, filters,
transforms, custom properties, all of it. This is the default.

**`canvas`** is the classic html2canvas repainter, kept and maintained. It is used when
`foreignObject` drawing is unsupported, and it is what `'auto'` falls back to when an SVG render
fails or would taint the canvas.

**`'auto'`** prefers `svg` and falls back to `canvas` on failure. Pick an engine explicitly only
if you know why.

## Fidelity

Scored as SSIM against a real browser screenshot of the same element, across a 99-case suite:

| engine | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| svg (default) | **99%** of cases ≥ 0.90 SSIM | **99%** | **93.9%** |
| canvas (fallback) | 88.3% | 87.2% | — |

That gap is the reason `'auto'` prefers the SVG engine.

## Performance

Median of 15 runs after 3 warmups, Chromium 148, 1280x800 @1x, on one developer desktop. Timed
region is capture through a readback that forces rasterization, so nothing is hidden behind
laziness. **Lower is better; deltas under ~25% are noise on this hardware.**

| library | simple-card (20 nodes) | text-doc (451) | image-heavy (121) | deep-tree (3177) |
| --- | --- | --- | --- | --- |
| **domlens** (auto) | **14.5 ms** | **88.5 ms** | **87.3 ms** | 3863 ms |
| snapdom | 11.7 ms | 71.7 ms | 108.6 ms | 2889 ms |
| html-to-image | 21.5 ms | 567.7 ms | 160.4 ms | 12040 ms |
| modern-screenshot | 35.7 ms | 331.2 ms | 215.6 ms | 5907 ms |
| html2canvas 1.4.1 | 72.1 ms | 286.7 ms | 159.3 ms | **917 ms** |

Read that table honestly:

- Against **html2canvas**, domlens is ~5x faster on small captures and ~3x on text-heavy ones.
- Against **snapdom**, the fastest current library, domlens is ~1.2x ahead on image-heavy work
  and ~1.2–1.4x behind elsewhere.
- **On very deep trees the SVG engine is the slowest option here**, including slower than
  html2canvas — the cost is browser-side rasterization of a very large output area, not
  serialization. If you capture 3000-node subtrees, pass `engine: 'canvas'` and measure; it runs
  that case in ~1082 ms.

These are one machine's numbers, and the deep-tree gap in particular is hardware-sensitive: on a
4-core CI runner the same suite puts the SVG engine at 1817 ms against html2canvas's 851 ms — the
same ordering, but a 2.1x gap rather than a 4.3x one. The ordering has held on every machine
measured; the magnitude has not. CI re-runs this nightly against a committed baseline
(`tests/bench/results/ci-baseline.json`) so a real regression is caught even though the absolute
numbers move.

The SVG the serializer emits is also smaller than the obvious approach — 0.39x snapdom's bytes on
a small card, 0.97x on a text document — because styles are diffed against the browser's own
defaults rather than dumped wholesale.

## Browser support

All three engines are verified and gating. The reference-test matrix runs Chromium, Firefox and
WebKit on every push, and a failure in any of them fails the build.

- **Chromium** covers Chrome and Edge.
- **Firefox** is Gecko.
- **WebKit** is Safari on macOS, and on iOS it is the engine behind *every* browser — so a
  visitor on an iPhone is on it whatever they installed.

WebKit scores lower than the other two (93.9% against 99%) and is worth calibrating rather than
glossing: its reference baselines were generated from WebKit's own output, so they hold WebKit to
*not changing*, while the 93.9% is the number that says how close that output is to a real
screenshot. If you ship primarily to Safari, that six-point gap is the honest expectation.

## Differences from html2canvas

- The default engine is different, so output is *more* accurate rather than bug-compatible. If
  you depended on an html2canvas rendering quirk, pass `engine: 'canvas'`.
- Options are grouped (`output.scale` rather than `scale`). `domlens-html2canvas` maps the old
  flat names for you.
- `capture()` resolves a `CaptureResult`, not a canvas. `toCanvas()` gets you the old return value.
- Rasterization is lazy — see the note under `CaptureResult`.

## Credits

domlens is a fork of [html2canvas](https://github.com/niklasvh/html2canvas) by
Niklas von Hertzen, and would not exist without it. Substantial portions of the canvas engine are
his work, used under the MIT licence and carrying his copyright — see [LICENSE](LICENSE).

## License

MIT.
