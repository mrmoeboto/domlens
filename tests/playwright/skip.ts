export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface SkipEntry {
    /** Browsers the test is skipped in. Omit to skip everywhere. */
    browsers?: BrowserName[];
    reason: string;
}

/**
 * Reftests that are skipped by the Playwright runner, keyed by path relative to
 * tests/reftests (always with forward slashes).
 *
 * Entries should explain WHY the test is skipped so they can be revisited.
 */
export const SKIPPED_REFTESTS: Record<string, SkipEntry> = {
    'text/fontawesome.html': {
        reason: 'Depends on the FontAwesome CDN (use.fontawesome.com); network access is not deterministic/available in CI.'
    },
    // New Phase 4 pages without committed baselines yet (baselines/** is frozen between
    // integrate runs). Covered by tests/playwright/webfont.spec.ts (svg engine, SSIM vs
    // native screenshot); remove these entries when the integrate stage regenerates the
    // canvas baselines and svg manifests.
    'text/webfont.html': {
        reason: 'Pending baseline regeneration (integrate stage); verified by webfont.spec.ts meanwhile.'
    },
    'text/webfont-unicode-range.html': {
        reason: 'Pending baseline regeneration (integrate stage); verified by webfont.spec.ts meanwhile.'
    },
    'shadow/simple.html': {
        reason: 'Pending baseline regeneration (integrate stage); verified by svg-phase4.spec.ts meanwhile.'
    },
    'shadow/slots.html': {
        reason: 'Pending baseline regeneration (integrate stage); verified by svg-phase4.spec.ts meanwhile.'
    },
    'shadow/nested.html': {
        reason: 'Pending baseline regeneration (integrate stage); verified by svg-phase4.spec.ts meanwhile.'
    }
};
