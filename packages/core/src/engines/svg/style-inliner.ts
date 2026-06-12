import {isInputElement, isSelectElement, isTextareaElement} from '../canvas/dom/node-parser';
import {CloneStyleInliner} from '../../clone/document-cloner';
import {DefaultStyleCache, diffComputedStyle, StyleDeclarationLike} from './default-styles';
import {inlinePseudoStyles, PSEUDO_ELEMENT_TAG} from './pseudo';
import {drawContainedFrame, VIDEO_POSTER_ATTRIBUTE, VIDEO_SRC_ATTRIBUTE, VIDEO_TIME_ATTRIBUTE} from './resource-inliner';

/**
 * Serializes live form state into markup, since XMLSerializer only sees attributes and
 * text — DOM properties like `input.value`, `input.checked` or `option.selected` set by the
 * user (or scripts) would silently be lost in the svg output:
 *
 * - input: the current value is written to the `value` attribute, the checked state of
 *   checkboxes/radios to the `checked` attribute,
 * - textarea: the current value replaces the element's text content,
 * - select: the `selected` attribute is rewritten on every cloned option to match the live
 *   selection (options are paired with the original by index).
 */
export const materializeFormState = (original: Element, clone: HTMLElement | SVGElement): void => {
    if (isInputElement(original)) {
        if (original.type === 'checkbox' || original.type === 'radio') {
            if (original.checked) {
                clone.setAttribute('checked', '');
            } else {
                clone.removeAttribute('checked');
            }
        } else if (original.type !== 'file') {
            clone.setAttribute('value', original.value);
        }
        return;
    }

    if (isTextareaElement(original)) {
        clone.textContent = original.value;
        return;
    }

    if (isSelectElement(original)) {
        const originalOptions = original.options;
        const cloneOptions = clone.getElementsByTagName('option');
        for (let i = 0; i < originalOptions.length && i < cloneOptions.length; i++) {
            if (originalOptions[i].selected) {
                cloneOptions[i].setAttribute('selected', '');
            } else {
                cloneOptions[i].removeAttribute('selected');
            }
        }
    }
};

export const isCheckableInput = (element: Element): element is HTMLInputElement =>
    isInputElement(element) && (element.type === 'checkbox' || element.type === 'radio');

const BUTTON_INPUT_TYPES = new Set(['submit', 'reset', 'button']);

export const isButtonInput = (element: Element): element is HTMLInputElement =>
    isInputElement(element) && BUTTON_INPUT_TYPES.has(element.type);

/** The label a button input renders: its value, or the UA default for submit/reset. */
export const buttonInputLabel = (input: HTMLInputElement): string => {
    if (input.value) {
        return input.value;
    }
    return input.type === 'submit' ? 'Submit' : input.type === 'reset' ? 'Reset' : '';
};

/**
 * Materializes the replacement clone for a form control whose native widget cannot be
 * painted (checkboxes/radios become widget spans, button inputs become label spans);
 * returns null for controls that keep their regular clone.
 */
export const materializeFormControl = (original: Element): HTMLElement | null => {
    if (!original.ownerDocument) {
        return null;
    }
    if (isCheckableInput(original)) {
        return original.ownerDocument.createElement('span');
    }
    if (isButtonInput(original)) {
        const span = original.ownerDocument.createElement('span');
        span.textContent = buttonInputLabel(original);
        return span;
    }
    return null;
};

/** Neutral widget palette, close to both Chromium's and Firefox's themed controls. */
const CONTROL_BORDER_COLOR = '%238d8d8d';
const CONTROL_ACCENT_COLOR = '%231a73e8';

/**
 * Whether this browser refuses to paint native form widgets inside foreignObject
 * rasterization. Chromium (and WebKit) paint them natively — materializing approximations
 * there would only lose fidelity — while Firefox drops them entirely (layout collapses to
 * zero-size checkboxes, selects lose their arrow, button labels shift), so the svg path
 * must paint its own equivalents.
 */
const NEEDS_WIDGET_MATERIALIZATION = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

/** Checked-radio dot radius as a fraction of the glyph, approximating the Firefox theme. */
const RADIO_DOT_RATIO = 0.44;

/**
 * The widget glyph drawn into the control box, as an svg data-url background image
 * generated at the rendered pixel size: strokes and corner radii are absolute (native
 * widgets keep hairline borders and small corner radii at any size), while the check mark
 * and the radio dot scale with the control.
 */
const controlGlyph = (radio: boolean, checked: boolean, size: number): string => {
    const s = Math.max(Math.round(size) || 16, 4);
    const half = s / 2;
    let shapes: string;
    if (radio) {
        const r = (half - 0.5).toFixed(1);
        const dot = (RADIO_DOT_RATIO * s).toFixed(1);
        shapes = checked
            ? `%3Ccircle cx='${half}' cy='${half}' r='${r}' fill='%23ffffff' stroke='${CONTROL_ACCENT_COLOR}'/%3E` +
              `%3Ccircle cx='${half}' cy='${half}' r='${dot}' fill='${CONTROL_ACCENT_COLOR}'/%3E`
            : `%3Ccircle cx='${half}' cy='${half}' r='${r}' fill='%23ffffff' stroke='${CONTROL_BORDER_COLOR}'/%3E`;
    } else {
        const rx = Math.min(2.5 + s / 32, 8).toFixed(1);
        const scale = (s / 16).toFixed(3);
        shapes = checked
            ? `%3Crect width='${s}' height='${s}' rx='${rx}' fill='${CONTROL_ACCENT_COLOR}'/%3E` +
              `%3Cpath d='M13.3 4.6 6.6 11.3 3.4 8.1 2 9.5l4.6 4.6 8.1-8.1z' fill='%23ffffff' transform='scale(${scale})'/%3E`
            : `%3Crect x='0.5' y='0.5' width='${s - 1}' height='${s - 1}' rx='${rx}' fill='%23ffffff' stroke='${CONTROL_BORDER_COLOR}'/%3E`;
    }
    return (
        `url("data:image/svg+xml;charset=utf-8,` +
        `%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'%3E${shapes}%3C/svg%3E")`
    );
};

/**
 * Styles the span that replaces a checkbox/radio in the svg clone as a painted widget
 * approximation. Firefox does not paint native form widgets inside foreignObject
 * rasterization — the controls disappear AND collapse the layout, since nothing reserves
 * their intrinsic size. The diffed computed style provides the box context (margins,
 * display, transforms); the used size and the widget face are pinned explicitly because a
 * span has neither an intrinsic size nor the input's border-box sizing default.
 */
export const styleCheckableControl = (
    original: HTMLInputElement,
    clone: HTMLElement,
    computed: StyleDeclarationLike,
    diff: Array<[string, string]>
): void => {
    for (const [property, value] of diff) {
        clone.style.setProperty(property, value);
    }

    // Pinned explicitly (not via the diff): these computed values match the INPUT tag
    // defaults — and are therefore diffed away — but the span's own defaults differ.
    clone.style.setProperty('width', computed.getPropertyValue('width'));
    clone.style.setProperty('height', computed.getPropertyValue('height'));
    clone.style.setProperty('box-sizing', computed.getPropertyValue('box-sizing'));
    const display = computed.getPropertyValue('display');
    clone.style.setProperty('display', !display || display === 'inline' ? 'inline-block' : display);
    const verticalAlign = computed.getPropertyValue('vertical-align');
    if (verticalAlign) {
        clone.style.setProperty('vertical-align', verticalAlign);
    }

    // The widget face: browsers paint the glyph at a fixed aspect ratio, sized to the
    // smaller box dimension and centered (an author background on a themed control is not
    // painted, hence the explicit transparent background-color overriding the diff).
    const width = parseFloat(computed.getPropertyValue('width')) || 0;
    const height = parseFloat(computed.getPropertyValue('height')) || 0;
    const glyphSize = Math.min(width || height, height || width);
    clone.style.setProperty('background-color', 'transparent');
    clone.style.setProperty('background-image', controlGlyph(original.type === 'radio', original.checked, glyphSize));
    clone.style.setProperty('background-repeat', 'no-repeat');
    clone.style.setProperty('background-position', 'center');
    clone.style.setProperty('background-size', glyphSize > 0 ? `${glyphSize}px ${glyphSize}px` : 'contain');
};

/** Dropdown chevron painted on select clones (foreignObject drops the native arrow). */
const SELECT_ARROW =
    `url("data:image/svg+xml;charset=utf-8,` +
    `%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E` +
    `%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23444444' stroke-width='1.5'/%3E%3C/svg%3E")`;

/** Resize grip painted on textarea clones (foreignObject drops the native grip). */
const TEXTAREA_GRIP =
    `url("data:image/svg+xml;charset=utf-8,` +
    `%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E` +
    `%3Cpath d='M11 1 1 11M11 6 6 11' fill='none' stroke='%23a0a0a0'/%3E%3C/svg%3E")`;

/**
 * Paints the native widget decorations foreignObject rasterization drops: the dropdown
 * chevron of selects (with a padding bump so the value text clears it, like the native
 * control) and the resize grip of textareas.
 */
export const decorateControl = (
    original: Element,
    clone: HTMLElement | SVGElement,
    computed: StyleDeclarationLike
): void => {
    if (isSelectElement(original)) {
        clone.style.setProperty('background-image', SELECT_ARROW);
        clone.style.setProperty('background-repeat', 'no-repeat');
        clone.style.setProperty('background-position', 'right 3px center');
        if (computed.getPropertyValue('box-sizing') !== 'content-box') {
            // Clear the value text off the arrow. Only safe under border-box sizing
            // (the UA default for selects): the outer box must not grow.
            const paddingRight = parseFloat(computed.getPropertyValue('padding-right')) || 0;
            clone.style.setProperty('padding-right', `${paddingRight + 14}px`);
        }
        return;
    }

    if (isTextareaElement(original) && computed.getPropertyValue('resize') !== 'none') {
        clone.style.setProperty('background-image', TEXTAREA_GRIP);
        clone.style.setProperty('background-repeat', 'no-repeat');
        clone.style.setProperty('background-position', 'right 1px bottom 1px');
    }
};

/**
 * An element's used width/height must never be omitted by the default diff: the sandbox
 * "default" is the used size of an EMPTY element, so e.g. `<img style="width:0">` (0px,
 * equal to the empty sandbox img's 0px) would be dropped and the clone would render at
 * natural size, and a `style="height:0"` div would size from its content once its
 * stylesheets are stripped. Inline boxes report `auto` and are skipped — their size is
 * genuinely content-driven. Resolved values keep the element's box-sizing semantics, so
 * they can be written back verbatim.
 */
export const pinUsedSize = (clone: HTMLElement | SVGElement, computed: StyleDeclarationLike): void => {
    for (const property of ['width', 'height']) {
        if (clone.style.getPropertyValue(property)) {
            continue;
        }
        const value = computed.getPropertyValue(property);
        if (value && value !== 'auto') {
            clone.style.setProperty(property, value);
        }
    }
};

const FORM_CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OPTION', 'OPTGROUP']);

/**
 * Form controls do not inherit font/color — their UA defaults (a ~13px control font,
 * fieldtext color) override inheritance. The diff omits inherited properties whose value
 * matches the parent, which is correct for normal elements but loses e.g. an input's
 * `font: inherit`-alike styling; pin the text styling explicitly on every control.
 */
export const pinControlFont = (clone: HTMLElement | SVGElement, computed: StyleDeclarationLike): void => {
    for (const property of [
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'letter-spacing',
        'word-spacing',
        'color'
    ]) {
        const value = computed.getPropertyValue(property);
        if (value) {
            clone.style.setProperty(property, value);
        }
    }
};

const TEXT_CONTROL_INPUT_TYPES = new Set(['text', 'password', 'email', 'number', 'search', 'tel', 'url']);

/** Text-editing controls whose box model must be pinned explicitly (see {@link pinControlBox}). */
const isTextControl = (element: Element): boolean =>
    isTextareaElement(element) || (isInputElement(element) && TEXT_CONTROL_INPUT_TYPES.has(element.type));

const BOX_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Pins a text control's full box model inline and devolves it from native theming.
 * Computed border/padding values that match the UA defaults are diffed away, but a
 * *themed* (appearance: auto) control ignores them for layout in Firefox — the serialized
 * clone would collapse to its content box (and foreignObject rasterization does not paint
 * the native theme anyway). appearance: none makes the explicit box apply everywhere.
 */
/** The content-box height of a control, derived from its computed metrics. */
export const controlContentHeight = (computed: StyleDeclarationLike): number => {
    const pf = (property: string): number => parseFloat(computed.getPropertyValue(property)) || 0;
    const height = pf('height');
    return computed.getPropertyValue('box-sizing') === 'border-box'
        ? height - pf('border-top-width') - pf('border-bottom-width') - pf('padding-top') - pf('padding-bottom')
        : height;
};

export const pinControlBox = (clone: HTMLElement | SVGElement, computed: StyleDeclarationLike): void => {
    clone.style.setProperty('appearance', 'none');
    for (const side of BOX_SIDES) {
        for (const property of [
            `border-${side}-width`,
            `border-${side}-style`,
            `border-${side}-color`,
            `padding-${side}`
        ]) {
            clone.style.setProperty(property, computed.getPropertyValue(property));
        }
    }
    clone.style.setProperty('box-sizing', computed.getPropertyValue('box-sizing'));
    clone.style.setProperty('width', computed.getPropertyValue('width'));
    clone.style.setProperty('height', computed.getPropertyValue('height'));
    clone.style.setProperty('background-color', computed.getPropertyValue('background-color'));
};

/**
 * Styles the span (carrying the label as a text child) that replaces a button input.
 * Firefox's foreignObject rasterization positions devolved button labels with a different
 * baseline than the live themed widget, which inflates every line box containing a button
 * by a few pixels; a span with an explicit line-height reproduces the native rendering:
 * the label is centered in the content box and the span's baseline is the label's
 * baseline, exactly like the themed widget.
 */
export const styleButtonControl = (
    clone: HTMLElement,
    computed: StyleDeclarationLike,
    diff: Array<[string, string]>
): void => {
    for (const [property, value] of diff) {
        clone.style.setProperty(property, value);
    }
    pinControlBox(clone, computed);

    const display = computed.getPropertyValue('display');
    clone.style.setProperty('display', !display || display === 'inline' ? 'inline-block' : display);
    clone.style.setProperty('white-space', 'pre');
    const textAlign = computed.getPropertyValue('text-align');
    clone.style.setProperty('text-align', !textAlign || textAlign === 'start' ? 'center' : textAlign);

    const contentHeight = controlContentHeight(computed);
    if (contentHeight > 0) {
        clone.style.setProperty('line-height', `${contentHeight}px`);
    }
};

const TRANSPARENT_COLORS = new Set(['transparent', 'rgba(0, 0, 0, 0)']);

/**
 * The background that paints an iframe's viewport, per the CSS 'special backgrounds'
 * propagation: the frame document's root background, else its body background, else
 * nothing (the iframe element's own background, inlined separately, shows through).
 */
const frameViewportBackground = (frame: HTMLIFrameElement): string | null => {
    try {
        const doc = frame.contentDocument;
        const view = doc && doc.defaultView;
        if (!doc || !view) {
            return null;
        }
        for (const element of [doc.documentElement, doc.body]) {
            if (element) {
                const color = view.getComputedStyle(element).backgroundColor;
                if (color && !TRANSPARENT_COLORS.has(color)) {
                    return color;
                }
            }
        }
    } catch (e) {
        // cross-origin frame
    }
    return null;
};

/** Whether the browser is displaying the poster (it shows until first playback). */
const showsPoster = (video: HTMLVideoElement): boolean => {
    if (!video.poster) {
        return false;
    }
    try {
        return video.played.length === 0;
    } catch (e) {
        return video.currentTime === 0;
    }
};

/**
 * Bakes an element's scroll position into the clone: serialized markup cannot carry
 * scrollTop/scrollLeft, so the children are wrapped in an unstyled block container shifted
 * by negative margins. The wrapper is inheritance-transparent (no inline styles), the
 * scroll container's own inline overflow clipping crops the shifted content, and the live
 * clone renders identically to the scrolled original.
 */
export const applyScrollShift = (clone: HTMLElement | SVGElement, scrollLeft: number, scrollTop: number): void => {
    const doc = clone.ownerDocument;
    if (!doc || (!scrollLeft && !scrollTop)) {
        return;
    }

    const wrapper = doc.createElement('div');
    if (scrollLeft) {
        wrapper.style.marginLeft = `${-scrollLeft}px`;
    }
    if (scrollTop) {
        wrapper.style.marginTop = `${-scrollTop}px`;
    }

    while (clone.firstChild) {
        wrapper.appendChild(clone.firstChild);
    }
    clone.appendChild(wrapper);
};

/**
 * The svg engine's computed-style inliner, plugged into the clone stage (it replaces the
 * legacy copyStyles full-copy mode). For every original element (walked exactly once, with
 * one getComputedStyle call per node performed by the cloner) it writes the default-diffed
 * style set inline on the clone — see {@link diffComputedStyle} for the diffing rules.
 * `var()` indirections need no special handling: computed longhand values are already
 * resolved, and the custom properties themselves are dropped.
 */
export class StyleInliner implements CloneStyleInliner {
    private readonly defaults: DefaultStyleCache;
    private readonly computedStyles = new WeakMap<Element, StyleDeclarationLike>();

    constructor(ownerDocument: Document) {
        this.defaults = new DefaultStyleCache(ownerDocument);
    }

    element(original: Element, clone: HTMLElement | SVGElement, computed: CSSStyleDeclaration): void {
        this.computedStyles.set(original, computed);

        const parent = original.parentElement;
        const parentComputed = parent ? this.computedOf(parent) : null;
        const diff = diffComputedStyle(computed, this.defaults.get(original), parentComputed);

        if (isCheckableInput(original) && !isInputElement(clone as Element)) {
            // The clone is the span this.formControl() materialized: paint the widget.
            styleCheckableControl(original, clone as HTMLElement, computed, diff);
            return;
        }

        if (isButtonInput(original) && !isInputElement(clone as Element)) {
            styleButtonControl(clone as HTMLElement, computed, diff);
            return;
        }

        for (const [property, value] of diff) {
            clone.style.setProperty(property, value);
        }

        pinUsedSize(clone, computed);

        if (FORM_CONTROL_TAGS.has(original.tagName)) {
            pinControlFont(clone, computed);
        }

        if (NEEDS_WIDGET_MATERIALIZATION) {
            if (isTextControl(original)) {
                pinControlBox(clone, computed);
                if (!isTextareaElement(original)) {
                    // Native single-line inputs center their text vertically; the devolved
                    // foreignObject rendering top-aligns it.
                    const contentHeight = controlContentHeight(computed);
                    if (contentHeight > 0) {
                        clone.style.setProperty('line-height', `${contentHeight}px`);
                    }
                }
            }
            decorateControl(original, clone, computed);
        }

        materializeFormState(original, clone);
    }

    /**
     * Replaces checkboxes/radios with a span the clone walk will style as a painted widget
     * (see {@link styleCheckableControl}); other controls keep their native clone — text
     * inputs, selects, textareas and buttons are CSS boxes with text and rasterize fine in
     * foreignObject on every supported browser.
     */
    formControl(original: Element): HTMLElement | null {
        return NEEDS_WIDGET_MATERIALIZATION ? materializeFormControl(original) : null;
    }

    /**
     * Inlines an expanded same-origin iframe's box styles onto its replacement container:
     * the diff against the container's own tag defaults keeps the frame border (UA-styled
     * on iframes, absent on divs), explicit size, float/position context, and so on. The
     * container clips like the frame viewport and carries the propagated root/body
     * background, mirroring what the canvas engine's IFrameElementContainer paints.
     * Scrollbars are not reproduced (the canvas engine does not paint them either).
     */
    frame(original: HTMLIFrameElement, container: HTMLElement, computed: CSSStyleDeclaration): void {
        this.computedStyles.set(original, computed);

        const parent = original.parentElement;
        const parentComputed = parent ? this.computedOf(parent) : null;

        for (const [property, value] of diffComputedStyle(
            computed,
            this.defaults.getByTag(container.tagName),
            parentComputed
        )) {
            container.style.setProperty(property, value);
        }

        // Replaced inline boxes size like inline-blocks; a plain inline div would not.
        if (computed.getPropertyValue('display') === 'inline') {
            container.style.setProperty('display', 'inline-block');
        }
        // The frame viewport clips its content; overflow != visible also moves the
        // inline-block baseline to the bottom margin edge, like a replaced box.
        container.style.setProperty('overflow', 'hidden');

        const background = frameViewportBackground(original);
        if (background) {
            container.style.setProperty('background-color', background);
        }
    }

    /**
     * Draws the video frame the user sees onto the canvas clone, letterboxed like browser
     * video content. When the poster is displayed, the frame is not yet decoded, or
     * drawing taints the canvas (cross-origin video without CORS), the canvas is left
     * blank and marked for the resource inliner's async pass (poster draw / CORS
     * re-fetch); a tainted draw returns a fresh canvas, since taint is irreversible and
     * would force the whole capture into the canvas-engine fallback.
     */
    video(original: HTMLVideoElement, canvas: HTMLCanvasElement): HTMLCanvasElement {
        const HAVE_CURRENT_DATA = 2;
        const poster = showsPoster(original);
        const ctx = canvas.width && canvas.height ? canvas.getContext('2d') : null;

        if (ctx && !poster && original.readyState >= HAVE_CURRENT_DATA && original.videoWidth) {
            try {
                drawContainedFrame(
                    ctx,
                    original,
                    canvas.width,
                    canvas.height,
                    original.videoWidth,
                    original.videoHeight
                );
                // The svg engine must be able to read the canvas back later (toDataURL).
                ctx.getImageData(0, 0, 1, 1);
                return canvas;
            } catch (e) {
                // Tainted: fall through to a fresh canvas with a CORS re-fetch marker.
            }
        }

        const marked = original.ownerDocument.createElement('canvas');
        marked.width = canvas.width;
        marked.height = canvas.height;
        if (poster) {
            marked.setAttribute(VIDEO_POSTER_ATTRIBUTE, original.poster);
        } else {
            const src = original.currentSrc || original.src;
            if (src) {
                marked.setAttribute(VIDEO_SRC_ATTRIBUTE, src);
                if (original.currentTime) {
                    marked.setAttribute(VIDEO_TIME_ATTRIBUTE, String(original.currentTime));
                }
            }
        }
        return marked;
    }

    pseudo(host: Element, target: HTMLElement, computed: CSSStyleDeclaration): void {
        inlinePseudoStyles(target, computed, this.computedOf(host), this.defaults.getByTag(PSEUDO_ELEMENT_TAG));
    }

    scrolled(original: Element, clone: HTMLElement | SVGElement): void {
        applyScrollShift(clone, original.scrollLeft, original.scrollTop);
    }

    dispose(): void {
        this.defaults.dispose();
    }

    private computedOf(element: Element): StyleDeclarationLike | null {
        const cached = this.computedStyles.get(element);
        if (cached) {
            return cached;
        }

        // ::before pseudos resolve before the host's own style hook runs; browsers return
        // the same live declaration object for repeated getComputedStyle calls, so this
        // does not recompute styles.
        const view = element.ownerDocument && element.ownerDocument.defaultView;
        if (!view) {
            return null;
        }
        const computed = view.getComputedStyle(element);
        this.computedStyles.set(element, computed);
        return computed;
    }
}
