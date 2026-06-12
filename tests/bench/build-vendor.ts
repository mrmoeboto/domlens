/**
 * Stages the competitor libraries' browser bundles into tests/bench/vendor/ (gitignored,
 * rebuilt on demand by `npm run bench`).
 *
 * Every benchmarked competitor already ships a self-contained UMD/IIFE browser bundle, so
 * "bundling" is a verified copy — the simplest reliable injection mechanism (no esbuild
 * pass that could change the code being measured). Each copy is checked for the global
 * the bench harness calls.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const VENDOR_DIR = path.resolve(__dirname, 'vendor');

interface VendorBundle {
    /** vendor/ file name (also the script the bench page injects). */
    file: string;
    /** Prebuilt browser bundle inside node_modules. */
    source: string;
    /** window.* global the bundle must define (sanity-checked against the bundle text). */
    global: string;
}

export const VENDOR_BUNDLES: VendorBundle[] = [
    {file: 'snapdom.js', source: '@zumer/snapdom/dist/snapdom.js', global: 'snapdom'},
    {file: 'html-to-image.js', source: 'html-to-image/dist/html-to-image.js', global: 'htmlToImage'},
    {file: 'modern-screenshot.js', source: 'modern-screenshot/dist/index.js', global: 'modernScreenshot'},
    {file: 'html2canvas-v1.js', source: 'html2canvas-v1/dist/html2canvas.js', global: 'html2canvas'}
];

/** Bundles built from this repo (must exist before the bench runs). */
export const LOCAL_BUNDLES = [path.resolve(ROOT, 'packages/core/dist/domlens.js')];

export const vendorVersions = (): Record<string, string> =>
    Object.fromEntries(
        VENDOR_BUNDLES.map(({source}) => {
            const name = source.split('/dist/')[0];
            const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'node_modules', name, 'package.json'), 'utf-8'));
            return [name, pkg.version as string];
        })
    );

export const buildVendor = (): void => {
    for (const local of LOCAL_BUNDLES) {
        if (!fs.existsSync(local)) {
            throw new Error(`Missing ${path.relative(ROOT, local)} — run \`npm run build\` first.`);
        }
    }

    fs.mkdirSync(VENDOR_DIR, {recursive: true});
    for (const {file, source, global} of VENDOR_BUNDLES) {
        const sourcePath = path.resolve(ROOT, 'node_modules', source);
        const code = fs.readFileSync(sourcePath, 'utf-8');
        if (!code.includes(global)) {
            throw new Error(`${source} does not look like a browser bundle exposing "${global}"`);
        }
        fs.writeFileSync(path.resolve(VENDOR_DIR, file), code);
    }
    console.warn(`Staged ${VENDOR_BUNDLES.length} competitor bundles into ${path.relative(ROOT, VENDOR_DIR)}/`);
};

if (require.main === module) {
    buildVendor();
}
