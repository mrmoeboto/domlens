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
    }
};
