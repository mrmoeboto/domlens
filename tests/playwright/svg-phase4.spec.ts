/**
 * Targeted svg-engine fidelity bars for the Phase 4 work (shadow DOM expansion, same-origin
 * iframe capture, fidelity tail). Runs only with ENGINE=svg, like the scorecard.
 *
 * The shadow/* reftests are new pages without committed canvas/svg baselines yet; they are
 * listed in tests/playwright/skip.ts until the integrate stage regenerates baselines, and
 * this spec is their fidelity gate in the meantime.
 *
 * Set SVG_DEBUG_DIR=/some/dir to dump cropped actual/native PNGs for visual inspection.
 */
import {test, expect} from '@playwright/test';
import {scorePageFidelity} from './fidelity';

interface FidelityBar {
    /** Path relative to tests/reftests. */
    page: string;
    /** Minimum SSIM vs the native screenshot, per browser. */
    min: {chromium: number; firefox: number};
}

const BARS: FidelityBar[] = [
    // Shadow DOM expansion (open roots, slotted + fallback content, nested roots).
    {page: 'shadow/simple.html', min: {chromium: 0.95, firefox: 0.95}},
    {page: 'shadow/slots.html', min: {chromium: 0.95, firefox: 0.95}},
    {page: 'shadow/nested.html', min: {chromium: 0.95, firefox: 0.95}},
    // Same-origin iframe capture (the cross-origin frame on the page stays an empty box).
    {page: 'iframe.html', min: {chromium: 0.9, firefox: 0.9}},
    // Form control materialization (Firefox does not paint native widgets in foreignObject).
    {page: 'forms.html', min: {chromium: 0.9, firefox: 0.85}},
    // Video first-frame/poster handling.
    {page: 'images/video.html', min: {chromium: 0.9, firefox: 0.9}},
    // background-clip rendering (chromium was below 0.90 before inline backgrounds
    // stopped being stripped of their background-clip context).
    {page: 'background/clip.html', min: {chromium: 0.9, firefox: 0.9}}
];

if (process.env.ENGINE === 'svg') {
    for (const {page: relPath, min} of BARS) {
        test(`svg fidelity: ${relPath}`, async ({page, browserName}) => {
            test.skip(browserName === 'webkit', 'Phase 4 bars are defined for chromium/firefox');
            const bar = min[browserName as 'chromium' | 'firefox'];
            const {ssim} = await scorePageFidelity(
                page,
                `/tests/reftests/${relPath}`,
                'svg',
                process.env.SVG_DEBUG_DIR ? `${process.env.SVG_DEBUG_DIR}/${browserName}` : undefined
            );
            expect(ssim, `${relPath} SSIM ${ssim.toFixed(4)} below the ${bar} bar`).toBeGreaterThanOrEqual(bar);
        });
    }
}
