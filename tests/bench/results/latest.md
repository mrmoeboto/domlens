# DOM-capture benchmark

2026-08-18T21:44:22.561Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 12.8 (11.44–14.22) | 89.4 (85.1–98.92) | 93.8 (88.04–96.26) | 3926.1 (3742.34–4330.72) |
| domlens-canvas | 19.6 (18.3–21.26) | 233.2 (223.62–270.04) | 102.2 (97.72–107.36) | 1082.2 (1025.14–1175.46) |
| domlens-auto | 14.5 (11.58–15.56) | 88.5 (86.4–124.2) | 87.3 (85.2–94.2) | 3863.4 (3694.04–4109.84) |
| snapdom | 11.7 (11–12.68) | 71.7 (66.38–74.08) | 108.6 (105.88–115.98) | 2888.6 (2722.78–3377.48) |
| html-to-image | 21.5 (20.38–30.56) | 567.7 (558.88–690.18) | 160.4 (147.8–167.2) | 12039.7 (6995.8–15142.44) |
| modern-screenshot | 35.7 (34.22–38.98) | 331.2 (326.2–384.92) | 215.6 (205.14–222.58) | 5906.6 (5450.82–10780.18) |
| html2canvas-v1 | 72.1 (68.46–73.86) | 286.7 (278.88–302.66) | 159.3 (151.86–167.26) | 917.5 (894.08–948.6) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 23,376 | 60,079 | 0.39x |
| text-doc | 164,479 | 169,480 | 0.97x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
