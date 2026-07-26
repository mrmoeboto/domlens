import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Bounds} from '../engines/canvas/css/layout/bounds';
import {CaptureContext} from '../capture-context';
import {resolveOptions, CaptureOptions} from '../options';
import {SvgEngine} from '../engines/svg/engine';
import {TaintError} from '../engines/taint-error';
import {ClonedTree} from '../engines/types';
import {inlineExternalResources} from '../engines/svg/resource-inliner';

vi.mock('../engines/svg/resource-inliner', () => ({
    inlineExternalResources: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../engines/svg/fonts', () => ({
    embedWebFonts: vi.fn().mockResolvedValue('')
}));
vi.mock('../engines/svg/serializer', () => ({
    serializeToSvg: vi.fn().mockReturnValue('<svg/>')
}));
vi.mock('../engines/svg/rasterize', () => ({
    rasterizeSvg: vi.fn().mockResolvedValue({} as HTMLCanvasElement)
}));
vi.mock('../engines/canvas/css/layout/bounds', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    parseBounds: vi.fn().mockReturnValue({left: 0, top: 0, width: 10, height: 20}),
    parseDocumentSize: vi.fn().mockReturnValue({left: 0, top: 0, width: 10, height: 20})
}));
vi.mock('../engines/canvas/dom/node-parser', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBodyElement: () => true,
    isHTMLElement: () => false
}));
vi.mock('../engines/canvas/engine', () => ({
    parseBackgroundColor: vi.fn().mockReturnValue(0)
}));

const inliner = vi.mocked(inlineExternalResources);

const makeContext = (options: CaptureOptions = {}): CaptureContext =>
    new CaptureContext(resolveOptions({debug: false, ...options}), new Bounds(0, 0, 0, 0));

const makeTree = (): ClonedTree => ({
    clonedElement: document.body,
    container: document.createElement('iframe'),
    ownerDocument: document
});

describe('SvgEngine resource inlining', () => {
    beforeEach(() => {
        inliner.mockReset();
        inliner.mockResolvedValue(undefined);
    });

    it('should inline resources in prepareClone and skip the render-time sweep', async () => {
        const engine = new SvgEngine();
        const context = makeContext();
        const root = document.documentElement;

        await engine.cloneConfig.prepareClone?.(root, context);
        expect(inliner).toHaveBeenCalledTimes(1);
        expect(inliner).toHaveBeenCalledWith(root, context);

        await engine.render(makeTree(), context);
        expect(inliner).toHaveBeenCalledTimes(1);
    });

    it('should sweep during render when prepareClone did not run', async () => {
        const engine = new SvgEngine();
        const context = makeContext();

        await engine.render(makeTree(), context);
        expect(inliner).toHaveBeenCalledTimes(1);
    });

    it('should sweep during render when afterClone plugins may have mutated the tree', async () => {
        const engine = new SvgEngine();
        const context = makeContext({plugins: [{afterClone: () => undefined}]});

        await engine.cloneConfig.prepareClone?.(document.documentElement, context);
        await engine.render(makeTree(), context);
        expect(inliner).toHaveBeenCalledTimes(2);
    });

    it('should defer a prepareClone TaintError to render, where it triggers fallback', async () => {
        const engine = new SvgEngine();
        const context = makeContext();
        const taint = new TaintError('tainted resource');

        inliner.mockRejectedValue(taint);
        await expect(engine.cloneConfig.prepareClone?.(document.documentElement, context)).resolves.toBeUndefined();

        await expect(engine.render(makeTree(), context)).rejects.toBe(taint);
        expect(inliner).toHaveBeenCalledTimes(2);
    });

    it('should recover when a deferred taint heals by the render-time sweep', async () => {
        const engine = new SvgEngine();
        const context = makeContext();

        inliner.mockRejectedValueOnce(new TaintError('transient taint'));
        await engine.cloneConfig.prepareClone?.(document.documentElement, context);

        await expect(engine.render(makeTree(), context)).resolves.toMatchObject({kind: 'svg', markup: '<svg/>'});
        expect(inliner).toHaveBeenCalledTimes(2);
    });

    it('should rethrow non-taint prepareClone failures', async () => {
        const engine = new SvgEngine();
        const context = makeContext();
        inliner.mockRejectedValue(new Error('boom'));

        await expect(engine.cloneConfig.prepareClone?.(document.documentElement, context)).rejects.toThrow('boom');
    });
});
