/**
 * Reftest runner (replaces the old karma/mocha harness, see git history:
 * tests/testrunner.ts + tests/karma.ts).
 *
 * For every HTML page under tests/reftests it:
 *  1. loads the page from the local test server (tests/server.ts, started by playwright.config.ts),
 *  2. injects packages/html2canvas-compat/dist/html2canvas.js (the drop-in compat bundle
 *     this suite certifies),
 *  3. renders `window.forceElement || document.documentElement` with the same default
 *     options the old runner used (white background, proxy on the CORS server),
 *  4. verifies the resulting canvas is not tainted,
 *  5. compares the canvas PNG against a committed per-browser baseline with pixelmatch.
 *
 * Run with UPDATE_BASELINES=1 to (re)generate baselines instead of comparing.
 *
 * SSIM scorecard mode (ENGINE=svg or ENGINE=canvas): instead of the baseline comparison,
 * a single sequential test injects the core UMD bundle (packages/core/dist/domlens.js),
 * captures every non-skipped reftest page with `domlens.capture(target, {engine, ...})`
 * and scores the result against a NATIVE Playwright screenshot of the live page (same
 * element bounds, scale 1 = the configured deviceScaleFactor) using SSIM. Results land in
 * tests/playwright/reports/{engine}-scorecard-{browser}.json. A capture that throws (or
 * falls back to another engine) scores 0 with the error recorded. The canvas scorecard is
 * the absolute-fidelity bar the svg engine had to beat before 'auto' flipped to svg-first.
 *
 * SVG baseline regression dimension (deterministic, on top of the trend scorecard):
 *  - UPDATE_SVG_BASELINES=1 (re)generates tests/playwright/baselines-svg/{browser}/ PNGs
 *    for every reftest whose svg capture currently scores SSIM >= 0.90, and writes a
 *    manifest (baselines-svg/{browser}/manifest.json) listing exactly those tests.
 *  - normal ENGINE=svg runs compare the manifest tests against the committed svg
 *    baselines with pixelmatch (a regression fails the run) AND still emit the full ssim
 *    scorecard, which keeps scoring the tests not yet good enough for a baseline.
 */
import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {ssim} from 'ssim.js';
import {SKIPPED_REFTESTS, BrowserName} from './skip';

const REFTESTS_DIR = path.resolve(__dirname, '../reftests');
const BASELINES_DIR = path.resolve(__dirname, 'baselines');
const SVG_BASELINES_DIR = path.resolve(__dirname, 'baselines-svg');
const REPORTS_DIR = path.resolve(__dirname, 'reports');
const CORE_BUNDLE = path.resolve(__dirname, '../../packages/core/dist/domlens.js');
const PROXY_URL = 'http://localhost:8081/proxy';
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';
const UPDATE_SVG_BASELINES = process.env.UPDATE_SVG_BASELINES === '1';
const SCORECARD_ENGINE = UPDATE_SVG_BASELINES
    ? 'svg'
    : process.env.ENGINE === 'svg' || process.env.ENGINE === 'canvas'
      ? process.env.ENGINE
      : null;

// Pixelmatch per-pixel color threshold (0..1); tolerant of minor antialiasing changes.
const PIXELMATCH_THRESHOLD = 0.1;
// Maximum fraction of pixels that may differ before the test fails.
const MAX_DIFF_PIXEL_RATIO = 0.005;
// Only reftests at or above this SSIM score get a committed svg baseline.
const SVG_BASELINE_SSIM_THRESHOLD = 0.9;

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

interface ScorecardEntry {
    path: string;
    /** Mean SSIM vs the native screenshot in [0, 1]; 0 when the capture failed. */
    ssim: number;
    error?: string;
}

interface Scorecard {
    engine: string;
    browser: string;
    summary: {
        /** Non-skipped reftest pages scored. */
        total: number;
        /** Pages where the engine produced an image (no error). */
        captured: number;
        /** Percent of non-skipped pages with ssim >= 0.90. */
        pct90: number;
    };
    tests: ScorecardEntry[];
}

/** baselines-svg/{browser}/manifest.json: which reftests have a committed svg baseline. */
interface SvgBaselineManifest {
    engine: 'svg';
    browser: string;
    /** SSIM bar a test had to clear (against the native screenshot) to be baselined. */
    ssimThreshold: number;
    /** Reftest paths (relative to tests/reftests) with a committed baseline PNG. */
    tests: string[];
}

const svgManifestPath = (browser: string): string => path.join(SVG_BASELINES_DIR, browser, 'manifest.json');

const readSvgManifest = (browser: string): SvgBaselineManifest | null => {
    const file = svgManifestPath(browser);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as SvgBaselineManifest) : null;
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

/**
 * Captures one reftest page with the requested engine and returns the captured PNG plus
 * its SSIM score against a native screenshot of the live page, cropped to the captured
 * element's bounds.
 */
const scorePage = async (page: Page, urlPath: string, engine: string): Promise<{ssim: number; actual: PNG}> => {
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

    // The browser's own rendering is the fidelity reference. deviceScaleFactor is 1 and the
    // capture runs with output.scale 1, so both images are at 1 device pixel per CSS pixel.
    const native = PNG.sync.read(await page.screenshot({fullPage: true, animations: 'disabled'}));

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
    const actual = pngFromDataURL(dataUrl);

    // Crop both images to their common region (engine output and native screenshot can
    // disagree by a ceil()'ed pixel or where the element extends past the document edge).
    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    const width = Math.min(actual.width, native.width - x);
    const height = Math.min(actual.height, native.height - y);
    if (width <= 0 || height <= 0) {
        throw new Error(
            `capture (${actual.width}x${actual.height}) does not overlap the native screenshot ` +
                `(${native.width}x${native.height} at ${x},${y})`
        );
    }

    const {mssim} = ssim(
        asImageData(cropPng(actual, 0, 0, width, height)),
        asImageData(cropPng(native, x, y, width, height))
    );
    return {ssim: mssim, actual};
};

if (SCORECARD_ENGINE) {
    const engine = SCORECARD_ENGINE;

    test(`ssim scorecard (${engine} engine)`, async ({page, browserName}, testInfo) => {
        // Sequential over ~95 pages; well above the default per-test timeout.
        test.setTimeout(30 * 60_000);

        // svg baseline regression dimension (see file header).
        const svgBaselines = engine === 'svg';
        const manifest = svgBaselines && !UPDATE_SVG_BASELINES ? readSvgManifest(browserName) : null;
        const baselined = new Set(manifest?.tests ?? []);
        const baselineFailures: string[] = [];
        const updatedBaselines: string[] = [];
        if (UPDATE_SVG_BASELINES) {
            // Regenerate from scratch so removed/regressed tests do not leave stale PNGs.
            fs.rmSync(path.join(SVG_BASELINES_DIR, browserName), {recursive: true, force: true});
        }

        const compareWithBaseline = async (relPath: string, actual: PNG): Promise<void> => {
            const baselinePath = path.join(SVG_BASELINES_DIR, browserName, relPath.replace(/\.html$/, '.png'));
            if (!fs.existsSync(baselinePath)) {
                baselineFailures.push(`${relPath}: missing baseline ${baselinePath} (listed in the manifest)`);
                return;
            }

            const expected = PNG.sync.read(fs.readFileSync(baselinePath));
            if (expected.width !== actual.width || expected.height !== actual.height) {
                baselineFailures.push(
                    `${relPath}: size mismatch (baseline ${expected.width}x${expected.height}, ` +
                        `actual ${actual.width}x${actual.height})`
                );
                return;
            }

            const {width, height} = expected;
            const diff = new PNG({width, height});
            const diffPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, {
                threshold: PIXELMATCH_THRESHOLD
            });
            const diffRatio = diffPixels / (width * height);
            if (diffRatio > MAX_DIFF_PIXEL_RATIO) {
                const slug = relPath.replace(/[/.]/g, '-');
                const actualPath = testInfo.outputPath(`${slug}-actual.png`);
                const diffPath = testInfo.outputPath(`${slug}-diff.png`);
                fs.mkdirSync(path.dirname(actualPath), {recursive: true});
                fs.writeFileSync(actualPath, PNG.sync.write(actual));
                fs.writeFileSync(diffPath, PNG.sync.write(diff));
                await testInfo.attach(`${slug}-actual`, {path: actualPath, contentType: 'image/png'});
                await testInfo.attach(`${slug}-diff`, {path: diffPath, contentType: 'image/png'});
                baselineFailures.push(
                    `${relPath}: ${diffPixels} of ${width * height} pixels differ ` +
                        `(${(diffRatio * 100).toFixed(3)}%, allowed ${MAX_DIFF_PIXEL_RATIO * 100}%)`
                );
            }
        };

        const entries: ScorecardEntry[] = [];
        for (const relPath of reftests) {
            const urlPath = `/tests/reftests/${relPath}`;
            if (isIgnored(urlPath, browserName) || skipReason(relPath, browserName) !== null) {
                continue;
            }

            const entry: ScorecardEntry = {path: relPath, ssim: 0};
            try {
                const {ssim: score, actual} = await scorePage(page, urlPath, engine);
                entry.ssim = score;

                if (UPDATE_SVG_BASELINES && score >= SVG_BASELINE_SSIM_THRESHOLD) {
                    const baselinePath = path.join(
                        SVG_BASELINES_DIR,
                        browserName,
                        relPath.replace(/\.html$/, '.png')
                    );
                    fs.mkdirSync(path.dirname(baselinePath), {recursive: true});
                    fs.writeFileSync(baselinePath, PNG.sync.write(actual));
                    updatedBaselines.push(relPath);
                } else if (baselined.has(relPath)) {
                    await compareWithBaseline(relPath, actual);
                }
            } catch (e) {
                entry.error = e instanceof Error ? e.message : String(e);
                if (baselined.has(relPath)) {
                    baselineFailures.push(`${relPath}: capture failed (${entry.error})`);
                }
            }
            entries.push(entry);
            // eslint-disable-next-line no-console
            console.log(`[scorecard:${engine}:${browserName}] ${relPath} ${entry.error ?? entry.ssim.toFixed(4)}`);
        }

        const captured = entries.filter((entry) => !entry.error).length;
        const above90 = entries.filter((entry) => entry.ssim >= 0.9).length;
        const scorecard: Scorecard = {
            engine,
            browser: browserName,
            summary: {
                total: entries.length,
                captured,
                pct90: Math.round((above90 / entries.length) * 1000) / 10
            },
            tests: entries
        };

        fs.mkdirSync(REPORTS_DIR, {recursive: true});
        const reportPath = path.join(REPORTS_DIR, `${engine}-scorecard-${browserName}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(scorecard, null, 2) + '\n');

        if (UPDATE_SVG_BASELINES) {
            const newManifest: SvgBaselineManifest = {
                engine: 'svg',
                browser: browserName,
                ssimThreshold: SVG_BASELINE_SSIM_THRESHOLD,
                tests: updatedBaselines
            };
            fs.mkdirSync(path.dirname(svgManifestPath(browserName)), {recursive: true});
            fs.writeFileSync(svgManifestPath(browserName), JSON.stringify(newManifest, null, 2) + '\n');
        } else if (manifest) {
            expect(baselineFailures, `svg baseline regressions:\n${baselineFailures.join('\n')}`).toEqual([]);
        } else if (svgBaselines) {
            throw new Error(
                `Missing svg baseline manifest ${svgManifestPath(browserName)}. ` +
                    `Run with UPDATE_SVG_BASELINES=1 to create it.`
            );
        }

        expect(entries.length).toBeGreaterThan(0);
    });
}

for (const relPath of SCORECARD_ENGINE ? [] : reftests) {
    const urlPath = `/tests/reftests/${relPath}`;

    test(relPath, async ({page, browserName}, testInfo) => {
        test.skip(isIgnored(urlPath, browserName), 'Listed in tests/reftests/ignore.txt');
        const reason = skipReason(relPath, browserName);
        test.skip(reason !== null, reason ?? undefined);

        await page.goto(`${urlPath}?selenium&run=false&reftest`);
        // Inject by path (not URL): some pages set <base href> to another origin,
        // which would break relative script URL resolution.
        await page.addScriptTag({
            path: path.resolve(__dirname, '../../packages/html2canvas-compat/dist/html2canvas.js')
        });
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
