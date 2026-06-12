import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import {createRequire} from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// The package is named @domlens/core, but the UMD bundle keeps the classic
// html2canvas global (and output file name) until the new API lands in a later phase.
const umdName = 'html2canvas';

const banner = `/*!
 * ${pkg.title} ${pkg.version} <${pkg.homepage}>
 * Copyright (c) ${new Date().getFullYear()} ${pkg.author.name} <${pkg.author.url}>
 * Released under ${pkg.license} License
 */`;

export default {
    input: 'src/index.ts',
    output: [
        {file: pkg.main, name: umdName, format: 'umd', banner, sourcemap: true},
        {file: pkg.module, format: 'esm', banner, sourcemap: true},
        {
            file: 'dist/html2canvas.min.js',
            name: umdName,
            format: 'umd',
            banner,
            sourcemap: true,
            plugins: [terser({format: {comments: /^!/}})]
        }
    ],
    watch: {
        include: 'src/**'
    },
    plugins: [
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
    ]
};
