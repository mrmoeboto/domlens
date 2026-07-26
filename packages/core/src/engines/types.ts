import type {CaptureContext} from '../capture-context';
import type {CloneStyleInliner} from '../clone/document-cloner';

export type EngineName = 'svg' | 'canvas';

/** Result of the clone stage, handed to the selected engine. */
export interface ClonedTree {
    /** Clone of the element being captured, living inside the capture iframe. */
    clonedElement: HTMLElement;
    /** The iframe container hosting the cloned document. */
    container: HTMLIFrameElement;
    /** The cloned document. */
    ownerDocument: Document;
}

export type EngineOutput =
    | {kind: 'canvas'; canvas: HTMLCanvasElement; width: number; height: number}
    | {
          kind: 'svg';
          markup: string;
          width: number;
          height: number;
          /**
           * Canvas the svg engine rasterized (and taint-probed) during render; reused by
           * CaptureResult so exports do not rasterize again.
           */
          canvas?: HTMLCanvasElement;
      };

export interface EngineSupportResult {
    ok: boolean;
    reason?: string;
}

/** Clone-stage configuration an engine requires (DocumentCloner is engine-driven). */
export interface EngineCloneConfig {
    inlineImages: boolean;
    copyStyles: boolean;
    /**
     * Engine-owned computed-style inliner the clone stage should drive (svg engine). The
     * clone stage creates it per capture against the captured element's document and
     * disposes it after the clone walk.
     */
    createStyleInliner?: (ownerDocument: Document) => CloneStyleInliner;
    /**
     * Optional asynchronous preparation of the detached cloned tree, run between the
     * clone walk and the adoption into the capture iframe. The svg engine inlines
     * external resources as data urls here, so the capture iframe decodes them from
     * memory instead of re-fetching every subresource before its load event fires.
     * Must be best-effort: failures that should trigger the engine fallback have to be
     * (re-)thrown from `render()`, not from here — the clone stage cannot fall back.
     */
    prepareClone?: (documentElement: HTMLElement, context: CaptureContext) => Promise<void>;
}

export interface CaptureEngine {
    readonly name: EngineName;
    readonly cloneConfig: EngineCloneConfig;
    /** Whether this engine can render in the current environment. */
    supports(context: CaptureContext): Promise<EngineSupportResult>;
    render(tree: ClonedTree, context: CaptureContext): Promise<EngineOutput>;
}
