import {Context} from './context';
import {Logger} from './logger';
import {Cache} from './resources/cache-storage';
import {Bounds} from './engines/canvas/css/layout/bounds';
import {FEATURES} from './env/features';
import {NormalizedOptions} from './options';
import {PluginRunner} from './plugins/runner';

/**
 * Per-capture context for the new pipeline: normalized options, plugin hooks, environment
 * feature detection, plus the logger/resource-cache shared with the canvas engine internals.
 *
 * The canvas engine internals (node-parser, the CSS system, CanvasRenderer, DocumentCloner)
 * still consume the legacy {@link Context} shape; {@link CaptureContext.legacy} is that
 * adapter, so those modules stay untouched.
 */
export class CaptureContext {
    /** Legacy Context adapter handed to node-parser/CSS parsing/CanvasRenderer/DocumentCloner. */
    readonly legacy: Context;
    /** Sequential plugin hook runner. */
    readonly hooks: PluginRunner;
    /** Lazy feature detection results for the current environment. */
    readonly env: typeof FEATURES = FEATURES;

    constructor(
        readonly options: NormalizedOptions,
        windowBounds: Bounds
    ) {
        this.legacy = new Context(
            {
                logging: options.debug.logging,
                cache: options.resources.cache,
                imageTimeout: options.resources.imageTimeout,
                useCORS: options.resources.cors !== 'off',
                allowTaint: options.resources.allowTaint,
                proxy: options.resources.proxy
            },
            windowBounds
        );
        this.hooks = new PluginRunner(options.plugins);
    }

    get logger(): Logger {
        return this.legacy.logger;
    }

    get cache(): Cache {
        return this.legacy.cache;
    }

    /** Live window bounds; the clone stage may adjust these (scroll restoration quirks). */
    get windowBounds(): Bounds {
        return this.legacy.windowBounds;
    }
}
