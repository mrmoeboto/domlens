# DOM-capture benchmark

2026-06-13T01:19:14.262Z · chromium 148.0.7778.96 · 1280x800 @1x · median of 15 runs after 3 warmups (p10–p90 spread) · shared machine; deltas under ~25% should be treated as noise

Libraries: @domlens/core (domlens)@1.4.1, @zumer/snapdom@2.12.8, html-to-image@1.11.13, modern-screenshot@4.7.0, html2canvas-v1@1.4.1

## Capture to canvas, median ms (p10–p90)

| library | simple-card | text-doc | image-heavy | deep-tree |
|---|---|---|---|---|
| domlens-svg | 12.6 (11.94–16.88) | 83.2 (78.6–96.44) | 126.7 (121.64–141) | 3153.3 (3121.38–3297.98) |
| domlens-canvas | 17 (16.4–17.66) | 214.8 (208.3–240.92) | 89.8 (87.2–98.82) | 814.5 (797.9–867.3) |
| domlens-auto | 12.3 (11.7–13.08) | 81.9 (79.34–122.58) | 124 (121.3–135.24) | 3175.1 (3151.3–3282.86) |
| snapdom | 8.5 (8.18–8.9) | 65.6 (63.76–69.22) | 100 (96.22–113.3) | 2281.5 (2249.06–2654.6) |
| html-to-image | 17.9 (17.54–33.7) | 531.6 (517.2–545.3) | 141.7 (138.94–146.4) | 6560.4 (6515.88–6723.4) |
| modern-screenshot | 30.9 (29.9–31.5) | 316.7 (309.1–351.74) | 185.8 (174.68–199.44) | 5343.6 (4845.72–5856.12) |
| html2canvas-v1 | 69.7 (68.32–100.92) | 257.2 (254.48–268.34) | 156 (145.34–175.24) | 1260.7 (1138.58–1361.44) |

## SVG output size, bytes (domlens default-style diffing vs snapdom)

| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |
|---|---|---|---|
| simple-card | 23,376 | 60,079 | 0.39x |
| text-doc | 164,479 | 169,480 | 0.97x |

Scenario node counts: simple-card=20, text-doc=451, image-heavy=121, deep-tree=3177
