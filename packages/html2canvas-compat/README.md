# domlens-html2canvas

A drop-in replacement for [html2canvas](https://github.com/niklasvh/html2canvas), which has been
unmaintained since January 2022.

```bash
npm install domlens-html2canvas
```

```js
import html2canvas from 'domlens-html2canvas';

const canvas = await html2canvas(element, {scale: 2, backgroundColor: '#fff'});
```

Same call signature, same flat option names, same `Promise<HTMLCanvasElement>` return.

## What you get by swapping the import

**Not a different rendering.** This package deliberately keeps html2canvas 1.4.1's behavior: it
renders with the canvas engine by default and does not silently fall back to anything else, so
your output stays pixel-comparable. What changes is that the code underneath is maintained, and
faster.

How much faster depends on how you capture. On a **single** screenshot — the usual case for a
widget or an export button — it is 1.8x on a small card (60 ms vs 107 ms), and 1.1–1.3x on larger
pages. If you capture **repeatedly** in one page session the gap widens to ~3.7x on small captures
(20 ms vs 69 ms), because more of the setup is amortized. Both are measured on the same desktop;
see the [benchmarks](https://github.com/mrmoeboto/domlens#performance).

```diff
-import html2canvas from 'html2canvas';
+import html2canvas from 'domlens-html2canvas';
```

Or keep the global — the classic `window.html2canvas(element, options)` still works:

```html
<script src="https://unpkg.com/domlens-html2canvas/dist/html2canvas.min.js"></script>
```

## Opting into the accurate renderer

html2canvas had an experimental `foreignObjectRendering` flag. Here it is not experimental: it
selects [domlens](https://www.npmjs.com/package/domlens)'s SVG engine, which serializes your
subtree and lets the browser lay it out, so CSS support is whatever the browser supports.

```js
const canvas = await html2canvas(element, {foreignObjectRendering: true});
```

That path scores 99% of a 99-case fidelity suite at ≥0.90 SSIM against a real screenshot, versus
88% for the canvas engine — and it still falls back to the canvas engine if the render fails,
matching the old "if the browser supports it" semantics. It is faster on most shapes of content,
with one exception: on very deep trees (thousands of nodes) it is several times slower, because
the browser rasterizes a very large output area. Leave the flag off there.

## Supported options

`allowTaint`, `backgroundColor`, `canvas`, `foreignObjectRendering`, `imageTimeout`,
`ignoreElements`, `logging`, `onclone`, `proxy`, `removeContainer`, `scale`, `useCORS`, `width`,
`height`, `x`, `y`, `scrollX`, `scrollY`, `windowWidth`, `windowHeight`, and `cache` for sharing
a resource cache between captures.

`onclone` becomes an afterClone plugin and `ignoreElements` becomes an inverted filter, but both
behave as they always did.

## For new code

Prefer [`domlens`](https://www.npmjs.com/package/domlens) directly. It defaults to the accurate
SVG engine, and returns a capture result rather than just a canvas — so you can get SVG, PNG,
JPEG, WebP or a Blob without a second conversion step.

## Credits

A fork of html2canvas by Niklas von Hertzen, used under the MIT licence and carrying his
copyright — see [LICENSE](LICENSE).

## License

MIT.
