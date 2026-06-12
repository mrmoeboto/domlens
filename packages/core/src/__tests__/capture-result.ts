import {describe, expect, it, vi} from 'vitest';
import {Bounds} from '../engines/canvas/css/layout/bounds';
import {CaptureContext} from '../capture-context';
import {CaptureOptions, resolveOptions} from '../options';
import {CaptureResult} from '../capture-result';
import {EngineOutput} from '../engines/types';

const makeContext = (options: CaptureOptions = {}): CaptureContext =>
    new CaptureContext(resolveOptions({debug: false, ...options}), new Bounds(0, 0, 0, 0));

interface FakeCanvas {
    toDataURL: ReturnType<typeof vi.fn>;
    toBlob: ReturnType<typeof vi.fn>;
}

const makeCanvas = (): FakeCanvas => ({
    toDataURL: vi.fn().mockImplementation((type: string) => `data:${type};base64,AAAA`),
    toBlob: vi.fn().mockImplementation((callback: (blob: Blob) => void) => callback({} as Blob))
});

const makeResult = (options: CaptureOptions = {}): {result: CaptureResult; canvas: FakeCanvas} => {
    const canvas = makeCanvas();
    const output: EngineOutput = {
        kind: 'canvas',
        canvas: canvas as unknown as HTMLCanvasElement,
        width: 10,
        height: 20
    };
    return {result: new CaptureResult(output, makeContext(options)), canvas};
};

describe('CaptureResult', () => {
    it('should expose kind and dimensions', () => {
        const {result} = makeResult();
        expect(result.kind).toBe('canvas');
        expect(result.width).toBe(10);
        expect(result.height).toBe(20);
    });

    it('should return the canvas synchronously for canvas output', () => {
        const {result, canvas} = makeResult();
        expect(result.toCanvas()).toBe(canvas as unknown as HTMLCanvasElement);
    });

    it('should throw from toSvg for canvas output', () => {
        const {result} = makeResult();
        expect(() => result.toSvg()).toThrow('svg engine not yet available');
    });

    it('should encode lazily', () => {
        const {canvas} = makeResult();
        expect(canvas.toDataURL).not.toHaveBeenCalled();
    });

    it('should cache repeated exports of the same format', async () => {
        const {result, canvas} = makeResult();
        const first = await result.toPng();
        const second = await result.toPng();
        expect(first).toBe(second);
        expect(first).toBe('data:image/png;base64,AAAA');
        expect(canvas.toDataURL).toHaveBeenCalledTimes(1);
    });

    it('should encode different formats and qualities separately', async () => {
        const {result, canvas} = makeResult();
        await result.toPng();
        await result.toJpeg(0.5);
        await result.toJpeg(0.5);
        await result.toJpeg(0.9);
        await result.toWebp();
        expect(canvas.toDataURL).toHaveBeenCalledTimes(4);
        expect(canvas.toDataURL).toHaveBeenCalledWith('image/png', undefined);
        expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5);
        expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
        expect(canvas.toDataURL).toHaveBeenCalledWith('image/webp', undefined);
    });

    it('should run the beforeExport hook once per cached encoding', async () => {
        const beforeExport = vi.fn();
        const {result} = makeResult({plugins: [{beforeExport}]});
        await result.toPng();
        await result.toPng();
        expect(beforeExport).toHaveBeenCalledTimes(1);
        expect(beforeExport).toHaveBeenCalledWith(expect.any(Object), {format: 'png'});

        await result.toJpeg();
        expect(beforeExport).toHaveBeenCalledTimes(2);
        expect(beforeExport).toHaveBeenLastCalledWith(expect.any(Object), {format: 'jpeg'});
    });

    it('should produce and cache blobs', async () => {
        const {result, canvas} = makeResult();
        const first = await result.toBlob();
        const second = await result.toBlob();
        expect(first).toBe(second);
        expect(canvas.toBlob).toHaveBeenCalledTimes(1);
        expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    });

    it('should expose svg markup for svg output and refuse toCanvas', () => {
        const output: EngineOutput = {kind: 'svg', markup: '<svg/>', width: 1, height: 1};
        const result = new CaptureResult(output, makeContext());
        expect(result.toSvg()).toBe('<svg/>');
        expect(() => result.toCanvas()).toThrow('not available for svg output');
    });
});
