import {describe, expect, it, vi} from 'vitest';
import html2canvas from '../index';

import {CanvasRenderer} from '../../../core/src/engines/canvas/render/canvas/canvas-renderer';
import {DocumentCloner} from '../../../core/src/clone/document-cloner';
import {COLORS} from '../../../core/src/engines/canvas/css/types/color';

// Stub svg engine: jsdom cannot run the real one (no layout, no image loading). It renders
// to a recognizable rasterized canvas so the foreignObjectRendering wiring is observable.
const {svgRasterCanvas} = vi.hoisted(() => ({svgRasterCanvas: {} as HTMLCanvasElement}));

vi.mock('../../../core/src/engines/svg/engine', () => ({
    SvgEngine: class {
        readonly name = 'svg';
        readonly cloneConfig = {inlineImages: true, copyStyles: false};
        supports() {
            return Promise.resolve({ok: true});
        }
        render() {
            return Promise.resolve({kind: 'svg', markup: '<svg/>', width: 1, height: 1, canvas: svgRasterCanvas});
        }
    }
}));

vi.mock('../../../core/src/logger');
vi.mock('../../../core/src/engines/canvas/css/layout/bounds');
vi.mock('../../../core/src/clone/document-cloner');
vi.mock('../../../core/src/engines/canvas/dom/node-parser', () => {
    return {
        isBodyElement: () => false,
        isHTMLElement: () => false,
        parseTree: vi.fn().mockImplementation(() => {
            return {styles: {}};
        })
    };
});

vi.mock('../../../core/src/engines/canvas/render/stacking-context');
vi.mock('../../../core/src/engines/canvas/render/canvas/canvas-renderer');

describe('html2canvas (compat)', () => {
    const element = {
        ownerDocument: {
            defaultView: {
                pageXOffset: 12,
                pageYOffset: 34
            }
        }
    } as HTMLElement;

    it('should render with an element', async () => {
        DocumentCloner.destroy = vi.fn().mockReturnValue(true);
        await html2canvas(element);
        expect(CanvasRenderer).toHaveBeenLastCalledWith(
            expect.objectContaining({
                cache: expect.any(Object),
                logger: expect.any(Object),
                windowBounds: expect.objectContaining({left: 12, top: 34})
            }),
            expect.objectContaining({
                backgroundColor: 0xffffffff,
                scale: 1,
                height: 50,
                width: 200,
                x: 0,
                y: 0,
                canvas: undefined
            })
        );
        expect(DocumentCloner.destroy).toBeCalled();
    });

    it('should have transparent background with backgroundColor: null', async () => {
        await html2canvas(element, {backgroundColor: null});
        expect(CanvasRenderer).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                backgroundColor: COLORS.TRANSPARENT
            })
        );
    });

    it('should use existing canvas when given as option', async () => {
        const canvas = {} as HTMLCanvasElement;
        await html2canvas(element, {canvas});
        expect(CanvasRenderer).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                canvas
            })
        );
    });

    it('should not remove cloned window when removeContainer: false', async () => {
        DocumentCloner.destroy = vi.fn();
        await html2canvas(element, {removeContainer: false});
        expect(CanvasRenderer).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                backgroundColor: 0xffffffff,
                scale: 1,
                height: 50,
                width: 200,
                x: 0,
                y: 0,
                canvas: undefined
            })
        );
        expect(DocumentCloner.destroy).not.toBeCalled();
    });

    it('should call onclone with the cloned document and element', async () => {
        const onclone = vi.fn();
        await html2canvas(element, {onclone});

        expect(onclone).toHaveBeenCalledTimes(1);
        const [clonedDocument, clonedElement] = onclone.mock.calls[0];
        // The DocumentCloner mock produces a cloned element whose owner window is scrolled to 12,34.
        expect(clonedElement.ownerDocument).toBe(clonedDocument);
        expect(clonedDocument.defaultView).toMatchObject({pageXOffset: 12, pageYOffset: 34});
    });

    it('should render with the svg engine and return its rasterized canvas for foreignObjectRendering: true', async () => {
        DocumentCloner.destroy = vi.fn().mockReturnValue(true);
        const canvasRendererCalls = vi.mocked(CanvasRenderer).mock.calls.length;

        const canvas = await html2canvas(element, {foreignObjectRendering: true});

        expect(canvas).toBe(svgRasterCanvas);
        // The svg engine rendered; the canvas engine was not involved.
        expect(vi.mocked(CanvasRenderer).mock.calls.length).toBe(canvasRendererCalls);
        expect(DocumentCloner.destroy).toBeCalled();
    });
});
