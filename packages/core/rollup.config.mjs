import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import {createRequire} from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// The package is named @domlens/core, but the UMD bundle keeps the classic
// html2canvas global (and output file name) until the new API lands in a later phase.
// src/umd.ts has a single default export so the global stays directly callable
// (`window.html2canvas(element)`); the new API rides along as `window.html2canvas.capture`.
const umdName = 'html2canvas';

const banner = `/*!
 * ${pkg.title} ${pkg.version} <${pkg.homepage}>
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
        compilerOptions: {types: []}
    }),
    commonjs({include: 'node_modules/**'})
];

export default [
    {
        input: 'src/umd.ts',
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
