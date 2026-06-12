import {DefaultStyleMap, diffComputedStyle, StyleDeclarationLike} from './default-styles';

/**
 * ::before/::after materialization for the svg engine.
 *
 * The structural part — resolving `content` (strings, url() images, attr(), counters,
 * quotes) into real child nodes — lives in the shared clone stage
 * (DocumentCloner.resolvePseudoContent), because the canvas engine consumes the same
 * materialized `<html2canvaspseudoelement>` nodes. What is engine-specific is how the
 * pseudo's computed style gets onto that node: the canvas engine copies every property,
 * while the svg engine writes the default-diffed subset via {@link inlinePseudoStyles}.
 */

/** Tag name the clone stage materializes pseudo elements as (an unknown inline element). */
export const PSEUDO_ELEMENT_TAG = 'html2canvaspseudoelement';

/**
 * Inlines a pseudo element's computed style onto its materialized node, diffed against the
 * defaults of {@link PSEUDO_ELEMENT_TAG} (a plain inline element, like the anonymous box a
 * pseudo generates). The host element acts as the inheritance parent: the materialized node
 * is inserted as a child of the host's clone, so inherited properties matching the host's
 * computed value can be omitted and reproduced through inheritance.
 */
export const inlinePseudoStyles = (
    target: HTMLElement,
    computed: StyleDeclarationLike,
    hostComputed: StyleDeclarationLike | null,
    defaults: DefaultStyleMap
): void => {
    for (const [property, value] of diffComputedStyle(computed, defaults, hostComputed)) {
        target.style.setProperty(property, value);
    }
};
