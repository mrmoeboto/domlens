import {CaptureContext} from '../../capture-context';
import {Cache, CacheStorage} from '../../resources/cache-storage';
import {Logger} from '../../logger';

/**
 * Web font embedding for the svg engine (`<svg><foreignObject>` markup rendered as an
 * image cannot load external resources, so every needed @font-face must be re-emitted with
 * a `data:` url src).
 *
 * Pipeline (see {@link embedWebFonts}):
 *  1. discover @font-face rules: CSSOM walk over the source document's stylesheets
 *     (including @import/@media nesting and constructable/adopted sheets); cross-origin
 *     sheets whose cssRules are blocked are re-fetched as text and parsed with a tolerant
 *     regex parser ({@link parseFontFaceBlocks}); `document.fonts` complements the walk as
 *     a readiness/coverage signal (JS-constructed FontFace objects expose no src and can
 *     never be re-fetched — they are logged, not embedded),
 *  2. determine which family/weight/style combinations the capture subtree actually uses
 *     by walking the cloned (style-inlined) tree ({@link collectUsedFonts}),
 *  3. select the matching faces with a simplified CSS font-matching pass and prune faces
 *     whose `unicode-range` cannot match any character used in the subtree
 *     ({@link selectUsedFaces}) — a codepoint-set check, not glyph subsetting (Phase 6),
 *  4. fetch the needed binaries and emit a `@font-face` CSS block with `data:` url sources
 *     ({@link buildFontFaceCss}), which serializer.ts injects as a `<style>` element.
 *
 * Font data urls are cached across captures keyed by absolute url, scoped to the shared
 * resource {@link Cache} (pass `resources.cache` to share the cache between captures).
 */

/** A discovered @font-face rule (descriptor values as authored / as reported by CSSOM). */
export interface FontFaceRule {
    /** font-family descriptor value, quotes preserved as reported. */
    family: string;
    /** Raw src descriptor value: comma-separated url()/local() sources with format() hints. */
    src: string;
    style: string;
    weight: string;
    stretch: string;
    /** unicode-range descriptor value; empty string = the full range. */
    unicodeRange: string;
    /** Base url the src url() references resolve against (the owning stylesheet's url). */
    base: string;
}

/** One distinct family-list/weight/style combination used by text in the capture subtree. */
export interface FontUsage {
    /** Normalized (unquoted, lowercased) font-family fallback list. */
    families: string[];
    weight: number;
    /** Normalized style category: 'normal' | 'italic' | 'oblique'. */
    style: string;
}

export interface UsedFonts {
    usages: FontUsage[];
    /** Set of non-whitespace codepoints appearing in the subtree's rendered text. */
    codepoints: Set<number>;
}

const FONT_FACE_RULE = 5; // CSSRule.FONT_FACE_RULE
const IMPORT_RULE = 3; // CSSRule.IMPORT_RULE

const WEIGHT_KEYWORDS: Record<string, number> = {normal: 400, bold: 700, bolder: 700, lighter: 100};

export const normalizeFamily = (value: string): string =>
    value
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim()
        .toLowerCase();

/** Splits a font-family list value into normalized family names. */
export const parseFontFamilies = (value: string): string[] =>
    value
        .split(',')
        .map(normalizeFamily)
        .filter((family) => family.length > 0);

const parseUsedWeight = (value: string): number => {
    const first = value.trim().split(/\s+/)[0] ?? '';
    const keyword = WEIGHT_KEYWORDS[first.toLowerCase()];
    if (typeof keyword === 'number') {
        return keyword;
    }
    const parsed = parseFloat(first);
    return isNaN(parsed) ? 400 : parsed;
};

/** Reduces a font-style value to its matching category ('normal' | 'italic' | 'oblique'). */
const styleCategory = (value: string): string => {
    const first = (value.trim().split(/\s+/)[0] ?? '').toLowerCase();
    return first === 'italic' || first === 'oblique' ? first : 'normal';
};

/**
 * Parses a unicode-range descriptor value into inclusive [start, end] codepoint ranges.
 * Wildcard tokens (U+4??) expand to their min/max. A non-empty value that yields no valid
 * range parses as the full range, so malformed input never prunes a face.
 */
export const parseUnicodeRange = (value: string): Array<[number, number]> => {
    const ranges: Array<[number, number]> = [];
    for (const token of value.split(',')) {
        const match = token.trim().match(/^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
        if (!match) {
            continue;
        }
        const [, startToken, endToken] = match;
        const start = parseInt(startToken.replace(/\?/g, '0'), 16);
        const end = endToken ? parseInt(endToken, 16) : parseInt(startToken.replace(/\?/g, 'f'), 16);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
            ranges.push([start, end]);
        }
    }
    if (!ranges.length && value.trim().length) {
        ranges.push([0, 0x10ffff]);
    }
    return ranges;
};

/** Whether a face with the given unicode-range can render any of the used codepoints. */
export const unicodeRangeMatches = (unicodeRange: string, codepoints: Set<number>): boolean => {
    if (!unicodeRange.trim()) {
        return true;
    }
    const ranges = parseUnicodeRange(unicodeRange);
    for (const codepoint of codepoints) {
        for (const [start, end] of ranges) {
            if (codepoint >= start && codepoint <= end) {
                return true;
            }
        }
    }
    return false;
};

export interface FontSource {
    kind: 'url' | 'local';
    value: string;
    format?: string;
}

const SRC_TOKEN =
    /(local|url)\(\s*(?:'([^']*)'|"([^"]*)"|([^'")][^)]*?))\s*\)(?:\s+format\(\s*(?:'([^']*)'|"([^"]*)"|([^'")][^)]*?))\s*\))?/gi;

/** Parses a src descriptor value into its url()/local() sources with format() hints. */
export const parseFontSrc = (src: string): FontSource[] => {
    const sources: FontSource[] = [];
    for (const match of src.matchAll(SRC_TOKEN)) {
        const [, kind, single, double, bare, formatSingle, formatDouble, formatBare] = match;
        const value = (single ?? double ?? bare ?? '').trim();
        if (!value) {
            continue;
        }
        const format = (formatSingle ?? formatDouble ?? formatBare ?? '').trim().toLowerCase();
        sources.push({
            kind: kind.toLowerCase() === 'local' ? 'local' : 'url',
            value,
            format: format || undefined
        });
    }
    return sources;
};

const formatFromUrl = (url: string): string | undefined => {
    const path = url.split(/[?#]/)[0];
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    switch (extension) {
        case 'woff2':
            return 'woff2';
        case 'woff':
            return 'woff';
        case 'ttf':
            return 'truetype';
        case 'otf':
            return 'opentype';
        case 'eot':
            return 'embedded-opentype';
        default:
            return undefined;
    }
};

const FORMAT_PRIORITY: Record<string, number> = {
    woff2: 5,
    woff: 4,
    truetype: 3,
    opentype: 3,
    // legacy formats no modern browser will render from a data url; never picked.
    'embedded-opentype': -1,
    svg: -1
};

/**
 * Picks the single source to embed for a face: the highest-priority url() source by format
 * (woff2 > woff > truetype/opentype > unhinted), first-wins on ties (CSS src order is a
 * preference list). local() sources and legacy formats (eot, svg) are never picked.
 */
export const pickFontSource = (sources: FontSource[]): {url: string; format?: string} | null => {
    let best: {url: string; format?: string} | null = null;
    let bestPriority = -1;
    for (const source of sources) {
        if (source.kind !== 'url') {
            continue;
        }
        const format = source.format ?? formatFromUrl(source.value);
        const priority = format ? (FORMAT_PRIORITY[format] ?? 2) : 2;
        if (priority > bestPriority) {
            best = {url: source.value, format};
            bestPriority = priority;
        }
    }
    return bestPriority < 0 ? null : best;
};

const resolveUrl = (url: string, base: string): string => {
    try {
        return new URL(url, base).href;
    } catch (e) {
        return url;
    }
};

const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Splits a declaration block on top-level semicolons only: a `;` inside url(...) or a
 * quoted string is part of the value (data: urls contain semicolons — `data:font/woff2;
 * base64,...`).
 */
const splitDeclarations = (block: string): string[] => {
    const declarations: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = '';
    for (const ch of block) {
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth = Math.max(0, depth - 1);
        } else if (ch === ';' && depth === 0) {
            declarations.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    declarations.push(current);
    return declarations;
};

/**
 * Tolerant text-level @font-face parser, used for stylesheets whose CSSOM is blocked
 * (cross-origin without CORS) after their text has been re-fetched. Descriptor parsing is
 * line-grammar level — enough for real-world @font-face blocks, which contain no nested
 * braces.
 */
export const parseFontFaceBlocks = (cssText: string, base: string): FontFaceRule[] => {
    const rules: FontFaceRule[] = [];
    const text = stripCssComments(cssText);
    for (const match of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
        const descriptors = new Map<string, string>();
        for (const declaration of splitDeclarations(match[1])) {
            const colon = declaration.indexOf(':');
            if (colon === -1) {
                continue;
            }
            const property = declaration.slice(0, colon).trim().toLowerCase();
            const value = declaration.slice(colon + 1).trim();
            if (property && value) {
                descriptors.set(property, value);
            }
        }

        const family = descriptors.get('font-family');
        const src = descriptors.get('src');
        if (family && src) {
            rules.push({
                family,
                src,
                style: descriptors.get('font-style') ?? 'normal',
                weight: descriptors.get('font-weight') ?? 'normal',
                stretch: descriptors.get('font-stretch') ?? '',
                unicodeRange: descriptors.get('unicode-range') ?? '',
                base
            });
        }
    }
    return rules;
};

const fontFaceFromCssom = (rule: CSSFontFaceRule, base: string): FontFaceRule | null => {
    const style = rule.style;
    if (!style || typeof style.getPropertyValue !== 'function') {
        return null;
    }
    const family = style.getPropertyValue('font-family').trim();
    const src = style.getPropertyValue('src').trim();
    if (!family || !src) {
        return null;
    }
    return {
        family,
        src,
        style: style.getPropertyValue('font-style').trim() || 'normal',
        weight: style.getPropertyValue('font-weight').trim() || 'normal',
        stretch: style.getPropertyValue('font-stretch').trim(),
        unicodeRange: style.getPropertyValue('unicode-range').trim(),
        base
    };
};

export type TextFetcher = (url: string) => Promise<string | null>;

/**
 * Discovers every reachable @font-face rule of a document: document.styleSheets and
 * adopted (constructable) stylesheets, recursing into @import and grouping rules
 * (@media/@supports/@layer; non-matching media blocks are skipped when matchMedia is
 * available). Cross-origin sheets whose cssRules access throws are re-fetched as text via
 * `fetchText` (resource-cache CORS/proxy policy) and parsed textually; fetch failures are
 * tolerated and simply yield no rules for that sheet.
 */
export const collectFontFaceRules = async (document: Document, fetchText: TextFetcher): Promise<FontFaceRule[]> => {
    const rules: FontFaceRule[] = [];
    const view = document.defaultView;
    const visited = new Set<unknown>();

    const mediaMatches = (condition: string): boolean => {
        if (!condition.trim() || !view || typeof view.matchMedia !== 'function') {
            return true;
        }
        try {
            return view.matchMedia(condition).matches;
        } catch (e) {
            return true;
        }
    };

    const walkRules = async (list: CSSRuleList, base: string): Promise<void> => {
        for (let i = 0; i < list.length; i++) {
            const rule = list[i];
            if (rule.type === FONT_FACE_RULE) {
                const fontFace = fontFaceFromCssom(rule as CSSFontFaceRule, base);
                if (fontFace) {
                    rules.push(fontFace);
                }
            } else if (rule.type === IMPORT_RULE) {
                const importRule = rule as CSSImportRule;
                if (importRule.styleSheet) {
                    await walkSheet(importRule.styleSheet, base);
                } else if (importRule.href) {
                    await fetchSheet(resolveUrl(importRule.href, base));
                }
            } else {
                const grouping = rule as CSSGroupingRule & {media?: MediaList};
                if (grouping.cssRules) {
                    if (rule.type === 4 /* MEDIA_RULE */ && grouping.media && !mediaMatches(grouping.media.mediaText)) {
                        continue;
                    }
                    await walkRules(grouping.cssRules, base);
                }
            }
        }
    };

    const fetchSheet = async (url: string): Promise<void> => {
        if (visited.has(url)) {
            return;
        }
        visited.add(url);
        const text = await fetchText(url);
        if (text) {
            rules.push(...parseFontFaceBlocks(text, url));
        }
    };

    const walkSheet = async (sheet: CSSStyleSheet, fallbackBase: string): Promise<void> => {
        if (visited.has(sheet)) {
            return;
        }
        visited.add(sheet);
        if (sheet.media && sheet.media.mediaText && !mediaMatches(sheet.media.mediaText)) {
            return;
        }

        const base = sheet.href ? resolveUrl(sheet.href, fallbackBase) : fallbackBase;
        let list: CSSRuleList | null = null;
        try {
            list = sheet.cssRules;
        } catch (e) {
            // Cross-origin stylesheet: CSSOM access is blocked; re-fetch the text instead.
        }

        if (list) {
            await walkRules(list, base);
        } else if (sheet.href) {
            await fetchSheet(base);
        }
    };

    const documentBase = document.baseURI ?? 'about:blank';
    for (const sheet of Array.from(document.styleSheets ?? [])) {
        await walkSheet(sheet as CSSStyleSheet, documentBase);
    }
    const adopted = (document as Document & {adoptedStyleSheets?: CSSStyleSheet[]}).adoptedStyleSheets;
    if (Array.isArray(adopted)) {
        for (const sheet of adopted) {
            await walkSheet(sheet, documentBase);
        }
    }

    return rules;
};

const directText = (element: Element): string => {
    let text = '';
    for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 /* TEXT_NODE */) {
            text += child.nodeValue ?? '';
        }
    }
    if (element.tagName === 'INPUT') {
        text += element.getAttribute('value') ?? '';
        text += element.getAttribute('placeholder') ?? '';
    }
    return text;
};

const applyTextTransform = (text: string, transform: string): string => {
    if (transform.indexOf('uppercase') !== -1) {
        return text + text.toUpperCase();
    }
    if (transform.indexOf('lowercase') !== -1) {
        return text + text.toLowerCase();
    }
    if (transform.indexOf('capitalize') !== -1) {
        return text + text.replace(/(^|\s)(\S)/g, (token) => token.toUpperCase());
    }
    return text;
};

/**
 * Walks the cloned (computed-style-inlined) tree and collects which font-family lists,
 * weights and styles its text actually renders with, plus the set of used codepoints.
 * Styles are read with getComputedStyle against the live clone iframe so inheritance of
 * the inlined values is resolved by the browser (one call per text-bearing element);
 * environments without a view (detached trees in unit tests) fall back to inline styles.
 * text-transform'ed elements contribute their transformed codepoints too (the transformed
 * characters are what the renderer needs glyphs for).
 */
export const collectUsedFonts = (root: Element): UsedFonts => {
    const view = root.ownerDocument ? root.ownerDocument.defaultView : null;
    const usages: FontUsage[] = [];
    const seen = new Set<string>();
    const codepoints = new Set<number>();

    const elements = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const element of elements) {
        let text = directText(element);
        if (!/\S/.test(text)) {
            continue;
        }

        const style: {getPropertyValue(property: string): string} = view
            ? view.getComputedStyle(element)
            : ((element as HTMLElement).style ?? {getPropertyValue: () => ''});

        text = applyTextTransform(text, style.getPropertyValue('text-transform'));
        for (const character of text) {
            if (!/\s/.test(character)) {
                codepoints.add(character.codePointAt(0) as number);
            }
        }

        const families = parseFontFamilies(style.getPropertyValue('font-family'));
        if (!families.length) {
            continue;
        }
        const weight = parseUsedWeight(style.getPropertyValue('font-weight'));
        const styleValue = styleCategory(style.getPropertyValue('font-style'));

        const key = `${families.join(',')}|${weight}|${styleValue}`;
        if (!seen.has(key)) {
            seen.add(key);
            usages.push({families, weight, style: styleValue});
        }
    }

    return {usages, codepoints};
};

/** Parses a face's font-weight descriptor (single value or range) into [min, max]. */
export const parseWeightRange = (value: string): [number, number] => {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    const weights = tokens
        .map((token) => WEIGHT_KEYWORDS[token.toLowerCase()] ?? parseFloat(token))
        .filter((weight) => !isNaN(weight));
    if (!weights.length) {
        return [400, 400];
    }
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    return [min, max];
};

const styleMatchScore = (faceStyle: string, usageStyle: string): number => {
    const face = styleCategory(faceStyle);
    if (face === usageStyle) {
        return 2;
    }
    if (face !== 'normal' && usageStyle !== 'normal') {
        // italic <-> oblique are mutual synthesis fallbacks in CSS font matching.
        return 1;
    }
    return 0;
};

const weightDistance = (range: [number, number], weight: number): number =>
    weight >= range[0] && weight <= range[1] ? 0 : Math.min(Math.abs(weight - range[0]), Math.abs(weight - range[1]));

/**
 * Simplified CSS font matching: for every usage and every family in its fallback list, the
 * faces of that family are filtered to the best style category match, then to the nearest
 * weight (all ties kept — faces of one weight typically differ only by unicode-range).
 * Finally faces whose unicode-range cannot match any used codepoint are pruned. Original
 * rule order is preserved.
 */
export const selectUsedFaces = (rules: FontFaceRule[], used: UsedFonts): FontFaceRule[] => {
    const byFamily = new Map<string, FontFaceRule[]>();
    for (const rule of rules) {
        const family = normalizeFamily(rule.family);
        const faces = byFamily.get(family);
        if (faces) {
            faces.push(rule);
        } else {
            byFamily.set(family, [rule]);
        }
    }

    const selected = new Set<FontFaceRule>();
    for (const usage of used.usages) {
        for (const family of usage.families) {
            const faces = byFamily.get(family);
            if (!faces) {
                continue;
            }

            const scores = faces.map((face) => styleMatchScore(face.style, usage.style));
            const bestScore = Math.max(...scores);
            const styleMatched = faces.filter((_, i) => scores[i] === bestScore);

            const distances = styleMatched.map((face) => weightDistance(parseWeightRange(face.weight), usage.weight));
            const bestDistance = Math.min(...distances);
            styleMatched.filter((_, i) => distances[i] === bestDistance).forEach((face) => selected.add(face));
        }
    }

    return rules.filter((rule) => selected.has(rule) && unicodeRangeMatches(rule.unicodeRange, used.codepoints));
};

const escapeFamily = (family: string): string =>
    `"${normalizeRawFamily(family).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Strips the (single pair of) quotes a CSSOM family value may carry, preserving case. */
const normalizeRawFamily = (family: string): string => family.trim().replace(/^['"]|['"]$/g, '');

export type FontDataLoader = (url: string) => Promise<string | null>;

/**
 * Emits the @font-face CSS block for the selected faces, with each face's best source
 * fetched and inlined as a data url. Faces whose binary cannot be loaded are dropped (the
 * raster falls back to the next face / default font for them, same as a failed font load
 * on a live page).
 */
export const buildFontFaceCss = async (
    faces: FontFaceRule[],
    load: FontDataLoader,
    logger?: Logger
): Promise<string> => {
    const blocks = await Promise.all(
        faces.map(async (face) => {
            const source = pickFontSource(parseFontSrc(face.src));
            if (!source) {
                logger?.debug(`No embeddable src for font face ${face.family}`);
                return '';
            }

            const url = resolveUrl(source.url, face.base);
            const dataUrl = await load(url);
            if (!dataUrl) {
                logger?.debug(`Unable to load font ${url.substring(0, 256)} for ${face.family}`);
                return '';
            }

            const descriptors = [
                `font-family: ${escapeFamily(face.family)}`,
                `font-style: ${face.style || 'normal'}`,
                `font-weight: ${face.weight || 'normal'}`
            ];
            if (face.stretch && face.stretch !== 'normal') {
                descriptors.push(`font-stretch: ${face.stretch}`);
            }
            if (face.unicodeRange) {
                descriptors.push(`unicode-range: ${face.unicodeRange}`);
            }
            descriptors.push(`src: url("${dataUrl}")${source.format ? ` format("${source.format}")` : ''}`);

            return `@font-face { ${descriptors.join('; ')}; }`;
        })
    );
    return blocks.filter(Boolean).join('\n');
};

const isDataUrl = (url: string): boolean => url.indexOf('data:') === 0;

const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result as string), false);
        reader.addEventListener('error', (e) => reject(e), false);
        reader.readAsDataURL(blob);
    });

const xhrFetch = (
    url: string,
    responseType: 'text' | 'blob',
    timeout: number,
    withCredentials: boolean
): Promise<string | Blob> =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            } else {
                reject(new Error(`Failed to fetch ${url.substring(0, 256)}: status ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error(`Failed to fetch ${url.substring(0, 256)}`));
        xhr.open('GET', url);
        xhr.responseType = responseType;
        xhr.withCredentials = withCredentials;
        if (timeout > 0) {
            xhr.timeout = timeout;
            xhr.ontimeout = () => reject(new Error(`Timed out (${timeout}ms) fetching ${url.substring(0, 256)}`));
        }
        xhr.send();
    });

const proxiedUrl = (url: string, proxy: string): string => {
    const separator = proxy.indexOf('?') > -1 ? '&' : '?';
    return `${proxy}${separator}url=${encodeURIComponent(url)}&responseType=blob`;
};

/**
 * Fetches a resource under the capture's resource policy: direct request first (font and
 * stylesheet fetches are CORS-mode by spec, so a resource the live page could render is
 * fetchable anonymously — credentials are only attached for `cors: 'use-credentials'`),
 * proxy fallback for cross-origin failures when configured. Failures resolve to null.
 */
const fetchResource = async (url: string, context: CaptureContext, as: 'text' | 'blob'): Promise<string | null> => {
    const {imageTimeout, cors, proxy} = context.options.resources;
    const sameOrigin = CacheStorage.isSameOrigin(url);

    try {
        const response = await xhrFetch(url, as, imageTimeout, !sameOrigin && cors === 'use-credentials');
        return typeof response === 'string' ? response : await blobToDataUrl(response);
    } catch (e) {
        if (!sameOrigin && typeof proxy === 'string' && proxy.length) {
            try {
                const blob = await xhrFetch(proxiedUrl(url, proxy), 'blob', imageTimeout, false);
                if (typeof blob !== 'string') {
                    return as === 'blob' ? await blobToDataUrl(blob) : await blob.text();
                }
                return blob;
            } catch (proxyError) {
                context.logger.debug(`Unable to proxy ${url.substring(0, 256)}: ${proxyError}`);
            }
        }
        context.logger.debug(`Unable to fetch ${url.substring(0, 256)}: ${e}`);
        return null;
    }
};

const fetchStylesheetText = async (url: string, context: CaptureContext): Promise<string | null> =>
    fetchResource(url, context, 'text');

/**
 * Per-resource-cache font data url store: data urls survive across captures that share a
 * {@link Cache} (`resources.cache` option), keyed by absolute font url. WeakMap-scoped so
 * a discarded cache releases its font data.
 */
const fontDataCaches = new WeakMap<Cache, Map<string, Promise<string | null>>>();

export const createFontDataLoader = (context: CaptureContext): FontDataLoader => {
    let store = fontDataCaches.get(context.cache);
    if (!store) {
        store = new Map();
        fontDataCaches.set(context.cache, store);
    }
    const cache = store;

    return (url: string) => {
        if (isDataUrl(url)) {
            return Promise.resolve(url);
        }
        let pending = cache.get(url);
        if (!pending) {
            pending = fetchResource(url, context, 'blob');
            cache.set(url, pending);
        }
        return pending;
    };
};

/** Families document.fonts knows about (normalized); empty when FontFaceSet is unavailable. */
const documentFontFamilies = (document: Document): Set<string> => {
    const families = new Set<string>();
    const fonts = (document as Document & {fonts?: Iterable<FontFace>}).fonts;
    if (fonts) {
        try {
            for (const face of fonts) {
                families.add(normalizeFamily(face.family));
            }
        } catch (e) {
            // FontFaceSet iteration unsupported; the CSSOM walk remains authoritative.
        }
    }
    return families;
};

/**
 * Top-level entry used by the svg engine: discovers, selects and inlines the web fonts the
 * cloned tree needs, returning the @font-face CSS block to inject into the serialized svg
 * (empty string when no fonts are needed or nothing could be embedded). Never throws —
 * font embedding failures degrade to default-font rendering, not a failed capture.
 */
export const embedWebFonts = async (
    sourceDocument: Document,
    clonedRoot: Element,
    context: CaptureContext
): Promise<string> => {
    try {
        const used = collectUsedFonts(clonedRoot);
        if (!used.usages.length) {
            return '';
        }

        const rules = await collectFontFaceRules(sourceDocument, (url) => fetchStylesheetText(url, context));
        const faces = selectUsedFaces(rules, used);
        if (!faces.length) {
            return '';
        }

        // document.fonts as a coverage signal: a used family the FontFaceSet knows but the
        // CSSOM walk found no rule for is unembeddable (JS-constructed FontFace without an
        // accessible src) — worth surfacing, it will render with a fallback font.
        const known = documentFontFamilies(sourceDocument);
        if (known.size) {
            const embeddable = new Set(faces.map((face) => normalizeFamily(face.family)));
            for (const usage of used.usages) {
                for (const family of usage.families) {
                    if (known.has(family) && !embeddable.has(family)) {
                        context.logger.debug(`Font family "${family}" has no embeddable @font-face rule`);
                    }
                }
            }
        }

        return await buildFontFaceCss(faces, createFontDataLoader(context), context.logger);
    } catch (e) {
        context.logger.error(`Web font embedding failed: ${e}`);
        return '';
    }
};
