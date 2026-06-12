import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    FOREIGN_OBJECT_QUIRK_STYLE,
    foreignObjectQuirkStyle,
    isWebKitUserAgent,
    needsWebKitQuirks,
    settleSvgImage,
    warmupEmbeddedFonts
} from '../engines/svg/webkit-quirks';
import {serializeToSvg} from '../engines/svg/serializer';

/**
 * These tests prove the GATING of the WebKit quirks (active on WebKit UAs, no-ops
 * everywhere else, including this jsdom environment). The quirks' actual effect on
 * foreignObject rasterization can only be proven against a real WebKit (the CI webkit
 * Playwright project / PW_WEBKIT=1) — see webkit-quirks.ts.
 */

const SAFARI_MACOS =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/17.4 Safari/605.1.15';
const SAFARI_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';
const CHROME_LINUX =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const HEADLESS_CHROME =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/123.0.0.0 Safari/537.36';
const EDGE_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.65';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';
const JSDOM = 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/24.0.0';

describe('isWebKitUserAgent', () => {
    it('should detect WebKit-engine browsers', () => {
        expect(isWebKitUserAgent(SAFARI_MACOS)).toBe(true);
        expect(isWebKitUserAgent(SAFARI_IOS)).toBe(true);
        // every iOS browser is WebKit underneath — shell UAs must match.
        expect(isWebKitUserAgent(CHROME_IOS)).toBe(true);
    });

    it('should reject Blink, Gecko and jsdom user agents', () => {
        expect(isWebKitUserAgent(CHROME_LINUX)).toBe(false);
        expect(isWebKitUserAgent(HEADLESS_CHROME)).toBe(false);
        expect(isWebKitUserAgent(EDGE_WINDOWS)).toBe(false);
        expect(isWebKitUserAgent(FIREFOX_LINUX)).toBe(false);
        expect(isWebKitUserAgent(JSDOM)).toBe(false);
    });
});

describe('needsWebKitQuirks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should be inactive in this jsdom environment', () => {
        expect(needsWebKitQuirks()).toBe(false);
    });

    it('should follow the live navigator.userAgent', () => {
        vi.stubGlobal('navigator', {userAgent: SAFARI_MACOS});
        expect(needsWebKitQuirks()).toBe(true);

        vi.stubGlobal('navigator', {userAgent: CHROME_LINUX});
        expect(needsWebKitQuirks()).toBe(false);
    });
});

describe('foreignObjectQuirkStyle', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should be empty when the quirks are inactive', () => {
        expect(foreignObjectQuirkStyle(false)).toBe('');
        // default gating in jsdom
        expect(foreignObjectQuirkStyle()).toBe('');
    });

    it('should pin -webkit-text-size-adjust when active', () => {
        expect(foreignObjectQuirkStyle(true)).toContain('-webkit-text-size-adjust: none');
    });

    it('should reach the serialized foreignObject wrapper only on WebKit', () => {
        const node = document.createElement('div');
        expect(serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0})).not.toContain(
            '-webkit-text-size-adjust'
        );

        vi.stubGlobal('navigator', {userAgent: SAFARI_MACOS});
        const markup = serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0});
        expect(markup).toContain(FOREIGN_OBJECT_QUIRK_STYLE);
    });
});

describe('settleSvgImage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be a no-op when inactive', async () => {
        const decode = vi.fn();
        const createElement = vi.spyOn(document, 'createElement');

        await settleSvgImage({decode} as unknown as HTMLImageElement, false);

        expect(decode).not.toHaveBeenCalled();
        expect(createElement).not.toHaveBeenCalled();
    });

    it('should decode and warmup-draw the image when active', async () => {
        const ctx = {drawImage: vi.fn()};
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
            tagName === 'canvas'
                ? ({width: 0, height: 0, getContext: () => ctx} as unknown as HTMLCanvasElement)
                : realCreateElement(tagName)) as typeof document.createElement);

        const img = {decode: vi.fn().mockResolvedValue(undefined)} as unknown as HTMLImageElement;
        await settleSvgImage(img, true);

        expect(img.decode).toHaveBeenCalledTimes(1);
        expect(ctx.drawImage).toHaveBeenCalledWith(img, 0, 0);
    });

    it('should tolerate decode() rejections and warmup draw failures', async () => {
        vi.spyOn(document, 'createElement').mockImplementation(() => {
            throw new Error('no canvas here');
        });
        const img = {decode: vi.fn().mockRejectedValue(new Error('decode failed'))} as unknown as HTMLImageElement;

        await expect(settleSvgImage(img, true)).resolves.toBeUndefined();
    });
});

const FONT_CSS =
    "@font-face { font-family: 'Karla'; font-style: normal; font-weight: 700; " +
    'unicode-range: U+0000-00FF; src: url("data:font/woff2;base64,AAAA") format("woff2"); }\n' +
    '@font-face { font-family: Lobster; src: url("data:font/woff2;base64,BBBB"); }';

class FakeFontFace {
    load = vi.fn().mockResolvedValue(this);
    constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors?: FontFaceDescriptors
    ) {}
}

const fakeDocument = (FontFaceCtor: unknown = FakeFontFace) => {
    const fonts = {add: vi.fn(), delete: vi.fn()};
    const doc = {
        baseURI: 'http://localhost/',
        defaultView: FontFaceCtor ? {FontFace: FontFaceCtor} : {},
        fonts
    } as unknown as Document;
    return {doc, fonts};
};

describe('warmupEmbeddedFonts', () => {
    it('should be a no-op when inactive', async () => {
        const {doc, fonts} = fakeDocument();

        const cleanup = await warmupEmbeddedFonts(FONT_CSS, doc, false);
        cleanup();

        expect(fonts.add).not.toHaveBeenCalled();
        expect(fonts.delete).not.toHaveBeenCalled();
    });

    it('should be a no-op without font css or without FontFace support', async () => {
        const {doc, fonts} = fakeDocument();
        (await warmupEmbeddedFonts('', doc, true))();
        expect(fonts.add).not.toHaveBeenCalled();

        const noCtor = fakeDocument(null);
        await expect(warmupEmbeddedFonts(FONT_CSS, noCtor.doc, true)).resolves.toBeInstanceOf(Function);
        expect(noCtor.fonts.add).not.toHaveBeenCalled();
    });

    it('should add, load and clean up the embedded faces when active', async () => {
        const {doc, fonts} = fakeDocument();

        const cleanup = await warmupEmbeddedFonts(FONT_CSS, doc, true);

        expect(fonts.add).toHaveBeenCalledTimes(2);
        const faces = fonts.add.mock.calls.map(([face]) => face as FakeFontFace);
        expect(faces[0].family).toBe('Karla');
        expect(faces[0].source).toContain('data:font/woff2;base64,AAAA');
        expect(faces[0].descriptors).toMatchObject({weight: '700', style: 'normal', unicodeRange: 'U+0000-00FF'});
        expect(faces[1].family).toBe('Lobster');
        for (const face of faces) {
            expect(face.load).toHaveBeenCalledTimes(1);
        }

        expect(fonts.delete).not.toHaveBeenCalled();
        cleanup();
        expect(fonts.delete).toHaveBeenCalledTimes(2);
        expect(fonts.delete).toHaveBeenCalledWith(faces[0]);
        expect(fonts.delete).toHaveBeenCalledWith(faces[1]);
    });

    it('should tolerate face load rejections and FontFaceSet.delete throwing', async () => {
        class RejectingFontFace extends FakeFontFace {
            load = vi.fn().mockRejectedValue(new Error('load failed'));
        }
        const {doc, fonts} = fakeDocument(RejectingFontFace);
        fonts.delete.mockImplementation(() => {
            throw new Error('delete failed');
        });

        const cleanup = await warmupEmbeddedFonts(FONT_CSS, doc, true);
        expect(() => cleanup()).not.toThrow();
        expect(fonts.add).toHaveBeenCalledTimes(2);
    });
});
