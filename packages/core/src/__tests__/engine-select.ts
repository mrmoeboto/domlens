import {describe, expect, it, vi} from 'vitest';
import {Bounds} from '../engines/canvas/css/layout/bounds';
import {CaptureContext} from '../capture-context';
import {CaptureOptions, resolveOptions} from '../options';
import {CaptureStages, EngineRegistry, executeCapture, selectEngine} from '../engines/select';
import {CaptureEngine, EngineName, EngineOutput} from '../engines/types';

const canvasOutput: EngineOutput = {kind: 'canvas', canvas: {} as HTMLCanvasElement, width: 1, height: 1};

const makeEngine = (name: EngineName, overrides: Partial<CaptureEngine> = {}): CaptureEngine => ({
    name,
    cloneConfig: {inlineImages: name === 'svg', copyStyles: name === 'svg'},
    supports: () => Promise.resolve({ok: true}),
    render: vi.fn().mockResolvedValue(canvasOutput),
    ...overrides
});

const makeContext = (options: CaptureOptions = {}): CaptureContext =>
    new CaptureContext(resolveOptions({debug: false, ...options}), new Bounds(0, 0, 0, 0));

const makeStages = (): CaptureStages => ({
    clone: vi.fn().mockImplementation(() =>
        Promise.resolve({
            clonedElement: {} as HTMLElement,
            container: {} as HTMLIFrameElement,
            ownerDocument: {} as Document
        })
    ),
    cleanup: vi.fn()
});

describe('selectEngine', () => {
    it('should use the canvas engine when explicitly requested', async () => {
        const canvas = makeEngine('canvas');
        const engine = await selectEngine(makeContext({engine: 'canvas'}), {canvas: () => canvas});
        expect(engine).toBe(canvas);
    });

    it('should throw when the svg engine is requested but not registered', async () => {
        await expect(selectEngine(makeContext({engine: 'svg'}), {canvas: () => makeEngine('canvas')})).rejects.toThrow(
            'svg engine not yet available'
        );
    });

    it('should resolve auto to canvas while no svg engine is registered', async () => {
        const canvas = makeEngine('canvas');
        const engine = await selectEngine(makeContext({engine: 'auto'}), {canvas: () => canvas});
        expect(engine.name).toBe('canvas');
        expect(engine).toBe(canvas);
    });

    it('should use the svg engine when explicitly requested and registered', async () => {
        const svg = makeEngine('svg');
        const registry: EngineRegistry = {canvas: () => makeEngine('canvas'), svg: () => svg};
        expect(await selectEngine(makeContext({engine: 'svg'}), registry)).toBe(svg);
    });

    it('should keep resolving auto to canvas while the svg engine is not yet the default', async () => {
        // The auto → svg flip is gated on the svg engine clearing the fidelity scorecard.
        const svg = makeEngine('svg');
        const canvas = makeEngine('canvas');
        const registry: EngineRegistry = {canvas: () => canvas, svg: () => svg};
        expect(await selectEngine(makeContext({engine: 'auto'}), registry)).toBe(canvas);
    });
});

describe('executeCapture', () => {
    it('should run hooks and stages in pipeline order', async () => {
        const calls: string[] = [];
        const engine = makeEngine('canvas', {
            render: async () => {
                calls.push('render');
                return canvasOutput;
            }
        });
        const context = makeContext({
            engine: 'canvas',
            plugins: [
                {
                    beforeClone: () => void calls.push('beforeClone'),
                    afterClone: () => void calls.push('afterClone'),
                    beforeRender: () => void calls.push('beforeRender'),
                    afterRender: () => void calls.push('afterRender')
                }
            ]
        });
        const stages: CaptureStages = {
            clone: async () => {
                calls.push('clone');
                return {
                    clonedElement: {} as HTMLElement,
                    container: {} as HTMLIFrameElement,
                    ownerDocument: {} as Document
                };
            },
            cleanup: () => void calls.push('cleanup')
        };

        const output = await executeCapture(context, stages, {canvas: () => engine});
        expect(output).toBe(canvasOutput);
        expect(calls).toEqual([
            'beforeClone',
            'clone',
            'afterClone',
            'beforeRender',
            'render',
            'afterRender',
            'cleanup'
        ]);
    });

    it('should re-enter at the clone stage with the canvas engine when a non-canvas engine throws', async () => {
        const svg = makeEngine('svg', {render: vi.fn().mockRejectedValue(new Error('render failed'))});
        const canvas = makeEngine('canvas');
        const stages = makeStages();
        const context = makeContext({engine: 'svg'});

        const output = await executeCapture(context, stages, {canvas: () => canvas, svg: () => svg});

        expect(output).toBe(canvasOutput);
        expect(svg.render).toHaveBeenCalledTimes(1);
        expect(canvas.render).toHaveBeenCalledTimes(1);
        // fallback re-enters at the clone stage: clone + cleanup run once per engine attempt
        expect(stages.clone).toHaveBeenCalledTimes(2);
        expect(stages.clone).toHaveBeenNthCalledWith(1, svg);
        expect(stages.clone).toHaveBeenNthCalledWith(2, canvas);
        expect(stages.cleanup).toHaveBeenCalledTimes(2);
    });

    it('should fall back when a beforeRender plugin vetoes a non-canvas engine', async () => {
        const svg = makeEngine('svg');
        const canvas = makeEngine('canvas');
        const stages = makeStages();
        const context = makeContext({
            engine: 'svg',
            plugins: [{beforeRender: (_context, {engine}) => ({fallback: engine === 'svg', reason: 'veto'})}]
        });

        const output = await executeCapture(context, stages, {canvas: () => canvas, svg: () => svg});

        expect(output).toBe(canvasOutput);
        expect(svg.render).not.toHaveBeenCalled();
        expect(canvas.render).toHaveBeenCalledTimes(1);
        expect(stages.cleanup).toHaveBeenCalledTimes(2);
    });

    it('should ignore a fallback veto when the canvas engine is already selected', async () => {
        const canvas = makeEngine('canvas');
        const stages = makeStages();
        const context = makeContext({
            engine: 'canvas',
            plugins: [{beforeRender: () => ({fallback: true, reason: 'veto'})}]
        });

        const output = await executeCapture(context, stages, {canvas: () => canvas});
        expect(output).toBe(canvasOutput);
        expect(canvas.render).toHaveBeenCalledTimes(1);
    });

    it('should propagate canvas engine failures without fallback', async () => {
        const canvas = makeEngine('canvas', {render: vi.fn().mockRejectedValue(new Error('render failed'))});
        const stages = makeStages();
        const context = makeContext({engine: 'canvas'});

        await expect(executeCapture(context, stages, {canvas: () => canvas})).rejects.toThrow('render failed');
        expect(stages.cleanup).toHaveBeenCalledTimes(1);
    });

    it('should clean the clone up even when the render fails', async () => {
        const canvas = makeEngine('canvas', {render: vi.fn().mockRejectedValue(new Error('render failed'))});
        const stages = makeStages();

        await expect(executeCapture(makeContext({engine: 'canvas'}), stages, {canvas: () => canvas})).rejects.toThrow();
        expect(stages.cleanup).toHaveBeenCalledTimes(1);
    });
});
