# DOM-capture benchmark

2026-06-12T23:23:04.271Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 92.4 (84.22–96.56) | 513.8 (398.52–913.08) | 261.9 (254.38–294.04) | 5056.3 (4892.16–5116.52) |
| domlens-canvas | 74.4 (68.56–100.34) | 238.3 (231.56–243.9) | 155.5 (145.76–166.2) | 761.7 (749.4–787.22) |
| domlens-auto | 86.9 (85.38–94.72) | 399.2 (389.28–429.96) | 271.7 (261.16–308.08) | 5069.1 (4895.26–5378.38) |
| snapdom | 9.2 (8.34–11.5) | 56.3 (54.76–58.46) | 98.7 (95–114.68) | 348.5 (336.8–730.08) |
| html-to-image | 30.1 (20.5–40.82) | 529.2 (519.38–541.92) | 156.3 (140.32–168.74) | 4607.4 (3384.84–4641.9) |
| modern-screenshot | 34.3 (32.56–36.88) | 304.9 (299.22–335.82) | 181.9 (173.04–189.86) | 1944.5 (1900.94–2339.46) |
| html2canvas-v1 | 70.4 (69.34–73.42) | 243 (238.38–250.14) | 154.6 (145.42–158.7) | 775.8 (759.68–825.62) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 29,853 | 60,079 | 0.50x |
| text-doc | 314,812 | 169,480 | 1.86x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
