import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import {createRequire} from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

const banner = `/*!
 * ${pkg.title} ${pkg.version} <${pkg.homepage}>
 * Copyright (c) ${new Date().getFullYear()} ${pkg.author.name} <${pkg.author.url}>
 * Released under ${pkg.license} License
 */`;

export default {
    input: 'src/index.ts',
    output: [
        {file: pkg.main, name: pkg.name, format: 'umd', banner, sourcemap: true},
        {file: pkg.module, format: 'esm', banner, sourcemap: true},
        {
            file: 'dist/html2canvas.min.js',
            name: pkg.name,
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
            compilerOptions: {types: []}
        }),
        commonjs({include: 'node_modules/**'})
    ]
};
