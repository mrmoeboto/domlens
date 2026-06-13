const SVG_NS = 'http://www.w3.org/2000/svg';
const IGNORE_ATTRIBUTE = 'data-html2canvas-ignore';

/** Computed default styles of an unstyled element, keyed by longhand property name. */
export type DefaultStyleMap = Map<string, string>;

/**
 * Minimal read surface of CSSStyleDeclaration used by the diffing logic, so unit tests can
 * substitute plain objects (jsdom's getComputedStyle is too sparse to exercise the diff).
 */
export interface StyleDeclarationLike {
    readonly length: number;
    item(index: number): string;
    getPropertyValue(property: string): string;
}

/**
 * Properties never written inline:
 * - `all` / `d`: break rendering when set from computed values (#2476, #2483),
 * - `content`: pseudo content is materialized as child nodes; an inline `content` would
 *   additionally replace element contents in browsers that apply it to real elements.
 */
const IGNORED_PROPERTIES = new Set(['all', 'd', 'content']);

/**
 * Inherited properties (safe whitelist): omitted whenever the value equals the parent's
 * computed value, because inheritance reproduces it in the serialized output. Only
 * properties that are DEFINITELY inherited may be listed here.
 */
const INHERITED_PROPERTIES = new Set([
    'accent-color',
    'border-collapse',
    'border-spacing',
    'caption-side',
    'caret-color',
    'clip-rule',
    'color',
    'color-interpolation',
    'color-interpolation-filters',
    'color-scheme',
    'cursor',
    'direction',
    'dominant-baseline',
    'empty-cells',
    'hyphens',
    'image-rendering',
    'letter-spacing',
    'line-break',
    'line-height',
    'list-style-image',
    'list-style-position',
    'list-style-type',
    'orphans',
    'overflow-wrap',
    'paint-order',
    'pointer-events',
    'print-color-adjust',
    'quotes',
    'shape-rendering',
    'tab-size',
    'text-align',
    'text-align-last',
    'text-anchor',
    'text-decoration-skip-ink',
    'text-emphasis-color',
    'text-emphasis-position',
    'text-emphasis-style',
    'text-indent',
    'text-justify',
    'text-orientation',
    'text-rendering',
    'text-shadow',
    'text-size-adjust',
    'text-transform',
    'text-underline-offset',
    'text-underline-position',
    'visibility',
    'white-space',
    'white-space-collapse',
    'widows',
    'word-break',
    'word-spacing',
    'word-wrap',
    'writing-mode',
    '-moz-tab-size',
    '-webkit-print-color-adjust',
    '-webkit-text-fill-color',
    '-webkit-text-size-adjust',
    '-webkit-text-stroke',
    '-webkit-text-stroke-color',
    '-webkit-text-stroke-width',
    '-webkit-writing-mode'
]);

/** Prefix families that are inherited in their entirety. */
const INHERITED_PREFIXES = ['font', 'fill', 'stroke', 'marker'];

const isInheritedProperty = (property: string): boolean =>
    INHERITED_PROPERTIES.has(property) || INHERITED_PREFIXES.some((prefix) => property.startsWith(prefix));

/**
 * Properties known to be non-inherited: when the computed value equals the tag default it
 * can be omitted regardless of the parent's value. Properties NOT classified here fall back
 * to the conservative rule (only omitted when default AND parent agree), so an incomplete
 * list costs bytes, never correctness — but listing an inherited property here would.
 */
const NON_INHERITED_EXCEPTIONS = new Set(['border-collapse', 'border-spacing', 'overflow-wrap']);
const NON_INHERITED_PREFIXES = [
    'margin',
    'padding',
    'border',
    'background',
    'outline',
    'overflow',
    'flex',
    'grid',
    'gap',
    'row-gap',
    'column',
    'align',
    'justify',
    'place',
    'transform',
    'transition',
    'animation',
    'object',
    'mask',
    'contain',
    'box',
    'inset',
    'min-',
    'max-',
    'scroll-'
];
const NON_INHERITED_PROPERTIES = new Set([
    'appearance',
    'aspect-ratio',
    'backdrop-filter',
    'block-size',
    'bottom',
    'break-after',
    'break-before',
    'break-inside',
    'clear',
    'clip',
    'clip-path',
    'counter-increment',
    'counter-reset',
    'counter-set',
    'display',
    'filter',
    'float',
    'height',
    'inline-size',
    'isolation',
    'left',
    'mix-blend-mode',
    'opacity',
    'order',
    'page-break-after',
    'page-break-before',
    'page-break-inside',
    'perspective',
    'perspective-origin',
    'position',
    'resize',
    'right',
    'rotate',
    'scale',
    'table-layout',
    'text-decoration-color',
    'text-decoration-line',
    'text-decoration-style',
    'text-decoration-thickness',
    'text-overflow',
    'top',
    'touch-action',
    'translate',
    'unicode-bidi',
    'user-select',
    'vertical-align',
    'width',
    'will-change',
    'z-index',
    'zoom',
    '-webkit-user-select'
]);

const THREE_D_BORDER_STYLES = new Set(['inset', 'outset', 'groove', 'ridge']);

/**
 * Whether a computed border-*-style value uses one of the 3D styles. Border colors must
 * stay inline when it does: browsers paint an explicitly-set color differently from the
 * initial currentcolor (Chromium uses its themed gray bevel for the default), so "computed
 * value equals the default" does not imply "renders the same" for them.
 */
const isThreeDBorderStyle = (style: string): boolean =>
    style.split(/\s+/).some((value) => THREE_D_BORDER_STYLES.has(value));

const isBorderColorProperty = (property: string): boolean =>
    property.indexOf('border') === 0 && property.indexOf('-color') === property.length - 6;

const isNonInheritedProperty = (property: string): boolean => {
    if (NON_INHERITED_EXCEPTIONS.has(property)) {
        return false;
    }
    return (
        NON_INHERITED_PROPERTIES.has(property) || NON_INHERITED_PREFIXES.some((prefix) => property.startsWith(prefix))
    );
};

/**
 * Diff behavior classes, resolved once per property name and cached for the lifetime of
 * the page (the classification rules are static): the prefix scans in
 * {@link isInheritedProperty}/{@link isNonInheritedProperty} are far too slow to re-run
 * for every property of every node of a capture.
 */
const enum PropertyClass {
    /** Custom property / ignored property: never written inline. */
    SKIP,
    /** border-*-color: kept inline whenever the matching border style is a 3D style. */
    BORDER_COLOR,
    INHERITED,
    NON_INHERITED,
    UNCLASSIFIED
}

const classificationCache = new Map<string, PropertyClass>();

const classifyProperty = (property: string): PropertyClass => {
    const cached = classificationCache.get(property);
    if (cached !== undefined) {
        return cached;
    }

    let classification: PropertyClass;
    if (!property || property.indexOf('--') === 0 || IGNORED_PROPERTIES.has(property)) {
        classification = PropertyClass.SKIP;
    } else if (isBorderColorProperty(property)) {
        classification = PropertyClass.BORDER_COLOR;
    } else if (isInheritedProperty(property)) {
        classification = PropertyClass.INHERITED;
    } else if (isNonInheritedProperty(property)) {
        classification = PropertyClass.NON_INHERITED;
    } else {
        classification = PropertyClass.UNCLASSIFIED;
    }
    classificationCache.set(property, classification);
    return classification;
};

/**
 * A plain snapshot of an element's computed style (custom properties excluded — computed
 * longhand values already have `var()` references substituted). Snapshots are what the
 * diff reads its parent ("inheritance reference") values from: reading a live
 * CSSStyleDeclaration costs a style-engine call per property, while every element's values
 * are needed once for its own diff and once per child — the snapshot makes those repeat
 * reads plain map lookups.
 */
export type StyleSnapshot = Map<string, string>;

export const snapshotComputedStyle = (computed: StyleDeclarationLike): StyleSnapshot => {
    const snapshot: StyleSnapshot = new Map();
    for (let i = 0, length = computed.length; i < length; i++) {
        const property = computed.item(i);
        if (property && !(property.charCodeAt(0) === 45 && property.charCodeAt(1) === 45)) {
            snapshot.set(property, computed.getPropertyValue(property));
        }
    }
    return snapshot;
};

/**
 * Diffs an element's computed-style snapshot against its tag's default styles and (for
 * inheritance) its parent's snapshot, returning only the property/value pairs that must be
 * written inline to reproduce the rendering without stylesheets:
 *
 * - custom properties (`--*`) are skipped — computed longhand values already have `var()`
 *   references substituted, so the custom properties themselves carry no information,
 * - inherited properties are omitted when they equal the parent's computed value
 *   (inheritance reproduces them); at the tree root they are compared to the defaults,
 * - non-inherited properties are omitted when they equal the tag default,
 * - unclassified properties are omitted only when tag default AND parent value agree, which
 *   is safe whether or not the property inherits.
 */
export const diffStyleSnapshot = (
    snapshot: StyleSnapshot,
    defaults: DefaultStyleMap,
    parentSnapshot: StyleSnapshot | null
): Array<[string, string]> => {
    const result: Array<[string, string]> = [];

    for (const [property, value] of snapshot) {
        switch (classifyProperty(property)) {
            case PropertyClass.SKIP:
                continue;
            case PropertyClass.BORDER_COLOR:
                if (isThreeDBorderStyle(snapshot.get(property.slice(0, -6) + '-style') ?? '')) {
                    break;
                }
                // Not a 3D border: border colors are regular non-inherited properties.
                if (value === defaults.get(property)) {
                    continue;
                }
                break;
            case PropertyClass.INHERITED: {
                const reference = parentSnapshot ? parentSnapshot.get(property) : defaults.get(property);
                if (value === reference) {
                    continue;
                }
                break;
            }
            case PropertyClass.NON_INHERITED:
                if (value === defaults.get(property)) {
                    continue;
                }
                break;
            case PropertyClass.UNCLASSIFIED:
                if (
                    value === defaults.get(property) &&
                    (!parentSnapshot || value === parentSnapshot.get(property))
                ) {
                    continue;
                }
                break;
        }

        result.push([property, value]);
    }

    return result;
};

/**
 * {@link diffStyleSnapshot} for callers holding live (or test-stubbed) style declarations;
 * the snapshot indirection is what makes repeated parent reads cheap, see above.
 */
export const diffComputedStyle = (
    computed: StyleDeclarationLike,
    defaults: DefaultStyleMap,
    parentComputed: StyleDeclarationLike | null
): Array<[string, string]> =>
    diffStyleSnapshot(
        snapshotComputedStyle(computed),
        defaults,
        parentComputed ? snapshotComputedStyle(parentComputed) : null
    );

const snapshot = (computed: CSSStyleDeclaration): DefaultStyleMap => {
    const map: DefaultStyleMap = new Map();
    for (let i = 0; i < computed.length; i++) {
        const property = computed.item(i);
        if (property && property.indexOf('--') !== 0) {
            map.set(property, computed.getPropertyValue(property));
        }
    }
    return map;
};

/**
 * Per-tagName cache of default computed styles, resolved by rendering a bare `<tagName>` in
 * a hidden same-document iframe (about:blank, so only UA styles apply) and snapshotting its
 * computed style. The iframe is created lazily on first lookup and must be removed again
 * with {@link DefaultStyleCache.dispose} once the clone walk is done.
 */
export class DefaultStyleCache {
    private readonly cache = new Map<string, DefaultStyleMap>();
    private sandbox: HTMLIFrameElement | null = null;
    private svgRoot: SVGSVGElement | null = null;

    constructor(private readonly ownerDocument: Document) {}

    get(element: Element): DefaultStyleMap {
        const isSvg = element.namespaceURI === SVG_NS;
        const tagName = element.tagName.toLowerCase();
        let key = isSvg ? `svg:${tagName}` : tagName;
        // Input rendering (and thus its UA defaults) depends on the type attribute.
        const type = tagName === 'input' ? element.getAttribute('type') : null;
        if (type) {
            key += `|${type.toLowerCase()}`;
        }

        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        const defaults = this.compute(tagName, isSvg, type);
        this.cache.set(key, defaults);
        return defaults;
    }

    /** Defaults for a synthesized html element that has no original (e.g. materialized pseudos). */
    getByTag(tagName: string): DefaultStyleMap {
        const key = tagName.toLowerCase();
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const defaults = this.compute(key, false, null);
        this.cache.set(key, defaults);
        return defaults;
    }

    dispose(): void {
        if (this.sandbox && this.sandbox.parentNode) {
            this.sandbox.parentNode.removeChild(this.sandbox);
        }
        this.sandbox = null;
        this.svgRoot = null;
        this.cache.clear();
    }

    private compute(tagName: string, isSvg: boolean, type: string | null): DefaultStyleMap {
        const doc = this.sandboxDocument();
        const view = doc && doc.defaultView;
        if (!doc || !view || !doc.body || !doc.documentElement) {
            // No sandbox (detached document, sandboxed environment): an empty default map
            // makes the diff inline every property, which is safe.
            return new Map();
        }

        // html/body always exist in the sandbox; snapshot them in place so their defaults
        // come from real document structure rather than a misplaced probe element.
        if (!isSvg && tagName === 'html') {
            return snapshot(view.getComputedStyle(doc.documentElement));
        }
        if (!isSvg && tagName === 'body') {
            return snapshot(view.getComputedStyle(doc.body));
        }

        let probe: Element;
        if (isSvg) {
            probe = doc.createElementNS(SVG_NS, tagName);
            this.svgContainer(doc).appendChild(probe);
        } else {
            probe = doc.createElement(tagName);
            if (type) {
                probe.setAttribute('type', type);
            }
            doc.body.appendChild(probe);
        }

        const defaults = snapshot(view.getComputedStyle(probe));
        probe.parentNode?.removeChild(probe);
        return defaults;
    }

    private svgContainer(doc: Document): SVGSVGElement {
        if (!this.svgRoot || this.svgRoot.ownerDocument !== doc) {
            this.svgRoot = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
            doc.body.appendChild(this.svgRoot);
        }
        return this.svgRoot;
    }

    private sandboxDocument(): Document | null {
        if (this.sandbox) {
            return this.sandbox.contentDocument;
        }

        const body = this.ownerDocument.body;
        if (!body) {
            return null;
        }

        const iframe = this.ownerDocument.createElement('iframe');
        iframe.style.visibility = 'hidden';
        iframe.style.position = 'fixed';
        iframe.style.left = '-10000px';
        iframe.style.top = '0px';
        iframe.style.border = '0';
        iframe.width = '100';
        iframe.height = '100';
        iframe.setAttribute(IGNORE_ATTRIBUTE, 'true');
        body.appendChild(iframe);
        this.sandbox = iframe;

        // A src-less iframe exposes a same-origin about:blank document synchronously, but
        // Firefox resolves computed styles on that initial document without the full UA
        // stylesheet (e.g. h1 margins report 0px). Writing a proper standards-mode document
        // forces a fully styled document in every browser.
        const doc = iframe.contentDocument;
        if (doc) {
            doc.open();
            doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
            doc.close();
        }
        return iframe.contentDocument;
    }
}
