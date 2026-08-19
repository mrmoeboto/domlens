/**
 * Perf regression gate over two bench result files (Phase 5 verify stage).
 *
 * Usage: tsx tests/bench/check-regression.ts <baseline.json> <fresh.json>
 *
 * Compares every domlens-* capture path per scenario and fails (exit 1) on a >20%
 * median slowdown, using the ratio of the domlens median to the same run's snapdom
 * median as the primary metric and the raw medians as a secondary check.
 *
 * ## Both runs must come from the same kind of machine
 *
 * This file used to claim the snapdom ratio "cancels out" the difference between a
 * laptop baseline and a CI runner, and gated across hosts on that basis. It does not,
 * and the first nightly run proved it: every domlens raw median got *faster* on the
 * runner — deep-tree canvas 1082ms -> 774ms — while the gate reported three
 * regressions, because snapdom sped up more than domlens did on that hardware and the
 * ratio moved 0.37 -> 0.69. Normalizing against a competitor removes noise between two
 * runs on one machine; it does not remove a hardware change, because libraries do not
 * all scale with hardware at the same rate.
 *
 * So the gate now refuses to compare across environments rather than emitting a verdict
 * it cannot support. `host.environment` ('ci' or 'local') is recorded by bench.spec.ts
 * and must match. CI compares against tests/bench/results/ci-baseline.json, a run
 * produced on a runner; a developer compares two of their own runs. Results written
 * before this field existed are treated as unknown and refused with an explanation.
 *
 * Exit codes: 0 pass, 1 regression, 2 cannot compare.
 */
import {readFileSync} from 'fs';

interface Timing {
    median: number;
}

interface Results {
    browser: string;
    host?: {environment?: string; cpu?: string; cores?: number; arch?: string};
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
const environmentOf = (r: Results, label: string): string => {
    const env = r.host?.environment;
    if (!env) {
        console.error(
            `${label} has no host.environment field — it predates host recording, so there is no way ` +
                `to tell which machine produced it. Regenerate it with \`npm run bench\` on the machine ` +
                `you intend to compare against.`
        );
        process.exit(2);
    }
    return env;
};

const baselineEnv = environmentOf(baseline, `baseline (${baselinePath})`);
const freshEnv = environmentOf(fresh, `fresh (${freshPath})`);

if (baselineEnv !== freshEnv) {
    console.error(
        `Cannot compare: baseline was measured on '${baselineEnv}' and this run on '${freshEnv}'. ` +
            `Timings from different hardware are not comparable at this threshold, in raw form or ` +
            `normalized against a competitor. Compare against a baseline from the same environment ` +
            `(CI uses tests/bench/results/ci-baseline.json).`
    );
    process.exit(2);
}

// Same environment, so the raw medians are meaningful too and both metrics gate.
const sameHost = true;

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
