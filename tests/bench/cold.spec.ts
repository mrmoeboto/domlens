import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {expect, test, type Browser, type Page} from '@playwright/test';

/**
 * Cold-capture benchmark: the first screenshot, on a page that has just loaded.
 *
 * bench.spec.ts measures steady state — 3 warmups, then 15 timed captures on one page —
 * which is the right shape for something capturing repeatedly, and the wrong shape for
 * the commonest use of a DOM rasteriser: a bug-report widget, a "download as image"
 * button, an export. Those take exactly one screenshot and pay every cost once: module
 * init, the default-style probe, resource fetches, font loads, cold JIT.
 *
 * Steady state hides all of it. Everything cached across captures is free from the
 * second run onward and free forever in a median-of-15, so an optimization that only
 * helps repeat captures looks identical to one that helps everybody.
 *
 * So: a fresh browser context per sample (a new page alone keeps the HTTP and font
 * caches), one capture, no warmups. Slower to run and far noisier — cold numbers vary
 * with fetch scheduling — so it reports the median of a larger sample and prints the
 * spread. Treat differences under ~20% as noise.
 */

const ROOT = path.resolve(__dirname, '../..');
const VENDOR_DIR = path.resolve(__dirname, 'vendor');
const CORE_BUNDLE = path.resolve(ROOT, 'packages/core/dist/domlens.js');
const RESULTS_DIR = path.resolve(__dirname, 'results');
const SAMPLES = Number(process.env.COLD_SAMPLES ?? 9);

const SCENARIOS = ['simple-card', 'text-doc', 'image-heavy', 'deep-tree'] as const;
type Scenario = (typeof SCENARIOS)[number];

interface Library {
    name: string;
    bundle: 'core' | string;
    capture: string;
    result: 'capture-result' | 'canvas';
}

const LIBRARIES: Library[] = [
    {name: 'domlens-auto', bundle: 'core', capture: `domlens.capture(document.body)`, result: 'capture-result'},
    {
        name: 'domlens-svg',
        bundle: 'core',
        capture: `domlens.capture(document.body, {engine: 'svg'})`,
        result: 'capture-result'
    },
    {
        name: 'domlens-canvas',
        bundle: 'core',
        capture: `domlens.capture(document.body, {engine: 'canvas'})`,
        result: 'capture-result'
    },
    {name: 'snapdom', bundle: 'snapdom.js', capture: `snapdom.toCanvas(document.body)`, result: 'canvas'},
    {name: 'html-to-image', bundle: 'html-to-image.js', capture: `htmlToImage.toCanvas(document.body)`, result: 'canvas'},
    {
        name: 'modern-screenshot',
        bundle: 'modern-screenshot.js',
        capture: `modernScreenshot.domToCanvas(document.body)`,
        result: 'canvas'
    },
    {name: 'html2canvas-v1', bundle: 'html2canvas-v1.js', capture: `html2canvas(document.body)`, result: 'canvas'}
];

const timedCapture = (library: Library): string => `(async () => {
    const start = performance.now();
    const value = await (${library.capture});
    const canvas = ${library.result === 'capture-result' ? 'value.toCanvas()' : 'value'};
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
        throw new Error('capture did not produce a rasterized canvas');
    }
    // Same forced readback as the steady-state bench: deferred rasterization is real work
    // the user pays for, it just happens at their first pixel access instead of inside
    // capture(). Excluding it would flatter every library that defers.
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return {elapsed: performance.now() - start, width: canvas.width, height: canvas.height};
})()`;

/** One cold sample: its own context, so the HTTP/image/font caches start empty. */
const coldSample = async (browser: Browser, scenario: Scenario, library: Library, baseURL: string): Promise<number> => {
    const context = await browser.newContext({viewport: {width: 1280, height: 800}, deviceScaleFactor: 1});
    try {
        const page: Page = await context.newPage();
        await page.goto(`${baseURL}/tests/bench/pages/${scenario}.html`, {waitUntil: 'load'});
        await page.addScriptTag({path: library.bundle === 'core' ? CORE_BUNDLE : path.resolve(VENDOR_DIR, library.bundle)});
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const run = await page.evaluate<{elapsed: number; width: number; height: number}>(timedCapture(library));
        expect(run.width, `${scenario}/${library.name} output width`).toBeGreaterThan(0);
        return run.elapsed;
    } finally {
        await context.close();
    }
};

const percentile = (sorted: number[], p: number): number => {
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const round = (v: number): number => Math.round(v * 100) / 100;

test.describe.configure({mode: 'serial'});

test.describe('cold-capture benchmark', () => {
    test.skip(({browserName}) => browserName !== 'chromium', 'cross-library comparison runs on chromium only');

    const results: Record<string, Record<string, {median: number; p10: number; p90: number}>> = {};

    for (const scenario of SCENARIOS) {
        test(`cold: ${scenario}`, async ({browser, baseURL}) => {
            test.setTimeout(900_000);
            results[scenario] = {};
            for (const library of LIBRARIES) {
                const runs: number[] = [];
                for (let i = 0; i < SAMPLES; i++) {
                    runs.push(await coldSample(browser, scenario, library, baseURL ?? 'http://localhost:8080'));
                }
                const sorted = [...runs].sort((a, b) => a - b);
                results[scenario][library.name] = {
                    median: round(percentile(sorted, 0.5)),
                    p10: round(percentile(sorted, 0.1)),
                    p90: round(percentile(sorted, 0.9))
                };
            }
        });
    }

    test.afterAll(() => {
        if (Object.keys(results).length === 0) return;
        const lines = [
            '# Cold-capture benchmark (first screenshot, fresh context per sample)',
            '',
            `${new Date().toISOString()} · ${os.cpus().length}x ${os.cpus()[0]?.model ?? 'unknown'} · ` +
                `median of ${SAMPLES} cold samples (p10–p90) · treat deltas under ~20% as noise`,
            '',
            '| library | ' + SCENARIOS.join(' | ') + ' |',
            '|---|' + SCENARIOS.map(() => '---').join('|') + '|'
        ];
        for (const library of LIBRARIES) {
            const cells = SCENARIOS.map((s) => {
                const r = results[s]?.[library.name];
                return r ? `${r.median} (${r.p10}–${r.p90})` : '—';
            });
            lines.push(`| ${library.name} | ${cells.join(' | ')} |`);
        }
        const md = lines.join('\n') + '\n';
        fs.mkdirSync(RESULTS_DIR, {recursive: true});
        fs.writeFileSync(path.resolve(RESULTS_DIR, 'cold-latest.md'), md);
        fs.writeFileSync(
            path.resolve(RESULTS_DIR, 'cold-latest.json'),
            JSON.stringify(
                {
                    timestamp: new Date().toISOString(),
                    host: {environment: process.env.CI ? 'ci' : 'local', cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, arch: os.arch()},
                    samples: SAMPLES,
                    scenarios: results
                },
                null,
                2
            ) + '\n'
        );
        console.warn(`\n${md}`);
    });
});
