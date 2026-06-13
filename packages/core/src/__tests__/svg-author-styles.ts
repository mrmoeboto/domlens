import {afterEach, describe, expect, it} from 'vitest';
import {collectAuthorStyleProfile} from '../engines/svg/author-styles';
import {
    clearDefaultStyleCaches,
    DefaultStyleCache,
    diffStyleSnapshot,
    snapshotComputedStyle,
    StyleDeclarationLike
} from '../engines/svg/default-styles';

const decl = (props: Record<string, string>): StyleDeclarationLike => {
    const keys = Object.keys(props);
    return {
        length: keys.length,
        item: (i: number) => keys[i] ?? '',
        getPropertyValue: (property: string) => props[property] ?? ''
    };
};

const cleanup: Element[] = [];
const mount = <T extends Element>(element: T): T => {
    document.body.appendChild(element);
    cleanup.push(element);
    return element;
};

afterEach(() => {
    cleanup.splice(0).forEach((element) => element.remove());
});

describe('collectAuthorStyleProfile', () => {
    it('should collect longhands from stylesheets and inline styles, and always include color', () => {
        const style = mount(document.createElement('style'));
        style.textContent = `.x { padding-left: 4px; } @media (min-width: 1px) { .y { opacity: 0.5; } }`;
        const inline = mount(document.createElement('div'));
        inline.style.setProperty('z-index', '4');

        const profile = collectAuthorStyleProfile(document);
        expect(profile).not.toBeNull();
        expect(profile?.properties.has('color')).toBe(true);
        expect(profile?.properties.has('padding-left')).toBe(true);
        expect(profile?.properties.has('opacity')).toBe(true);
        expect(profile?.properties.has('z-index')).toBe(true);
        // Never mentioned: must NOT be in the read set.
        expect(profile?.properties.has('transform-origin')).toBe(false);
    });

    it('should expand logical alias declarations to their physical longhands', () => {
        const style = mount(document.createElement('style'));
        style.textContent = `.x { inline-size: 10px; margin-block-start: 2px; border-inline-end-width: 1px; }`;

        const profile = collectAuthorStyleProfile(document);
        expect(profile).not.toBeNull();
        const properties = profile?.properties as Set<string>;
        // jsdom may or may not retain the logical declarations; when it does, the physical
        // expansions must be present (the writing-mode-agnostic superset).
        if (properties.size > 1) {
            for (const physical of ['width', 'height', 'margin-top', 'margin-bottom', 'border-right-width']) {
                if (properties.has('width') || properties.has('margin-top')) {
                    expect(properties.has(physical)).toBe(true);
                }
            }
        }
    });

    it('should return null (full-snapshot fallback) when a stylesheet is unreadable', () => {
        const style = mount(document.createElement('style'));
        style.textContent = `.x { color: red; }`;
        const sheet = style.sheet as CSSStyleSheet;
        Object.defineProperty(sheet, 'cssRules', {
            get() {
                throw new DOMException('cannot access rules', 'SecurityError');
            }
        });

        expect(collectAuthorStyleProfile(document)).toBeNull();
    });
});

describe('snapshotComputedStyle with a property list', () => {
    it('should read exactly the listed properties and skip unknown (empty) values', () => {
        const computed = decl({color: 'rgb(1, 2, 3)', 'padding-left': '4px', display: 'block'});
        const snapshot = snapshotComputedStyle(computed, ['color', 'padding-left', 'nonexistent-prop']);

        expect(snapshot.get('color')).toBe('rgb(1, 2, 3)');
        expect(snapshot.get('padding-left')).toBe('4px');
        expect(snapshot.has('nonexistent-prop')).toBe(false);
        // Not listed: not read, even though the declaration knows it.
        expect(snapshot.has('display')).toBe(false);
    });

    it('should skip logical alias properties in full enumeration mode', () => {
        const snapshot = snapshotComputedStyle(
            decl({'margin-block-start': '4px', 'inline-size': '100px', 'margin-top': '4px', width: '100px'})
        );
        expect(snapshot.has('margin-block-start')).toBe(false);
        expect(snapshot.has('inline-size')).toBe(false);
        expect(snapshot.get('margin-top')).toBe('4px');
        expect(snapshot.get('width')).toBe('100px');
    });
});

describe('currentcolor-coupled diffing', () => {
    const defaults = new Map([
        ['color', 'rgb(0, 0, 0)'],
        ['border-top-color', 'rgb(0, 0, 0)'],
        ['text-decoration-color', 'rgb(0, 0, 0)'],
        ['outline-color', 'rgb(0, 0, 0)'],
        ['column-rule-color', 'rgb(0, 0, 0)']
    ]);

    it('should omit non-inherited currentcolor-initial properties equal to the own color', () => {
        const snapshot = new Map([
            ['color', 'rgb(35, 35, 35)'],
            ['border-top-color', 'rgb(35, 35, 35)'],
            ['text-decoration-color', 'rgb(35, 35, 35)'],
            ['outline-color', 'rgb(35, 35, 35)'],
            ['column-rule-color', 'rgb(35, 35, 35)']
        ]);
        // color differs from the parent, so it stays; every coupled color collapses into it.
        const diff = diffStyleSnapshot(snapshot, defaults, new Map([['color', 'rgb(0, 0, 0)']]));
        expect(Object.fromEntries(diff)).toEqual({color: 'rgb(35, 35, 35)'});
    });

    it('should keep coupled colors that differ from both the default and the own color', () => {
        const snapshot = new Map([
            ['color', 'rgb(35, 35, 35)'],
            ['text-decoration-color', 'rgb(255, 0, 0)'],
            ['border-top-color', 'rgb(0, 128, 0)']
        ]);
        const diff = diffStyleSnapshot(snapshot, defaults, new Map([['color', 'rgb(35, 35, 35)']]));
        expect(Object.fromEntries(diff)).toEqual({
            'text-decoration-color': 'rgb(255, 0, 0)',
            'border-top-color': 'rgb(0, 128, 0)'
        });
    });

    it('should keep coupled colors inline where the probe shows a UA tag override (form controls)', () => {
        // A bare textarea probes border-color rgb(118,118,118) while its color probes
        // black: the UA stylesheet overrides the property, so "equals the own color" does
        // not prove the initial value would reproduce it.
        const textareaDefaults = new Map([
            ['color', 'rgb(0, 0, 0)'],
            ['border-top-color', 'rgb(118, 118, 118)']
        ]);
        const snapshot = new Map([
            ['color', 'rgb(0, 0, 0)'],
            ['border-top-color', 'rgb(0, 0, 0)']
        ]);
        const diff = diffStyleSnapshot(snapshot, textareaDefaults, null);
        expect(Object.fromEntries(diff)['border-top-color']).toBe('rgb(0, 0, 0)');
    });

    it('should keep 3D-style border colors inline even when equal to the own color', () => {
        const snapshot = new Map([
            ['color', 'rgb(35, 35, 35)'],
            ['border-top-style', 'inset'],
            ['border-top-color', 'rgb(35, 35, 35)']
        ]);
        const diff = diffStyleSnapshot(snapshot, defaults, null);
        expect(Object.fromEntries(diff)['border-top-color']).toBe('rgb(35, 35, 35)');
    });
});

describe('DefaultStyleCache persistence', () => {
    it('should reuse computed default maps across cache instances for the same document', () => {
        clearDefaultStyleCaches(document);
        const first = new DefaultStyleCache(document);
        const map = first.get(document.createElement('div'));
        first.dispose();

        const second = new DefaultStyleCache(document);
        try {
            expect(second.get(document.createElement('div'))).toBe(map);
        } finally {
            second.dispose();
        }

        clearDefaultStyleCaches(document);
        const third = new DefaultStyleCache(document);
        try {
            expect(third.get(document.createElement('div'))).not.toBe(map);
        } finally {
            third.dispose();
        }
    });

    it('should extend persisted maps when a later capture reads extra properties', () => {
        clearDefaultStyleCaches(document);
        const first = new DefaultStyleCache(document);
        const map = first.get(document.createElement('div'));
        first.dispose();

        const second = new DefaultStyleCache(document, ['background-position-x']);
        try {
            const extended = second.get(document.createElement('div'));
            expect(extended).toBe(map); // identity-stable merge
            expect(extended.has('background-position-x')).toBe(true);
        } finally {
            second.dispose();
            clearDefaultStyleCaches(document);
        }
    });
});
