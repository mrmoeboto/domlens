import {isInputElement, isSelectElement, isTextareaElement} from '../canvas/dom/node-parser';
import {CloneStyleInliner} from '../../clone/document-cloner';
import {DefaultStyleCache, diffComputedStyle, StyleDeclarationLike} from './default-styles';
import {inlinePseudoStyles, PSEUDO_ELEMENT_TAG} from './pseudo';

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

        for (const [property, value] of diffComputedStyle(computed, this.defaults.get(original), parentComputed)) {
            clone.style.setProperty(property, value);
        }

        materializeFormState(original, clone);
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
