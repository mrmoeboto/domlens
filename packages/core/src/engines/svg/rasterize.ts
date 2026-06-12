import {isSecurityError, TaintError} from '../taint-error';
import {settleSvgImage, warmupEmbeddedFonts} from './webkit-quirks';

/**
 * Loads serialized `<svg>` markup (or an svg DOM node) into an HTMLImageElement via a
 * `data:image/svg+xml` url, so it can be drawn onto a canvas.
 */
export const loadSerializedSVG = (svg: Node | string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load serialized svg image'));

        const markup = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
};

export interface RasterizeConfig {
    /** Intrinsic (CSS pixel) size of the svg markup. */
    width: number;
    height: number;
    /** Device pixel ratio multiplier applied to the output canvas. */
    scale: number;
    /** Skip the post-draw taint probe: the caller explicitly accepts tainted output. */
    allowTaint?: boolean;
    /**
     * The @font-face CSS embedded in the markup (fonts.ts). On WebKit the faces are
     * pre-loaded into the host document before rasterization so the foreignObject text
     * does not rasterize with fallback fonts (webkit-quirks.ts); unused elsewhere.
     */
    fontCss?: string;
}

/**
 * Rasterizes svg engine markup onto a canvas at `scale` device pixels per CSS pixel.
 * Browsers re-rasterize svg images at the drawn resolution, so scaling here stays sharp.
 *
 * After drawing, a 1x1 getImageData taint probe verifies the canvas is readable (some
 * browsers taint canvases for svg content they refuse to read back); a SecurityError is
 * rethrown as a typed {@link TaintError}, which `executeCapture` translates into the
 * canvas-engine fallback. Set `allowTaint` to skip the probe.
 */
export const rasterizeSvg = async (markup: string, config: RasterizeConfig): Promise<HTMLCanvasElement> => {
    const {width, height, scale} = config;

    // WebKit-only (no-ops elsewhere, see webkit-quirks.ts): pre-load the embedded fonts in
    // the host document, and settle the loaded svg image (decode + warmup draw) before the
    // readback draw below.
    const cleanupFonts = await warmupEmbeddedFonts(config.fontCss);
    try {
        const img = await loadSerializedSVG(markup);
        await settleSvgImage(img);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(width * scale));
        canvas.height = Math.max(1, Math.floor(height * scale));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Unable to get 2d context for svg rasterization');
        }

        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);

        if (!config.allowTaint) {
            try {
                ctx.getImageData(0, 0, 1, 1);
            } catch (e) {
                if (!isSecurityError(e)) {
                    throw e;
                }
                throw new TaintError(`svg rasterization produced a tainted canvas: ${e}`);
            }
        }

        return canvas;
    } finally {
        cleanupFonts();
    }
};
