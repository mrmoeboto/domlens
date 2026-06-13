import {Logger} from './logger';
import {Cache, ResourceOptions} from './resources/cache-storage';
import {Bounds} from './engines/canvas/css/layout/bounds';

export type ContextOptions = {
    logging: boolean;
    /** Explicit cache instance, or a factory resolving one (shared-cache lookup). */
    cache?: Cache | ((context: Context, options: ResourceOptions) => Cache);
} & ResourceOptions;

export class Context {
    private readonly instanceName = `#${Context.instanceCount++}`;
    readonly logger: Logger;
    readonly cache: Cache;

    private static instanceCount = 1;

    constructor(options: ContextOptions, public windowBounds: Bounds) {
        this.logger = new Logger({id: this.instanceName, enabled: options.logging});
        this.cache =
            typeof options.cache === 'function' ? options.cache(this, options) : (options.cache ?? new Cache(this, options));
    }
}
