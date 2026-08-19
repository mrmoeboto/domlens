import type {CaptureOptions, Plugin, ResourceLoadingOptions} from 'domlens';

/**
 * Classic html2canvas options (the documented v1 surface), unchanged from html2canvas 1.4.1.
 */
export interface Options {
    /** Whether to allow cross-origin images to taint the canvas. */
    allowTaint: boolean;
    /** Canvas background color, if none is specified in DOM. `null` for transparent. */
    backgroundColor: string | null;
    /** Existing canvas element to use as a base for drawing on. */
    canvas?: HTMLCanvasElement;
    /** Whether to use ForeignObject rendering if the browser supports it. */
    foreignObjectRendering: boolean;
    /** Timeout for loading an image (ms); 0 disables the timeout. */
    imageTimeout: number;
    /** Predicate which removes the matching elements from the render. */
    ignoreElements?: (element: Element) => boolean;
    /** Enable logging for debug purposes. */
    logging: boolean;
    /** Callback called with the cloned Document before rendering. */
    onclone?: (document: Document, element: HTMLElement) => void;
    /** Url to a html2canvas-proxy used for loading cross-origin images. */
    proxy?: string;
    /** Whether to cleanup the cloned DOM elements html2canvas creates temporarily. */
    removeContainer?: boolean;
    /** The scale to use for rendering. Defaults to the browser's device pixel ratio. */
    scale: number;
    /** Whether to attempt to load images from a server using CORS. */
    useCORS: boolean;
    /** The width of the canvas. */
    width: number;
    /** The height of the canvas. */
    height: number;
    /** Crop canvas x-coordinate. */
    x: number;
    /** Crop canvas y-coordinate. */
    y: number;
    /** The x-scroll position used when rendering the element. */
    scrollX: number;
    /** The y-scroll position used when rendering the element. */
    scrollY: number;
    /** Window width to use when rendering the element (affects media queries). */
    windowWidth: number;
    /** Window height to use when rendering the element (affects media queries). */
    windowHeight: number;
    /** Existing resource cache to share between captures. */
    cache?: ResourceLoadingOptions['cache'];
}

/**
 * Maps the classic option names onto the normalized domlens schema. Behavior is
 * unchanged from html2canvas 1.4.1: the compat layer renders with the canvas engine by
 * default (no auto-fallback, preserving pixel behavior), and `onclone`/`ignoreElements`
 * become an afterClone plugin and an inverted `filter`. `foreignObjectRendering: true`
 * selects the svg foreignObject engine — the modern successor of the removed v1
 * experimental renderer — which still falls back to the canvas engine when its render
 * fails (matching the v1 "if the browser supports it" semantics).
 */
export const mapClassicOptions = (opts: Partial<Options>): CaptureOptions => {
    const plugins: Plugin[] = [];

    const onclone = opts.onclone;
    if (typeof onclone === 'function') {
        plugins.push({
            name: 'classic-onclone',
            afterClone: (_context, {document, element: clonedElement}) => onclone(document, clonedElement)
        });
    }

    const ignoreElements = opts.ignoreElements;

    return {
        engine: (opts.foreignObjectRendering ?? false) ? 'svg' : 'canvas',
        output: {
            scale: opts.scale,
            width: opts.width,
            height: opts.height,
            x: opts.x,
            y: opts.y,
            backgroundColor: opts.backgroundColor,
            canvas: opts.canvas
        },
        resources: {
            cors: (opts.useCORS ?? false) ? 'anonymous' : 'off',
            allowTaint: opts.allowTaint,
            proxy: opts.proxy,
            imageTimeout: opts.imageTimeout,
            cache: opts.cache
        },
        viewport: {
            width: opts.windowWidth,
            height: opts.windowHeight,
            scrollX: opts.scrollX,
            scrollY: opts.scrollY
        },
        filter: ignoreElements ? (el: Element) => !ignoreElements(el) : undefined,
        plugins,
        debug: {
            logging: opts.logging,
            keepContainer: !(opts.removeContainer ?? true)
        }
    };
};
