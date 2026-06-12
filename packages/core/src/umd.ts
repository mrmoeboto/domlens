/**
 * UMD bundle entry point.
 *
 * The UMD build must keep `window.html2canvas` directly callable (classic API), which
 * requires a single default export. The new `capture` API is attached as a property:
 * `window.html2canvas.capture(element, options)`.
 */
import html2canvas, {capture} from './index';

type Html2CanvasGlobal = typeof html2canvas & {capture: typeof capture};

const api = html2canvas as Html2CanvasGlobal;
api.capture = capture;

export default api;
