import {isCanvasElement, isImageElement} from '../canvas/dom/node-parser';
import {CaptureContext} from '../../capture-context';
import {isSecurityError, TaintError} from '../taint-error';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Matches url(...) tokens in (computed, hence absolutized) CSS property values. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

type UrlLoader = (url: string) => Promise<string | null>;

const isDataUrl = (url: string): boolean => url.indexOf('data:') === 0;

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
