import {describe, expect, it} from 'vitest';
import {createForeignObjectSVG, serializeToSvg} from '../engines/svg/serializer';
import {SvgEngine} from '../engines/svg/engine';
import {CaptureContext} from '../capture-context';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

const parse = (markup: string): SVGSVGElement => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe(SVG_NS);
    return root as unknown as SVGSVGElement;
};

describe('serializeToSvg', () => {
    it('should produce svg-namespaced markup with the configured dimensions', () => {
        const node = document.createElement('div');
        const markup = serializeToSvg(node, {width: 120, height: 80, left: 0, top: 0});

        const svg = parse(markup);
        expect(svg.getAttribute('width')).toBe('120');
        expect(svg.getAttribute('height')).toBe('80');
        expect(svg.getAttribute('viewBox')).toBe('0 0 120 80');
    });

    it('should serialize html content with an explicit xhtml namespace declaration', () => {
        const node = document.createElement('div');
        node.textContent = 'hello';
        const markup = serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0});

        // foreignObject content must be namespaced XML; the xmlns declaration is what makes
        // the markup self-contained when loaded as an svg image.
        expect(markup).toContain(`xmlns="${XHTML_NS}"`);

        const svg = parse(markup);
        const div = svg.getElementsByTagNameNS(XHTML_NS, 'div')[0];
        expect(div).toBeDefined();
        expect(div.textContent).toBe('hello');
    });

    it('should offset and oversize the foreignObject to crop to the capture region', () => {
        const node = document.createElement('div');
        const markup = serializeToSvg(node, {width: 100, height: 50, left: 30, top: 20});

        const svg = parse(markup);
        const foreignObject = svg.getElementsByTagNameNS(SVG_NS, 'foreignObject')[0];
        expect(foreignObject.getAttribute('x')).toBe('-30');
        expect(foreignObject.getAttribute('y')).toBe('-20');
        expect(foreignObject.getAttribute('width')).toBe('130');
        expect(foreignObject.getAttribute('height')).toBe('70');
    });

    it('should paint a background rect only when a background color is configured', () => {
        const node = document.createElement('div');
        const withBackground = parse(
            serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0, backgroundColor: '#ff8000'})
        );
        const rect = withBackground.getElementsByTagNameNS(SVG_NS, 'rect')[0];
        expect(rect).toBeDefined();
        expect(rect.getAttribute('fill')).toBe('#ff8000');
        // The background must be painted behind the content.
        expect(rect.nextSibling).toBe(withBackground.getElementsByTagNameNS(SVG_NS, 'foreignObject')[0]);

        const transparent = parse(serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0}));
        expect(transparent.getElementsByTagNameNS(SVG_NS, 'rect')).toHaveLength(0);
    });

    it('should not detach the serialized node from its tree', () => {
        const parent = document.createElement('section');
        const node = document.createElement('div');
        parent.appendChild(node);

        serializeToSvg(node, {width: 10, height: 10, left: 0, top: 0});
        expect(node.parentNode).toBe(parent);
    });

    it('should clamp degenerate dimensions to 1x1', () => {
        const node = document.createElement('div');
        const svg = parse(serializeToSvg(node, {width: 0, height: 0, left: 0, top: 0}));
        expect(svg.getAttribute('width')).toBe('1');
        expect(svg.getAttribute('height')).toBe('1');
    });
});

describe('createForeignObjectSVG', () => {
    it('should move the node into a sized svg > foreignObject', () => {
        const node = document.createElement('div');
        const svg = createForeignObjectSVG(100, 50, 5, 7, node);

        expect(svg.namespaceURI).toBe(SVG_NS);
        expect(svg.getAttribute('width')).toBe('100');
        expect(svg.getAttribute('height')).toBe('50');

        const foreignObject = svg.firstChild as SVGForeignObjectElement;
        expect(foreignObject.namespaceURI).toBe(SVG_NS);
        expect(foreignObject.getAttribute('x')).toBe('5');
        expect(foreignObject.getAttribute('y')).toBe('7');
        expect(foreignObject.firstChild).toBe(node);
    });
});

describe('SvgEngine', () => {
    const stubContext = (foreignObject: boolean): CaptureContext =>
        ({env: {SUPPORT_FOREIGNOBJECT_DRAWING: Promise.resolve(foreignObject)}}) as unknown as CaptureContext;

    it('should request inlined images and the engine-owned style inliner (no legacy copyStyles)', () => {
        const engine = new SvgEngine();
        expect(engine.name).toBe('svg');
        expect(engine.cloneConfig.inlineImages).toBe(true);
        expect(engine.cloneConfig.copyStyles).toBe(false);
        expect(typeof engine.cloneConfig.createStyleInliner).toBe('function');
    });

    it('should report support based on the foreignObject feature detect', async () => {
        const engine = new SvgEngine();
        expect(await engine.supports(stubContext(true))).toEqual({ok: true});

        const unsupported = await engine.supports(stubContext(false));
        expect(unsupported.ok).toBe(false);
        expect(unsupported.reason).toContain('foreignObject');
    });
});
