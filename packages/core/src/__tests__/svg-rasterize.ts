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

/**
 * The one context method the probe actually calls, as a callable signature.
 *
 * Deliberately NOT `FakeContext['getImageData']`: that is `ReturnType<typeof vi.fn>`, i.e.
 * `Mock<Procedure | Constructable>`, which is a union with a construct signature and so has
 * no call signature to match — passing one to `mockImplementation` does not compile. The
 * interface keeps the mock type because the assertions below want the matcher surface;
 * the parameter wants a function, and they are not the same type.
 */
type GetImageData = (sx: number, sy: number, sw: number, sh: number) => ImageData;

const securityError = (): Error => Object.assign(new Error('The canvas has been tainted'), {name: 'SecurityError'});

/** One fake context per created canvas: contexts[0] is the output canvas, [1] the probe. */
const stubEnvironment = (getImageData: GetImageData): FakeContext[] => {
    const contexts: FakeContext[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.stubGlobal('Image', FakeImage);
    const createElement = (tagName: string): HTMLElement => {
        if (tagName === 'canvas') {
            const ctx: FakeContext = {
                scale: vi.fn(),
                drawImage: vi.fn(),
                // per-canvas spy so a probe readback is distinguishable from an output readback
                getImageData: vi.fn().mockImplementation(getImageData)
            };
            contexts.push(ctx);
            return {width: 0, height: 0, style: {}, getContext: () => ctx} as unknown as HTMLCanvasElement;
        }
        return realCreateElement(tagName);
    };
    vi.spyOn(document, 'createElement').mockImplementation(createElement as typeof document.createElement);
    return contexts;
};

describe('rasterizeSvg taint probe', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should probe a 1x1 scratch canvas and leave the output canvas unread', async () => {
        const contexts = stubEnvironment(vi.fn().mockReturnValue({data: new Uint8ClampedArray(4)}));

        await rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 2});

        // Output canvas: drawn, never read back — a readback would force the browser to
        // rasterize the full output area eagerly inside capture().
        const [output, probe] = contexts;
        expect(output.drawImage).toHaveBeenCalledTimes(1);
        expect(output.getImageData).not.toHaveBeenCalled();
        // Probe canvas: same image drawn at 1x1, then read (the taint signal).
        expect(probe.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1, 1);
        expect(probe.getImageData).toHaveBeenCalledWith(0, 0, 1, 1);
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
        const contexts = stubEnvironment(
            vi.fn().mockImplementation(() => {
                throw securityError();
            })
        );

        await rasterizeSvg('<svg/>', {width: 10, height: 20, scale: 1, allowTaint: true});

        expect(contexts).toHaveLength(1);
        expect(contexts[0].getImageData).not.toHaveBeenCalled();
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
