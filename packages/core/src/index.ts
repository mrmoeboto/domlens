import {Bounds} from './engines/canvas/css/layout/bounds';
import {CloneConfigurations, DocumentCloner} from './clone/document-cloner';
import {CacheStorage} from './resources/cache-storage';
import {CaptureContext} from './capture-context';
import {CaptureOptions, resolveOptions} from './options';
import {CaptureResult} from './capture-result';
import {CaptureStages, EngineRegistry, executeCapture} from './engines/select';
import {CanvasEngine} from './engines/canvas/engine';
import {SvgEngine} from './engines/svg/engine';
import {CaptureEngine, ClonedTree} from './engines/types';

export {CaptureContext} from './capture-context';
export {CaptureResult} from './capture-result';
export type {ImageFormat} from './capture-result';
export {CanvasEngine} from './engines/canvas/engine';
export {SvgEngine} from './engines/svg/engine';
export {serializeToSvg} from './engines/svg/serializer';
export type {SerializeConfig} from './engines/svg/serializer';
export {loadSerializedSVG, rasterizeSvg} from './engines/svg/rasterize';
export type {RasterizeConfig} from './engines/svg/rasterize';
export {StyleInliner, materializeFormState, applyScrollShift} from './engines/svg/style-inliner';
export {DefaultStyleCache, diffComputedStyle} from './engines/svg/default-styles';
export type {DefaultStyleMap, StyleDeclarationLike} from './engines/svg/default-styles';
export {inlinePseudoStyles, PSEUDO_ELEMENT_TAG} from './engines/svg/pseudo';
export {inlineExternalResources} from './engines/svg/resource-inliner';
export type {CloneStyleInliner} from './clone/document-cloner';
export {selectEngine, executeCapture} from './engines/select';
export type {EngineFactory, EngineRegistry, CaptureStages} from './engines/select';
export {TaintError, isSecurityError} from './engines/taint-error';
export type {
    CaptureEngine,
    ClonedTree,
    EngineCloneConfig,
    EngineName,
    EngineOutput,
    EngineSupportResult
} from './engines/types';
export {resolveOptions} from './options';
export type {
    CaptureOptions,
    CorsMode,
    DebugOptions,
    EngineRequest,
    FontOptions,
    NormalizedOptions,
    OutputOptions,
    ResourceLoadingOptions,
    ViewportDefaults,
    ViewportOptions
} from './options';
export {PluginRunner} from './plugins/runner';
export type {BeforeRenderOutcome} from './plugins/runner';
export type {
    AfterCloneArgs,
    AfterRenderArgs,
    BeforeExportArgs,
    BeforeRenderArgs,
    BeforeRenderResult,
    Plugin
} from './plugins/types';

if (typeof window !== 'undefined') {
    CacheStorage.setContext(window);
}

const engines: EngineRegistry = {
    canvas: () => new CanvasEngine(),
    // The default: `engine: 'auto'` prefers the svg engine when foreignObject drawing is
    // supported, with automatic canvas-engine fallback on render/taint failures (see
    // engines/select.ts). The svg engine cleared the canvas engine's fidelity scorecard
    // (Phase 3 exit criteria), flipping 'auto' to svg-first.
    svg: () => new SvgEngine()
};

/**
 * Captures an element with the new pipeline:
 * resolveOptions → beforeClone → clone stage → afterClone → engine selection →
 * beforeRender → engine.render() → afterRender → cleanup → CaptureResult.
 */
export const capture = (element: HTMLElement, options: CaptureOptions = {}): Promise<CaptureResult> => {
    if (!element || typeof element !== 'object') {
        return Promise.reject('Invalid element provided as first argument');
    }

    return captureElement(element, options);
};

const captureElement = async (element: HTMLElement, options: CaptureOptions): Promise<CaptureResult> => {
    const ownerDocument = element.ownerDocument;

    if (!ownerDocument) {
        throw new Error(`Element is not attached to a Document`);
    }

    const defaultView = ownerDocument.defaultView;

    if (!defaultView) {
        throw new Error(`Document is not attached to a Window`);
    }

    const resolved = resolveOptions(options, {
        devicePixelRatio: defaultView.devicePixelRatio,
        innerWidth: defaultView.innerWidth,
        innerHeight: defaultView.innerHeight,
        pageXOffset: defaultView.pageXOffset,
        pageYOffset: defaultView.pageYOffset
    });

    const {viewport} = resolved;
    const windowBounds = new Bounds(viewport.scrollX, viewport.scrollY, viewport.width, viewport.height);
    const context = new CaptureContext(resolved, windowBounds);

    const output = await executeCapture(context, createCloneStages(element, context), engines);

    context.logger.debug(`Finished rendering`);
    return new CaptureResult(output, context);
};

/**
 * The DOM clone stage: clones the captured element's document into a hidden iframe with
 * the engine's clone configuration, and removes that iframe again afterwards (unless
 * `debug.keepContainer` is set).
 */
const createCloneStages = (element: HTMLElement, context: CaptureContext): CaptureStages => ({
    clone: async (engine: CaptureEngine): Promise<ClonedTree> => {
        const {options, windowBounds} = context;
        const filter = options.filter;
        // The style inliner lives only for the synchronous clone walk (the DocumentCloner
        // constructor); its hidden default-styles iframe is removed again right after.
        const styleInliner = engine.cloneConfig.createStyleInliner?.(element.ownerDocument as Document);
        const cloneOptions: CloneConfigurations = {
            allowTaint: options.resources.allowTaint,
            ignoreElements: filter ? (el: Element) => !filter(el) : undefined,
            ...engine.cloneConfig,
            styleInliner
        };

        context.logger.debug(
            `Starting document clone with size ${windowBounds.width}x${
                windowBounds.height
            } scrolled to ${-windowBounds.left},${-windowBounds.top}`
        );

        let documentCloner: DocumentCloner;
        try {
            documentCloner = new DocumentCloner(context.legacy, element, cloneOptions);
        } finally {
            styleInliner?.dispose();
        }
        const clonedElement = documentCloner.clonedReferenceElement;
        if (!clonedElement) {
            return Promise.reject(`Unable to find element in cloned iframe`);
        }

        const container = await documentCloner.toIFrame(element.ownerDocument as Document, windowBounds);

        return {clonedElement, container, ownerDocument: clonedElement.ownerDocument};
    },
    cleanup: (tree: ClonedTree): void => {
        if (!context.options.debug.keepContainer) {
            if (!DocumentCloner.destroy(tree.container)) {
                context.logger.error(`Cannot detach cloned iframe as it is not in the DOM anymore`);
            }
        }
    }
});
