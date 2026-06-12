/**
 * Shared SSIM fidelity scoring for targeted svg-engine specs: captures a reftest page with
 * the requested engine via the core UMD bundle and scores the output against a native
 * Playwright screenshot of the live page (the same procedure as the scorecard in
 * reftests.spec.ts, factored out for per-page assertions).
 */
import type {Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {PNG} from 'pngjs';
import {ssim} from 'ssim.js';

export const CORE_BUNDLE = path.resolve(__dirname, '../../packages/core/dist/domlens.js');
export const PROXY_URL = 'http://localhost:8081/proxy';

const pngFromDataURL = (dataUrl: string): PNG => {
    const prefix = 'data:image/png;base64,';
    if (!dataUrl.startsWith(prefix)) {
        throw new Error(`Expected a PNG data url, got "${dataUrl.slice(0, 40)}..."`);
    }
    return PNG.sync.read(Buffer.from(dataUrl.slice(prefix.length), 'base64'));
};

const cropPng = (src: PNG, x: number, y: number, width: number, height: number): PNG => {
    const out = new PNG({width, height});
    PNG.bitblt(src, out, x, y, width, height, 0, 0);
    return out;
};

const asImageData = (png: PNG): {data: Uint8ClampedArray; width: number; height: number} => ({
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height
});

export interface FidelityScore {
    ssim: number;
    /** The engine capture, cropped to the compared region. */
    actual: PNG;
    /** The native screenshot, cropped to the compared region. */
    native: PNG;
}

/**
 * Captures `urlPath` (e.g. /tests/reftests/iframe.html) with the given engine and returns
 * the SSIM score against the native screenshot, cropped to the captured element's bounds.
 * Set `debugDir` to also write `<slug>-{actual,native}.png` for visual inspection.
 */
export const scorePageFidelity = async (
    page: Page,
    urlPath: string,
    engine: 'svg' | 'canvas',
    debugDir?: string
): Promise<FidelityScore> => {
    await page.goto(`${urlPath}?selenium&run=false&reftest`);
    await page.addScriptTag({path: CORE_BUNDLE});
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // Document coordinates of the capture target (what the engine is asked to render).
    const bounds = await page.evaluate(() => {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const element: HTMLElement = (window as any).forceElement || document.documentElement;
        const rect = element.getBoundingClientRect();
        return {x: rect.left + window.pageXOffset, y: rect.top + window.pageYOffset};
    });

    const nativeFull = PNG.sync.read(await page.screenshot({fullPage: true, animations: 'disabled'}));

    const dataUrl = await page.evaluate(
        async ({engine, proxy}) => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const win = window as any;
            const element: HTMLElement = win.forceElement || document.documentElement;
            const result = await win.domlens.capture(element, {
                engine,
                output: {scale: 1, backgroundColor: '#ffffff'},
                resources: {proxy}
            });
            /* eslint-enable @typescript-eslint/no-explicit-any */
            if (result.kind !== engine) {
                throw new Error(`engine fell back: requested ${engine}, produced ${result.kind} output`);
            }
            return result.toPng();
        },
        {engine, proxy: PROXY_URL}
    );
    const captured = pngFromDataURL(dataUrl);

    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    const width = Math.min(captured.width, nativeFull.width - x);
    const height = Math.min(captured.height, nativeFull.height - y);
    if (width <= 0 || height <= 0) {
        throw new Error(
            `capture (${captured.width}x${captured.height}) does not overlap the native screenshot ` +
                `(${nativeFull.width}x${nativeFull.height} at ${x},${y})`
        );
    }

    const actual = cropPng(captured, 0, 0, width, height);
    const native = cropPng(nativeFull, x, y, width, height);
    const {mssim} = ssim(asImageData(actual), asImageData(native));

    if (debugDir) {
        const slug = urlPath.replace(/^\/tests\/reftests\//, '').replace(/[/.]/g, '-');
        fs.mkdirSync(debugDir, {recursive: true});
        fs.writeFileSync(path.join(debugDir, `${slug}-actual.png`), PNG.sync.write(actual));
        fs.writeFileSync(path.join(debugDir, `${slug}-native.png`), PNG.sync.write(native));
    }

    return {ssim: mssim, actual, native};
};
