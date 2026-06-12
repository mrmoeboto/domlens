import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    buildFontFaceCss,
    collectFontFaceRules,
    collectUsedFonts,
    createFontDataLoader,
    embedWebFonts,
    FontFaceRule,
    parseFontFaceBlocks,
    parseFontFamilies,
    parseFontSrc,
    parseUnicodeRange,
    parseWeightRange,
    pickFontSource,
    selectUsedFaces,
    unicodeRangeMatches,
    UsedFonts
} from '../engines/svg/fonts';
import {CaptureContext} from '../capture-context';

const face = (overrides: Partial<FontFaceRule>): FontFaceRule => ({
    family: 'TestFont',
    src: 'url(test.woff2) format("woff2")',
    style: 'normal',
    weight: '400',
    stretch: '',
    unicodeRange: '',
    base: 'https://example.com/css/app.css',
    ...overrides
});

const codepointsOf = (text: string): Set<number> => new Set([...text].map((c) => c.codePointAt(0) as number));

afterEach(() => {
    document.body.innerHTML = '';
});

describe('parseFontFamilies', () => {
    it('should split, unquote, trim and lowercase the family list', () => {
        expect(parseFontFamilies(`"My Font", 'Other' , sans-serif`)).toEqual(['my font', 'other', 'sans-serif']);
    });

    it('should drop empty entries', () => {
        expect(parseFontFamilies('')).toEqual([]);
        expect(parseFontFamilies('Karla,,serif')).toEqual(['karla', 'serif']);
    });
});

describe('parseUnicodeRange', () => {
    it('should parse single codepoints, ranges and wildcards', () => {
        expect(parseUnicodeRange('U+131')).toEqual([[0x131, 0x131]]);
        expect(parseUnicodeRange('U+0000-00FF')).toEqual([[0x0, 0xff]]);
        expect(parseUnicodeRange('U+4??')).toEqual([[0x400, 0x4ff]]);
        expect(parseUnicodeRange('u+0102-0103, U+1EA0-1EF9')).toEqual([
            [0x102, 0x103],
            [0x1ea0, 0x1ef9]
        ]);
    });

    it('should treat unparseable non-empty input as the full range (never prunes)', () => {
        expect(parseUnicodeRange('bogus')).toEqual([[0, 0x10ffff]]);
    });

    it('should ignore invalid tokens among valid ones', () => {
        expect(parseUnicodeRange('U+41, nope')).toEqual([[0x41, 0x41]]);
    });
});

describe('unicodeRangeMatches', () => {
    it('should match everything for an empty range (default = full range)', () => {
        expect(unicodeRangeMatches('', codepointsOf('abc'))).toBe(true);
    });

    it('should detect intersection with used codepoints', () => {
        const latin = codepointsOf('hello');
        expect(unicodeRangeMatches('U+0000-00FF', latin)).toBe(true);
        expect(unicodeRangeMatches('U+0370-03FF', latin)).toBe(false);
        expect(unicodeRangeMatches('U+0370-03FF', codepointsOf('αβγ'))).toBe(true);
    });
});

describe('parseFontSrc / pickFontSource', () => {
    it('should parse url() and local() sources with format hints', () => {
        const sources = parseFontSrc(`local("Karla"), url('a.woff2') format('woff2'), url(b.woff) format("woff")`);
        expect(sources).toEqual([
            {kind: 'local', value: 'Karla', format: undefined},
            {kind: 'url', value: 'a.woff2', format: 'woff2'},
            {kind: 'url', value: 'b.woff', format: 'woff'}
        ]);
    });

    it('should prefer woff2 over other formats regardless of order', () => {
        const picked = pickFontSource(parseFontSrc('url(a.ttf) format("truetype"), url(a.woff2) format("woff2")'));
        expect(picked).toEqual({url: 'a.woff2', format: 'woff2'});
    });

    it('should infer the format from the url extension when unhinted', () => {
        expect(pickFontSource(parseFontSrc('url(font.woff?v=3)'))).toEqual({url: 'font.woff?v=3', format: 'woff'});
    });

    it('should never pick local() sources or legacy formats', () => {
        expect(pickFontSource(parseFontSrc('local("Karla")'))).toBeNull();
        expect(
            pickFontSource(parseFontSrc('url(f.eot) format("embedded-opentype"), url(f.svg) format("svg")'))
        ).toBeNull();
        expect(pickFontSource(parseFontSrc('url(f.eot), url(f.otf)'))).toEqual({url: 'f.otf', format: 'opentype'});
    });
});

describe('parseWeightRange', () => {
    it('should parse single weights, keywords and variable ranges', () => {
        expect(parseWeightRange('400')).toEqual([400, 400]);
        expect(parseWeightRange('bold')).toEqual([700, 700]);
        expect(parseWeightRange('100 900')).toEqual([100, 900]);
        expect(parseWeightRange('')).toEqual([400, 400]);
    });
});

describe('parseFontFaceBlocks', () => {
    it('should extract @font-face rules with their descriptors', () => {
        const css = `
            /* comment with @font-face { inside } */
            body { color: red; }
            @font-face {
                font-family: "Karla";
                font-style: italic;
                font-weight: 700;
                unicode-range: U+0000-00FF;
                src: url(../fonts/karla.woff2) format('woff2');
            }
            @media screen {
                @font-face { font-family: Nested; src: url(nested.woff); }
            }
            @font-face { font-family: NoSrc; }
        `;
        const rules = parseFontFaceBlocks(css, 'https://example.com/css/app.css');
        expect(rules).toHaveLength(2);
        expect(rules[0]).toMatchObject({
            family: '"Karla"',
            style: 'italic',
            weight: '700',
            unicodeRange: 'U+0000-00FF',
            src: "url(../fonts/karla.woff2) format('woff2')",
            base: 'https://example.com/css/app.css'
        });
        expect(rules[1]).toMatchObject({family: 'Nested', weight: 'normal', style: 'normal'});
    });
});

describe('collectFontFaceRules', () => {
    const cssomFontFace = (descriptors: Record<string, string>) => ({
        type: 5,
        style: {getPropertyValue: (property: string) => descriptors[property] ?? ''}
    });

    const stubDocument = (sheets: unknown[], matchMedia?: (q: string) => {matches: boolean}): Document =>
        ({
            styleSheets: sheets,
            baseURI: 'https://example.com/page/',
            defaultView: matchMedia ? {matchMedia} : null
        }) as unknown as Document;

    it('should walk CSSOM rules including grouping and @import rules', async () => {
        const imported = {
            href: 'https://example.com/css/imported.css',
            cssRules: [cssomFontFace({'font-family': 'Imported', src: 'url(i.woff2)'})]
        };
        const sheet = {
            href: 'https://example.com/css/app.css',
            cssRules: [
                cssomFontFace({'font-family': 'Karla', src: 'url(k.woff2)', 'unicode-range': 'U+0-FF'}),
                {type: 3, styleSheet: imported},
                {
                    type: 4,
                    media: {mediaText: 'screen'},
                    cssRules: [cssomFontFace({'font-family': 'InMedia', src: 'url(m.woff2)'})]
                },
                {type: 1} // a style rule: ignored
            ]
        };

        const fetchText = vi.fn(async () => null);
        const rules = await collectFontFaceRules(stubDocument([sheet]), fetchText);

        expect(rules.map((rule) => rule.family)).toEqual(['Karla', 'Imported', 'InMedia']);
        expect(rules[0].base).toBe('https://example.com/css/app.css');
        expect(rules[1].base).toBe('https://example.com/css/imported.css');
        expect(fetchText).not.toHaveBeenCalled();
    });

    it('should skip non-matching @media blocks when matchMedia is available', async () => {
        const sheet = {
            href: null,
            cssRules: [
                {
                    type: 4,
                    media: {mediaText: 'print'},
                    cssRules: [cssomFontFace({'font-family': 'PrintOnly', src: 'url(p.woff2)'})]
                }
            ]
        };
        const rules = await collectFontFaceRules(
            stubDocument([sheet], (q) => ({matches: q !== 'print'})),
            async () => null
        );
        expect(rules).toEqual([]);
    });

    it('should re-fetch cross-origin sheets whose cssRules access throws', async () => {
        const blocked = {
            href: 'https://cdn.example.org/fonts.css',
            get cssRules(): CSSRuleList {
                throw new DOMException('blocked', 'SecurityError');
            }
        };
        const fetchText = vi.fn(async (url: string) =>
            url === 'https://cdn.example.org/fonts.css'
                ? '@font-face { font-family: Remote; src: url(remote.woff2); }'
                : null
        );

        const rules = await collectFontFaceRules(stubDocument([blocked]), fetchText);
        expect(fetchText).toHaveBeenCalledWith('https://cdn.example.org/fonts.css');
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({family: 'Remote', base: 'https://cdn.example.org/fonts.css'});
    });

    it('should tolerate fetch failures for blocked sheets', async () => {
        const blocked = {
            href: 'https://cdn.example.org/fonts.css',
            get cssRules(): CSSRuleList {
                throw new DOMException('blocked', 'SecurityError');
            }
        };
        const rules = await collectFontFaceRules(stubDocument([blocked]), async () => null);
        expect(rules).toEqual([]);
    });
});

describe('collectUsedFonts', () => {
    it('should collect family lists, weights, styles and codepoints from text-bearing elements', () => {
        document.body.innerHTML = `
            <div id="a" style="font-family: Karla, sans-serif; font-weight: 700; font-style: italic">Bold αβ</div>
            <div style="font-family: Karla, sans-serif; font-weight: 700; font-style: italic">duplicate usage</div>
            <div style="font-family: Other">   </div>
        `;
        const used = collectUsedFonts(document.body);

        expect(used.usages).toContainEqual({families: ['karla', 'sans-serif'], weight: 700, style: 'italic'});
        // the whitespace-only element contributes nothing; the duplicate usage is deduped
        expect(used.usages.filter((usage) => usage.families[0] === 'karla')).toHaveLength(1);
        expect(used.usages.some((usage) => usage.families[0] === 'other')).toBe(false);

        expect(used.codepoints.has('B'.codePointAt(0) as number)).toBe(true);
        expect(used.codepoints.has('α'.codePointAt(0) as number)).toBe(true);
        // whitespace never lands in the codepoint set
        expect(used.codepoints.has(0x20)).toBe(false);
    });

    it('should include input value/placeholder text', () => {
        document.body.innerHTML = `<input style="font-family: FormFont" value="Yes" placeholder="ω">`;
        const used = collectUsedFonts(document.body);
        expect(used.usages).toContainEqual({families: ['formfont'], weight: 400, style: 'normal'});
        expect(used.codepoints.has('Y'.codePointAt(0) as number)).toBe(true);
        expect(used.codepoints.has('ω'.codePointAt(0) as number)).toBe(true);
    });

    it('should add text-transformed codepoints', () => {
        document.body.innerHTML = `<div style="font-family: T; text-transform: uppercase">abc</div>`;
        const used = collectUsedFonts(document.body);
        expect(used.codepoints.has('a'.codePointAt(0) as number)).toBe(true);
        expect(used.codepoints.has('A'.codePointAt(0) as number)).toBe(true);
    });
});

describe('selectUsedFaces', () => {
    const usage = (overrides: Partial<UsedFonts['usages'][0]> = {}): UsedFonts['usages'][0] => ({
        families: ['testfont'],
        weight: 400,
        style: 'normal',
        ...overrides
    });

    it('should only keep faces of families that are actually used', () => {
        const karla = face({family: 'Karla'});
        const unused = face({family: 'Unused'});
        const used: UsedFonts = {usages: [usage({families: ['karla']})], codepoints: codepointsOf('x')};
        expect(selectUsedFaces([karla, unused], used)).toEqual([karla]);
    });

    it('should pick the nearest weight', () => {
        const regular = face({weight: '400'});
        const bold = face({weight: '700'});
        const used: UsedFonts = {usages: [usage({weight: 600})], codepoints: codepointsOf('x')};
        expect(selectUsedFaces([regular, bold], used)).toEqual([bold]);
    });

    it('should treat variable weight ranges as containing their span', () => {
        const variable = face({weight: '100 900'});
        const fixed = face({weight: '500'});
        const used: UsedFonts = {usages: [usage({weight: 300})], codepoints: codepointsOf('x')};
        expect(selectUsedFaces([variable, fixed], used)).toEqual([variable]);
    });

    it('should match style categories with italic/oblique as mutual fallbacks', () => {
        const normal = face({style: 'normal'});
        const italic = face({style: 'italic'});
        const oblique = face({style: 'oblique 10deg'});

        const italicUsage: UsedFonts = {usages: [usage({style: 'italic'})], codepoints: codepointsOf('x')};
        expect(selectUsedFaces([normal, italic, oblique], italicUsage)).toEqual([italic]);
        expect(selectUsedFaces([normal, oblique], italicUsage)).toEqual([oblique]);
        // with no slanted face at all, the normal face is kept (browsers synthesize italic)
        expect(selectUsedFaces([normal], italicUsage)).toEqual([normal]);
    });

    it('should keep all unicode-range variants of the matched weight and prune non-intersecting ones', () => {
        const latin = face({unicodeRange: 'U+0000-00FF'});
        const latinExt = face({unicodeRange: 'U+0100-024F'});
        const greek = face({unicodeRange: 'U+0370-03FF'});
        const used: UsedFonts = {usages: [usage()], codepoints: codepointsOf('aĚ')};

        expect(selectUsedFaces([latin, latinExt, greek], used)).toEqual([latin, latinExt]);
    });

    it('should keep faces without a unicode-range', () => {
        const open = face({});
        const used: UsedFonts = {usages: [usage()], codepoints: codepointsOf('α')};
        expect(selectUsedFaces([open], used)).toEqual([open]);
    });
});

describe('buildFontFaceCss', () => {
    it('should emit @font-face rules with data url sources and preserved descriptors', async () => {
        const rule = face({
            family: `'Karla'`,
            weight: '700',
            style: 'italic',
            unicodeRange: 'U+0000-00FF',
            src: 'url(../fonts/karla.woff2) format("woff2")'
        });
        const load = vi.fn(async () => 'data:font/woff2;base64,QUJD');

        const css = await buildFontFaceCss([rule], load);

        // relative src urls resolve against the owning stylesheet's url
        expect(load).toHaveBeenCalledWith('https://example.com/fonts/karla.woff2');
        expect(css).toContain('font-family: "Karla"');
        expect(css).toContain('font-style: italic');
        expect(css).toContain('font-weight: 700');
        expect(css).toContain('unicode-range: U+0000-00FF');
        expect(css).toContain('src: url("data:font/woff2;base64,QUJD") format("woff2")');
    });

    it('should drop faces whose binary cannot be loaded or that have no embeddable src', async () => {
        const unloadable = face({});
        const localOnly = face({family: 'LocalOnly', src: 'local("LocalOnly")'});
        const css = await buildFontFaceCss([unloadable, localOnly], async () => null);
        expect(css).toBe('');
    });
});

describe('createFontDataLoader', () => {
    class StubXHR {
        static sent = 0;
        responseType = '';
        timeout = 0;
        withCredentials = false;
        status = 200;
        response: Blob = new Blob([new Uint8Array([0x41, 0x42, 0x43])], {type: 'font/woff2'});
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        ontimeout: (() => void) | null = null;
        open(): void {}
        send(): void {
            StubXHR.sent++;
            setTimeout(() => this.onload?.(), 0);
        }
    }

    const contextWithCache = (cache: object): CaptureContext =>
        ({
            cache,
            logger: {debug: () => undefined, error: () => undefined},
            options: {resources: {cors: 'off', allowTaint: false, imageTimeout: 1000}}
        }) as unknown as CaptureContext;

    it('should cache font data urls across captures sharing a resource cache (keyed by url)', async () => {
        vi.stubGlobal('XMLHttpRequest', StubXHR);
        try {
            StubXHR.sent = 0;
            const sharedCache = {};
            const first = createFontDataLoader(contextWithCache(sharedCache));
            const second = createFontDataLoader(contextWithCache(sharedCache));
            const other = createFontDataLoader(contextWithCache({}));

            const url = 'https://example.com/fonts/karla.woff2';
            const dataUrl = await first(url);
            expect(dataUrl).toMatch(/^data:/);
            expect(await second(url)).toBe(dataUrl);
            expect(StubXHR.sent).toBe(1);

            // a different resource cache fetches independently
            await other(url);
            expect(StubXHR.sent).toBe(2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('should pass data: urls through without fetching', async () => {
        vi.stubGlobal('XMLHttpRequest', StubXHR);
        try {
            StubXHR.sent = 0;
            const load = createFontDataLoader(contextWithCache({}));
            expect(await load('data:font/woff2;base64,QUJD')).toBe('data:font/woff2;base64,QUJD');
            expect(StubXHR.sent).toBe(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('embedWebFonts', () => {
    const stubContext = (): CaptureContext =>
        ({
            cache: {},
            logger: {debug: () => undefined, error: () => undefined},
            options: {resources: {cors: 'off', allowTaint: false, imageTimeout: 1000}}
        }) as unknown as CaptureContext;

    const sheetWith = (rules: unknown[]): Document =>
        ({
            styleSheets: [{href: null, cssRules: rules}],
            baseURI: 'https://example.com/',
            defaultView: null
        }) as unknown as Document;

    const cssomFontFace = (descriptors: Record<string, string>) => ({
        type: 5,
        style: {getPropertyValue: (property: string) => descriptors[property] ?? ''}
    });

    it('should embed used faces (data url src passes through without fetching) and prune by unicode-range', async () => {
        document.body.innerHTML = `<div style="font-family: EmbedFont">latin only</div>`;

        const usedFace = cssomFontFace({
            'font-family': 'EmbedFont',
            src: 'url(data:font/woff2;base64,TEFUSU4=) format("woff2")',
            'unicode-range': 'U+0000-00FF'
        });
        const prunedFace = cssomFontFace({
            'font-family': 'EmbedFont',
            src: 'url(data:font/woff2;base64,R1JFRUs=) format("woff2")',
            'unicode-range': 'U+0370-03FF'
        });

        const css = await embedWebFonts(sheetWith([usedFace, prunedFace]), document.body, stubContext());

        expect(css).toContain('TEFUSU4=');
        expect(css).not.toContain('R1JFRUs=');
        expect(css.match(/@font-face/g)).toHaveLength(1);
    });

    it('should return an empty string when no text or no rules are present', async () => {
        document.body.innerHTML = `<div style="font-family: EmbedFont"></div>`;
        expect(await embedWebFonts(sheetWith([]), document.body, stubContext())).toBe('');

        document.body.innerHTML = `<div style="font-family: EmbedFont">text</div>`;
        expect(await embedWebFonts(sheetWith([]), document.body, stubContext())).toBe('');
    });

    it('should never throw (font embedding failures degrade to fallback rendering)', async () => {
        const broken = {
            get styleSheets(): StyleSheetList {
                throw new Error('boom');
            }
        } as unknown as Document;
        document.body.innerHTML = `<div style="font-family: EmbedFont">text</div>`;
        expect(await embedWebFonts(broken, document.body, stubContext())).toBe('');
    });
});
