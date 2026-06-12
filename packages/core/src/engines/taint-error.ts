/**
 * Typed error for cross-origin taint failures in the svg engine pipeline: thrown by the
 * post-draw taint probe in svg/rasterize.ts and by the resource inliner when extracting a
 * resource would taint a canvas. `executeCapture` (engines/select.ts) translates it into
 * the canvas-engine fallback, which implements the legacy CORS/allowTaint/proxy policy.
 */
export class TaintError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaintError';
        // Keep instanceof working when the class is transpiled to ES5-style inheritance.
        Object.setPrototypeOf(this, TaintError.prototype);
    }
}

/** Whether an unknown thrown value is a canvas-taint SecurityError (DOMException). */
export const isSecurityError = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && (e as {name?: unknown}).name === 'SecurityError';
