import {CaptureContext} from './capture-context';
import {EngineOutput} from './engines/types';

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
     * Returns the rendered canvas synchronously. Only available for canvas engine output;
     * svg output requires asynchronous rasterization (arrives with the svg engine).
     */
    toCanvas(): HTMLCanvasElement {
        if (this.output.kind !== 'canvas') {
            throw new Error(`toCanvas() is not available for ${this.output.kind} output yet`);
        }

        return this.output.canvas;
    }

    /**
     * Returns the SVG markup of the capture. Canvas engine output cannot be converted to
     * SVG; this throws until the svg engine is available (and selected).
     */
    toSvg(): string {
        if (this.output.kind !== 'svg') {
            throw new Error(`svg engine not yet available`);
        }

        return this.output.markup;
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
                const canvas = this.toCanvas();
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
                return this.toCanvas().toDataURL(MIME_TYPES[format], quality);
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
