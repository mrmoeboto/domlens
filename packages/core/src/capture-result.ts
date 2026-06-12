import {CaptureContext} from './capture-context';
import {EngineOutput} from './engines/types';
import {rasterizeSvg} from './engines/svg/rasterize';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

const MIME_TYPES: Record<ImageFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp'
};

/**
 * Result of a capture. Export methods are lazy (nothing is encoded until requested) and
 * cached (repeated calls with the same format/quality reuse the first encoding). Encoding
 * exports run the `beforeExport` plugin hook first.
 */
export class CaptureResult {
    private readonly dataUrls = new Map<string, Promise<string>>();
    private readonly blobs = new Map<string, Promise<Blob>>();
    private rasterized?: Promise<HTMLCanvasElement>;

    constructor(
        private readonly output: EngineOutput,
        private readonly context: CaptureContext
    ) {}

    /** The kind of output the engine produced ('canvas' or 'svg'). */
    get kind(): EngineOutput['kind'] {
        return this.output.kind;
    }

    get width(): number {
        return this.output.width;
    }

    get height(): number {
        return this.output.height;
    }

    /**
     * Returns the rendered canvas synchronously: the canvas engine's output canvas, or the
     * canvas the svg engine rasterized during render. Throws for svg output constructed
     * without a rasterized canvas — asynchronous rasterization is then required, use
     * toPng()/toBlob() instead.
     */
    toCanvas(): HTMLCanvasElement {
        if (this.output.kind === 'canvas') {
            return this.output.canvas;
        }

        if (this.output.canvas) {
            return this.output.canvas;
        }

        throw new Error(
            `toCanvas() is synchronous and not available for un-rasterized svg output; use toPng()/toBlob()`
        );
    }

    /**
     * Returns the SVG markup of the capture. Only available for svg engine output; the
     * canvas engine paints pixels and cannot produce svg markup.
     */
    toSvg(): string {
        if (this.output.kind !== 'svg') {
            throw new Error(`toSvg() is not available for ${this.output.kind} output; use the svg engine`);
        }

        return this.output.markup;
    }

    /**
     * Resolves the output to a canvas: canvas output (or the canvas the svg engine
     * rasterized during render) directly, otherwise svg markup through a single cached
     * rasterization (markup → Image → canvas) at the configured output scale.
     */
    private resolveCanvas(): Promise<HTMLCanvasElement> {
        if (this.output.kind === 'canvas' || this.output.canvas) {
            return Promise.resolve(this.output.canvas as HTMLCanvasElement);
        }

        if (!this.rasterized) {
            const {markup, width, height} = this.output;
            const {scale} = this.context.options.output;
            const {allowTaint} = this.context.options.resources;
            this.rasterized = rasterizeSvg(markup, {width, height, scale, allowTaint});
        }

        return this.rasterized;
    }

    toPng(): Promise<string> {
        return this.encode('png');
    }

    toJpeg(quality?: number): Promise<string> {
        return this.encode('jpeg', quality);
    }

    toWebp(quality?: number): Promise<string> {
        return this.encode('webp', quality);
    }

    toBlob(format: ImageFormat = 'png', quality?: number): Promise<Blob> {
        const key = cacheKey(format, quality);
        let blob = this.blobs.get(key);
        if (!blob) {
            blob = (async () => {
                await this.context.hooks.beforeExport(this.context, {format});
                const canvas = await this.resolveCanvas();
                return await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(
                        (result) => (result ? resolve(result) : reject(new Error(`Failed to encode ${format} blob`))),
                        MIME_TYPES[format],
                        quality
                    );
                });
            })();
            this.blobs.set(key, blob);
        }

        return blob;
    }

    async download(filename = `capture.png`): Promise<void> {
        const format = formatFromFilename(filename);
        const dataUrl = await this.encode(format);
        const anchor = document.createElement('a');
        anchor.href = dataUrl;
        anchor.download = filename;
        anchor.rel = 'noopener';
        anchor.click();
    }

    private encode(format: ImageFormat, quality?: number): Promise<string> {
        const key = cacheKey(format, quality);
        let dataUrl = this.dataUrls.get(key);
        if (!dataUrl) {
            dataUrl = (async () => {
                await this.context.hooks.beforeExport(this.context, {format});
                return (await this.resolveCanvas()).toDataURL(MIME_TYPES[format], quality);
            })();
            this.dataUrls.set(key, dataUrl);
        }

        return dataUrl;
    }
}

const cacheKey = (format: ImageFormat, quality?: number): string => `${format}:${quality ?? 'default'}`;

const formatFromFilename = (filename: string): ImageFormat => {
    const extension = filename.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
            return 'jpeg';
        case 'webp':
            return 'webp';
        default:
            return 'png';
    }
};
