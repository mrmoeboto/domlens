import {parseFontFaceBlocks} from './fonts';

/**
 * WebKit foreignObject rasterization workarounds, each isolated behind runtime UA
 * detection so they are no-ops in every other engine:
 *
 *  (a) {@link settleSvgImage} — image decode + warmup draw before the canvas readback.
 *      WebKit bug 219770: the first drawImage of an `<svg><foreignObject>` image can paint
 *      before the svg document's subresources/layout settle, yielding a blank or partial
 *      raster. `img.decode()` plus a scratch-canvas warmup draw plus a double-rAF settle
 *      gives WebKit a paint cycle to finish before the real draw.
 *
 *  (b) {@link foreignObjectQuirkStyle} — `-webkit-text-size-adjust: none` on the
 *      foreignObject wrapper. WebKit applies its mobile text autosizing inside
 *      foreignObject content rendered as an image, inflating font sizes relative to the
 *      live page; the property is inherited, so pinning it on the wrapper covers the
 *      whole subtree.
 *
 *  (c) {@link warmupEmbeddedFonts} — pre-load the embedded @font-face binaries in the host
 *      document (FontFace + document.fonts) before rasterization. WebKit rasterizes the
 *      svg image without waiting for the fonts declared inside it; when the same font data
 *      is already decoded in the host document the foreignObject text renders with it
 *      instead of a fallback font.
 *
 * Detection is UA-based ({@link isWebKitUserAgent}): WebKit-the-engine without a Blink
 * marker. iOS shell browsers (CriOS/FxiOS/EdgiOS) are WebKit and intentionally match.
 * The gating is unit-tested; the quirks themselves can only be proven against a real
 * WebKit (CI webkit project / PW_WEBKIT=1).
 */

/** True for WebKit-engine user agents (Safari, any iOS browser); false for Blink/Gecko/jsdom. */
export const isWebKitUserAgent = (userAgent: string): boolean =>
    /AppleWebKit\//.test(userAgent) &&
    !/\b(?:Chrome|Chromium|HeadlessChrome|Edg|OPR)\//.test(userAgent) &&
    !/\bjsdom\b/i.test(userAgent);

/** Whether the current environment needs the WebKit foreignObject quirks. */
export const needsWebKitQuirks = (): boolean =>
    typeof navigator !== 'undefined' && isWebKitUserAgent(navigator.userAgent);

/** Quirk (b): style pinned on the serialized foreignObject wrapper. */
export const FOREIGN_OBJECT_QUIRK_STYLE = '-webkit-text-size-adjust: none;';

export const foreignObjectQuirkStyle = (active: boolean = needsWebKitQuirks()): string =>
    active ? FOREIGN_OBJECT_QUIRK_STYLE : '';

const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 16);
        }
    });

/**
 * Quirk (a): settles a loaded svg image before it is drawn for readback. No-op outside
 * WebKit. Never throws — a failed decode/warmup degrades to the plain draw path.
 */
export const settleSvgImage = async (img: HTMLImageElement, active: boolean = needsWebKitQuirks()): Promise<void> => {
    if (!active) {
        return;
    }

    if (typeof img.decode === 'function') {
        try {
            await img.decode();
        } catch (e) {
            // Some WebKit versions reject decode() for svg images; the warmup draw below
            // still forces the rasterization.
        }
    }

    try {
        const scratch = document.createElement('canvas');
        scratch.width = 1;
        scratch.height = 1;
        scratch.getContext('2d')?.drawImage(img, 0, 0);
    } catch (e) {
        // Warmup draw is best-effort; the real draw will surface genuine failures.
    }

    await nextFrame();
    await nextFrame();
};

export type FontWarmupCleanup = () => void;

interface FontFaceSetLike {
    add(face: FontFace): unknown;
    delete(face: FontFace): unknown;
}

const NOOP_CLEANUP: FontWarmupCleanup = () => undefined;

const unquoteFamily = (family: string): string =>
    family
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();

/**
 * Quirk (c): loads the embedded @font-face rules (data: url sources, see fonts.ts) into the
 * host document's FontFaceSet and waits for them, so WebKit rasterizes the foreignObject
 * with the real fonts. Returns a cleanup that removes the added faces again. No-op (and an
 * inert cleanup) outside WebKit or when FontFace/document.fonts are unavailable.
 */
export const warmupEmbeddedFonts = async (
    fontCss: string | undefined,
    doc: Document = document,
    active: boolean = needsWebKitQuirks()
): Promise<FontWarmupCleanup> => {
    if (!active || !fontCss) {
        return NOOP_CLEANUP;
    }

    const fonts = (doc as Document & {fonts?: FontFaceSetLike}).fonts;
    const view = (doc.defaultView ?? globalThis) as {FontFace?: typeof FontFace};
    const FontFaceCtor = view.FontFace;
    if (!fonts || typeof fonts.add !== 'function' || typeof FontFaceCtor !== 'function') {
        return NOOP_CLEANUP;
    }

    const added: FontFace[] = [];
    for (const rule of parseFontFaceBlocks(fontCss, doc.baseURI ?? '')) {
        try {
            const descriptors: FontFaceDescriptors = {
                style: rule.style || 'normal',
                weight: rule.weight || 'normal'
            };
            if (rule.unicodeRange) {
                descriptors.unicodeRange = rule.unicodeRange;
            }
            const face = new FontFaceCtor(unquoteFamily(rule.family), rule.src, descriptors);
            fonts.add(face);
            added.push(face);
        } catch (e) {
            // An unparseable face simply is not warmed up; rasterization proceeds.
        }
    }

    await Promise.all(
        added.map((face) =>
            Promise.resolve()
                .then(() => face.load())
                .catch(() => undefined)
        )
    );

    return () => {
        for (const face of added) {
            try {
                fonts.delete(face);
            } catch (e) {
                // FontFaceSet.delete throwing must not break capture cleanup.
            }
        }
    };
};
