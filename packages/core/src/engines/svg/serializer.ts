import {foreignObjectQuirkStyle} from './webkit-quirks';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Wraps a node in an `<svg><foreignObject>` document. The node is appended (moved) into the
 * foreignObject. Used by the foreignObject feature detection and as the low-level building
 * block of {@link serializeToSvg}.
 */
export const createForeignObjectSVG = (
    width: number,
    height: number,
    x: number,
    y: number,
    node: Node
): SVGForeignObjectElement => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
    svg.setAttributeNS(null, 'width', width.toString());
    svg.setAttributeNS(null, 'height', height.toString());

    foreignObject.setAttributeNS(null, 'width', '100%');
    foreignObject.setAttributeNS(null, 'height', '100%');
    foreignObject.setAttributeNS(null, 'x', x.toString());
    foreignObject.setAttributeNS(null, 'y', y.toString());
    foreignObject.setAttributeNS(null, 'externalResourcesRequired', 'true');
    svg.appendChild(foreignObject);

    foreignObject.appendChild(node);

    return svg;
};

export interface SerializeConfig {
    /** Size of the capture region (the svg viewport) in CSS pixels. */
    width: number;
    height: number;
    /** Offset of the capture region within the serialized content (crop origin). */
    left: number;
    top: number;
    /** CSS background color painted behind the content; omit to keep the svg transparent. */
    backgroundColor?: string;
    /**
     * CSS injected as a `<style>` element inside the svg — @font-face rules with data: url
     * sources (see fonts.ts), so text in the foreignObject renders with its web fonts when
     * the markup is loaded as a self-contained image.
     */
    fontCss?: string;
}

/**
 * Serializes a cloned (computed-style-inlined) DOM node into standalone
 * `<svg><foreignObject>` markup:
 *
 * - the node is deep-imported (the original clone tree is left untouched),
 * - serialization happens with XMLSerializer so HTML content gets its XHTML namespace
 *   declaration (foreignObject content must be namespaced XML, not HTML),
 * - the foreignObject is offset by `-left/-top` and oversized accordingly, so the svg
 *   viewport shows exactly the `left/top/width/height` region of the content (this is how
 *   capturing a child element of the page crops to its bounds).
 */
export const serializeToSvg = (node: Node, config: SerializeConfig): string => {
    const width = Math.max(1, Math.round(config.width));
    const height = Math.max(1, Math.round(config.height));
    const left = Math.round(config.left);
    const top = Math.round(config.top);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttributeNS(null, 'width', width.toString());
    svg.setAttributeNS(null, 'height', height.toString());
    svg.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);

    if (config.fontCss) {
        // Embedded fonts must precede the content so the style is parsed before layout of
        // the foreignObject subtree. Style elements inside svg apply to the whole document,
        // including the XHTML content of foreignObject.
        const style = document.createElementNS(SVG_NS, 'style');
        style.setAttributeNS(null, 'type', 'text/css');
        style.textContent = config.fontCss;
        svg.appendChild(style);
    }

    if (config.backgroundColor) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttributeNS(null, 'width', '100%');
        rect.setAttributeNS(null, 'height', '100%');
        rect.setAttributeNS(null, 'fill', config.backgroundColor);
        svg.appendChild(rect);
    }

    const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
    foreignObject.setAttributeNS(null, 'x', (-left).toString());
    foreignObject.setAttributeNS(null, 'y', (-top).toString());
    foreignObject.setAttributeNS(null, 'width', (left + width).toString());
    foreignObject.setAttributeNS(null, 'height', (top + height).toString());
    foreignObject.setAttributeNS(null, 'externalResourcesRequired', 'true');

    // WebKit-only (empty string elsewhere): pin -webkit-text-size-adjust on the wrapper so
    // WebKit's text autosizing does not inflate font sizes inside the rendered image; the
    // property is inherited by the whole foreignObject subtree.
    const quirkStyle = foreignObjectQuirkStyle();
    if (quirkStyle) {
        foreignObject.setAttributeNS(null, 'style', quirkStyle);
    }
    svg.appendChild(foreignObject);

    // importNode (not appendChild) so the clone tree stays attached to its iframe; layout
    // queries against the clone (e.g. bounds parsing) must keep working after serialization.
    foreignObject.appendChild((svg.ownerDocument ?? document).importNode(node, true));

    return new XMLSerializer().serializeToString(svg);
};
