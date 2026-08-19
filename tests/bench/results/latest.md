# DOM-capture benchmark

2026-08-19T13:34:26.274Z · chromium 148.0.7778.96 · local (12x Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz) · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: domlens (domlens)@0.1.0, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 14.7 (12.4–16) | 100.2 (93.44–110.2) | 104.9 (98.9–131.24) | 3666.2 (3579.66–3899.7) |
| domlens-canvas | 21.9 (19.34–23.12) | 320.9 (289.8–344.08) | 133.5 (112.14–161.96) | 1058.5 (950.98–1132.12) |
| domlens-auto | 12.7 (11.72–14.02) | 106.4 (94.96–117.06) | 98.2 (95.18–116.22) | 3725.7 (3568.82–3772.96) |
| snapdom | 10.4 (9.4–11.8) | 83.7 (75.78–92.46) | 127 (121.4–146.1) | 2913.4 (2536.22–3054.54) |
| html-to-image | 35.8 (24.4–47.32) | 630.4 (611.88–665.18) | 172.9 (164.52–185.9) | 8022.1 (7344.78–8263.4) |
| modern-screenshot | 38.8 (35.52–54.42) | 416.2 (374.1–487.56) | 244.6 (225.84–275.78) | 5479.5 (5142.96–5721.06) |
| html2canvas-v1 | 68.8 (67.82–71.4) | 300 (287.68–335.04) | 167.5 (159.6–200.12) | 968.8 (948.28–1002.46) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 23,376 | 60,079 | 0.39x |
| text-doc | 164,479 | 169,480 | 0.97x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
