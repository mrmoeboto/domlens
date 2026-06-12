import {parseBounds, parseDocumentSize} from '../canvas/css/layout/bounds';
import {asString, isTransparent} from '../canvas/css/types/color';
import {isBodyElement, isHTMLElement} from '../canvas/dom/node-parser';
import {parseBackgroundColor} from '../canvas/engine';
import {CaptureContext} from '../../capture-context';
import {CaptureEngine, ClonedTree, EngineCloneConfig, EngineOutput, EngineSupportResult} from '../types';
import {serializeToSvg} from './serializer';

/**
 * The SVG foreignObject engine: serializes the computed-style-inlined clone into
 * `<svg><foreignObject>` markup and lets the browser paint it. Rasterization to canvas
 * happens lazily in {@link CaptureResult} (see rasterize.ts).
 *
 * Scaffold-stage fidelity: backgrounds/borders/text layout render through the browser;
 * external images, web fonts and CSS url() resources are not inlined yet, so they do not
 * load inside the svg image (Phase 3/4 work).
 */
export class SvgEngine implements CaptureEngine {
    readonly name = 'svg';
    readonly cloneConfig: EngineCloneConfig = {
        // The foreignObject-era clone modes: inline canvas contents as data urls and copy
        // computed styles inline (the svg image cannot run stylesheets against the live DOM).
        inlineImages: true,
        copyStyles: true
    };

    async supports(context: CaptureContext): Promise<EngineSupportResult> {
        const ok = await context.env.SUPPORT_FOREIGNOBJECT_DRAWING;
        return ok ? {ok: true} : {ok: false, reason: 'foreignObject drawing is not supported in this environment'};
    }

    async render(tree: ClonedTree, context: CaptureContext): Promise<EngineOutput> {
        const {clonedElement, ownerDocument} = tree;
        const legacyContext = context.legacy;
        const {output} = context.options;

        const {width, height, left, top} =
            isBodyElement(clonedElement) || isHTMLElement(clonedElement)
                ? parseDocumentSize(ownerDocument)
                : parseBounds(legacyContext, clonedElement);

        const backgroundColor = parseBackgroundColor(legacyContext, clonedElement, output.backgroundColor);

        const documentElement = ownerDocument.documentElement;
        if (!documentElement) {
            throw new Error('Cloned document has no document element to serialize');
        }

        const outputWidth = output.width ?? Math.ceil(width);
        const outputHeight = output.height ?? Math.ceil(height);

        context.logger.debug(
            `Serializing cloned document to svg, element at ${left},${top} with size ${width}x${height}`
        );

        // Serialize the whole cloned document element (not just the target subtree) and crop
        // the svg viewport to the element bounds: a standalone subtree would lose its page
        // layout context, while a cropped full document matches what the browser painted.
        const markup = serializeToSvg(documentElement, {
            width: outputWidth,
            height: outputHeight,
            left: output.x + left,
            top: output.y + top,
            backgroundColor: isTransparent(backgroundColor) ? undefined : asString(backgroundColor)
        });

        return {kind: 'svg', markup, width: outputWidth, height: outputHeight};
    }
}
