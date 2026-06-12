import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // Unit tests resolve the workspace dependency from source (no build required).
            '@domlens/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))
        }
    },
    test: {
        environment: 'jsdom',
        include: ['packages/*/src/**/__tests__/**/*.ts']
    }
});
