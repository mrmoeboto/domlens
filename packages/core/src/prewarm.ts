import {collectAuthorStyleProfile} from './engines/svg/author-styles';
import {DefaultStyleCache} from './engines/svg/default-styles';

/**
 * Do a capture's cacheable work now, so the capture itself is faster.
 *
 * ## Why this exists
 *
 * The commonest use of this library takes exactly one screenshot: a bug-report widget, a
 * "download as image" button, an export. That capture pays every first-time cost at once,
 * and the largest of them is probing the browser for UA default styles — the table the
 * style inliner diffs against so it only writes properties the author actually changed.
 * Measured cold on the benchmark's simple-card page, the clone walk costs 22ms on the
 * first capture and 2.4ms on the second: nine tenths of it is that probe, and it is paid
 * while the user is waiting.
 *
 * Nothing about it needs to happen then. UA defaults cannot change within a browser
 * session, and the widget has been sitting on the page since load. Calling `prewarm()`
 * once at idle moves the work off the click.
 *
 * ## What it does and does not do
 *
 * It probes UA defaults for every tag name in `element`'s subtree, using the same author
 * read set a real capture derives, so the capture gets cache hits rather than near-misses
 * it has to re-probe and merge. The results persist per document for the session.
 *
 * It deliberately does NOT run a capture. It does not warm the rasterizer, fetch resources
 * or embed fonts — those depend on what is being captured and when, and a speculative
 * capture would cost a rasterization and briefly mutate the page for a guess. Expect it to
 * remove most of the clone-walk cost and nothing else; on simple-card that is roughly
 * 20ms of a 48ms cold capture.
 *
 * It is safe to call more than once, safe to call before the DOM is ready (it simply warms
 * whatever exists), and never throws: a prewarm that fails must not break the page it was
 * meant to make faster. It is also entirely optional — captures behave identically without
 * it, just paying the probe themselves.
 */
export interface PrewarmOptions {
    /**
     * Subtree whose tag names to warm. Defaults to the whole document, which is the right
     * choice when you do not yet know what will be captured. Pass the element you intend
     * to capture when you do — it is cheaper and warms exactly what is needed.
     */
    element?: Element;
}

export const prewarm = (options: PrewarmOptions = {}): void => {
    try {
        const root = options.element ?? (typeof document !== 'undefined' ? document.documentElement : null);
        const ownerDocument = root?.ownerDocument;
        if (!root || !ownerDocument) {
            return;
        }

        // The same two lines the style inliner runs per capture, in the same order: the
        // read set has to match or the probe below caches maps a capture would reject as
        // not covering its properties, and re-probe anyway.
        const authorProfile = collectAuthorStyleProfile(ownerDocument);
        const defaults = new DefaultStyleCache(ownerDocument, authorProfile?.propertyList ?? []);
        try {
            // `get` rather than `getByTag`: the cache keys <input> by its type attribute,
            // because a checkbox and a text field have different UA defaults, and only the
            // element knows which it is.
            defaults.get(root);
            for (const element of Array.from(root.querySelectorAll('*'))) {
                defaults.get(element);
            }
        } finally {
            // Removes the probe sandbox iframe. The computed maps stay cached.
            defaults.dispose();
        }
    } catch {
        // Intentionally silent: this is an optimization, and a page that cannot be probed
        // still captures correctly by paying the probe during capture().
    }
};
