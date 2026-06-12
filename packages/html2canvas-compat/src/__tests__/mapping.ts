import {describe, expect, it} from 'vitest';
import {resolveOptions} from '@domlens/core';
import type {CaptureContext, NormalizedOptions, ResourceLoadingOptions} from '@domlens/core';
import {mapClassicOptions, Options} from '../mapping';

const normalize = (classic: Partial<Options>): NormalizedOptions => resolveOptions(mapClassicOptions(classic));

const canvas = {} as HTMLCanvasElement;
const cache = {} as NonNullable<ResourceLoadingOptions['cache']>;
const proxy = 'http://localhost:8081/proxy';

/**
 * Every documented v1 option (docs/configuration.md) and the NormalizedOptions field it
 * must map onto. `onclone`, `ignoreElements` and `foreignObjectRendering` map onto
 * plugins/filter and are covered separately below.
 */
const table: [name: string, classic: Partial<Options>, get: (n: NormalizedOptions) => unknown, expected: unknown][] = [
    ['allowTaint', {allowTaint: true}, (n) => n.resources.allowTaint, true],
    ['allowTaint default', {}, (n) => n.resources.allowTaint, false],
    ['backgroundColor', {backgroundColor: '#ff0000'}, (n) => n.output.backgroundColor, '#ff0000'],
    ['backgroundColor: null (transparent)', {backgroundColor: null}, (n) => n.output.backgroundColor, null],
    ['backgroundColor default (engine default white)', {}, (n) => n.output.backgroundColor, undefined],
    ['canvas', {canvas}, (n) => n.output.canvas, canvas],
    ['imageTimeout', {imageTimeout: 1234}, (n) => n.resources.imageTimeout, 1234],
    ['logging', {logging: false}, (n) => n.debug.logging, false],
    ['logging default', {}, (n) => n.debug.logging, true],
    ['proxy', {proxy}, (n) => n.resources.proxy, proxy],
    ['removeContainer: false', {removeContainer: false}, (n) => n.debug.keepContainer, true],
    ['removeContainer default', {}, (n) => n.debug.keepContainer, false],
    ['scale', {scale: 3}, (n) => n.output.scale, 3],
    ['useCORS: true', {useCORS: true}, (n) => n.resources.cors, 'anonymous'],
    ['useCORS default', {}, (n) => n.resources.cors, 'off'],
    ['width', {width: 321}, (n) => n.output.width, 321],
    ['height', {height: 123}, (n) => n.output.height, 123],
    ['x', {x: 5}, (n) => n.output.x, 5],
    ['y', {y: 7}, (n) => n.output.y, 7],
    ['scrollX', {scrollX: 11}, (n) => n.viewport.scrollX, 11],
    ['scrollY', {scrollY: 13}, (n) => n.viewport.scrollY, 13],
    ['windowWidth', {windowWidth: 1024}, (n) => n.viewport.width, 1024],
    ['windowHeight', {windowHeight: 768}, (n) => n.viewport.height, 768],
    ['cache', {cache}, (n) => n.resources.cache, cache]
];

describe('classic option mapping', () => {
    it.each(table)('%s', (_name, classic, get, expected) => {
        expect(get(normalize(classic))).toBe(expected);
    });

    it('selects the canvas engine by default (no auto-fallback in compat)', () => {
        expect(normalize({}).engine).toBe('canvas');
        expect(normalize({foreignObjectRendering: false}).engine).toBe('canvas');
    });

    it('inverts ignoreElements into filter', () => {
        const ignoreElements = (element: Element) => element.id === 'skip';
        const {filter} = mapClassicOptions({ignoreElements});

        expect(filter).toBeTypeOf('function');
        expect(filter?.({id: 'skip'} as Element)).toBe(false);
        expect(filter?.({id: 'keep'} as Element)).toBe(true);
    });

    it('omits filter when ignoreElements is not given', () => {
        expect(mapClassicOptions({}).filter).toBeUndefined();
    });

    it('maps onclone onto an afterClone plugin receiving the cloned document and element', () => {
        const calls: unknown[][] = [];
        const onclone = (document: Document, element: HTMLElement) => calls.push([document, element]);
        const plugins = mapClassicOptions({onclone}).plugins ?? [];
        const plugin = plugins.find((p) => p.name === 'classic-onclone');

        expect(plugin).toBeDefined();

        const document = {} as Document;
        const element = {} as HTMLElement;
        plugin?.afterClone?.({} as CaptureContext, {document, element});

        expect(calls).toEqual([[document, element]]);
    });

    it('does not register the onclone plugin when onclone is not a function', () => {
        expect((mapClassicOptions({}).plugins ?? []).find((p) => p.name === 'classic-onclone')).toBeUndefined();
    });

    it('maps foreignObjectRendering: true onto the svg engine', () => {
        const mapped = mapClassicOptions({foreignObjectRendering: true});

        expect(mapped.engine).toBe('svg');
        // The stage-B "no longer supported" error-log plugin is gone: the svg engine is the
        // real foreignObject renderer now.
        expect((mapped.plugins ?? []).map((p) => p.name)).not.toContain('classic-foreign-object-rendering');
    });

    it('keeps the canvas engine for foreignObjectRendering: false', () => {
        expect(mapClassicOptions({foreignObjectRendering: false}).engine).toBe('canvas');
        expect((mapClassicOptions({}).plugins ?? []).map((p) => p.name)).not.toContain(
            'classic-foreign-object-rendering'
        );
    });
});
