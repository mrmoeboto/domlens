import {parseBounds, parseDocumentSize} from './css/layout/bounds';
import {COLORS, isTransparent, parseColor} from './css/types/color';
import {isBodyElement, isHTMLElement, parseTree} from './dom/node-parser';
import {CanvasRenderer, RenderConfigurations} from './render/canvas/canvas-renderer';
import {Context} from '../../context';
import {CaptureContext} from '../../capture-context';
import {CaptureEngine, ClonedTree, EngineCloneConfig, EngineOutput, EngineSupportResult} from '../types';

/**
 * The legacy html2canvas repaint engine behind the {@link CaptureEngine} seam: parses the
 * cloned DOM into ElementContainers and repaints them onto a canvas. The parsing/painting
 * internals are untouched; they keep consuming the legacy Context via `context.legacy`.
 */
export class CanvasEngine implements CaptureEngine {
    readonly name = 'canvas';
    readonly cloneConfig: EngineCloneConfig = {
        inlineImages: false,
        copyStyles: false
    };

    supports(): Promise<EngineSupportResult> {
        // The canvas repainter is the universal fallback; it runs everywhere the library does.
        return Promise.resolve({ok: true});
    }

    async render(tree: ClonedTree, context: CaptureContext): Promise<EngineOutput> {
        const {clonedElement} = tree;
        const legacyContext = context.legacy;
        const {output} = context.options;

        const {width, height, left, top} =
            isBodyElement(clonedElement) || isHTMLElement(clonedElement)
                ? parseDocumentSize(clonedElement.ownerDocument)
                : parseBounds(legacyContext, clonedElement);

        const backgroundColor = parseBackgroundColor(legacyContext, clonedElement, output.backgroundColor);

        const renderOptions: RenderConfigurations = {
            canvas: output.canvas,
            backgroundColor,
            scale: output.scale,
            x: output.x + left,
            y: output.y + top,
            width: output.width ?? Math.ceil(width),
            height: output.height ?? Math.ceil(height)
        };

        context.logger.debug(
            `Document cloned, element located at ${left},${top} with size ${width}x${height} using computed rendering`
        );

        context.logger.debug(`Starting DOM parsing`);
        const root = parseTree(legacyContext, clonedElement);

        if (backgroundColor === root.styles.backgroundColor) {
            root.styles.backgroundColor = COLORS.TRANSPARENT;
        }

        context.logger.debug(
            `Starting renderer for element at ${renderOptions.x},${renderOptions.y} with size ${renderOptions.width}x${renderOptions.height}`
        );

        const renderer = new CanvasRenderer(legacyContext, renderOptions);
        const canvas = await renderer.render(root);

        return {kind: 'canvas', canvas, width: renderOptions.width, height: renderOptions.height};
    }
}

// http://www.w3.org/TR/css3-background/#special-backgrounds
const parseBackgroundColor = (context: Context, element: HTMLElement, backgroundColorOverride?: string | null) => {
    const ownerDocument = element.ownerDocument;
    const documentBackgroundColor = ownerDocument.documentElement
        ? parseColor(context, getComputedStyle(ownerDocument.documentElement).backgroundColor as string)
        : COLORS.TRANSPARENT;
    const bodyBackgroundColor = ownerDocument.body
        ? parseColor(context, getComputedStyle(ownerDocument.body).backgroundColor as string)
        : COLORS.TRANSPARENT;

    const defaultBackgroundColor =
        typeof backgroundColorOverride === 'string'
            ? parseColor(context, backgroundColorOverride)
            : backgroundColorOverride === null
              ? COLORS.TRANSPARENT
              : 0xffffffff;

    return element === ownerDocument.documentElement
        ? isTransparent(documentBackgroundColor)
            ? isTransparent(bodyBackgroundColor)
                ? defaultBackgroundColor
                : bodyBackgroundColor
            : documentBackgroundColor
        : defaultBackgroundColor;
};
