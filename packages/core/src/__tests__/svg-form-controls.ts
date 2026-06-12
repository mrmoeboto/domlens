import {describe, expect, it} from 'vitest';
import {StyleDeclarationLike} from '../engines/svg/default-styles';
import {
    buttonInputLabel,
    controlContentHeight,
    decorateControl,
    isButtonInput,
    isCheckableInput,
    materializeFormControl,
    pinControlBox,
    pinControlFont,
    pinUsedSize,
    styleButtonControl,
    styleCheckableControl,
    StyleInliner
} from '../engines/svg/style-inliner';
import {
    containRect,
    VIDEO_POSTER_ATTRIBUTE,
    VIDEO_SRC_ATTRIBUTE,
    VIDEO_TIME_ATTRIBUTE
} from '../engines/svg/resource-inliner';

/** Builds a CSSStyleDeclaration-like fixture (jsdom's getComputedStyle is too sparse). */
const decl = (props: Record<string, string>): StyleDeclarationLike => {
    const keys = Object.keys(props);
    return {
        length: keys.length,
        item: (i: number) => keys[i] ?? '',
        getPropertyValue: (property: string) => props[property] ?? ''
    };
};

const input = (type: string, attrs: Record<string, string> = {}): HTMLInputElement => {
    const element = document.createElement('input');
    element.setAttribute('type', type);
    for (const [name, value] of Object.entries(attrs)) {
        element.setAttribute(name, value);
    }
    return element;
};

describe('form control predicates', () => {
    it('should classify checkable and button inputs', () => {
        expect(isCheckableInput(input('checkbox'))).toBe(true);
        expect(isCheckableInput(input('radio'))).toBe(true);
        expect(isCheckableInput(input('text'))).toBe(false);
        expect(isCheckableInput(document.createElement('span'))).toBe(false);

        expect(isButtonInput(input('submit'))).toBe(true);
        expect(isButtonInput(input('reset'))).toBe(true);
        expect(isButtonInput(input('button'))).toBe(true);
        expect(isButtonInput(input('checkbox'))).toBe(false);
    });

    it('should resolve button labels with UA defaults', () => {
        expect(buttonInputLabel(input('submit', {value: 'Go'}))).toBe('Go');
        expect(buttonInputLabel(input('submit'))).toBe('Submit');
        expect(buttonInputLabel(input('reset'))).toBe('Reset');
        expect(buttonInputLabel(input('button'))).toBe('');
    });
});

describe('materializeFormControl', () => {
    it('should materialize checkboxes/radios as empty spans', () => {
        const clone = materializeFormControl(input('checkbox'));
        expect(clone?.tagName).toBe('SPAN');
        expect(clone?.textContent).toBe('');
    });

    it('should materialize button inputs as label spans', () => {
        const clone = materializeFormControl(input('submit', {value: 'Send'}));
        expect(clone?.tagName).toBe('SPAN');
        expect(clone?.textContent).toBe('Send');
    });

    it('should keep regular clones for other controls', () => {
        expect(materializeFormControl(input('text'))).toBeNull();
        expect(materializeFormControl(document.createElement('select'))).toBeNull();
        expect(materializeFormControl(document.createElement('div'))).toBeNull();
    });
});

describe('styleCheckableControl', () => {
    const computed = decl({
        width: '14px',
        height: '20px',
        'box-sizing': 'border-box',
        display: 'inline-block'
    });

    it('should pin the used size and display so the span cannot collapse', () => {
        const clone = document.createElement('span');
        styleCheckableControl(input('checkbox'), clone, computed, [['margin-left', '10px']]);

        expect(clone.style.getPropertyValue('margin-left')).toBe('10px');
        expect(clone.style.getPropertyValue('width')).toBe('14px');
        expect(clone.style.getPropertyValue('height')).toBe('20px');
        expect(clone.style.getPropertyValue('box-sizing')).toBe('border-box');
        expect(clone.style.getPropertyValue('display')).toBe('inline-block');
    });

    it('should map an inline display to inline-block', () => {
        const clone = document.createElement('span');
        styleCheckableControl(input('checkbox'), clone, decl({width: '13px', height: '13px', display: 'inline'}), []);
        expect(clone.style.getPropertyValue('display')).toBe('inline-block');
    });

    it('should paint the widget glyph at the smaller box dimension, centered', () => {
        const clone = document.createElement('span');
        styleCheckableControl(input('checkbox'), clone, decl({width: '200px', height: '20px'}), []);

        expect(clone.style.getPropertyValue('background-image')).toContain('data:image/svg+xml');
        expect(clone.style.getPropertyValue('background-size')).toBe('20px 20px');
        expect(clone.style.getPropertyValue('background-position')).toContain('center');
        expect(clone.style.getPropertyValue('background-repeat')).toBe('no-repeat');
        // an author background must not ride along on a themed widget
        expect(clone.style.getPropertyValue('background-color')).toBe('transparent');
    });

    it('should draw distinct glyphs per type and checked state', () => {
        const glyphOf = (type: string, checked: boolean): string => {
            const original = input(type);
            original.checked = checked;
            const clone = document.createElement('span');
            styleCheckableControl(original, clone, decl({width: '14px', height: '14px'}), []);
            return clone.style.getPropertyValue('background-image');
        };

        const set = new Set([
            glyphOf('checkbox', false),
            glyphOf('checkbox', true),
            glyphOf('radio', false),
            glyphOf('radio', true)
        ]);
        expect(set.size).toBe(4);
        expect(glyphOf('radio', false)).toContain('circle');
        expect(glyphOf('checkbox', false)).toContain('rect');
    });
});

describe('styleButtonControl', () => {
    it('should center the label via line-height derived from the border-box metrics', () => {
        const clone = document.createElement('span');
        styleButtonControl(
            clone,
            decl({
                width: '150px',
                height: '28px',
                'box-sizing': 'border-box',
                'border-top-width': '2px',
                'border-bottom-width': '2px',
                'padding-top': '2px',
                'padding-bottom': '2px',
                display: 'inline-block',
                'text-align': 'center'
            }),
            []
        );

        expect(clone.style.getPropertyValue('line-height')).toBe('20px');
        expect(clone.style.getPropertyValue('display')).toBe('inline-block');
        expect(clone.style.getPropertyValue('white-space')).toBe('pre');
        expect(clone.style.getPropertyValue('text-align')).toBe('center');
    });

    it('should center start-aligned labels but preserve explicit alignment', () => {
        const centered = document.createElement('span');
        styleButtonControl(centered, decl({height: '20px', 'text-align': 'start'}), []);
        expect(centered.style.getPropertyValue('text-align')).toBe('center');

        const left = document.createElement('span');
        styleButtonControl(left, decl({height: '20px', 'text-align': 'left'}), []);
        expect(left.style.getPropertyValue('text-align')).toBe('left');
    });
});

describe('controlContentHeight', () => {
    it('should subtract borders and paddings under border-box sizing', () => {
        expect(
            controlContentHeight(
                decl({
                    height: '50px',
                    'box-sizing': 'border-box',
                    'border-top-width': '2px',
                    'border-bottom-width': '3px',
                    'padding-top': '5px',
                    'padding-bottom': '10px'
                })
            )
        ).toBe(30);
    });

    it('should return the height as-is under content-box sizing', () => {
        expect(controlContentHeight(decl({height: '20px', 'box-sizing': 'content-box'}))).toBe(20);
    });
});

describe('pinControlBox', () => {
    it('should pin the full box model and devolve native theming', () => {
        const clone = document.createElement('input');
        pinControlBox(
            clone,
            decl({
                'border-top-width': '2px',
                'border-top-style': 'inset',
                'border-top-color': 'rgb(0, 0, 0)',
                'padding-top': '2px',
                'border-right-width': '2px',
                'border-right-style': 'inset',
                'border-right-color': 'rgb(0, 0, 0)',
                'padding-right': '2px',
                'border-bottom-width': '2px',
                'border-bottom-style': 'inset',
                'border-bottom-color': 'rgb(0, 0, 0)',
                'padding-bottom': '2px',
                'border-left-width': '2px',
                'border-left-style': 'inset',
                'border-left-color': 'rgb(0, 0, 0)',
                'padding-left': '2px',
                'box-sizing': 'content-box',
                width: '150px',
                height: '20px',
                'background-color': 'rgb(255, 255, 255)'
            })
        );

        expect(clone.style.getPropertyValue('appearance')).toBe('none');
        expect(clone.style.getPropertyValue('border-top-width')).toBe('2px');
        expect(clone.style.getPropertyValue('border-left-style')).toBe('inset');
        expect(clone.style.getPropertyValue('padding-bottom')).toBe('2px');
        expect(clone.style.getPropertyValue('width')).toBe('150px');
        expect(clone.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
    });
});

describe('pinControlFont', () => {
    it('should pin the text styling controls do not inherit', () => {
        const clone = document.createElement('input');
        pinControlFont(clone, decl({'font-family': 'Arial', 'font-size': '16px', color: 'rgb(0, 0, 0)'}));

        expect(clone.style.getPropertyValue('font-family')).toBe('Arial');
        expect(clone.style.getPropertyValue('font-size')).toBe('16px');
        expect(clone.style.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
        // absent values must not write empty declarations
        expect(clone.style.getPropertyValue('font-style')).toBe('');
    });
});

describe('decorateControl', () => {
    it('should paint a dropdown arrow on selects and clear the text off it', () => {
        const clone = document.createElement('select');
        decorateControl(
            document.createElement('select'),
            clone,
            decl({'box-sizing': 'border-box', 'padding-right': '2px'})
        );

        expect(clone.style.getPropertyValue('background-image')).toContain('data:image/svg+xml');
        expect(clone.style.getPropertyValue('padding-right')).toBe('16px');
    });

    it('should not grow a content-box select with the arrow padding', () => {
        const clone = document.createElement('select');
        decorateControl(
            document.createElement('select'),
            clone,
            decl({'box-sizing': 'content-box', 'padding-right': '2px'})
        );

        expect(clone.style.getPropertyValue('background-image')).toContain('data:image/svg+xml');
        expect(clone.style.getPropertyValue('padding-right')).toBe('');
    });

    it('should paint a resize grip on textareas unless resizing is disabled', () => {
        const grip = document.createElement('textarea');
        decorateControl(document.createElement('textarea'), grip, decl({resize: 'both'}));
        expect(grip.style.getPropertyValue('background-image')).toContain('data:image/svg+xml');

        const fixed = document.createElement('textarea');
        decorateControl(document.createElement('textarea'), fixed, decl({resize: 'none'}));
        expect(fixed.style.getPropertyValue('background-image')).toBe('');
    });

    it('should leave other elements untouched', () => {
        const clone = document.createElement('div');
        decorateControl(document.createElement('div'), clone, decl({}));
        expect(clone.getAttribute('style')).toBeNull();
    });
});

describe('pinUsedSize', () => {
    it('should pin used pixel sizes the default diff would omit', () => {
        const clone = document.createElement('img');
        pinUsedSize(clone, decl({width: '0px', height: '0px'}));
        expect(clone.style.getPropertyValue('width')).toBe('0px');
        expect(clone.style.getPropertyValue('height')).toBe('0px');
    });

    it('should skip auto sizes (inline boxes) and respect already-diffed values', () => {
        const span = document.createElement('span');
        pinUsedSize(span, decl({width: 'auto', height: 'auto'}));
        expect(span.getAttribute('style')).toBeNull();

        const div = document.createElement('div');
        div.style.setProperty('width', '320px');
        pinUsedSize(div, decl({width: '100px', height: '50px'}));
        expect(div.style.getPropertyValue('width')).toBe('320px');
        expect(div.style.getPropertyValue('height')).toBe('50px');
    });
});

describe('containRect', () => {
    it('should letterbox wide content in a taller box', () => {
        expect(containRect(100, 100, 200, 100)).toEqual({left: 0, top: 25, width: 100, height: 50});
    });

    it('should pillarbox tall content in a wider box', () => {
        expect(containRect(100, 100, 50, 100)).toEqual({left: 25, top: 0, width: 50, height: 100});
    });

    it('should fill the box exactly when aspect ratios match', () => {
        expect(containRect(250, 125, 500, 250)).toEqual({left: 0, top: 0, width: 250, height: 125});
    });

    it('should fall back to the full box when intrinsic dimensions are unknown', () => {
        expect(containRect(80, 60, 0, 0)).toEqual({left: 0, top: 0, width: 80, height: 60});
    });
});

describe('StyleInliner.video', () => {
    const inliner = () => new StyleInliner(document);

    const videoElement = (attrs: Record<string, string>): HTMLVideoElement => {
        const video = document.createElement('video');
        for (const [name, value] of Object.entries(attrs)) {
            video.setAttribute(name, value);
        }
        return video;
    };

    const canvas = (): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = 250;
        c.height = 140;
        return c;
    };

    it('should mark an undecodable video for a CORS re-fetch by the resource inliner', () => {
        // jsdom: readyState 0, no 2d context — the synchronous draw cannot happen.
        const video = videoElement({src: 'http://localhost/video.mp4'});
        const clone = inliner().video(video, canvas());

        expect(clone.tagName).toBe('CANVAS');
        expect(clone.width).toBe(250);
        expect(clone.height).toBe(140);
        expect(clone.getAttribute(VIDEO_SRC_ATTRIBUTE)).toBe(video.src);
        expect(clone.getAttribute(VIDEO_TIME_ATTRIBUTE)).toBeNull();
        expect(clone.getAttribute(VIDEO_POSTER_ATTRIBUTE)).toBeNull();
    });

    it('should mark the poster when the browser is displaying it', () => {
        const video = videoElement({src: 'http://localhost/video.mp4', poster: 'http://localhost/poster.png'});
        const clone = inliner().video(video, canvas());

        expect(clone.getAttribute(VIDEO_POSTER_ATTRIBUTE)).toBe(video.poster);
        expect(clone.getAttribute(VIDEO_SRC_ATTRIBUTE)).toBeNull();
    });
});
