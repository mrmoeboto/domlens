import {describe, expect, it} from 'vitest';
import {resolveOptions} from '../options';

describe('resolveOptions', () => {
    it('should apply defaults for an empty input', () => {
        const options = resolveOptions();
        expect(options.engine).toBe('auto');
        expect(options.output).toEqual({
            scale: 1,
            width: undefined,
            height: undefined,
            x: 0,
            y: 0,
            backgroundColor: undefined,
            canvas: undefined
        });
        expect(options.resources).toEqual({
            cors: 'off',
            allowTaint: false,
            proxy: undefined,
            imageTimeout: 15000,
            cache: undefined
        });
        expect(options.viewport).toEqual({width: 0, height: 0, scrollX: 0, scrollY: 0});
        expect(options.fonts).toEqual({embed: true, subset: false});
        expect(options.plugins).toEqual([]);
        expect(options.filter).toBeUndefined();
        expect(options.debug).toEqual({logging: true, keepContainer: false});
    });

    it('should source dynamic defaults from the environment', () => {
        const options = resolveOptions(
            {},
            {devicePixelRatio: 2, innerWidth: 1024, innerHeight: 768, pageXOffset: 10, pageYOffset: 20}
        );
        expect(options.output.scale).toBe(2);
        expect(options.viewport).toEqual({width: 1024, height: 768, scrollX: 10, scrollY: 20});
    });

    it('should let explicit options win over environment defaults', () => {
        const options = resolveOptions(
            {output: {scale: 3}, viewport: {width: 500, scrollY: 7}},
            {devicePixelRatio: 2, innerWidth: 1024, innerHeight: 768, pageXOffset: 10, pageYOffset: 20}
        );
        expect(options.output.scale).toBe(3);
        expect(options.viewport).toEqual({width: 500, height: 768, scrollX: 10, scrollY: 7});
    });

    it('should preserve the explicit engine choice', () => {
        expect(resolveOptions({engine: 'canvas'}).engine).toBe('canvas');
        expect(resolveOptions({engine: 'svg'}).engine).toBe('svg');
    });

    it('should distinguish backgroundColor null (transparent) from undefined (default)', () => {
        expect(resolveOptions({output: {backgroundColor: null}}).output.backgroundColor).toBeNull();
        expect(resolveOptions({output: {}}).output.backgroundColor).toBeUndefined();
        expect(resolveOptions({output: {backgroundColor: '#ff0000'}}).output.backgroundColor).toBe('#ff0000');
    });

    it('should support the debug boolean shorthand', () => {
        expect(resolveOptions({debug: false}).debug).toEqual({logging: false, keepContainer: false});
        expect(resolveOptions({debug: true}).debug).toEqual({logging: true, keepContainer: false});
        expect(resolveOptions({debug: {keepContainer: true}}).debug).toEqual({logging: true, keepContainer: true});
    });

    it('should pass through filter and plugins', () => {
        const filter = () => true;
        const plugin = {name: 'test'};
        const options = resolveOptions({filter, plugins: [plugin]});
        expect(options.filter).toBe(filter);
        expect(options.plugins).toEqual([plugin]);
    });

    it('should map resource options', () => {
        const options = resolveOptions({
            resources: {cors: 'anonymous', allowTaint: true, proxy: 'http://proxy', imageTimeout: 100}
        });
        expect(options.resources).toEqual({
            cors: 'anonymous',
            allowTaint: true,
            proxy: 'http://proxy',
            imageTimeout: 100,
            cache: undefined
        });
    });
});
