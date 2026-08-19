import {capture} from 'domlens';
import {mapClassicOptions, Options} from './mapping';

export type {Options} from './mapping';

/**
 * Classic html2canvas API, implemented on top of domlens's `capture` by mapping the
 * legacy option names onto the normalized schema (see ./mapping.ts). Behavior (including
 * the html/body background special-casing and container lifecycle) is unchanged from
 * html2canvas 1.4.1; the canvas engine is used by default (no auto-fallback), preserving
 * pixel behavior. `foreignObjectRendering: true` selects the svg foreignObject engine,
 * whose render output is rasterized eagerly, so `toCanvas()` stays synchronous here.
 *
 * This module has a single (default) runtime export so the UMD global stays directly
 * callable: `window.html2canvas(element, options)`.
 */
const html2canvas = async (element: HTMLElement, options: Partial<Options> = {}): Promise<HTMLCanvasElement> => {
    const result = await capture(element, mapClassicOptions(options));
    return result.toCanvas();
};

export default html2canvas;
