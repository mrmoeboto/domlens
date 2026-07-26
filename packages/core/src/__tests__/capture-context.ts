import {describe, expect, it} from 'vitest';
import {Bounds} from '../engines/canvas/css/layout/bounds';
import {CaptureContext} from '../capture-context';
import {resolveOptions} from '../options';

const makeContext = (timings: boolean): CaptureContext =>
    new CaptureContext(resolveOptions({debug: {logging: false, timings}}), new Bounds(0, 0, 0, 0));

describe('CaptureContext stage timings', () => {
    it('should not record timings by default', async () => {
        const context = makeContext(false);
        expect(context.stageTimings).toBeNull();
        await expect(context.time('clone-walk', () => 42)).resolves.toBe(42);
        expect(context.stageTimings).toBeNull();
    });

    it('should record stage durations when debug.timings is set', async () => {
        const context = makeContext(true);
        expect(context.stageTimings).toEqual({});

        const value = await context.time('serialize', () => 'markup');
        expect(value).toBe('markup');
        expect(context.stageTimings).toHaveProperty('serialize');
        expect(context.stageTimings?.serialize).toBeGreaterThanOrEqual(0);
    });

    it('should resolve async stages and accumulate repeated stages', async () => {
        const context = makeContext(true);

        await context.time('resource-inline', () => new Promise((resolve) => setTimeout(() => resolve(1), 5)));
        const first = context.stageTimings?.['resource-inline'] as number;
        expect(first).toBeGreaterThan(0);

        await context.time('resource-inline', () => new Promise((resolve) => setTimeout(() => resolve(2), 5)));
        expect(context.stageTimings?.['resource-inline']).toBeGreaterThan(first);
    });

    it('should record the duration of a failing stage and rethrow', async () => {
        const context = makeContext(true);
        await expect(
            context.time('rasterize', () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(context.stageTimings).toHaveProperty('rasterize');
    });
});
