import {Context} from './context';
import {Logger} from './logger';
import {Cache, clearSharedResourceCaches, sharedResourceCache} from './resources/cache-storage';
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
    /** Per-stage wall-clock timings in ms, recorded when `debug.timings` is set. */
    readonly stageTimings: Record<string, number> | null;

    constructor(
        readonly options: NormalizedOptions,
        windowBounds: Bounds
    ) {
        if (options.resources.cacheMode === 'disabled') {
            clearSharedResourceCaches();
        }
        this.legacy = new Context(
            {
                logging: options.debug.logging,
                // An explicit cache instance wins; 'full' resolves the shared persistent
                // cache for this loading policy; 'soft'/'disabled' build a per-capture one.
                cache:
                    options.resources.cache ??
                    (options.resources.cacheMode === 'full' ? sharedResourceCache : undefined),
                imageTimeout: options.resources.imageTimeout,
                useCORS: options.resources.cors !== 'off',
                allowTaint: options.resources.allowTaint,
                proxy: options.resources.proxy
            },
            windowBounds
        );
        this.hooks = new PluginRunner(options.plugins);
        this.stageTimings = options.debug.timings ? {} : null;
    }

    /**
     * Runs `fn`, recording its wall-clock duration under `stage` when `debug.timings` is
     * enabled (durations of repeated stages accumulate). Zero-allocation no-op otherwise.
     */
    async time<T>(stage: string, fn: () => T | Promise<T>): Promise<T> {
        if (!this.stageTimings) {
            return fn();
        }
        const start = performance.now();
        try {
            return await fn();
        } finally {
            this.stageTimings[stage] = (this.stageTimings[stage] ?? 0) + (performance.now() - start);
        }
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
