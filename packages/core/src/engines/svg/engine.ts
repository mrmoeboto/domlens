import {parseBounds, parseDocumentSize} from '../canvas/css/layout/bounds';
import {asString, isTransparent} from '../canvas/css/types/color';
import {isBodyElement, isHTMLElement} from '../canvas/dom/node-parser';
import {parseBackgroundColor} from '../canvas/engine';
import {CaptureContext} from '../../capture-context';
import {CaptureEngine, ClonedTree, EngineCloneConfig, EngineOutput, EngineSupportResult} from '../types';
import {inlineExternalResources} from './resource-inliner';
import {serializeToSvg} from './serializer';
import {StyleInliner} from './style-inliner';

/**
 * The SVG foreignObject engine: serializes the computed-style-inlined clone into
 * `<svg><foreignObject>` markup and lets the browser paint it. Rasterization to canvas
 * happens lazily in {@link CaptureResult} (see rasterize.ts).
 *
 * Style fidelity comes from the default-diffing computed-style inliner (style-inliner.ts)
 * driven by the clone stage, plus the resource inliner that rewrites every external
 * img/background reference to a data url before serialization (svg-as-image must be
 * self-contained). Web fonts and same-origin iframes are Phase 4 work.
 */
export class SvgEngine implements CaptureEngine {
    readonly name = 'svg';
    readonly cloneConfig: EngineCloneConfig = {
        // Inline canvas/video contents as data urls; styles are written inline by the
        // engine-owned computed-style inliner instead of the legacy full-copy mode.
        inlineImages: true,
        copyStyles: false,
        createStyleInliner: (ownerDocument: Document) => new StyleInliner(ownerDocument)
    };

    async supports(context: CaptureContext): Promise<EngineSupportResult> {
        const ok = await context.env.SUPPORT_FOREIGNOBJECT_DRAWING;
        return ok ? {ok: true} : {ok: false, reason: 'foreignObject drawing is not supported in this environment'};
    }

    async render(tree: ClonedTree, context: CaptureContext): Promise<EngineOutput> {
        const {clonedElement, ownerDocument} = tree;
        const legacyContext = context.legacy;
        const {output} = context.options;

        const documentElement = ownerDocument.documentElement;
        if (!documentElement) {
            throw new Error('Cloned document has no document element to serialize');
        }

        // Inline external resources (img src, background url(), canvases) as data urls
        // before measuring/serializing: svg-as-image cannot load external references.
        await inlineExternalResources(documentElement, context);

        const {width, height, left, top} =
            isBodyElement(clonedElement) || isHTMLElement(clonedElement)
                ? parseDocumentSize(ownerDocument)
                : parseBounds(legacyContext, clonedElement);

        const backgroundColor = parseBackgroundColor(legacyContext, clonedElement, output.backgroundColor);

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
