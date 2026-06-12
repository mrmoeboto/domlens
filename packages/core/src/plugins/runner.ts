import type {CaptureContext} from '../capture-context';
import type {AfterCloneArgs, AfterRenderArgs, BeforeExportArgs, BeforeRenderArgs, Plugin} from './types';

export interface BeforeRenderOutcome {
    fallback: boolean;
    reason?: string;
}

/**
 * Runs plugin hooks sequentially in registration order, awaiting each one.
 */
export class PluginRunner {
    constructor(private readonly plugins: readonly Plugin[]) {}

    async beforeClone(context: CaptureContext): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.beforeClone) {
                await plugin.beforeClone(context);
            }
        }
    }

    async afterClone(context: CaptureContext, args: AfterCloneArgs): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.afterClone) {
                await plugin.afterClone(context, args);
            }
        }
    }

    /**
     * Runs `beforeRender` hooks; stops at (and reports) the first hook signalling
     * `{fallback: true}` — the remaining hooks will run again once the pipeline
     * re-enters with the fallback engine.
     */
    async beforeRender(context: CaptureContext, args: BeforeRenderArgs): Promise<BeforeRenderOutcome> {
        for (const plugin of this.plugins) {
            if (plugin.beforeRender) {
                const result = await plugin.beforeRender(context, args);
                if (result && result.fallback) {
                    return {
                        fallback: true,
                        reason: result.reason ?? `vetoed by plugin ${plugin.name ?? '<anonymous>'}`
                    };
                }
            }
        }

        return {fallback: false};
    }

    async afterRender(context: CaptureContext, args: AfterRenderArgs): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.afterRender) {
                await plugin.afterRender(context, args);
            }
        }
    }

    async beforeExport(context: CaptureContext, args: BeforeExportArgs): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.beforeExport) {
                await plugin.beforeExport(context, args);
            }
        }
    }
}
