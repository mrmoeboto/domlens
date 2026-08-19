import {describe, expect, it, vi} from 'vitest';
import {prewarm} from '../prewarm';

/**
 * prewarm() is an optimization with one hard requirement: it must never break the page it
 * was added to make faster. Every test here is about that, not about speed — the timing
 * claim is measured by tests/bench/cold.spec.ts, which is the only place it can be.
 */
describe('prewarm', () => {
    it('does not throw on a plain document', () => {
        expect(() => prewarm()).not.toThrow();
    });

    it('does not throw when given an element', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>text</p><span>more</span><input type="checkbox">';
        document.body.appendChild(div);
        try {
            expect(() => prewarm({element: div})).not.toThrow();
        } finally {
            div.remove();
        }
    });

    it('does not throw for a detached element, which has no ownerDocument to warm', () => {
        const orphan = document.createElement('div');
        expect(() => prewarm({element: orphan})).not.toThrow();
    });

    it('swallows a probe that throws rather than propagating into the caller', () => {
        const boom = vi.spyOn(document.documentElement, 'querySelectorAll').mockImplementation(() => {
            throw new Error('probe exploded');
        });
        try {
            expect(() => prewarm()).not.toThrow();
        } finally {
            boom.mockRestore();
        }
    });

    it('is idempotent — calling it repeatedly is allowed and harmless', () => {
        expect(() => {
            prewarm();
            prewarm();
            prewarm();
        }).not.toThrow();
    });

    it('leaves no probe sandbox behind in the document', () => {
        const before = document.querySelectorAll('iframe').length;
        prewarm();
        expect(document.querySelectorAll('iframe').length).toBe(before);
    });
});
