import {parseBounds, parseDocumentSize} from '../canvas/css/layout/bounds';
import {asString, isTransparent} from '../canvas/css/types/color';
import {isBodyElement, isHTMLElement} from '../canvas/dom/node-parser';
import {parseBackgroundColor} from '../canvas/engine';
import {CaptureContext} from '../../capture-context';
import {TaintError} from '../taint-error';
import {CaptureEngine, ClonedTree, EngineCloneConfig, EngineOutput, EngineSupportResult} from '../types';
import {embedWebFonts} from './fonts';
import {inlineExternalResources} from './resource-inliner';
import {rasterizeSvg} from './rasterize';
import {serializeToSvg} from './serializer';
import {StyleInliner} from './style-inliner';

/**
 * The SVG foreignObject engine: serializes the computed-style-inlined clone into
 * `<svg><foreignObject>` markup and lets the browser paint it. The markup is rasterized
 * eagerly here (see rasterize.ts) so the render fails — and the pipeline can fall back to
 * the canvas engine — when the svg does not load or the taint probe trips; the rasterized
 * canvas rides along in the output and is reused by {@link CaptureResult}.
 *
 * Style fidelity comes from the default-diffing computed-style inliner (style-inliner.ts)
 * driven by the clone stage, plus the resource inliner that rewrites every external
 * img/background reference to a data url before serialization (svg-as-image must be
 * self-contained) and the web font embedder that re-emits the used @font-face rules with
 * data url sources (fonts.ts). Same-origin iframes are Phase 4 work.
 */
export class SvgEngine implements CaptureEngine {
    readonly name = 'svg';
    /** Whether prepareClone inlined the tree's resources (engine instances are per capture). */
    private preInlined = false;
    /** A taint failure prepareClone deferred; render() re-runs the inliner to raise it. */
    private deferredTaint: TaintError | null = null;
    readonly cloneConfig: EngineCloneConfig = {
        // Inline canvas/video contents as data urls; styles are written inline by the
        // engine-owned computed-style inliner instead of the legacy full-copy mode.
        inlineImages: true,
        copyStyles: false,
        createStyleInliner: (ownerDocument: Document) => new StyleInliner(ownerDocument),
        // Resource inlining runs against the DETACHED clone, before the iframe adoption:
        // the capture iframe then decodes in-memory data urls instead of re-fetching (and
        // waiting for) every image before its load event fires. Best-effort by contract —
        // a TaintError is swallowed here and re-raised from render() below, where
        // executeCapture can fall back to the canvas engine.
        prepareClone: (documentElement: HTMLElement, context: CaptureContext) =>
            context.time('resource-inline', async () => {
                try {
                    await inlineExternalResources(documentElement, context);
                    this.preInlined = true;
                } catch (e) {
                    if (!(e instanceof TaintError)) {
                        throw e;
                    }
                    this.deferredTaint = e;
                    context.logger.debug(`deferring taint failure to render: ${e.message}`);
                }
            })
    };

    async supports(context: CaptureContext): Promise<EngineSupportResult> {
        // The detection promise can reject (e.g. no 2d canvas context at all).
        const ok = await Promise.resolve(context.env.SUPPORT_FOREIGNOBJECT_DRAWING).catch(() => false);
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

        // Resource-inlining sweep (img src, background url(), canvases → data urls; the
        // serialized svg must be self-contained). The bulk ran pre-adoption in
        // prepareClone; the sweep is needed again only when that pass did not complete
        // (deferred taint — re-running raises the TaintError here, where executeCapture
        // can fall back to the canvas engine), when the engine is driven without the
        // prepareClone stage, or when afterClone plugins may have added new references.
        if (!this.preInlined || this.deferredTaint || context.hooks.hasAfterClone) {
            await context.time('resource-sweep', () => inlineExternalResources(documentElement, context));
            if (this.deferredTaint) {
                // The sweep re-attempts every conversion ('soft' caches are per pass, and
                // failures are never pinned), so a persisting taint re-throws above; a
                // transient one heals. Reaching here means the tree is fully inlined.
                this.deferredTaint = null;
            }
        }

        // Embed the web fonts the cloned tree uses as @font-face rules with data: url
        // sources (fonts.ts): rule discovery runs against the source document (the clone
        // carries no stylesheets — styles are inlined), usage detection against the clone.
        // The container iframe lives in the source document, which the tree does not
        // reference directly.
        const sourceDocument = tree.container.ownerDocument;
        const fontCss =
            context.options.fonts.embed && sourceDocument
                ? await context.time('font-embed', () => embedWebFonts(sourceDocument, documentElement, context))
                : '';

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
        const markup = await context.time('serialize', () =>
            serializeToSvg(documentElement, {
                width: outputWidth,
                height: outputHeight,
                left: output.x + left,
                top: output.y + top,
                backgroundColor: isTransparent(backgroundColor) ? undefined : asString(backgroundColor),
                fontCss: fontCss || undefined
            })
        );

        // Rasterize while the engine can still fail over: a markup that does not load as an
        // image or trips the taint probe must throw here (executeCapture falls back to the
        // canvas engine), not later in a CaptureResult export.
        const canvas = await context.time('rasterize', () =>
            rasterizeSvg(markup, {
                width: outputWidth,
                height: outputHeight,
                scale: output.scale,
                allowTaint: context.options.resources.allowTaint,
                // WebKit font decode warmup (webkit-quirks.ts); ignored on other engines.
                fontCss: fontCss || undefined
            })
        );

        return {kind: 'svg', markup, width: outputWidth, height: outputHeight, canvas};
    }
}
