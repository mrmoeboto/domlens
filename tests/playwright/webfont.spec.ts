/**
 * Targeted verification of svg-engine web font embedding (Phase 4, engines/svg/fonts.ts):
 *
 *  - tests/reftests/text/webfont.html and webfont-unicode-range.html are captured with the
 *    svg engine and scored with SSIM against a NATIVE screenshot of the live page. A high
 *    score proves the embedded @font-face data urls render identically in the svg raster
 *    to the real web fonts — the entire point of font embedding,
 *  - the serialized markup of webfont-unicode-range.html must contain the bytes of the
 *    latin face (Karla) and must NOT contain the bytes of the unused greek-range face
 *    (Lobster): unicode-range pruning drops faces that cannot match any used codepoint.
 *
 * These pages have no committed canvas/svg baselines yet (see tests/playwright/skip.ts);
 * this spec is their gate until the integrate stage regenerates baselines. Skipped in
 * scorecard/baseline-update modes like the other integration specs.
 */
import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {PNG} from 'pngjs';
import {ssim} from 'ssim.js';

const CORE_BUNDLE = path.resolve(__dirname, '../../packages/core/dist/domlens.js');
const FONTS_DIR = path.resolve(__dirname, '../assets/fonts');
const SCORECARD_MODE = !!process.env.ENGINE || process.env.UPDATE_SVG_BASELINES === '1';

/** Embedded fonts must reproduce the native text rendering nearly pixel-perfectly. */
const MIN_SSIM = 0.95;

test.skip(SCORECARD_MODE, 'webfont integration tests run with the regular reftest suite');

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

/** A base64 slice from the middle of a font binary: a byte-level fingerprint of the file. */
const fontFingerprint = (file: string): string => {
    const base64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
    return base64.slice(128, 192);
};

interface SvgCapture {
    kind: string;
    markup: string;
    png: string;
}

/** Captures the page's documentElement with the svg engine and returns markup + png. */
const captureSvg = async (page: Page, urlPath: string): Promise<SvgCapture> => {
    await page.goto(urlPath);
    await page.addScriptTag({path: CORE_BUNDLE});
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    return page.evaluate(async () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const win = window as any;
        const result = await win.domlens.capture(document.documentElement, {
            engine: 'svg',
            output: {scale: 1, backgroundColor: '#ffffff'}
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return {kind: result.kind, markup: result.toSvg(), png: await result.toPng()};
    });
};

/** SSIM of the captured png against a native screenshot, over their common crop region. */
const ssimVsNative = async (page: Page, png: string): Promise<number> => {
    const native = PNG.sync.read(await page.screenshot({fullPage: true, animations: 'disabled'}));
    const actual = pngFromDataURL(png);

    const width = Math.min(actual.width, native.width);
    const height = Math.min(actual.height, native.height);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    const {mssim} = ssim(
        asImageData(cropPng(actual, 0, 0, width, height)),
        asImageData(cropPng(native, 0, 0, width, height))
    );
    return mssim;
};

test('embedded @font-face fonts render identically to the native web fonts', async ({page}) => {
    const capture = await captureSvg(page, '/tests/reftests/text/webfont.html');
    expect(capture.kind).toBe('svg');

    // all five faces are used by the page (400/700 x latin/latin-ext + italic)
    expect(capture.markup.match(/@font-face/g) ?? []).toHaveLength(5);
    expect(capture.markup).toContain(fontFingerprint('karla-latin-400-normal.woff2'));
    expect(capture.markup).toContain(fontFingerprint('karla-latin-700-normal.woff2'));
    expect(capture.markup).toContain(fontFingerprint('karla-latin-ext-400-normal.woff2'));
    expect(capture.markup).toContain(fontFingerprint('karla-latin-ext-700-normal.woff2'));
    expect(capture.markup).toContain(fontFingerprint('karla-latin-400-italic.woff2'));

    const score = await ssimVsNative(page, capture.png);
    expect(score, `SSIM vs native screenshot ${score.toFixed(4)} below ${MIN_SSIM}`).toBeGreaterThanOrEqual(MIN_SSIM);
});

test('unicode-range pruning drops the bytes of faces no used codepoint can match', async ({page}) => {
    const capture = await captureSvg(page, '/tests/reftests/text/webfont-unicode-range.html');
    expect(capture.kind).toBe('svg');

    // the latin face is embedded with its unicode-range preserved (CSSOM may normalize
    // the notation, e.g. U+0000-00FF -> U+0-FF)...
    expect(capture.markup.match(/@font-face/g) ?? []).toHaveLength(1);
    expect(capture.markup).toMatch(/unicode-range:\s*u\+0{1,4}-0{0,2}ff/i);
    expect(capture.markup).toContain(fontFingerprint('karla-latin-400-normal.woff2'));

    // ...the greek-range face is pruned entirely: no rule, no bytes
    expect(capture.markup).not.toMatch(/u\+0?370/i);
    expect(capture.markup).not.toContain(fontFingerprint('lobster-latin-400-normal.woff2'));

    const score = await ssimVsNative(page, capture.png);
    expect(score, `SSIM vs native screenshot ${score.toFixed(4)} below ${MIN_SSIM}`).toBeGreaterThanOrEqual(MIN_SSIM);
});
