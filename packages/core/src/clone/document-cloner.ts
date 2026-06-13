import {Bounds} from '../engines/canvas/css/layout/bounds';
import {
    isBodyElement,
    isCanvasElement,
    isCustomElement,
    isElementNode,
    isHTMLElement,
    isHTMLElementNode,
    isIFrameElement,
    isImageElement,
    isScriptElement,
    isSelectElement,
    isSlotElement,
    isStyleElement,
    isSVGElementNode,
    isTextareaElement,
    isTextNode,
    isVideoElement
} from '../engines/canvas/dom/node-parser';
import {isIdentToken, nonFunctionArgSeparator} from '../engines/canvas/css/syntax/parser';
import {TokenType} from '../engines/canvas/css/syntax/tokenizer';
import {CounterState, createCounterText} from '../engines/canvas/css/types/functions/counter';
import {LIST_STYLE_TYPE, listStyleType} from '../engines/canvas/css/property-descriptors/list-style-type';
import {CSSParsedCounterDeclaration, CSSParsedPseudoDeclaration} from '../engines/canvas/css/index';
import {getQuote} from '../engines/canvas/css/property-descriptors/quotes';
import {Context} from '../context';
import {DebuggerType, isDebugging} from '../debugger';

export interface CloneOptions {
    ignoreElements?: (element: Element) => boolean;
    onclone?: (document: Document, element: HTMLElement) => void;
    allowTaint?: boolean;
}

export interface WindowOptions {
    scrollX: number;
    scrollY: number;
    windowWidth: number;
    windowHeight: number;
}

/**
 * Engine-owned style inlining seam (svg engine): when configured, the cloner calls these
 * hooks — at the point where it has the (original, clone) pair and the computed styles in
 * hand — instead of the legacy full computed-style copy. See engines/svg/style-inliner.ts.
 */
export interface CloneStyleInliner {
    /** Inline an element's styles (and serializable state) onto its clone. */
    element(original: Element, clone: HTMLElement | SVGElement, computed: CSSStyleDeclaration): void;
    /** Inline a materialized ::before/::after pseudo element's styles. */
    pseudo(host: Element, target: HTMLElement, computed: CSSStyleDeclaration): void;
    /** Bake an element's scroll position into its clone (markup cannot carry scroll state). */
    scrolled(original: Element, clone: HTMLElement | SVGElement): void;
    /**
     * Replace a form control with a painted equivalent before cloning (Firefox does not
     * paint native form widgets inside foreignObject rasterization). Return null to keep
     * the regular clone.
     */
    formControl?(original: Element): HTMLElement | null;
    /**
     * Inline an expanded same-origin iframe's own box styles (border, size, viewport
     * background, ...) onto the container element that replaces it in the clone.
     */
    frame?(original: HTMLIFrameElement, container: HTMLElement, computed: CSSStyleDeclaration): void;
    /**
     * Draw a video's current frame onto its canvas clone (letterboxed like the browser
     * paints video content), or mark the canvas for asynchronous materialization (poster /
     * CORS re-fetch) when the frame is unavailable or would taint. Returns the canvas to
     * use as the clone (a fresh one when drawing tainted the original).
     */
    video?(original: HTMLVideoElement, canvas: HTMLCanvasElement): HTMLCanvasElement;
    /** Release helper resources (the hidden default-styles iframe). */
    dispose(): void;
}

export type CloneConfigurations = CloneOptions & {
    inlineImages: boolean;
    copyStyles: boolean;
    styleInliner?: CloneStyleInliner;
};

const IGNORE_ATTRIBUTE = 'data-html2canvas-ignore';

const isStylesheetLinkElement = (element: Element): boolean =>
    element.tagName === 'LINK' &&
    (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).indexOf('stylesheet') !== -1;

export class DocumentCloner {
    private readonly scrolledElements: [Element, number, number][];
    private readonly referenceElement: HTMLElement;
    clonedReferenceElement?: HTMLElement;
    private readonly documentElement: HTMLElement;
    private readonly counters: CounterState;
    private quoteDepth: number;

    constructor(
        private readonly context: Context,
        element: HTMLElement,
        private readonly options: CloneConfigurations
    ) {
        this.scrolledElements = [];
        this.referenceElement = element;
        this.counters = new CounterState();
        this.quoteDepth = 0;
        if (!element.ownerDocument) {
            throw new Error('Cloned element does not have an owner document');
        }

        this.documentElement = this.cloneNode(element.ownerDocument.documentElement, false) as HTMLElement;
    }

    toIFrame(ownerDocument: Document, windowSize: Bounds): Promise<HTMLIFrameElement> {
        const iframe: HTMLIFrameElement = createIFrameContainer(ownerDocument, windowSize);

        if (!iframe.contentWindow) {
            return Promise.reject(`Unable to find iframe window`);
        }

        const scrollX = (ownerDocument.defaultView as Window).pageXOffset;
        const scrollY = (ownerDocument.defaultView as Window).pageYOffset;

        const cloneWindow = iframe.contentWindow;
        const documentClone: Document = cloneWindow.document;

        /* Chrome doesn't detect relative background-images assigned in inline <style> sheets when fetched through getComputedStyle
         if window url is about:blank, we can assign the url to current by writing onto the document
         */

        const iframeLoad = iframeLoader(iframe).then(async () => {
            this.scrolledElements.forEach(restoreNodeScroll);
            if (cloneWindow) {
                cloneWindow.scrollTo(windowSize.left, windowSize.top);
                if (
                    /(iPad|iPhone|iPod)/g.test(navigator.userAgent) &&
                    (cloneWindow.scrollY !== windowSize.top || cloneWindow.scrollX !== windowSize.left)
                ) {
                    this.context.logger.warn('Unable to restore scroll position for cloned document');
                    this.context.windowBounds = this.context.windowBounds.add(
                        cloneWindow.scrollX - windowSize.left,
                        cloneWindow.scrollY - windowSize.top,
                        0,
                        0
                    );
                }
            }

            const onclone = this.options.onclone;

            const referenceElement = this.clonedReferenceElement;

            if (typeof referenceElement === 'undefined') {
                return Promise.reject(`Error finding the ${this.referenceElement.nodeName} in the cloned document`);
            }

            if (documentClone.fonts && documentClone.fonts.ready) {
                await documentClone.fonts.ready;
            }

            if (/(AppleWebKit)/g.test(navigator.userAgent)) {
                await imagesReady(documentClone);
            }

            if (typeof onclone === 'function') {
                return Promise.resolve()
                    .then(() => onclone(documentClone, referenceElement))
                    .then(() => iframe);
            }

            return iframe;
        });

        documentClone.open();
        documentClone.write(`${serializeDoctype(document.doctype)}<html></html>`);
        // Chrome scrolls the parent document for some reason after the write to the cloned window???
        restoreOwnerScroll(this.referenceElement.ownerDocument, scrollX, scrollY);
        documentClone.replaceChild(documentClone.adoptNode(this.documentElement), documentClone.documentElement);
        documentClone.close();

        return iframeLoad;
    }

    createElementClone<T extends HTMLElement | SVGElement>(node: T): HTMLElement | SVGElement {
        if (isDebugging(node, DebuggerType.CLONE)) {
            debugger;
        }
        if (isCanvasElement(node)) {
            return this.createCanvasClone(node);
        }
        if (isVideoElement(node)) {
            return this.createVideoClone(node);
        }
        if (isStyleElement(node)) {
            return this.createStyleClone(node);
        }

        const styleInliner = this.options.styleInliner;
        if (styleInliner) {
            if (isIFrameElement(node)) {
                return this.createInlinedIFrameClone(node);
            }
            const control = styleInliner.formControl?.(node);
            if (control) {
                return control;
            }
        }

        const clone = node.cloneNode(false) as T;
        if (isImageElement(clone)) {
            if (isImageElement(node) && node.currentSrc && node.currentSrc !== node.src) {
                clone.src = node.currentSrc;
                clone.srcset = '';
            }

            if (clone.loading === 'lazy') {
                clone.loading = 'eager';
            }
        }

        if (isCustomElement(clone)) {
            return this.createCustomElementClone(clone);
        }

        return clone;
    }

    /**
     * Engine-owned style inlining path: expands a same-origin iframe into a container div
     * holding a recursive clone of the frame's document, since serialized svg markup
     * cannot load nested browsing contexts. The container is sized/styled like the iframe
     * box by {@link CloneStyleInliner.frame} later in the clone walk.
     *
     * Cross-origin frames stay a shallow iframe clone and render as an empty frame box —
     * their content document is unreachable from script (documented limitation, matching
     * what the canvas engine paints when it cannot parse the frame).
     */
    createInlinedIFrameClone(iframe: HTMLIFrameElement): HTMLElement {
        let contentRoot: HTMLElement | null = null;
        try {
            contentRoot = iframe.contentDocument ? iframe.contentDocument.documentElement : null;
        } catch (e) {
            // Cross-origin frame: accessing contentDocument throws.
        }

        if (!contentRoot) {
            return iframe.cloneNode(false) as HTMLElement;
        }

        const container = iframe.ownerDocument.createElement('div');
        container.appendChild(this.cloneNode(contentRoot, false));
        return container;
    }

    createCustomElementClone(node: HTMLElement): HTMLElement {
        const clone = document.createElement('html2canvascustomelement');
        copyCSSStyles(node.style, clone);

        return clone;
    }

    createStyleClone(node: HTMLStyleElement): HTMLStyleElement {
        try {
            const sheet = node.sheet as CSSStyleSheet | undefined;
            if (sheet && sheet.cssRules) {
                const css: string = [].slice.call(sheet.cssRules, 0).reduce((css: string, rule: CSSRule) => {
                    if (rule && typeof rule.cssText === 'string') {
                        return css + rule.cssText;
                    }
                    return css;
                }, '');
                const style = node.cloneNode(false) as HTMLStyleElement;
                style.textContent = css;
                return style;
            }
        } catch (e) {
            // accessing node.sheet.cssRules throws a DOMException
            this.context.logger.error('Unable to access cssRules property', e);
            if ((e as Error).name !== 'SecurityError') {
                throw e;
            }
        }
        return node.cloneNode(false) as HTMLStyleElement;
    }

    createCanvasClone(canvas: HTMLCanvasElement): HTMLImageElement | HTMLCanvasElement {
        if (this.options.inlineImages && canvas.ownerDocument) {
            const img = canvas.ownerDocument.createElement('img');
            try {
                img.src = canvas.toDataURL();
                return img;
            } catch (e) {
                this.context.logger.info(`Unable to inline canvas contents, canvas is tainted`, canvas);
            }
        }

        const clonedCanvas = canvas.cloneNode(false) as HTMLCanvasElement;

        try {
            clonedCanvas.width = canvas.width;
            clonedCanvas.height = canvas.height;
            const ctx = canvas.getContext('2d');
            const clonedCtx = clonedCanvas.getContext('2d');
            if (clonedCtx) {
                if (!this.options.allowTaint && ctx) {
                    clonedCtx.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
                } else {
                    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
                    if (gl) {
                        const attribs = gl.getContextAttributes();
                        if (attribs?.preserveDrawingBuffer === false) {
                            this.context.logger.warn(
                                'Unable to clone WebGL context as it has preserveDrawingBuffer=false',
                                canvas
                            );
                        }
                    }

                    clonedCtx.drawImage(canvas, 0, 0);
                }
            }
            return clonedCanvas;
        } catch (e) {
            this.context.logger.info(`Unable to clone canvas as it is tainted`, canvas);
        }

        return clonedCanvas;
    }

    createVideoClone(video: HTMLVideoElement): HTMLCanvasElement {
        const canvas = video.ownerDocument.createElement('canvas');

        canvas.width = video.offsetWidth;
        canvas.height = video.offsetHeight;

        const styleInliner = this.options.styleInliner;
        if (styleInliner && styleInliner.video) {
            // svg engine path: letterboxed first-frame draw with poster/CORS-refetch
            // markers for the resource inliner (legacy stretch-draw below stays untouched
            // for the canvas engine).
            return styleInliner.video(video, canvas);
        }

        const ctx = canvas.getContext('2d');

        try {
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                if (!this.options.allowTaint) {
                    ctx.getImageData(0, 0, canvas.width, canvas.height);
                }
            }
            return canvas;
        } catch (e) {
            this.context.logger.info(`Unable to clone video as it is tainted`, video);
        }

        const blankCanvas = video.ownerDocument.createElement('canvas');

        blankCanvas.width = video.offsetWidth;
        blankCanvas.height = video.offsetHeight;
        return blankCanvas;
    }

    appendChildNode(clone: HTMLElement | SVGElement, child: Node, copyStyles: boolean): void {
        if (
            !isElementNode(child) ||
            (!isScriptElement(child) &&
                !child.hasAttribute(IGNORE_ATTRIBUTE) &&
                (typeof this.options.ignoreElements !== 'function' || !this.options.ignoreElements(child)))
        ) {
            // With styles inlined (legacy copyStyles or the engine-owned style inliner),
            // stylesheets must not ride along: in the inliner case they would double-apply
            // against the inline styles. Linked stylesheets are only skipped for the
            // inliner (legacy copyStyles kept them; its behavior stays untouched).
            const skipStyles =
                isElementNode(child) &&
                ((this.options.copyStyles && isStyleElement(child)) ||
                    (!!this.options.styleInliner && (isStyleElement(child) || isStylesheetLinkElement(child))));
            if (!skipStyles) {
                clone.appendChild(this.cloneNode(child, copyStyles));
            }
        }
    }

    /**
     * Clones an element's rendered children. Open shadow roots are expanded into their
     * light-DOM equivalent: the shadow content is cloned in place of the host's children,
     * and every <slot> is materialized as the nodes assigned to it (or its fallback
     * content when nothing is assigned). :host/::slotted styling needs no special casing —
     * the computed styles the inliner writes already include it.
     *
     * Closed shadow roots cannot be expanded: `node.shadowRoot` is null by design, so the
     * host renders as if it had no shadow tree (its light-DOM children, which the browser
     * does not render either, are cloned instead). This is a documented limitation.
     */
    cloneChildNodes(node: Element, clone: HTMLElement | SVGElement, copyStyles: boolean): void {
        for (
            let child = node.shadowRoot ? node.shadowRoot.firstChild : node.firstChild;
            child;
            child = child.nextSibling
        ) {
            if (isElementNode(child) && isSlotElement(child) && typeof child.assignedNodes === 'function') {
                // Materialize the slot per its current assignment. Fallback content (the
                // slot's own children) renders only when nothing is assigned, which the
                // `else` branch reproduces by cloning the slot element itself (display:
                // contents is part of its inlined computed style).
                const assignedNodes = child.assignedNodes() as ChildNode[];
                if (assignedNodes.length) {
                    assignedNodes.forEach((assignedNode) => this.appendChildNode(clone, assignedNode, copyStyles));
                } else if (this.options.styleInliner) {
                    // Inliner path only: the legacy canvas clone dropped fallback content
                    // entirely, and its committed baselines freeze that behavior.
                    this.appendChildNode(clone, child, copyStyles);
                }
            } else {
                this.appendChildNode(clone, child, copyStyles);
            }
        }
    }

    cloneNode(node: Node, copyStyles: boolean): Node {
        if (isTextNode(node)) {
            return document.createTextNode(node.data);
        }

        if (!node.ownerDocument) {
            return node.cloneNode(false);
        }

        const window = node.ownerDocument.defaultView;

        if (window && isElementNode(node) && (isHTMLElementNode(node) || isSVGElementNode(node))) {
            const clone = this.createElementClone(node);
            if (this.options.styleInliner) {
                // The computed-style diff reproduces every inline declaration, so the
                // cloned style attribute must not ride along: re-serializing the combined
                // declarations corrupts the diffed longhands (Chromium collapses e.g.
                // background-image + background-clip back into an ambiguous
                // `background: url(..) border-box` shorthand, which shifts
                // background-origin on reparse), and relative url() values in the original
                // inline style would escape resource inlining.
                clone.removeAttribute('style');
            }
            clone.style.transitionProperty = 'none';

            const style = window.getComputedStyle(node);
            const styleBefore = window.getComputedStyle(node, ':before');
            const styleAfter = window.getComputedStyle(node, ':after');

            if (this.referenceElement === node && isHTMLElementNode(clone)) {
                this.clonedReferenceElement = clone;
            }
            if (isBodyElement(clone)) {
                createPseudoHideStyles(clone);
            }

            const counters = this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
            const before = this.resolvePseudoContent(node, clone, styleBefore, PseudoElementType.BEFORE);

            if (isCustomElement(node)) {
                copyStyles = true;
            }

            // Expanded iframes (svg path) already carry their recursively cloned content
            // document; the iframe's own children are fallback content and never render.
            const isExpandedIFrame = !!this.options.styleInliner && isIFrameElement(node);
            if (!isVideoElement(node) && !isExpandedIFrame) {
                this.cloneChildNodes(node, clone, copyStyles);
            }

            if (before) {
                clone.insertBefore(before, clone.firstChild);
            }

            const after = this.resolvePseudoContent(node, clone, styleAfter, PseudoElementType.AFTER);
            if (after) {
                clone.appendChild(after);
            }

            this.counters.pop(counters);

            const styleInliner = this.options.styleInliner;
            if (style && styleInliner && isIFrameElement(node)) {
                if (!isIFrameElement(clone)) {
                    // Same-origin iframe expanded into a container div: inline the iframe
                    // box's own styles (border, size, viewport background) onto it.
                    styleInliner.frame?.(node, clone as HTMLElement, style);
                }
            } else if (style && styleInliner) {
                styleInliner.element(node, clone, style);
            } else if (
                (style && (this.options.copyStyles || isSVGElementNode(node)) && !isIFrameElement(node)) ||
                copyStyles
            ) {
                copyCSSStyles(style, clone);
            }

            if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
                if (styleInliner && !isBodyElement(node) && !isHTMLElement(node)) {
                    // Bake element scroll into the clone markup instead of restoring it on
                    // the live clone document (which serialization would lose again).
                    styleInliner.scrolled(node, clone);
                } else {
                    this.scrolledElements.push([clone, node.scrollLeft, node.scrollTop]);
                }
            }

            if (
                (isTextareaElement(node) || isSelectElement(node)) &&
                (isTextareaElement(clone) || isSelectElement(clone))
            ) {
                clone.value = node.value;
            }

            return clone;
        }

        return node.cloneNode(false);
    }

    resolvePseudoContent(
        node: Element,
        clone: Element,
        style: CSSStyleDeclaration,
        pseudoElt: PseudoElementType
    ): HTMLElement | void {
        if (!style) {
            return;
        }

        const value = style.content;
        const document = clone.ownerDocument;
        if (!document || !value || value === 'none' || value === '-moz-alt-content' || style.display === 'none') {
            return;
        }

        this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
        const declaration = new CSSParsedPseudoDeclaration(this.context, style);

        const anonymousReplacedElement = document.createElement('html2canvaspseudoelement');
        if (this.options.styleInliner) {
            this.options.styleInliner.pseudo(node, anonymousReplacedElement, style);
        } else {
            copyCSSStyles(style, anonymousReplacedElement);
        }

        declaration.content.forEach((token) => {
            if (token.type === TokenType.STRING_TOKEN) {
                anonymousReplacedElement.appendChild(document.createTextNode(token.value));
            } else if (token.type === TokenType.URL_TOKEN) {
                const img = document.createElement('img');
                img.src = token.value;
                img.style.opacity = '1';
                anonymousReplacedElement.appendChild(img);
            } else if (token.type === TokenType.FUNCTION) {
                if (token.name === 'attr') {
                    const attr = token.values.filter(isIdentToken);
                    if (attr.length) {
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(node.getAttribute(attr[0].value) || '')
                        );
                    }
                } else if (token.name === 'counter') {
                    const [counter, counterStyle] = token.values.filter(nonFunctionArgSeparator);
                    if (counter && isIdentToken(counter)) {
                        const counterState = this.counters.getCounterValue(counter.value);
                        const counterType =
                            counterStyle && isIdentToken(counterStyle)
                                ? listStyleType.parse(this.context, counterStyle.value)
                                : LIST_STYLE_TYPE.DECIMAL;

                        anonymousReplacedElement.appendChild(
                            document.createTextNode(createCounterText(counterState, counterType, false))
                        );
                    }
                } else if (token.name === 'counters') {
                    const [counter, delim, counterStyle] = token.values.filter(nonFunctionArgSeparator);
                    if (counter && isIdentToken(counter)) {
                        const counterStates = this.counters.getCounterValues(counter.value);
                        const counterType =
                            counterStyle && isIdentToken(counterStyle)
                                ? listStyleType.parse(this.context, counterStyle.value)
                                : LIST_STYLE_TYPE.DECIMAL;
                        const separator = delim && delim.type === TokenType.STRING_TOKEN ? delim.value : '';
                        const text = counterStates
                            .map((value) => createCounterText(value, counterType, false))
                            .join(separator);

                        anonymousReplacedElement.appendChild(document.createTextNode(text));
                    }
                } else {
                    //   console.log('FUNCTION_TOKEN', token);
                }
            } else if (token.type === TokenType.IDENT_TOKEN) {
                switch (token.value) {
                    case 'open-quote':
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(getQuote(declaration.quotes, this.quoteDepth++, true))
                        );
                        break;
                    case 'close-quote':
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(getQuote(declaration.quotes, --this.quoteDepth, false))
                        );
                        break;
                    default:
                        // safari doesn't parse string tokens correctly because of lack of quotes
                        anonymousReplacedElement.appendChild(document.createTextNode(token.value));
                }
            }
        });

        anonymousReplacedElement.className = `${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE} ${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}`;
        const newClassName =
            pseudoElt === PseudoElementType.BEFORE
                ? ` ${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE}`
                : ` ${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}`;

        if (isSVGElementNode(clone)) {
            clone.className.baseValue += newClassName;
        } else {
            clone.className += newClassName;
        }

        return anonymousReplacedElement;
    }

    static destroy(container: HTMLIFrameElement): boolean {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
            return true;
        }
        return false;
    }
}

enum PseudoElementType {
    BEFORE,
    AFTER
}

const createIFrameContainer = (ownerDocument: Document, bounds: Bounds): HTMLIFrameElement => {
    const cloneIframeContainer = ownerDocument.createElement('iframe');

    cloneIframeContainer.className = 'html2canvas-container';
    cloneIframeContainer.style.visibility = 'hidden';
    cloneIframeContainer.style.position = 'fixed';
    cloneIframeContainer.style.left = '-10000px';
    cloneIframeContainer.style.top = '0px';
    cloneIframeContainer.style.border = '0';
    cloneIframeContainer.width = bounds.width.toString();
    cloneIframeContainer.height = bounds.height.toString();
    cloneIframeContainer.scrolling = 'no'; // ios won't scroll without it
    cloneIframeContainer.setAttribute(IGNORE_ATTRIBUTE, 'true');
    ownerDocument.body.appendChild(cloneIframeContainer);

    return cloneIframeContainer;
};

const imageReady = (img: HTMLImageElement): Promise<Event | void | string> => {
    return new Promise((resolve) => {
        if (img.complete) {
            resolve();
            return;
        }
        if (!img.src) {
            resolve();
            return;
        }
        img.onload = resolve;
        img.onerror = resolve;
    });
};

const imagesReady = (document: HTMLDocument): Promise<unknown[]> => {
    return Promise.all([].slice.call(document.images, 0).map(imageReady));
};

const iframeLoader = (iframe: HTMLIFrameElement): Promise<HTMLIFrameElement> => {
    return new Promise((resolve, reject) => {
        const cloneWindow = iframe.contentWindow;

        if (!cloneWindow) {
            return reject(`No window assigned for iframe`);
        }

        const documentClone = cloneWindow.document;

        cloneWindow.onload = iframe.onload = () => {
            cloneWindow.onload = iframe.onload = null;
            // Poll tightly: the document is adopted synchronously before close(), so the
            // ready condition usually already holds when load fires — the legacy 50ms
            // setInterval added a flat ~50ms to every capture for nothing.
            const check = () => {
                if (documentClone.body && documentClone.body.childNodes.length > 0 && documentClone.readyState === 'complete') {
                    resolve(iframe);
                } else {
                    setTimeout(check, 4);
                }
            };
            check();
        };
    });
};

const ignoredStyleProperties = [
    'all', // #2476
    'd', // #2483
    'content' // Safari shows pseudoelements if content is set
];

export const copyCSSStyles = <T extends HTMLElement | SVGElement>(style: CSSStyleDeclaration, target: T): T => {
    // Edge does not provide value for cssText
    for (let i = style.length - 1; i >= 0; i--) {
        const property = style.item(i);
        if (ignoredStyleProperties.indexOf(property) === -1) {
            target.style.setProperty(property, style.getPropertyValue(property));
        }
    }
    return target;
};

const serializeDoctype = (doctype?: DocumentType | null): string => {
    let str = '';
    if (doctype) {
        str += '<!DOCTYPE ';
        if (doctype.name) {
            str += doctype.name;
        }

        if (doctype.internalSubset) {
            str += doctype.internalSubset;
        }

        if (doctype.publicId) {
            str += `"${doctype.publicId}"`;
        }

        if (doctype.systemId) {
            str += `"${doctype.systemId}"`;
        }

        str += '>';
    }

    return str;
};

const restoreOwnerScroll = (ownerDocument: Document | null, x: number, y: number) => {
    if (
        ownerDocument &&
        ownerDocument.defaultView &&
        (x !== ownerDocument.defaultView.pageXOffset || y !== ownerDocument.defaultView.pageYOffset)
    ) {
        ownerDocument.defaultView.scrollTo(x, y);
    }
};

const restoreNodeScroll = ([element, x, y]: [Element, number, number]) => {
    element.scrollLeft = x;
    element.scrollTop = y;
};

const PSEUDO_BEFORE = ':before';
const PSEUDO_AFTER = ':after';
const PSEUDO_HIDE_ELEMENT_CLASS_BEFORE = '___html2canvas___pseudoelement_before';
const PSEUDO_HIDE_ELEMENT_CLASS_AFTER = '___html2canvas___pseudoelement_after';

const PSEUDO_HIDE_ELEMENT_STYLE = `{
    content: "" !important;
    display: none !important;
}`;

const createPseudoHideStyles = (body: HTMLElement) => {
    createStyles(
        body,
        `.${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE}${PSEUDO_BEFORE}${PSEUDO_HIDE_ELEMENT_STYLE}
         .${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}${PSEUDO_AFTER}${PSEUDO_HIDE_ELEMENT_STYLE}`
    );
};

const createStyles = (body: HTMLElement, styles: string) => {
    const document = body.ownerDocument;
    if (document) {
        const style = document.createElement('style');
        style.textContent = styles;
        body.appendChild(style);
    }
};
