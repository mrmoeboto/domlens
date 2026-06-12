import {defineConfig, devices} from '@playwright/test';

// Browsers are installed but this host OS is not on Playwright's validated list.
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

// A fixed viewport + deviceScaleFactor keeps the rendered reftest screenshots deterministic.
const viewport = {width: 800, height: 600};

export default defineConfig({
    testDir: 'tests/playwright',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 60000,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:8080'
    },
    webServer: {
        command: 'tsx tests/server.ts --port=8080 --cors=8081',
        url: 'http://localhost:8080/packages/html2canvas-compat/dist/html2canvas.js',
        reuseExistingServer: !process.env.CI
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome'], viewport, deviceScaleFactor: 1}
        },
        {
            name: 'firefox',
            use: {...devices['Desktop Firefox'], viewport, deviceScaleFactor: 1}
        },
        // WebKit does not run on this host; opt in explicitly with PW_WEBKIT=1.
        ...(process.env.PW_WEBKIT === '1'
            ? [
                  {
                      name: 'webkit',
                      use: {...devices['Desktop Safari'], viewport, deviceScaleFactor: 1}
                  }
              ]
            : [])
    ]
});
