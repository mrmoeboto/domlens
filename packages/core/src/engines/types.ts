import type {CaptureContext} from '../capture-context';

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
    | {kind: 'svg'; markup: string; width: number; height: number};

export interface EngineSupportResult {
    ok: boolean;
    reason?: string;
}

/** Clone-stage configuration an engine requires (DocumentCloner is engine-driven). */
export interface EngineCloneConfig {
    inlineImages: boolean;
    copyStyles: boolean;
}

export interface CaptureEngine {
    readonly name: EngineName;
    readonly cloneConfig: EngineCloneConfig;
    /** Whether this engine can render in the current environment. */
    supports(context: CaptureContext): Promise<EngineSupportResult>;
    render(tree: ClonedTree, context: CaptureContext): Promise<EngineOutput>;
}
