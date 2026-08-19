/**
 * Cross-library DOM-capture benchmark (npm run bench, playwright.bench.config.ts).
 *
 * For each scenario page under tests/bench/pages/ and each library, the harness loads the
 * page fresh in a single shared chromium instance, injects exactly one library bundle and
 * times `capture(document.body)` down to a rasterized canvas with READABLE PIXELS — the
 * timed region ends after a 1x1 getImageData, because canvases produced by drawing an
 * svg image are rasterized lazily and a timing that stops at drawImage would credit
 * libraries for work the browser merely deferred (domlens always pays it eagerly: its
 * taint probe reads the canvas back as part of capture()):
 *
 *   domlens-svg / domlens-canvas / domlens-auto  -> domlens.capture(body, {engine})
 *       (the svg engine rasterizes eagerly during render, so capture() resolves with a
 *        ready canvas — same output parity as the competitors' toCanvas paths)
 *   snapdom            -> snapdom.toCanvas(body)
 *   html-to-image      -> htmlToImage.toCanvas(body)
 *   modern-screenshot  -> modernScreenshot.domToCanvas(body)
 *   html2canvas-v1     -> html2canvas(body)
 *
 * Methodology (this machine is shared and noisy): 3 warmup captures then >= 15 timed runs
 * per cell, timed in-page with performance.now(); we report median/p10/p90 and treat
 * deltas under ~25% as noise. Warmups also put every library into its steady (resource
 * caches warm) state, which is the repeated-capture behavior users actually see.
 *
 * SVG output size: on simple-card and text-doc the harness additionally records
 * domlens capture().toSvg() byte length vs snapdom's raw svg markup byte length
 * (decoded from its data: url) — the default-style-diffing size claim.
 *
 * Results: tests/bench/results/bench-{timestamp}.json + latest.json + latest.md.
 * Competitor bundles are staged into tests/bench/vendor/ (gitignored) by build-vendor.ts.
 */
import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {buildVendor, vendorVersions} from './build-vendor';

const ROOT = path.resolve(__dirname, '../..');
const VENDOR_DIR = path.resolve(__dirname, 'vendor');
const RESULTS_DIR = path.resolve(__dirname, 'results');
const CORE_BUNDLE = path.resolve(ROOT, 'packages/core/dist/domlens.js');

const WARMUP_RUNS = 3;
const TIMED_RUNS = 15;

const SCENARIOS = ['simple-card', 'text-doc', 'image-heavy', 'deep-tree'] as const;
type Scenario = (typeof SCENARIOS)[number];

/** Scenarios where svg markup byte size is also recorded (domlens vs snapdom). */
const SVG_SIZE_SCENARIOS: Scenario[] = ['simple-card', 'text-doc'];

interface Library {
    name: string;
    /** Bundle injected into the page ('core' = packages/core/dist/domlens.js). */
    bundle: 'core' | string;
    /** In-page expression resolving to the library's capture promise for document.body. */
    capture: string;
    /** How to reach the output canvas from the awaited capture value. */
    result: 'capture-result' | 'canvas';
}

const LIBRARIES: Library[] = [
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
    {name: 'domlens-auto', bundle: 'core', capture: `domlens.capture(document.body)`, result: 'capture-result'},
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

interface CellStats {
    median: number;
    p10: number;
    p90: number;
    runs: number[];
    output: {width: number; height: number};
}

interface ScenarioResult {
    nodeCount: number;
    timings: Record<string, CellStats>;
    svgBytes?: Record<string, number>;
}

const results: Partial<Record<Scenario, ScenarioResult>> = {};
let browserVersion = '';

const percentile = (sorted: number[], p: number): number => {
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const round = (value: number): number => Math.round(value * 100) / 100;

const loadScenario = async (page: Page, scenario: Scenario, bundle: Library['bundle']): Promise<number> => {
    await page.goto(`/tests/bench/pages/${scenario}.html`, {waitUntil: 'load'});
    await page.addScriptTag({path: bundle === 'core' ? CORE_BUNDLE : path.resolve(VENDOR_DIR, bundle)});
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return page.evaluate(() => document.querySelectorAll('*').length);
};

const timedCapture = (library: Library): string => `(async () => {
    const start = performance.now();
    const value = await (${library.capture});
    const canvas = ${library.result === 'capture-result' ? 'value.toCanvas()' : 'value'};
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
        throw new Error('capture did not produce a rasterized canvas');
    }
    // Force the pixels: a canvas that came back from drawImage(svg) may not have been
    // rasterized yet — browsers defer that work until the first readback/use. Without
    // this, libraries that skip a taint probe report times that exclude the actual
    // raster cost (it would silently hit the user's first toDataURL/getImageData).
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    const elapsed = performance.now() - start;
    return {elapsed, width: canvas.width, height: canvas.height};
})()`;

const benchLibrary = async (
    page: Page,
    scenario: Scenario,
    library: Library
): Promise<{stats: CellStats; nodeCount: number}> => {
    const nodeCount = await loadScenario(page, scenario, library.bundle);

    let output: {width: number; height: number} = {width: 0, height: 0};
    for (let i = 0; i < WARMUP_RUNS; i++) {
        output = await page.evaluate<{elapsed: number; width: number; height: number}>(timedCapture(library));
    }

    const runs: number[] = [];
    for (let i = 0; i < TIMED_RUNS; i++) {
        const run = await page.evaluate<{elapsed: number; width: number; height: number}>(timedCapture(library));
        expect(run.width, `${scenario}/${library.name} output width`).toBeGreaterThan(0);
        runs.push(run.elapsed);
        output = run;
    }

    const sorted = [...runs].sort((a, b) => a - b);
    return {
        nodeCount,
        stats: {
            median: round(percentile(sorted, 0.5)),
            p10: round(percentile(sorted, 0.1)),
            p90: round(percentile(sorted, 0.9)),
            runs: runs.map(round),
            output: {width: output.width, height: output.height}
        }
    };
};

const measureSvgBytes = async (page: Page, scenario: Scenario): Promise<Record<string, number>> => {
    await loadScenario(page, scenario, 'core');
    const domlensBytes = await page.evaluate(`(async () => {
        const result = await domlens.capture(document.body, {engine: 'svg'});
        return new TextEncoder().encode(result.toSvg()).length;
    })()`);

    await loadScenario(page, scenario, 'snapdom.js');
    const snapdomBytes = await page.evaluate(`(async () => {
        const url = await snapdom.toRaw(document.body);
        const markup = decodeURIComponent(url.slice(url.indexOf(',') + 1));
        return new TextEncoder().encode(markup).length;
    })()`);

    return {domlens: domlensBytes as number, snapdom: snapdomBytes as number};
};

test.describe.configure({mode: 'serial'});

test.describe('cross-library benchmark', () => {
    test.skip(({browserName}) => browserName !== 'chromium', 'cross-library comparison runs on chromium only');

    for (const scenario of SCENARIOS) {
        test(`scenario: ${scenario}`, async ({page, browser}) => {
            browserVersion = browser.version();
            const scenarioResult: ScenarioResult = {nodeCount: 0, timings: {}};
            results[scenario] = scenarioResult;

            for (const library of LIBRARIES) {
                const {stats, nodeCount} = await benchLibrary(page, scenario, library);
                scenarioResult.nodeCount = nodeCount;
                scenarioResult.timings[library.name] = stats;
            }

            if (SVG_SIZE_SCENARIOS.includes(scenario)) {
                scenarioResult.svgBytes = await measureSvgBytes(page, scenario);
            }
        });
    }

    test.afterAll(() => {
        const completed = SCENARIOS.filter((scenario) => results[scenario]);
        if (completed.length === 0) {
            return;
        }

        const corePkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'packages/core/package.json'), 'utf-8'));
        const report = {
            timestamp: new Date().toISOString(),
            browser: `chromium ${browserVersion}`,
            // Which machine produced these numbers, because the regression gate cannot compare
            // two runs from different hardware and has no other way to tell. `environment` is
            // what it keys on: a developer's desktop and a CI runner are not comparable at a
            // 20% threshold even after normalizing against a competitor, since libraries do not
            // all scale with hardware at the same rate. The cpu fields are for reading a
            // surprising result afterwards, not for gating — CI runners vary between runs.
            host: {
                environment: process.env.CI ? 'ci' : 'local',
                cpu: os.cpus()[0]?.model ?? 'unknown',
                cores: os.cpus().length,
                arch: os.arch()
            },
            viewport: '1280x800 @1x',
            methodology: {
                warmupRuns: WARMUP_RUNS,
                timedRuns: TIMED_RUNS,
                statistic:
                    'median (p10/p90 spread) of in-page performance.now() around capture-to-readable-canvas ' +
                    '(timed region includes a 1x1 getImageData readback that realizes deferred svg rasterization)',
                note: 'shared machine; deltas under ~25% should be treated as noise'
            },
            libraries: {[`${corePkg.name} (domlens)`]: corePkg.version as string, ...vendorVersions()},
            scenarios: results
        };

        fs.mkdirSync(RESULTS_DIR, {recursive: true});
        const stamp = report.timestamp.replace(/[:.]/g, '-');
        const json = JSON.stringify(report, null, 2) + '\n';
        fs.writeFileSync(path.resolve(RESULTS_DIR, `bench-${stamp}.json`), json);
        fs.writeFileSync(path.resolve(RESULTS_DIR, 'latest.json'), json);
        fs.writeFileSync(path.resolve(RESULTS_DIR, 'latest.md'), renderMarkdown(report));
        console.warn(`\n${renderMarkdown(report)}`);
    });
});

interface Report {
    timestamp: string;
    browser: string;
    host: {environment: string; cpu: string; cores: number; arch: string};
    viewport: string;
    methodology: {warmupRuns: number; timedRuns: number; statistic: string; note: string};
    libraries: Record<string, string>;
    scenarios: Partial<Record<Scenario, ScenarioResult>>;
}

const renderMarkdown = (report: Report): string => {
    const lines: string[] = [];
    lines.push('# DOM-capture benchmark');
    lines.push('');
    lines.push(
        `${report.timestamp} · ${report.browser} · ${report.host.environment} (${report.host.cores}x ${report.host.cpu}) · ${report.viewport} · ` +
            `median of ${report.methodology.timedRuns} runs after ${report.methodology.warmupRuns} warmups ` +
            `(p10–p90 spread) · ${report.methodology.note}`
    );
    lines.push('');
    lines.push('Libraries: ' + Object.entries(report.libraries).map(([name, v]) => `${name}@${v}`).join(', '));
    lines.push('');

    lines.push('## Capture to canvas, median ms (p10–p90)');
    lines.push('');
    const scenarios = SCENARIOS.filter((scenario) => report.scenarios[scenario]);
    lines.push('| library | ' + scenarios.join(' | ') + ' |');
    lines.push('|---|' + scenarios.map(() => '---|').join(''));
    for (const library of LIBRARIES) {
        const cells = scenarios.map((scenario) => {
            const stats = report.scenarios[scenario]?.timings[library.name];
            return stats ? `${stats.median} (${stats.p10}–${stats.p90})` : 'n/a';
        });
        lines.push(`| ${library.name} | ${cells.join(' | ')} |`);
    }
    lines.push('');

    const sized = scenarios.filter((scenario) => report.scenarios[scenario]?.svgBytes);
    if (sized.length > 0) {
        lines.push('## SVG output size, bytes (domlens default-style diffing vs snapdom)');
        lines.push('');
        lines.push('| scenario | domlens toSvg() | snapdom raw svg | domlens/snapdom |');
        lines.push('|---|---|---|---|');
        for (const scenario of sized) {
            const bytes = report.scenarios[scenario]?.svgBytes as Record<string, number>;
            const ratio = (bytes.domlens / bytes.snapdom).toFixed(2);
            lines.push(`| ${scenario} | ${bytes.domlens.toLocaleString('en-US')} | ${bytes.snapdom.toLocaleString('en-US')} | ${ratio}x |`);
        }
        lines.push('');
    }

    lines.push('Scenario node counts: ' + scenarios.map((s) => `${s}=${report.scenarios[s]?.nodeCount}`).join(', '));
    lines.push('');
    return lines.join('\n');
};

// Stage competitor bundles before any scenario runs (cheap, idempotent).
test.beforeAll(() => {
    buildVendor();
});
