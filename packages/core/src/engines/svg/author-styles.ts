/**
 * Author-style scan backing the pruned computed-style snapshots of the svg engine's style
 * inliner (style-inliner.ts).
 *
 * The inliner's job is to reproduce, without stylesheets, everything AUTHOR styling did to
 * an element — UA styling needs no inlining at all: the serialized foreignObject document
 * is parsed by the same browser with the same element structure and attributes, so every
 * UA-origin rule (tag defaults, `ul ul` margins, [hidden], presentational hint attributes,
 * `:link` colors, ...) re-applies by itself. A computed property can therefore only need
 * inlining when author CSS mentions it somewhere:
 *
 * - mentioned directly: stylesheet rules, inline `style` attributes, @keyframes (animated
 *   values surface in getComputedStyle under the mentioned property name),
 * - or set without any stylesheet trace: Web-Animations-API animations — their target
 *   elements are collected separately and snapshot fully.
 *
 * The scan collects the union of LONGHAND property names declared anywhere author CSS can
 * live for the captured document: document.styleSheets (recursing @media/@supports/@layer/
 * @import/@keyframes), adoptedStyleSheets, inline style attributes, open shadow roots
 * (style sheets + adopted sheets + inline styles, recursively) and same-origin iframes
 * (their documents are expanded into the clone). CSSOM enumerates declared shorthands as
 * their longhands (verified on Chromium and Firefox), so the set is directly comparable to
 * getComputedStyle property names.
 *
 * Conservative fallbacks — the scan returns null (callers snapshot every property, the
 * pre-scan behavior) whenever it cannot prove completeness:
 * - a stylesheet's cssRules is inaccessible (cross-origin link without CORS),
 * - the `all` shorthand is declared anywhere (it can reset every property),
 * - any unexpected DOM/CSSOM error.
 */

export interface AuthorStyleProfile {
    /**
     * Longhand property names author CSS mentions anywhere in the captured document
     * (plus `color`, always present: the diff's currentcolor-coupling rule reads it).
     */
    properties: ReadonlySet<string>;
    /** Same set as an array, for cheap iteration when building pruned snapshots. */
    propertyList: readonly string[];
    /** Elements with script-driven (Web Animations API) animations: snapshot these fully. */
    animated: ReadonlySet<Element>;
}

/** Properties whose presence forces the full-snapshot fallback. */
const UNPRUNABLE = 'all';

/**
 * Always part of the read set, whatever the author wrote:
 * - `color`: the diff's currentcolor-coupling rule compares against it,
 * - margins and paddings: their UA defaults are often font-relative (p/h1-h6/ol/ul
 *   margins are 1em/0.67em/...), so they recompute differently in the serialized clone
 *   wherever the inherited font context deviates (the diff intentionally omits inherited
 *   properties equal to the parent, and UA tag rules like h3's font-size then re-apply
 *   over inheritance). Reading them always lets the diff pin the used pixel values
 *   exactly like the full-snapshot path does.
 */
const ALWAYS_READ = [
    'color',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left'
];

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/**
 * Physical expansion of an author-mentioned logical alias property. The inliner only
 * writes physical longhands (logical aliases are skipped as pure duplicates, see
 * default-styles.ts), so a logical author declaration must put its physical counterparts
 * into the read set. The block/inline -> physical mapping depends on each element's
 * writing-mode; expanding to ALL candidate physical longhands is the writing-mode-agnostic
 * superset (extra reads cost a few style-engine calls, never correctness).
 */
const expandLogicalAlias = (property: string): string[] | null => {
    const sized = /^(min-|max-|contain-intrinsic-)?(block|inline)-size$/.exec(property);
    if (sized) {
        const prefix = sized[1] ?? '';
        return [`${prefix}width`, `${prefix}height`];
    }

    const overflow = /^(overflow|overscroll-behavior)-(block|inline)$/.exec(property);
    if (overflow) {
        return [`${overflow[1]}-x`, `${overflow[1]}-y`];
    }

    const boxes = /^(margin|padding|scroll-margin|scroll-padding)-(block|inline)(?:-(?:start|end))?$/.exec(property);
    if (boxes) {
        return SIDES.map((side) => `${boxes[1]}-${side}`);
    }

    const inset = /^inset(?:-(block|inline)(?:-(?:start|end))?)?$/.exec(property);
    if (inset) {
        return [...SIDES];
    }

    const border = /^border-(?:block|inline)(?:-(?:start|end))?-(width|style|color)$/.exec(property);
    if (border) {
        return SIDES.map((side) => `border-${side}-${border[1]}`);
    }

    if (/^border-(?:start|end)-(?:start|end)-radius$/.test(property)) {
        return CORNERS.map((corner) => `border-${corner}-radius`);
    }

    // Not a recognized logical alias: keep the property itself in the read set. (Logical
    // aliases NOT expanded here are exactly those default-styles.ts does not skip, so any
    // exotic one still flows through read -> diff -> inline unchanged.)
    return null;
};

class UnprunableError extends Error {}

const addDeclaredProperties = (style: CSSStyleDeclaration, into: Set<string>): void => {
    for (let i = 0, length = style.length; i < length; i++) {
        const property = style.item(i);
        if (!property || (property.charCodeAt(0) === 45 && property.charCodeAt(1) === 45)) {
            continue; // custom properties never surface in computed longhands
        }
        if (property === UNPRUNABLE) {
            throw new UnprunableError(`author CSS declares '${property}'`);
        }
        const expanded = expandLogicalAlias(property);
        if (expanded) {
            for (const physical of expanded) {
                into.add(physical);
            }
        } else {
            into.add(property);
        }
    }
};

const visitRules = (rules: CSSRuleList, into: Set<string>): void => {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i] as CSSRule & {
            style?: CSSStyleDeclaration;
            cssRules?: CSSRuleList;
            styleSheet?: CSSStyleSheet | null;
        };
        if (rule.style) {
            addDeclaredProperties(rule.style, into);
        }
        if (rule.cssRules) {
            visitRules(rule.cssRules, into);
        }
        if (rule.styleSheet) {
            // @import: cssRules access throws for cross-origin sheets -> full fallback.
            visitRules(rule.styleSheet.cssRules, into);
        }
    }
};

const visitSheets = (sheets: ArrayLike<CSSStyleSheet>, into: Set<string>): void => {
    for (let i = 0; i < sheets.length; i++) {
        // Inaccessible cssRules (cross-origin stylesheet) throws here; disabled sheets do
        // not apply, but scanning them only widens the set (safe).
        visitRules(sheets[i].cssRules, into);
    }
};

const visitTree = (root: Document | ShadowRoot, into: Set<string>, documents: Document[]): void => {
    visitSheets(root.styleSheets, into);
    const adopted = (root as {adoptedStyleSheets?: CSSStyleSheet[]}).adoptedStyleSheets;
    if (adopted) {
        visitSheets(adopted, into);
    }

    const elements = root.querySelectorAll('*');
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.hasAttribute('style')) {
            const inline = (element as HTMLElement | SVGElement).style;
            if (inline) {
                addDeclaredProperties(inline, into);
            }
        }
        if (element.shadowRoot) {
            visitTree(element.shadowRoot, into, documents);
        }
        if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
            let contentDocument: Document | null = null;
            try {
                contentDocument = (element as HTMLIFrameElement).contentDocument;
            } catch (e) {
                // Cross-origin frame: not expanded by the cloner, nothing to scan.
            }
            if (contentDocument) {
                documents.push(contentDocument);
                visitTree(contentDocument, into, documents);
            }
        }
    }
};

const collectAnimatedElements = (documents: Document[]): Set<Element> => {
    const animated = new Set<Element>();
    for (const document of documents) {
        const doc = document as Document & {getAnimations?: () => Animation[]};
        if (typeof doc.getAnimations !== 'function') {
            continue;
        }
        for (const animation of doc.getAnimations()) {
            const effect = animation.effect as KeyframeEffect | null;
            const target = effect && effect.target;
            if (target) {
                // CSS animations/transitions are also covered by the stylesheet scan
                // (their property names appear in rules/keyframes); WAAPI animations have
                // no stylesheet trace and are why this set exists.
                animated.add(target);
            }
        }
    }
    return animated;
};

/**
 * Scans the document's author CSS into an {@link AuthorStyleProfile}, or returns null when
 * the scan cannot prove it saw everything (callers must then snapshot every property).
 */
export const collectAuthorStyleProfile = (ownerDocument: Document): AuthorStyleProfile | null => {
    try {
        const properties = new Set<string>(ALWAYS_READ);
        const documents: Document[] = [ownerDocument];
        visitTree(ownerDocument, properties, documents);
        return {
            properties,
            propertyList: [...properties],
            animated: collectAnimatedElements(documents)
        };
    } catch (e) {
        return null;
    }
};
