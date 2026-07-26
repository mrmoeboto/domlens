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
 * After drawing, a taint probe verifies the drawn image is readable (some browsers taint
 * canvases for svg content they refuse to read back); a SecurityError is rethrown as a
 * typed {@link TaintError}, which `executeCapture` translates into the canvas-engine
 * fallback. Set `allowTaint` to skip the probe.
 *
 * The probe draws the image onto a 1x1 scratch canvas instead of reading the output
 * canvas: tainting is a property of the drawn source, not of the drawn size, so the
 * scratch readback raises the same SecurityError — while a readback of the output canvas
 * would force the browser to rasterize all of it eagerly inside capture(). Browsers
 * defer canvas paint ops until the first readback/use, so skipping that keeps capture()
 * latency independent of output area (a full-page 1280x20000 capture rasterizes ~3s
 * later, when pixels are actually consumed — or never, for svg-only consumers).
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
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            const probeCtx = probe.getContext('2d');
            if (!probeCtx) {
                throw new Error('Unable to get 2d context for svg taint probe');
            }
            probeCtx.drawImage(img, 0, 0, 1, 1);
            try {
                probeCtx.getImageData(0, 0, 1, 1);
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
