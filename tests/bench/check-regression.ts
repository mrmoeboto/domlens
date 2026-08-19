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
/** Used when the two runs came from different CPUs; see the note by `sameCpu` below. */
const LOOSE_THRESHOLD = 2.0;
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

// Same CPU or not decides how much this comparison can be asked to prove.
//
// GitHub's hosted runners are heterogeneous: consecutive nightly runs landed on a 4-core
// Intel Xeon 8370C and a 4-core AMD EPYC 7763. Between those two the raw domlens medians
// moved 1.07-1.09x — noise — while the snapdom-normalized ratio moved up to 1.29x, because
// snapdom and domlens do not scale across silicon at the same rate. Normalizing against a
// competitor removes noise between two runs on one machine and does not remove a change of
// machine, which is the same lesson twice: first for desktop-vs-runner, then for
// Intel-vs-AMD inside one "environment".
//
// So a 20% gate is only meaningful on identical hardware. Anywhere else it reports
// regressions that are not there, and a gate that cries wolf is worse than no gate: it
// trains people to ignore a red nightly. On differing CPUs the threshold widens to a bound
// that hardware alone has not been observed to cross, which still catches the thing this
// job exists for — a change that makes domlens dramatically slower.
const sameCpu = (baseline.host?.cpu ?? 'a') === (fresh.host?.cpu ?? 'b');
const threshold = sameCpu ? THRESHOLD : LOOSE_THRESHOLD;
// Raw medians only mean something on identical hardware; elsewhere only the ratio gates.
const sameHost = sameCpu;

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
            if (ratioFactor > threshold) {
                verdict = 'REGRESSION';
                failures++;
            }
        } else if (sameHost && rawFactor > threshold) {
            // No reference library in one of the runs: fall back to raw medians, but only
            // when both runs came from the same browser/host.
            verdict = 'REGRESSION';
            failures++;
        }

        rows.push(`${verdict.padEnd(10)} ${scenario}/${library}: ${detail}`);
    }
}

console.log(
    `Perf regression gate (threshold ${threshold}x, reference: ${REFERENCE}, ` +
        `cpu: ${sameCpu ? 'identical' : 'DIFFERENT'})`
);
if (!sameCpu) {
    console.log(
        `  baseline cpu: ${baseline.host?.cpu ?? 'unknown'}\n` +
            `  this run:     ${fresh.host?.cpu ?? 'unknown'}\n` +
            `  Different silicon, so the threshold is widened to ${LOOSE_THRESHOLD}x and raw medians` +
            ` are reported but not gated. A regression under ${LOOSE_THRESHOLD}x cannot be told from` +
            ` the hardware here — re-run on matching hardware to gate it at ${THRESHOLD}x.`
    );
}
for (const row of rows) {
    console.log(`  ${row}`);
}

if (failures > 0) {
    console.error(`\n${failures} regression(s) above the ${threshold}x threshold.`);
    process.exit(1);
}
console.log('\nNo regressions above threshold.');
