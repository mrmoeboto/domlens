import type {CaptureContext} from '../capture-context';
import type {CaptureEngine, ClonedTree, EngineOutput} from './types';

export type EngineFactory = () => CaptureEngine;

/** Available engine factories. `svg` is absent until the foreignObject engine lands (Phase 3). */
export interface EngineRegistry {
    canvas: EngineFactory;
    svg?: EngineFactory;
}

/**
 * Engine selection policy:
 * - explicit `engine: 'canvas' | 'svg'` uses that engine (error when unavailable),
 * - `engine: 'auto'` prefers the svg engine when registered and supported, otherwise canvas.
 */
export const selectEngine = async (context: CaptureContext, registry: EngineRegistry): Promise<CaptureEngine> => {
    const requested = context.options.engine;

    if (requested === 'canvas') {
        return registry.canvas();
    }

    if (requested === 'svg') {
        if (!registry.svg) {
            throw new Error(`svg engine not yet available`);
        }
        return registry.svg();
    }

    // 'auto'
    if (registry.svg) {
        const engine = registry.svg();
        const support = await engine.supports(context);
        if (support.ok) {
            return engine;
        }
        context.logger.debug(`svg engine unsupported (${support.reason ?? 'unknown reason'}); using canvas engine`);
    }

    return registry.canvas();
};

/**
 * The capture stages the engine runner needs but does not own: cloning the document for a
 * given engine and cleaning the clone container up again. Injected so the fallback policy
 * can be unit tested with stub stages/engines.
 */
export interface CaptureStages {
    clone(engine: CaptureEngine): Promise<ClonedTree>;
    cleanup(tree: ClonedTree): void;
}

const FALLBACK: unique symbol = Symbol('fallback');

const runEngine = async (
    context: CaptureContext,
    engine: CaptureEngine,
    stages: CaptureStages,
    allowFallback: boolean
): Promise<EngineOutput | typeof FALLBACK> => {
    await context.hooks.beforeClone(context);
    const tree = await stages.clone(engine);

    try {
        await context.hooks.afterClone(context, {document: tree.ownerDocument, element: tree.clonedElement});

        const veto = await context.hooks.beforeRender(context, {engine: engine.name});
        if (veto.fallback) {
            if (allowFallback) {
                context.logger.debug(`${engine.name} engine vetoed before render (${veto.reason}); falling back`);
                return FALLBACK;
            }
            context.logger.warn(`beforeRender fallback signal ignored (${veto.reason}): no fallback engine available`);
        }

        const output = await engine.render(tree, context);
        await context.hooks.afterRender(context, {output});
        return output;
    } catch (e) {
        if (allowFallback) {
            context.logger.warn(`${engine.name} engine failed (${e}); falling back to canvas engine`);
            return FALLBACK;
        }
        throw e;
    } finally {
        stages.cleanup(tree);
    }
};

/**
 * Selects an engine and runs the clone → hooks → render stages with the auto-fallback
 * policy: when a non-canvas engine throws during render (or a `beforeRender` plugin
 * signals `{fallback: true}`), the pipeline re-enters at the clone stage with the canvas
 * engine (engines need different clone configurations, so the clone runs again).
 */
export const executeCapture = async (
    context: CaptureContext,
    stages: CaptureStages,
    registry: EngineRegistry
): Promise<EngineOutput> => {
    const engine = await selectEngine(context, registry);
    const allowFallback = engine.name !== 'canvas';

    const result = await runEngine(context, engine, stages, allowFallback);
    if (result !== FALLBACK) {
        return result;
    }

    return (await runEngine(context, registry.canvas(), stages, false)) as EngineOutput;
};
