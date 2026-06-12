import type {CaptureContext} from '../capture-context';
import {TaintError} from './taint-error';
import type {CaptureEngine, ClonedTree, EngineOutput} from './types';

export type EngineFactory = () => CaptureEngine;

/** Available engine factories. */
export interface EngineRegistry {
    canvas: EngineFactory;
    svg?: EngineFactory;
}

/**
 * Engine selection policy:
 * - explicit `engine: 'canvas' | 'svg'` uses that engine (error when not registered, no
 *   support pre-check — render failures of a non-canvas engine still auto-fall back to
 *   canvas),
 * - `engine: 'auto'` prefers the svg engine when it is registered and its support check
 *   (foreignObject drawing feature detection) passes, and resolves to the canvas engine
 *   otherwise. Render/taint failures of the svg engine fall back to the canvas engine in
 *   {@link executeCapture}.
 */
export const selectEngine = async (context: CaptureContext, registry: EngineRegistry): Promise<CaptureEngine> => {
    const requested = context.options.engine;

    if (requested === 'svg') {
        if (!registry.svg) {
            throw new Error(`svg engine requested but not registered`);
        }
        return registry.svg();
    }

    if (requested === 'auto' && registry.svg) {
        const svg = registry.svg();
        try {
            const support = await svg.supports(context);
            if (support.ok) {
                return svg;
            }
            context.logger.debug(`auto engine: svg engine not supported (${support.reason}); using canvas engine`);
        } catch (e) {
            context.logger.debug(`auto engine: svg support check failed (${e}); using canvas engine`);
        }
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
            if (e instanceof TaintError) {
                context.logger.warn(
                    `${engine.name} engine output would be tainted (${e.message}); falling back to canvas engine`
                );
            } else {
                context.logger.warn(`${engine.name} engine failed (${e}); falling back to canvas engine`);
            }
            return FALLBACK;
        }
        throw e;
    } finally {
        stages.cleanup(tree);
    }
};

/**
 * Selects an engine and runs the clone → hooks → render stages with the auto-fallback
 * policy: when a non-canvas engine throws during render (including a {@link TaintError}
 * from the svg taint probe / resource inliner) or a `beforeRender` plugin signals
 * `{fallback: true}`, the pipeline re-enters at the clone stage with the canvas engine
 * (engines need different clone configurations, so the clone runs again).
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
