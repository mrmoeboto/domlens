# DOM-capture benchmark

2026-06-13T02:01:08.572Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 11.9 (10.3–13.5) | 90.2 (87.06–104.04) | 89.2 (86.3–93.62) | 3389.4 (3242.4–3482.9) |
| domlens-canvas | 19.5 (18.46–20.66) | 234.6 (223–267.88) | 101.2 (95.26–109.04) | 911.8 (875.44–964.74) |
| domlens-auto | 11.5 (9.96–13.26) | 85.4 (82.04–113.34) | 86.6 (83.24–89.76) | 3417.7 (3296.92–3566.9) |
| snapdom | 10.9 (9.04–11.9) | 71.6 (67.42–79.34) | 108.3 (105.12–118.06) | 2463 (2354.7–2807.52) |
| html-to-image | 20.4 (19.44–35.74) | 579.4 (540.16–753.44) | 177.1 (154.82–206.68) | 7363.9 (7023.18–8044.6) |
| modern-screenshot | 37.4 (34.7–47.26) | 332 (327–360.42) | 249.3 (219.86–311.4) | 5269.2 (5105.08–5617.4) |
| html2canvas-v1 | 70.8 (68–74.06) | 266.5 (261.9–275.56) | 168.7 (153.34–190.52) | 999.3 (960.6–1064.1) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 23,376 | 60,079 | 0.39x |
| text-doc | 164,479 | 169,480 | 0.97x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
