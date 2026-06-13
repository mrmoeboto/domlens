# DOM-capture benchmark

2026-06-13T00:00:16.413Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 29 (27.94–32.6) | 244.8 (237.3–281.22) | 182.4 (171.5–195.94) | 4352.9 (4174.52–4392.98) |
| domlens-canvas | 16.6 (15.78–16.96) | 215 (207.44–240.54) | 92.5 (86.94–96.6) | 808.3 (778.22–838.06) |
| domlens-auto | 29.8 (28.34–31.26) | 239 (234.34–268.78) | 180 (175.32–200.66) | 4357.4 (4164.56–4403.3) |
| snapdom | 8.5 (8.3–17.56) | 63.6 (62.4–71.36) | 97.8 (95.34–105.5) | 2232.6 (2217.92–2588.86) |
| html-to-image | 18 (17.5–20.12) | 522.8 (514.44–530.34) | 141.6 (137.08–148.84) | 6500.5 (6441.06–6571.24) |
| modern-screenshot | 30.2 (29.34–31.44) | 320.2 (305.94–338.1) | 183.4 (168.78–230.84) | 4705.7 (4680.78–5107.1) |
| html2canvas-v1 | 74.6 (68.88–100.06) | 259.8 (253.22–275.46) | 155.4 (142.96–178.12) | 862.3 (846.12–885.14) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 29,853 | 60,079 | 0.50x |
| text-doc | 314,812 | 169,480 | 1.86x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
