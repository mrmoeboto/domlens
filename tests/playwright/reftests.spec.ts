/**
 * Reftest runner (replaces the old karma/mocha harness, see git history:
 * tests/testrunner.ts + tests/karma.ts).
 *
 * For every HTML page under tests/reftests it:
 *  1. loads the page from the local test server (tests/server.ts, started by playwright.config.ts),
 *  2. injects packages/core/dist/html2canvas.js,
 *  3. renders `window.forceElement || document.documentElement` with the same default
 *     options the old runner used (white background, proxy on the CORS server),
 *  4. verifies the resulting canvas is not tainted,
 *  5. compares the canvas PNG against a committed per-browser baseline with pixelmatch.
 *
 * Run with UPDATE_BASELINES=1 to (re)generate baselines instead of comparing.
 */
import {test, expect} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {SKIPPED_REFTESTS, BrowserName} from './skip';

const REFTESTS_DIR = path.resolve(__dirname, '../reftests');
const BASELINES_DIR = path.resolve(__dirname, 'baselines');
const PROXY_URL = 'http://localhost:8081/proxy';
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';

// Pixelmatch per-pixel color threshold (0..1); tolerant of minor antialiasing changes.
const PIXELMATCH_THRESHOLD = 0.1;
// Maximum fraction of pixels that may differ before the test fails.
const MAX_DIFF_PIXEL_RATIO = 0.005;

// ignore.txt semantics (from the old scripts/create-reftest-list.ts): one test per line,
// either "<path>" (ignored everywhere) or "[Browser1,Browser2]<path>" (ignored in the
// listed browsers only). Paths are absolute URL paths like /tests/reftests/foo.html and
// browser names are platform.js names (Chrome, Firefox, Safari, ...).
const IGNORE_TXT_BROWSER_NAMES: Record<BrowserName, string> = {
    chromium: 'Chrome',
    firefox: 'Firefox',
    webkit: 'Safari'
};

const parseIgnoreList = (file: string): Record<string, string[]> => {
    if (!fs.existsSync(file)) {
        return {};
    }

    return fs
        .readFileSync(file, 'utf-8')
        .split(/\r\n|\r|\n/)
        .filter((line) => line.length)
        .reduce((acc: Record<string, string[]>, line) => {
            const m = line.match(/^(\[(.+)\])?(.+)$/i);
            if (m) {
                acc[m[3]] = m[2] ? m[2].split(',') : [];
            }
            return acc;
        }, {});
};

const ignoredTests = parseIgnoreList(path.join(REFTESTS_DIR, 'ignore.txt'));

const reftests = (fs.readdirSync(REFTESTS_DIR, {recursive: true}) as string[])
    .filter((file) => file.endsWith('.html'))
    .map((file) => file.split(path.sep).join('/'))
    .sort();

const isIgnored = (urlPath: string, browserName: string): boolean => {
    const browsers = ignoredTests[urlPath];
    if (!Array.isArray(browsers)) {
        return false;
    }

    return browsers.length === 0 || browsers.indexOf(IGNORE_TXT_BROWSER_NAMES[browserName as BrowserName]) !== -1;
};

const skipReason = (relPath: string, browserName: string): string | null => {
    const entry = SKIPPED_REFTESTS[relPath];
    if (entry && (!entry.browsers || entry.browsers.indexOf(browserName as BrowserName) !== -1)) {
        return entry.reason;
    }
    return null;
};

const pngFromDataURL = (dataUrl: string): PNG => {
    const prefix = 'data:image/png;base64,';
    if (!dataUrl.startsWith(prefix)) {
        throw new Error(`Expected a PNG data url, got "${dataUrl.slice(0, 40)}..."`);
    }
    return PNG.sync.read(Buffer.from(dataUrl.slice(prefix.length), 'base64'));
};

for (const relPath of reftests) {
    const urlPath = `/tests/reftests/${relPath}`;

    test(relPath, async ({page, browserName}, testInfo) => {
        test.skip(isIgnored(urlPath, browserName), 'Listed in tests/reftests/ignore.txt');
        const reason = skipReason(relPath, browserName);
        test.skip(reason !== null, reason ?? undefined);

        await page.goto(`${urlPath}?selenium&run=false&reftest`);
        // Inject by path (not URL): some pages set <base href> to another origin,
        // which would break relative script URL resolution.
        await page.addScriptTag({path: path.resolve(__dirname, '../../packages/core/dist/html2canvas.js')});
        // Make rendering deterministic: wait for web fonts before capturing.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        const dataUrl = await page.evaluate(async (proxy: string) => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const win = window as any;
            const element: HTMLElement = win.forceElement || document.documentElement;
            const canvas: HTMLCanvasElement = await win.html2canvas(element, {
                removeContainer: true,
                backgroundColor: '#ffffff',
                proxy,
                ...(win.h2cOptions || {})
            });
            /* eslint-enable @typescript-eslint/no-explicit-any */

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Unable to get 2d context from rendered canvas');
            }

            try {
                ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch (e) {
                throw new Error('Canvas is tainted');
            }

            return canvas.toDataURL('image/png');
        }, PROXY_URL);

        const actual = pngFromDataURL(dataUrl);
        const baselinePath = path.join(BASELINES_DIR, browserName, relPath.replace(/\.html$/, '.png'));

        if (UPDATE_BASELINES) {
            fs.mkdirSync(path.dirname(baselinePath), {recursive: true});
            fs.writeFileSync(baselinePath, PNG.sync.write(actual));
            return;
        }

        const attachActual = async () => {
            const actualPath = testInfo.outputPath('actual.png');
            fs.mkdirSync(path.dirname(actualPath), {recursive: true});
            fs.writeFileSync(actualPath, PNG.sync.write(actual));
            await testInfo.attach('actual', {path: actualPath, contentType: 'image/png'});
        };

        if (!fs.existsSync(baselinePath)) {
            await attachActual();
            throw new Error(`Missing baseline ${baselinePath}. Run with UPDATE_BASELINES=1 to create it.`);
        }

        const expected = PNG.sync.read(fs.readFileSync(baselinePath));
        await testInfo.attach('expected', {path: baselinePath, contentType: 'image/png'});

        if (expected.width !== actual.width || expected.height !== actual.height) {
            await attachActual();
            throw new Error(
                `Size mismatch: baseline is ${expected.width}x${expected.height}, ` +
                    `actual is ${actual.width}x${actual.height}`
            );
        }

        const {width, height} = expected;
        const diff = new PNG({width, height});
        const diffPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, {
            threshold: PIXELMATCH_THRESHOLD
        });
        const diffRatio = diffPixels / (width * height);

        if (diffRatio > MAX_DIFF_PIXEL_RATIO) {
            await attachActual();
            const diffPath = testInfo.outputPath('diff.png');
            fs.writeFileSync(diffPath, PNG.sync.write(diff));
            await testInfo.attach('diff', {path: diffPath, contentType: 'image/png'});
        }

        expect(
            diffRatio,
            `${diffPixels} of ${width * height} pixels differ (${(diffRatio * 100).toFixed(3)}%, ` +
                `allowed ${MAX_DIFF_PIXEL_RATIO * 100}%)`
        ).toBeLessThanOrEqual(MAX_DIFF_PIXEL_RATIO);
    });
}
