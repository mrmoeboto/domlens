import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import {createRequire} from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// Drop-in html2canvas replacement: the UMD bundle keeps the classic global name and the
// classic single-callable shape (`window.html2canvas(element, options)`), and bundles
// @domlens/core (resolved to its built esm output, so core must be built first).
const umdName = 'html2canvas';

const banner = `/*!
 * ${pkg.title} ${pkg.version} <${pkg.homepage}>
 * Drop-in html2canvas compatibility build (${pkg.name}) powered by @domlens/core
 * Copyright (c) ${new Date().getFullYear()} ${pkg.author.name} <${pkg.author.url}>
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
        // Resolve @domlens/core through node_modules (built dist) rather than the repo-wide
        // source paths mapping, so the bundle consumes the core build artifact.
        compilerOptions: {types: [], paths: {}}
    }),
    commonjs({include: 'node_modules/**'})
];

export default [
    {
        input: 'src/index.ts',
        output: [
            {file: pkg.main, name: umdName, format: 'umd', banner, sourcemap: true, exports: 'default'},
            {
                file: 'dist/html2canvas.min.js',
                name: umdName,
                format: 'umd',
                banner,
                sourcemap: true,
                exports: 'default',
                plugins: [terser({format: {comments: /^!/}})]
            },
            {file: pkg.module, format: 'esm', banner, sourcemap: true}
        ],
        watch: {
            include: 'src/**'
        },
        plugins: plugins()
    }
];
