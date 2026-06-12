import {isCanvasElement, isImageElement} from '../canvas/dom/node-parser';
import {CaptureContext} from '../../capture-context';
import {isSecurityError, TaintError} from '../taint-error';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Matches url(...) tokens in (computed, hence absolutized) CSS property values. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

type UrlLoader = (url: string) => Promise<string | null>;

const isDataUrl = (url: string): boolean => url.indexOf('data:') === 0;

/**
 * Markers the clone stage leaves on a video's canvas clone when the displayed frame could
 * not be drawn synchronously (poster still showing, frame not yet decoded, or drawing
 * tainted the canvas). The async video pass below materializes them.
 */
export const VIDEO_SRC_ATTRIBUTE = 'data-html2canvas-video-src';
export const VIDEO_TIME_ATTRIBUTE = 'data-html2canvas-video-time';
export const VIDEO_POSTER_ATTRIBUTE = 'data-html2canvas-video-poster';

export interface ContainRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The object-fit: contain rectangle of intrinsic content centered in a box. */
export const containRect = (
    boxWidth: number,
    boxHeight: number,
    intrinsicWidth: number,
    intrinsicHeight: number
): ContainRect => {
    if (!boxWidth || !boxHeight || !intrinsicWidth || !intrinsicHeight) {
        return {left: 0, top: 0, width: boxWidth, height: boxHeight};
    }
    const scale = Math.min(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);
    const width = intrinsicWidth * scale;
    const height = intrinsicHeight * scale;
    return {left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height};
};

/**
 * Paints video content the way browsers do: aspect-preserved (object-fit: contain) and
 * letterboxed over black.
 */
export const drawContainedFrame = (
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    boxWidth: number,
    boxHeight: number,
    intrinsicWidth: number,
    intrinsicHeight: number
): void => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, boxWidth, boxHeight);
    const rect = containRect(boxWidth, boxHeight, intrinsicWidth, intrinsicHeight);
    ctx.drawImage(source, rect.left, rect.top, rect.width, rect.height);
};

/**
 * Loads a resource url through the shared image cache (which implements the CORS /
 * allowTaint / proxy policy) and re-encodes it as a png data url via a scratch canvas.
 * Returns null when the resource cannot be loaded — callers leave the original reference
 * in place in that case. Throws a typed {@link TaintError} when the resource loaded but
 * reading it back taints the scratch canvas (cross-origin image without CORS): the svg
 * engine cannot embed such a resource at all, so the capture must fall back to the canvas
 * engine, which implements the legacy taint behavior.
 */
const loadAsDataUrl = async (url: string, context: CaptureContext): Promise<string | null> => {
    try {
        context.cache.addImage(url);
        const pending = context.cache.match(url);
        if (!pending) {
            return null;
        }

        const img: HTMLImageElement | undefined = await pending;
        if (!img || typeof img.naturalWidth !== 'number') {
            return null;
        }

        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
            return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL();
    } catch (e) {
        if (isSecurityError(e)) {
            throw new TaintError(`inlining ${url.substring(0, 256)} would taint the canvas: ${e}`);
        }
        context.logger.debug(`Unable to inline resource ${url.substring(0, 256)}: ${e}`);
        return null;
    }
};

const inlineStyleUrls = async (element: Element, load: UrlLoader): Promise<void> => {
    const style = (element as HTMLElement | SVGElement).style;
    if (!style || !style.length) {
        return;
    }

    for (let i = style.length - 1; i >= 0; i--) {
        const property = style.item(i);
        const value = style.getPropertyValue(property);
        if (value.indexOf('url(') === -1) {
            continue;
        }

        const urls = Array.from(value.matchAll(CSS_URL), (match) => match[2]).filter((url) => !isDataUrl(url));
        if (!urls.length) {
            continue;
        }

        const replacements = new Map<string, string>();
        await Promise.all(
            urls.map(async (url) => {
                const dataUrl = await load(url);
                if (dataUrl) {
                    replacements.set(url, dataUrl);
                }
            })
        );
        if (!replacements.size) {
            continue;
        }

        const replaced = value.replace(CSS_URL, (token: string, _quote: string, url: string) => {
            const dataUrl = replacements.get(url);
            return dataUrl ? `url("${dataUrl}")` : token;
        });
        style.setProperty(property, replaced, style.getPropertyPriority(property));
    }
};

const inlineImageElement = async (element: HTMLImageElement, load: UrlLoader): Promise<void> => {
    const src = element.src;
    if (!src || isDataUrl(src)) {
        return;
    }
    const dataUrl = await load(src);
    if (dataUrl) {
        element.setAttribute('src', dataUrl);
        element.removeAttribute('srcset');
    }
};

const isSvgImageElement = (element: Element): element is SVGImageElement =>
    element.namespaceURI === 'http://www.w3.org/2000/svg' && element.localName === 'image';

const inlineSvgImageElement = async (element: SVGImageElement, load: UrlLoader): Promise<void> => {
    const raw = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href');
    if (!raw || isDataUrl(raw)) {
        return;
    }

    let resolved = raw;
    try {
        resolved = new URL(raw, element.baseURI).href;
    } catch (e) {
        // leave the raw reference; the loader will fail and keep it untouched
    }

    const dataUrl = await load(resolved);
    if (dataUrl) {
        element.setAttribute('href', dataUrl);
        element.removeAttributeNS(XLINK_NS, 'href');
    }
};

/** Loads a video far enough to draw the frame at `time`, through a CORS-enabled request. */
const loadVideoFrame = (src: string, time: number, timeout: number): Promise<HTMLVideoElement | null> =>
    new Promise((resolve) => {
        const video = document.createElement('video');
        let settled = false;
        const finish = (result: HTMLVideoElement | null) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(result);
            }
        };
        const timer = setTimeout(() => finish(null), timeout);

        // crossOrigin makes a successful load CORS-clean (drawing it cannot taint); servers
        // without CORS headers fail the load and the marker resolves to nothing instead.
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto';
        video.addEventListener('error', () => finish(null));
        video.addEventListener('loadeddata', () => {
            if (time > 0) {
                video.addEventListener('seeked', () => finish(video));
                try {
                    video.currentTime = time;
                } catch (e) {
                    finish(video);
                }
            } else {
                finish(video);
            }
        });
        video.src = src;
        video.load();
    });

/** Decodes a (data url) image for canvas drawing. */
const decodeImage = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });

/**
 * Materializes a video canvas marked by the clone stage: re-fetches the video through a
 * CORS request and draws the frame the user saw (the synchronous clone-time draw would
 * have tainted the canvas for cross-origin sources), or draws the poster image when that
 * is what the browser displayed. Failures leave the canvas blank — an empty box is the
 * best self-contained svg markup can do for an unreadable video.
 */
const materializeVideoCanvas = async (
    canvas: HTMLCanvasElement,
    load: UrlLoader,
    context: CaptureContext
): Promise<void> => {
    const src = canvas.getAttribute(VIDEO_SRC_ATTRIBUTE);
    const poster = canvas.getAttribute(VIDEO_POSTER_ATTRIBUTE);
    const time = parseFloat(canvas.getAttribute(VIDEO_TIME_ATTRIBUTE) ?? '') || 0;
    canvas.removeAttribute(VIDEO_SRC_ATTRIBUTE);
    canvas.removeAttribute(VIDEO_POSTER_ATTRIBUTE);
    canvas.removeAttribute(VIDEO_TIME_ATTRIBUTE);

    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) {
        return;
    }

    if (poster) {
        // The poster goes through the shared image cache (CORS/proxy policy) and is
        // re-encoded as a data url, so drawing it cannot taint the canvas.
        const dataUrl = await load(poster);
        const img = dataUrl ? await decodeImage(dataUrl) : null;
        if (img) {
            drawContainedFrame(
                ctx,
                img,
                canvas.width,
                canvas.height,
                img.naturalWidth || img.width,
                img.naturalHeight || img.height
            );
            return;
        }
        context.logger.debug(`Unable to materialize video poster ${poster.substring(0, 256)}`);
    }

    if (src) {
        const video = await loadVideoFrame(src, time, context.options.resources.imageTimeout);
        if (video && video.videoWidth && video.videoHeight) {
            drawContainedFrame(ctx, video, canvas.width, canvas.height, video.videoWidth, video.videoHeight);
            return;
        }
        context.logger.debug(`Unable to materialize video frame for ${src.substring(0, 256)}`);
    }
};

/**
 * Replaces a canvas clone that still carries its bitmap only as live state (e.g. video
 * frames drawn by the clone stage) with an equally-sized img: XMLSerializer drops canvas
 * contents, an img with a data url survives serialization. Attributes (style, class,
 * width/height) are copied so layout in the live clone document is unchanged.
 */
const replaceCanvasWithImage = (canvas: HTMLCanvasElement): void => {
    const doc = canvas.ownerDocument;
    if (!doc || !canvas.parentNode) {
        return;
    }

    let dataUrl: string;
    try {
        dataUrl = canvas.toDataURL();
    } catch (e) {
        if (isSecurityError(e)) {
            // Tainted canvas: nothing the svg engine can serialize; fall back to the
            // canvas engine, which draws (and taints with) the live canvas directly.
            throw new TaintError(`cloned <canvas> is tainted and cannot be serialized: ${e}`);
        }
        return;
    }

    const img = doc.createElement('img');
    for (let i = 0; i < canvas.attributes.length; i++) {
        const attr = canvas.attributes[i];
        img.setAttribute(attr.name, attr.value);
    }
    img.src = dataUrl;
    canvas.parentNode.replaceChild(img, canvas);
};

/**
 * Inlines every external resource reference in the cloned tree as a data url, so the
 * serialized svg renders self-contained (svg-as-image must not load external resources):
 * img src, svg <image> href, canvases (replaced by imgs) and url() references written by
 * the style inliner (background-image, border-image-source, list-style-image, ...).
 * Resources that cannot be loaded keep their original reference; resources that would
 * taint a canvas on extraction throw a {@link TaintError} (canvas-engine fallback).
 */
export const inlineExternalResources = async (root: Element, context: CaptureContext): Promise<void> => {
    const loaded = new Map<string, Promise<string | null>>();
    const load: UrlLoader = (url: string) => {
        let pending = loaded.get(url);
        if (!pending) {
            pending = loadAsDataUrl(url, context);
            loaded.set(url, pending);
        }
        return pending;
    };

    // Marked video canvases (poster / CORS re-fetch) must be materialized before the
    // structural canvas replacement turns every canvas into an img.
    await Promise.all(
        [root, ...Array.from(root.querySelectorAll('*'))]
            .filter(isCanvasElement)
            .filter(
                (canvas) => canvas.hasAttribute(VIDEO_SRC_ATTRIBUTE) || canvas.hasAttribute(VIDEO_POSTER_ATTRIBUTE)
            )
            .map((canvas) => materializeVideoCanvas(canvas, load, context))
    );

    // Canvas replacement is synchronous and structural; run it first and re-collect the
    // element list afterwards so the replacement imgs go through the url passes too.
    [root, ...Array.from(root.querySelectorAll('*'))].filter(isCanvasElement).forEach(replaceCanvasWithImage);

    const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];

    await Promise.all(
        elements.map(async (element) => {
            if (isImageElement(element)) {
                await inlineImageElement(element, load);
            } else if (isSvgImageElement(element)) {
                await inlineSvgImageElement(element, load);
            }
            await inlineStyleUrls(element, load);
        })
    );
};
