# DOM-capture benchmark

2026-07-26T12:37:39.792Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 9.8 (9.24–10.86) | 81.1 (77.8–84.08) | 83.3 (82.3–85.02) | 3347.1 (3223.98–5305.16) |
| domlens-canvas | 16.6 (16.16–17.1) | 213 (206.54–240.76) | 87 (83.94–91.4) | 838.4 (803.58–858.98) |
| domlens-auto | 10.4 (10.1–10.8) | 81.4 (79.64–106.14) | 141.6 (84.78–159.3) | 3262.5 (3169.7–3332.86) |
| snapdom | 8.6 (8.4–9.06) | 63 (61.58–64.32) | 186.9 (153.34–230.42) | 2254.9 (2212.58–2597.22) |
| html-to-image | 18 (17.38–19.34) | 532.9 (507.48–542.5) | 136.4 (132.14–148.4) | 6221.9 (5135.12–6434.66) |
| modern-screenshot | 30.3 (29.18–32.4) | 315 (304.96–353.78) | 194.3 (176.64–229.76) | 4570.1 (4515.9–4890.7) |
| html2canvas-v1 | 85.7 (68.64–95.62) | 248.6 (244.06–253.44) | 155.3 (146.64–182.8) | 838.7 (836.32–869.2) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 23,376 | 60,079 | 0.39x |
| text-doc | 164,479 | 169,480 | 0.97x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
