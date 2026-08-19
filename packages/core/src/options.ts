import type {Plugin} from './plugins/types';
import type {Cache} from './resources/cache-storage';

export type EngineRequest = 'svg' | 'canvas' | 'auto';
export type CorsMode = 'off' | 'anonymous' | 'use-credentials';

/**
 * Resource cache lifetime:
 * - `'full'`: resources (loaded images, data-url conversions) are kept in a shared cache
 *   that persists across captures — fastest for repeated captures of the same page, at the
 *   cost of never observing changed resources behind unchanged URLs,
 * - `'soft'` (default): resources are cached for the duration of a single capture,
 * - `'disabled'`: like `'soft'`, but any persistent shared caches (from earlier `'full'`
 *   captures) are cleared before the capture starts.
 */
export type ResourceCacheMode = 'full' | 'soft' | 'disabled';

export interface OutputOptions {
    /** Device pixel ratio multiplier applied to the output. Defaults to the window's devicePixelRatio. */
    scale: number;
    /** Crop width/height of the output (CSS pixels). Defaults to the captured element's size. */
    width?: number;
    height?: number;
    /** Crop offset, added to the element position. */
    x: number;
    y: number;
    /**
     * Background color behind the capture. `undefined` uses the engine default (white, or the
     * page background when capturing the root element); `null` keeps the background transparent.
     */
    backgroundColor?: string | null;
    /** Existing canvas to render into (canvas engine only). */
    canvas?: HTMLCanvasElement;
}

export interface ResourceLoadingOptions {
    /** crossOrigin mode used when fetching cross-origin images. 'off' disables CORS fetching. */
    cors: CorsMode;
    /** Allow the output to be tainted by cross-origin content. */
    allowTaint: boolean;
    /** URL of a html2canvas-proxy compatible proxy used for cross-origin resources. */
    proxy?: string;
    /** Timeout (ms) for loading an image resource; 0 disables the timeout. */
    imageTimeout: number;
    /** Explicit resource cache instance to share between captures (overrides `cacheMode`). */
    cache?: Cache;
    /** Resource cache lifetime, see {@link ResourceCacheMode}. */
    cacheMode: ResourceCacheMode;
}

/** User-facing resource options: `cache` also accepts a {@link ResourceCacheMode} keyword. */
export type ResourceLoadingInput = Partial<Omit<ResourceLoadingOptions, 'cacheMode' | 'cache'>> & {
    cache?: Cache | ResourceCacheMode;
};

export interface ViewportOptions {
    /** Viewport size used when rendering the cloned document. Defaults to the live window size. */
    width: number;
    height: number;
    /** Scroll position applied to the cloned document. Defaults to the live scroll position. */
    scrollX: number;
    scrollY: number;
}

/**
 * Web font handling for the svg engine.
 *
 * Only `embed` exists, and it is read in exactly one place (engines/svg/engine.ts). There was
 * also a `subset` flag here; it was removed before the first release because nothing consumed
 * it — the option could be set and changed nothing, which is worse than its absence. Note that
 * `@font-face` selection already prunes faces whose `unicode-range` cannot match any character
 * in the subtree; that happens unconditionally and is not what `subset` meant. Real glyph
 * subsetting is still unimplemented, and the flag should come back with the code, not before.
 */
export interface FontOptions {
    /** Re-emit used `@font-face` rules with `data:` url sources so text renders identically. */
    embed: boolean;
}

export interface DebugOptions {
    /** Enable debug logging. */
    logging: boolean;
    /** Keep the cloned iframe container in the DOM after the capture (for inspection). */
    keepContainer: boolean;
    /**
     * Record per-stage wall-clock timings (clone walk, iframe load, resource inlining,
     * font embedding, serialization, rasterization) on {@link CaptureResult#timings}.
     */
    timings: boolean;
}

export interface NormalizedOptions {
    /** Engine to render with; 'auto' picks the best available engine with automatic fallback. */
    engine: EngineRequest;
    output: OutputOptions;
    resources: ResourceLoadingOptions;
    /** Predicate deciding which elements to keep; return false to exclude an element. */
    filter?: (element: Element) => boolean;
    viewport: ViewportOptions;
    fonts: FontOptions;
    plugins: Plugin[];
    debug: DebugOptions;
}

/** User-facing capture options; every field optional, see {@link NormalizedOptions} for semantics. */
export interface CaptureOptions {
    engine?: EngineRequest;
    output?: Partial<OutputOptions>;
    resources?: ResourceLoadingInput;
    filter?: (element: Element) => boolean;
    viewport?: Partial<ViewportOptions>;
    fonts?: Partial<FontOptions>;
    plugins?: Plugin[];
    /** Boolean shorthand toggles logging. */
    debug?: boolean | Partial<DebugOptions>;
}

/** Dynamic defaults sourced from the window owning the captured element. */
export interface ViewportDefaults {
    devicePixelRatio?: number;
    innerWidth?: number;
    innerHeight?: number;
    pageXOffset?: number;
    pageYOffset?: number;
}

export const resolveOptions = (input: CaptureOptions = {}, env: ViewportDefaults = {}): NormalizedOptions => {
    const debugInput = typeof input.debug === 'boolean' ? {logging: input.debug} : (input.debug ?? {});
    const cacheInput = input.resources?.cache;

    return {
        engine: input.engine ?? 'auto',
        output: {
            scale: input.output?.scale ?? env.devicePixelRatio ?? 1,
            width: input.output?.width,
            height: input.output?.height,
            x: input.output?.x ?? 0,
            y: input.output?.y ?? 0,
            backgroundColor: input.output?.backgroundColor,
            canvas: input.output?.canvas
        },
        resources: {
            cors: input.resources?.cors ?? 'off',
            allowTaint: input.resources?.allowTaint ?? false,
            proxy: input.resources?.proxy,
            imageTimeout: input.resources?.imageTimeout ?? 15000,
            cache: typeof cacheInput === 'object' ? cacheInput : undefined,
            cacheMode: typeof cacheInput === 'string' ? cacheInput : 'soft'
        },
        filter: input.filter,
        viewport: {
            width: input.viewport?.width ?? env.innerWidth ?? 0,
            height: input.viewport?.height ?? env.innerHeight ?? 0,
            scrollX: input.viewport?.scrollX ?? env.pageXOffset ?? 0,
            scrollY: input.viewport?.scrollY ?? env.pageYOffset ?? 0
        },
        fonts: {
            embed: input.fonts?.embed ?? true
        },
        plugins: input.plugins ?? [],
        debug: {
            logging: debugInput.logging ?? true,
            keepContainer: debugInput.keepContainer ?? false,
            timings: debugInput.timings ?? false
        }
    };
};
