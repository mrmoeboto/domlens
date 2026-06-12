import {vi} from 'vitest';

const {Bounds} = await vi.importActual<typeof import('../bounds')>('../bounds');

export {Bounds};
export const parseBounds = (): InstanceType<typeof Bounds> => {
    return new Bounds(0, 0, 200, 50);
};
