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
}

/**
 * Rasterizes svg engine markup onto a canvas at `scale` device pixels per CSS pixel.
 * Browsers re-rasterize svg images at the drawn resolution, so scaling here stays sharp.
 */
export const rasterizeSvg = async (markup: string, config: RasterizeConfig): Promise<HTMLCanvasElement> => {
    const {width, height, scale} = config;
    const img = await loadSerializedSVG(markup);

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

    return canvas;
};
