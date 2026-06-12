import {describe, expect, it} from 'vitest';
import {DefaultStyleCache, DefaultStyleMap, diffComputedStyle, StyleDeclarationLike} from '../engines/svg/default-styles';
import {applyScrollShift, materializeFormState} from '../engines/svg/style-inliner';
import {inlinePseudoStyles} from '../engines/svg/pseudo';

/** Builds a CSSStyleDeclaration-like fixture (jsdom's getComputedStyle is too sparse). */
const decl = (props: Record<string, string>): StyleDeclarationLike => {
    const keys = Object.keys(props);
    return {
        length: keys.length,
        item: (i: number) => keys[i] ?? '',
        getPropertyValue: (property: string) => props[property] ?? ''
    };
};

const defaultsOf = (props: Record<string, string>): DefaultStyleMap => new Map(Object.entries(props));

const applyDiff = (diff: Array<[string, string]>): HTMLElement => {
    const target = document.createElement('div');
    for (const [property, value] of diff) {
        target.style.setProperty(property, value);
    }
    return target;
};

describe('diffComputedStyle', () => {
    it('should omit non-inherited properties matching the tag defaults', () => {
        const diff = diffComputedStyle(
            decl({display: 'block', width: '100px', 'background-color': 'rgb(255, 0, 0)'}),
            defaultsOf({display: 'block', width: 'auto', 'background-color': 'rgba(0, 0, 0, 0)'}),
            // Parent values differ, but display/width/background are known non-inherited.
            decl({display: 'flex', width: '500px', 'background-color': 'rgb(0, 0, 255)'})
        );

        expect(Object.fromEntries(diff)).toEqual({width: '100px', 'background-color': 'rgb(255, 0, 0)'});
    });

    it('should omit inherited properties matching the parent computed value, even when they differ from the defaults', () => {
        const diff = diffComputedStyle(
            decl({color: 'rgb(255, 0, 0)', 'font-size': '20px', 'line-height': '30px'}),
            defaultsOf({color: 'rgb(0, 0, 0)', 'font-size': '16px', 'line-height': 'normal'}),
            decl({color: 'rgb(255, 0, 0)', 'font-size': '20px', 'line-height': '24px'})
        );

        // color/font-size are reproduced by inheritance; line-height differs from the parent.
        expect(Object.fromEntries(diff)).toEqual({'line-height': '30px'});
    });

    it('should inline inherited properties differing from the defaults at the tree root', () => {
        const diff = diffComputedStyle(
            decl({color: 'rgb(255, 0, 0)', 'font-size': '16px'}),
            defaultsOf({color: 'rgb(0, 0, 0)', 'font-size': '16px'}),
            null
        );

        expect(Object.fromEntries(diff)).toEqual({color: 'rgb(255, 0, 0)'});
    });

    it('should keep unclassified properties when the parent disagrees with the matching default (inheritance-safe)', () => {
        const diff = diffComputedStyle(
            decl({'scrollbar-color': 'auto'}),
            defaultsOf({'scrollbar-color': 'auto'}),
            decl({'scrollbar-color': 'rgb(255, 0, 0) rgb(0, 0, 255)'})
        );

        // If scrollbar-color were inherited (it is) and we omitted it, the serialized node
        // would wrongly inherit the parent's value.
        expect(Object.fromEntries(diff)).toEqual({'scrollbar-color': 'auto'});

        const agreeing = diffComputedStyle(
            decl({'scrollbar-color': 'auto'}),
            defaultsOf({'scrollbar-color': 'auto'}),
            decl({'scrollbar-color': 'auto'})
        );
        expect(agreeing).toEqual([]);
    });

    it('should drop custom properties and rely on computed longhands having var() resolved', () => {
        // getComputedStyle hands the inliner *resolved* values: a `background-color:
        // var(--brand)` declaration computes to the substituted color, and the custom
        // property itself is enumerated separately. The diff must keep the resolved
        // longhand and never emit var() indirections or `--*` properties.
        const diff = diffComputedStyle(
            decl({'--brand': 'rgb(0, 128, 0)', 'background-color': 'rgb(0, 128, 0)'}),
            defaultsOf({'background-color': 'rgba(0, 0, 0, 0)'}),
            null
        );

        const target = applyDiff(diff);
        const styleAttr = target.getAttribute('style') ?? '';
        expect(styleAttr).toContain('background-color: rgb(0, 128, 0)');
        expect(styleAttr).not.toContain('--brand');
        expect(styleAttr).not.toContain('var(');
    });

    it('should keep default-equal border colors inline when the border style is a 3D style', () => {
        // Chromium paints inset/outset borders with its themed bevel when the color is the
        // initial currentcolor, but flat-darkened when a color is explicitly set — omitting
        // a default-equal border-color changes rendering there.
        const diff = diffComputedStyle(
            decl({
                'border-top-style': 'inset',
                'border-top-color': 'rgb(0, 0, 0)',
                'border-bottom-style': 'solid',
                'border-bottom-color': 'rgb(0, 0, 0)'
            }),
            defaultsOf({
                'border-top-style': 'none',
                'border-top-color': 'rgb(0, 0, 0)',
                'border-bottom-style': 'none',
                'border-bottom-color': 'rgb(0, 0, 0)'
            }),
            null
        );

        expect(Object.fromEntries(diff)).toEqual({
            'border-top-style': 'inset',
            'border-top-color': 'rgb(0, 0, 0)',
            'border-bottom-style': 'solid'
        });
    });

    it('should never inline the content/all/d properties', () => {
        const diff = diffComputedStyle(
            decl({content: '"hi"', all: 'unset', d: 'path("M 0 0")', color: 'rgb(1, 2, 3)'}),
            defaultsOf({color: 'rgb(0, 0, 0)'}),
            null
        );
        expect(Object.fromEntries(diff)).toEqual({color: 'rgb(1, 2, 3)'});
    });

    it('should stay within the style attribute size budget on a representative node', () => {
        // A representative computed style: ~300 longhands at their defaults plus a handful
        // of real differences (what a typical styled div carries).
        const defaults: Record<string, string> = {};
        for (let i = 0; i < 300; i++) {
            defaults[`property-${i}`] = `value-${i}-${'x'.repeat(10)}`;
        }
        const computed: Record<string, string> = {
            ...defaults,
            width: '320px',
            height: '48px',
            'background-color': 'rgb(255, 0, 0)',
            'border-top-width': '1px',
            'margin-left': '8px',
            position: 'relative'
        };

        const fullDumpSize = Object.entries(computed).reduce((sum, [k, v]) => sum + k.length + v.length + 2, 0);
        const diff = diffComputedStyle(decl(computed), defaultsOf(defaults), null);
        const styleAttr = applyDiff(diff).getAttribute('style') ?? '';

        // The legacy copyStyles mode wrote the full dump; the diffed attribute must be a
        // small fraction of it.
        expect(styleAttr.length).toBeGreaterThan(0);
        expect(styleAttr.length).toBeLessThan(250);
        expect(styleAttr.length).toBeLessThan(fullDumpSize * 0.05);
    });
});

describe('DefaultStyleCache', () => {
    it('should cache defaults per tag name and key inputs by type', () => {
        const cache = new DefaultStyleCache(document);
        try {
            const div = document.createElement('div');
            expect(cache.get(div)).toBe(cache.get(document.createElement('div')));
            expect(cache.get(div)).not.toBe(cache.get(document.createElement('span')));

            const checkbox = document.createElement('input');
            checkbox.setAttribute('type', 'checkbox');
            const text = document.createElement('input');
            text.setAttribute('type', 'text');
            expect(cache.get(checkbox)).not.toBe(cache.get(text));
            expect(cache.getByTag('html2canvaspseudoelement')).toBe(cache.getByTag('html2canvaspseudoelement'));
        } finally {
            cache.dispose();
        }
    });

    it('should create its sandbox iframe lazily and remove it on dispose', () => {
        const countIframes = () => document.querySelectorAll('iframe[data-html2canvas-ignore]').length;
        const before = countIframes();

        const cache = new DefaultStyleCache(document);
        expect(countIframes()).toBe(before);

        cache.get(document.createElement('div'));
        expect(countIframes()).toBe(before + 1);

        cache.dispose();
        expect(countIframes()).toBe(before);
    });
});

describe('inlinePseudoStyles', () => {
    it('should inline diffed pseudo styles with the host as inheritance parent', () => {
        const target = document.createElement('html2canvaspseudoelement') as HTMLElement;
        inlinePseudoStyles(
            target,
            decl({color: 'rgb(255, 0, 0)', display: 'inline', width: '12px'}),
            decl({color: 'rgb(255, 0, 0)', display: 'block', width: '100px'}),
            defaultsOf({display: 'inline', width: 'auto'})
        );

        // color inherits from the host clone; display matches the pseudo-tag default.
        expect(target.style.getPropertyValue('color')).toBe('');
        expect(target.style.getPropertyValue('display')).toBe('');
        expect(target.style.getPropertyValue('width')).toBe('12px');
    });
});

describe('materializeFormState', () => {
    it('should write input values and checked state as attributes', () => {
        const input = document.createElement('input');
        input.value = 'typed';
        const clone = input.cloneNode(false) as HTMLInputElement;
        materializeFormState(input, clone);
        expect(clone.getAttribute('value')).toBe('typed');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        const checkboxClone = checkbox.cloneNode(false) as HTMLInputElement;
        materializeFormState(checkbox, checkboxClone);
        expect(checkboxClone.hasAttribute('checked')).toBe(true);

        checkbox.checked = false;
        materializeFormState(checkbox, checkboxClone);
        expect(checkboxClone.hasAttribute('checked')).toBe(false);
    });

    it('should write the textarea value as text content', () => {
        const textarea = document.createElement('textarea');
        textarea.textContent = 'initial';
        textarea.value = 'edited';
        const clone = textarea.cloneNode(true) as HTMLTextAreaElement;
        materializeFormState(textarea, clone);
        expect(clone.textContent).toBe('edited');
    });

    it('should mark the live selection on cloned select options', () => {
        const select = document.createElement('select');
        for (const label of ['a', 'b', 'c']) {
            const option = document.createElement('option');
            option.textContent = label;
            select.appendChild(option);
        }
        // The markup-selected option is the first; move the live selection to the third.
        select.options[0].setAttribute('selected', '');
        select.selectedIndex = 2;

        const clone = select.cloneNode(true) as HTMLSelectElement;
        materializeFormState(select, clone);

        const selected = Array.from(clone.querySelectorAll('option')).map((option) => option.hasAttribute('selected'));
        expect(selected).toEqual([false, false, true]);
    });
});

describe('applyScrollShift', () => {
    it('should wrap children in a negative-margin container reproducing the scroll offset', () => {
        const clone = document.createElement('div');
        const a = document.createElement('p');
        const b = document.createTextNode('text');
        clone.appendChild(a);
        clone.appendChild(b);

        applyScrollShift(clone, 15, 200);

        expect(clone.childNodes.length).toBe(1);
        const wrapper = clone.firstChild as HTMLElement;
        expect(wrapper.tagName).toBe('DIV');
        expect(wrapper.style.marginLeft).toBe('-15px');
        expect(wrapper.style.marginTop).toBe('-200px');
        expect(Array.from(wrapper.childNodes)).toEqual([a, b]);
    });

    it('should do nothing for unscrolled elements', () => {
        const clone = document.createElement('div');
        clone.appendChild(document.createElement('p'));
        applyScrollShift(clone, 0, 0);
        expect((clone.firstChild as HTMLElement).tagName).toBe('P');
    });
});
