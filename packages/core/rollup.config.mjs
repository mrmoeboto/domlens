import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import {createRequire} from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// The classic html2canvas global/bundle now ships from packages/html2canvas-compat;
// the core UMD bundle exposes the new API as a namespace: `window.domlens.capture(element)`.
const umdName = 'domlens';


// The upstream copyright line is not decoration and must not be dropped. domlens is a fork
// of html2canvas, whose MIT licence requires its copyright and permission notice to travel
// with "all copies or substantial portions of the Software" — and a minified bundle pasted
// into someone's app is exactly that. terser is configured to keep `/*!` comments, so this
// banner is the only thing carrying the notice into dist/*.min.js and into every downstream
// vendored copy. See LICENSE for the full text of both grants.
const banner = `/*!
 * ${pkg.title} ${pkg.version} <${pkg.homepage}>
 * Copyright (c) ${new Date().getFullYear()} ${pkg.author.name} <${pkg.author.url}>
 * Includes code from html2canvas <https://github.com/niklasvh/html2canvas>,
 * Copyright (c) 2012 Niklas von Hertzen. Released under MIT License.
 * Released under ${pkg.license} License
 */`;

const plugins = () => [
    resolve(),
    json(),
    typescript({
        sourceMap: true,
        inlineSources: true,
        noEmit: false,
        outputToFilesystem: false,
        exclude: ['src/**/__tests__/**', 'src/**/__mocks__/**'],
        compilerOptions: {types: []}
    }),
    commonjs({include: 'node_modules/**'})
];

export default [
    {
        input: 'src/index.ts',
        output: [
            {file: pkg.main, name: umdName, format: 'umd', banner, sourcemap: true, exports: 'named'},
            {
                file: 'dist/domlens.min.js',
                name: umdName,
                format: 'umd',
                banner,
                sourcemap: true,
                exports: 'named',
                plugins: [terser({format: {comments: /^!/}})]
            }
        ],
        plugins: plugins()
    },
    {
        input: 'src/index.ts',
        output: [{file: pkg.module, format: 'esm', banner, sourcemap: true}],
        watch: {
            include: 'src/**'
        },
        plugins: plugins()
    }
];
