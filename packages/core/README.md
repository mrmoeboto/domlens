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

### `prewarm(options?) => void`

Optional. Does a capture's cacheable work early, so the capture itself is faster.

```js
import {capture, prewarm} from 'domlens';

prewarm();                        // at load, or whenever the page is idle
button.onclick = () => capture(document.body);
```

If your app takes **one** screenshot — a bug-report widget, a "download as image" button,
an export — this is the single most useful call in the library. The largest first-capture
cost is probing the browser for its UA default styles, and that work does not need to
happen while someone is waiting for a screenshot. Measured cold, first capture:

| scenario | without | with `prewarm()` |
| --- | --- | --- |
| simple-card | 51 ms | **33 ms** |
| text-doc | 176 ms | **162 ms** |
| image-heavy | 190 ms | **176 ms** |

Pass `{element}` if you already know what you will capture; it warms exactly that subtree
instead of the whole document. It never throws, is safe to call repeatedly, and changes no
output — captures behave identically without it, they just pay the probe themselves. It
does not help a capture whose time is dominated by rasterizing a very large output.

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
| `resources.cache` | `'soft'` | `'disabled'`, `'soft'` or `'full'`. `'full'` keeps inlined resource data URLs across captures — worth setting if you capture repeatedly on an image-heavy page. |
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

There are two honest ways to benchmark a DOM rasteriser, and they disagree about who wins.

### The first screenshot

This is the one most apps take: a bug-report widget, a "download as image" button, an export.
One capture, on a page that just loaded, paying every first-time cost once — module init, the
UA-default probe, resource fetches, font loads, cold JIT. Median of 7 samples, each in a fresh
browser context so the HTTP, image and font caches start empty. **Lower is better; treat deltas
under ~20% as noise, cold numbers are noisy.**

| library | simple-card (20 nodes) | text-doc (451) | image-heavy (121) | deep-tree (3177) |
| --- | --- | --- | --- | --- |
| **domlens** (auto) | 51 ms | **179 ms** | 213 ms | 3591 ms |
| domlens (`engine: 'svg'`) | **48 ms** | 185 ms | 184 ms | 3514 ms |
| domlens (`engine: 'canvas'`) | 60 ms | 314 ms | **154 ms** | **1034 ms** |
| snapdom | 74 ms | 530 ms | 243 ms | 6252 ms |
| html-to-image | 51 ms | 791 ms | 269 ms | 7337 ms |
| modern-screenshot | 58 ms | 411 ms | 196 ms | 5601 ms |
| html2canvas 1.4.1 | 107 ms | 374 ms | 200 ms | 1141 ms |

Add [`prewarm()`](#prewarmoptions--void) and the default path gets faster again — 51 ms → **33 ms**
on simple-card, 179 → 162, 213 → 176 — because the UA-default probe stops happening while the
user waits.

On a single capture domlens is the fastest option in every column, and by a wide margin on
text-heavy content. Note that deep-tree is won by the *canvas* engine, which `auto` does not
currently choose; see the caveat below.

### Repeated screenshots

15 captures after 3 warmups, same page, same process — the right shape if you capture in a loop.

| library | simple-card | text-doc | image-heavy | deep-tree |
| --- | --- | --- | --- | --- |
| **domlens** (auto) | 13 ms | 106 ms | **98 ms** | 3726 ms |
| snapdom | **10 ms** | **84 ms** | 127 ms | 2913 ms |
| html-to-image | 36 ms | 630 ms | 173 ms | 8022 ms |
| modern-screenshot | 39 ms | 416 ms | 245 ms | 5480 ms |
| html2canvas 1.4.1 | 69 ms | 300 ms | 168 ms | **969 ms** |

snapdom leads two columns here and loses all four cold. Its advantage is cache reuse between
captures, which a one-shot capture never gets to use. Neither table is wrong — they answer
different questions, and which one applies to you depends on whether you capture once or often.

### The deep-tree caveat

On very large, deeply nested subtrees the SVG engine is slow, and it is worth knowing why before
you pick an engine. For a 3177-node, 26-megapixel capture, domlens spends **387 ms** doing its own
work — less than html2canvas's entire run — and then **3077 ms** waiting for the browser to
rasterize a 26-megapixel SVG image. It is not serialization, and no amount of tuning the
serializer touches it.

The canvas engine never builds that image; it paints boxes straight onto the canvas, and does the
same capture in ~1034 ms — the fastest of any library measured. `auto` does not route there today,
because the trade is real: the canvas engine scores 88% on the fidelity suite against the SVG
engine's 99%. If you capture very large pages, benchmark both against your own content:

```js
await capture(element, {engine: 'canvas'});
```

### Notes on the numbers

Both tables come from one developer desktop, and the deep-tree gap is hardware-sensitive: a 4-core
CI runner puts the SVG engine at 1817 ms against html2canvas's 851 ms — same ordering, 2.1x rather
than 3.8x. The ordering has held on every machine measured; the magnitude has not. CI re-runs the
suite nightly against a baseline measured on comparable hardware, so a real regression is caught
even though absolute numbers move.

Reproduce either with `npm run bench:cold` or `npm run bench`.

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
