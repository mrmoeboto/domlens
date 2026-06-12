import type {CaptureContext} from '../capture-context';
import type {EngineOutput} from '../engines/types';

export interface AfterCloneArgs {
    /** The cloned document (inside the capture iframe). */
    document: Document;
    /** The clone of the element being captured. */
    element: HTMLElement;
}

export interface BeforeRenderArgs {
    /** Name of the engine about to render. */
    engine: string;
}

/**
 * Returned by a `beforeRender` hook to veto the selected engine; the pipeline re-enters
 * at the clone stage with the fallback (canvas) engine. Ignored (with a warning) when the
 * canvas engine is already selected.
 */
export interface BeforeRenderResult {
    fallback?: boolean;
    reason?: string;
}

export interface AfterRenderArgs {
    output: EngineOutput;
}

export interface BeforeExportArgs {
    /** Export format requested from the CaptureResult (e.g. 'png', 'jpeg', 'webp'). */
    format: string;
}

/**
 * Capture lifecycle plugin. Hooks run sequentially in plugin registration order and are
 * awaited; a rejected hook aborts the capture.
 */
export interface Plugin {
    name?: string;
    beforeClone?(context: CaptureContext): void | Promise<void>;
    afterClone?(context: CaptureContext, args: AfterCloneArgs): void | Promise<void>;
    beforeRender?(
        context: CaptureContext,
        args: BeforeRenderArgs
    ): void | BeforeRenderResult | Promise<void | BeforeRenderResult>;
    afterRender?(context: CaptureContext, args: AfterRenderArgs): void | Promise<void>;
    beforeExport?(context: CaptureContext, args: BeforeExportArgs): void | Promise<void>;
}
