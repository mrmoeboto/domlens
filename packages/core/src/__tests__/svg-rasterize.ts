import {afterEach, describe, expect, it, vi} from 'vitest';
import {rasterizeSvg} from '../engines/svg/rasterize';
import {TaintError} from '../engines/taint-error';

/**
 * jsdom neither loads images nor implements a 2d canvas context, so the Image element and
 * the scratch canvas are stubbed: the interesting logic is the post-draw taint probe.
 */

class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
        queueMicrotask(() => this.onload?.());
    }
}

interface FakeContext {
    scale: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    getImageData: ReturnType<typeof vi.fn>;
}

const securityError = (): Error => Object.assign(new Error('The canvas has been tainted'), {name: 'SecurityError'});

const stubEnvironment = (getImageData: FakeContext['getImageData']): FakeContext => {
    const ctx: FakeContext = {scale: vi.fn(), drawImage: vi.fn(), getImageData};
    const realCreateElement = document.createElement.bind(document);
    vi.stubGlobal('Image', FakeImage);
    const createElement = (tagName: string): HTMLElement => {
        if (tagName === 'canvas') {
            return {width: 0, height: 0, style: {}, getContext: () => ctx} as unknown as HTMLCanvasElement;
        }
        return realCreateElement(tagName);
    };
    vi.spyOn(document, 'createElement').mockImplementation(createElement as typeof document.createElement);
    return ctx;
};

describe('rasterizeSvg taint probe', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should probe 1x1 after drawing and resolve when the canvas is readable', async () => {
        const ctx = stubEnvironment(vi.fn().mockReturnValue({data: new Uint8ClampedArray(4)}));

        await rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 2});

        expect(ctx.drawImage).toHaveBeenCalledTimes(1);
        expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 1, 1);
    });

    it('should throw a typed TaintError when the probe hits a SecurityError', async () => {
        stubEnvironment(
            vi.fn().mockImplementation(() => {
                throw securityError();
            })
        );

        await expect(rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 1})).rejects.toBeInstanceOf(TaintError);
    });

    it('should skip the probe when allowTaint is set', async () => {
        const ctx = stubEnvironment(
            vi.fn().mockImplementation(() => {
                throw securityError();
            })
        );

        await rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 1, allowTaint: true});

        expect(ctx.getImageData).not.toHaveBeenCalled();
    });

    it('should rethrow non-security probe errors untouched', async () => {
        const boom = new Error('boom');
        stubEnvironment(
            vi.fn().mockImplementation(() => {
                throw boom;
            })
        );

        const pending = rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 1});
        await expect(pending).rejects.toBe(boom);
        await expect(pending).rejects.not.toBeInstanceOf(TaintError);
    });
});
