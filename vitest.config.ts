import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['packages/*/src/**/__tests__/**/*.ts']
    }
});
