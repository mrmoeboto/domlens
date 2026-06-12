/**
 * Integration tests for the svg-first auto-fallback policy (engines/select.ts) against
 * the REAL engines in real browsers:
 *
 *  - `engine: 'auto'` prefers the svg engine when foreignObject drawing is supported,
 *  - a render failure of the real SvgEngine re-enters the pipeline at the clone stage
 *    with the canvas engine,
 *  - a cross-origin image served WITHOUT CORS headers (the CORS test server's root, see
 *    tests/server.ts) raises a typed TaintError in the svg path, which executeCapture
 *    translates into the canvas-engine fallback.
 *
 * Skipped in scorecard/baseline-update modes (those runs measure engine fidelity only).
 */
import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import * as path from 'path';

const CORE_BUNDLE = path.resolve(__dirname, '../../packages/core/dist/domlens.js');
const SCORECARD_MODE = !!process.env.ENGINE || process.env.UPDATE_SVG_BASELINES === '1';

interface CaptureSummary {
    kind: string;
    width: number;
    height: number;
    /** First bytes of the png data url, when requested (omit for tainted canvases). */
    pngPrefix?: string;
}

const prepare = async (page: Page, urlPath: string): Promise<void> => {
    await page.goto(urlPath);
    await page.addScriptTag({path: CORE_BUNDLE});
};

test.skip(SCORECARD_MODE, 'fallback integration tests run with the regular reftest suite');

test('auto prefers the svg engine when foreignObject drawing is supported', async ({page}) => {
    await prepare(page, '/tests/playwright/fixtures/simple.html');

    const result: CaptureSummary = await page.evaluate(async () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const win = window as any;
        const res = await win.domlens.capture(document.getElementById('target'), {
            engine: 'auto',
            output: {scale: 1}
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return {kind: res.kind, width: res.width, height: res.height, pngPrefix: (await res.toPng()).slice(0, 22)};
    });

    expect(result.kind).toBe('svg');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.pngPrefix).toBe('data:image/png;base64,');
});

test('falls back to the canvas engine (re-entering at the clone stage) when the real svg engine fails', async ({
    page
}) => {
    await prepare(page, '/tests/playwright/fixtures/simple.html');

    const result: {first: CaptureSummary; second: CaptureSummary} = await page.evaluate(async () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const win = window as any;
        const target = document.getElementById('target');

        // First capture: warms the foreignObject feature detection (it serializes svg
        // itself) and proves the svg engine works on this page.
        const first = await win.domlens.capture(target, {engine: 'auto', output: {scale: 1}});

        // Sabotage serialization so the real SvgEngine's render throws mid-pipeline; the
        // canvas engine must then re-clone and render (it does not use XMLSerializer here).
        win.XMLSerializer = class {
            serializeToString(): string {
                throw new Error('forced serializer failure (fallback integration test)');
            }
        };

        const second = await win.domlens.capture(target, {engine: 'auto', output: {scale: 1}});
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return {
            first: {kind: first.kind, width: first.width, height: first.height},
            second: {
                kind: second.kind,
                width: second.width,
                height: second.height,
                pngPrefix: (await second.toPng()).slice(0, 22)
            }
        };
    });

    expect(result.first.kind).toBe('svg');
    expect(result.second.kind).toBe('canvas');
    expect(result.second.width).toBe(result.first.width);
    expect(result.second.height).toBe(result.first.height);
    expect(result.second.pngPrefix).toBe('data:image/png;base64,');
});

test('falls back to the canvas engine when a cross-origin image without CORS headers would taint the capture', async ({
    page
}) => {
    await prepare(page, '/tests/playwright/fixtures/cross-origin-image.html');
    // The image comes from the CORS server's no-CORS-headers root; wait for it so the
    // taint path (image loads, reading it back throws SecurityError) is deterministic.
    await page.waitForFunction(() => {
        const img = document.querySelector('img');
        return !!img && img.complete && img.naturalWidth > 0;
    });

    const result: CaptureSummary & {tainted: boolean} = await page.evaluate(async () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const win = window as any;
        const res = await win.domlens.capture(document.getElementById('target'), {
            engine: 'auto',
            output: {scale: 1},
            resources: {allowTaint: true}
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        // The canvas-engine fallback draws the cross-origin image directly (allowTaint),
        // so the resulting canvas must be tainted — proof the image was not dropped.
        const canvas = res.toCanvas();
        let tainted = false;
        try {
            canvas.getContext('2d').getImageData(0, 0, 1, 1);
        } catch (e) {
            tainted = true;
        }
        return {kind: res.kind, width: res.width, height: res.height, tainted};
    });

    expect(result.kind).toBe('canvas');
    expect(result.width).toBeGreaterThan(0);
    expect(result.tainted).toBe(true);
});
