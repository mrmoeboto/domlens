import {describe, expect, it, vi} from 'vitest';
import html2canvas from '../index';

import {CanvasRenderer} from '../engines/canvas/render/canvas/canvas-renderer';
import {DocumentCloner} from '../clone/document-cloner';
import {COLORS} from '../engines/canvas/css/types/color';

vi.mock('../logger');
vi.mock('../engines/canvas/css/layout/bounds');
vi.mock('../clone/document-cloner');
vi.mock('../engines/canvas/dom/node-parser', () => {
    return {
        isBodyElement: () => false,
        isHTMLElement: () => false,
        parseTree: vi.fn().mockImplementation(() => {
            return {styles: {}};
        })
    };
});

vi.mock('../engines/canvas/render/stacking-context');
vi.mock('../engines/canvas/render/canvas/canvas-renderer');

describe('html2canvas', () => {
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
});
