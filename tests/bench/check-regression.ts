/**
 * Perf regression gate over two bench result files (Phase 5 verify stage).
 *
 * Usage: tsx tests/bench/check-regression.ts <baseline.json> <fresh.json>
 *
 * Compares every domlens-* capture path per scenario and fails (exit 1) on a >20%
 * median slowdown. The primary metric is the ratio of the domlens median to the same
 * run's snapdom median, not the raw milliseconds: the absolute numbers move with the
 * machine the bench happens to run on (a laptop baseline vs a CI runner, or a noisy
 * shared host), while the ratio to a fixed competitor measured in the same process a
 * few seconds apart cancels that out. A raw-median comparison is still reported for
 * context but only gates when the baseline and fresh runs came from the same browser
 * on the same host (heuristic: identical `browser` strings).
 */
import {readFileSync} from 'fs';

interface Timing {
    median: number;
}

interface Results {
    browser: string;
    scenarios: Record<string, {timings: Record<string, Timing>}>;
}

const THRESHOLD = 1.2;
const REFERENCE = 'snapdom';

const load = (path: string): Results => JSON.parse(readFileSync(path, 'utf-8')) as Results;

const [baselinePath, freshPath] = process.argv.slice(2);
if (!baselinePath || !freshPath) {
    console.error('usage: check-regression.ts <baseline.json> <fresh.json>');
    process.exit(2);
}

const baseline = load(baselinePath);
const fresh = load(freshPath);
const sameHost = baseline.browser === fresh.browser;

let failures = 0;
const rows: string[] = [];

for (const [scenario, freshData] of Object.entries(fresh.scenarios)) {
    const baseData = baseline.scenarios[scenario];
    if (!baseData) {
        rows.push(`${scenario}: new scenario, no baseline — skipped`);
        continue;
    }
    const baseRef = baseData.timings[REFERENCE]?.median;
    const freshRef = freshData.timings[REFERENCE]?.median;

    for (const [library, timing] of Object.entries(freshData.timings)) {
        if (!library.startsWith('domlens')) {
            continue;
        }
        const baseMedian = baseData.timings[library]?.median;
        if (!baseMedian) {
            rows.push(`${scenario}/${library}: no baseline entry — skipped`);
            continue;
        }

        const rawFactor = timing.median / baseMedian;
        let verdict = 'ok';
        let detail = `raw ${baseMedian}ms -> ${timing.median}ms (${rawFactor.toFixed(2)}x)`;

        if (baseRef && freshRef) {
            const baseRatio = baseMedian / baseRef;
            const freshRatio = timing.median / freshRef;
            const ratioFactor = freshRatio / baseRatio;
            detail += `, vs-${REFERENCE} ratio ${baseRatio.toFixed(2)} -> ${freshRatio.toFixed(2)} (${ratioFactor.toFixed(2)}x)`;
            if (ratioFactor > THRESHOLD) {
                verdict = 'REGRESSION';
                failures++;
            }
        } else if (sameHost && rawFactor > THRESHOLD) {
            // No reference library in one of the runs: fall back to raw medians, but only
            // when both runs came from the same browser/host.
            verdict = 'REGRESSION';
            failures++;
        }

        rows.push(`${verdict.padEnd(10)} ${scenario}/${library}: ${detail}`);
    }
}

console.log(`Perf regression gate (threshold ${THRESHOLD}x, reference: ${REFERENCE}, same host: ${sameHost})`);
for (const row of rows) {
    console.log(`  ${row}`);
}

if (failures > 0) {
    console.error(`\n${failures} regression(s) above the ${THRESHOLD}x threshold.`);
    process.exit(1);
}
console.log('\nNo regressions above threshold.');
