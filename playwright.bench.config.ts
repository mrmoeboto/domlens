import {defineConfig, devices} from '@playwright/test';

// Browsers are installed but this host OS is not on Playwright's validated list.
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

/**
 * Cross-library benchmark config (npm run bench).
 *
 * Separate from playwright.config.ts so the reftest matrix never picks up the bench
 * spec and vice versa. Single chromium project, one worker (a single browser instance,
 * sequential scenarios) and a fixed viewport keep the timings as stable as this shared
 * machine allows.
 */
export default defineConfig({
    testDir: 'tests/bench',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    // One test per scenario; each test times 7 libraries × (3 warmup + 15 measured) runs.
    timeout: 900000,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:8080'
    },
    webServer: {
        command: 'tsx tests/server.ts --port=8080 --cors=8081',
        url: 'http://localhost:8080/packages/core/dist/domlens.js',
        reuseExistingServer: !process.env.CI
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 800}, deviceScaleFactor: 1}
        }
    ]
});
