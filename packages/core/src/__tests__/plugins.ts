import {describe, expect, it, vi} from 'vitest';
import {PluginRunner} from '../plugins/runner';
import {Plugin} from '../plugins/types';
import {CaptureContext} from '../capture-context';

const context = {} as CaptureContext;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('PluginRunner', () => {
    it('should run hooks in registration order', async () => {
        const calls: string[] = [];
        const make = (name: string): Plugin => ({
            name,
            beforeClone: () => void calls.push(`${name}:beforeClone`),
            afterClone: () => void calls.push(`${name}:afterClone`),
            beforeRender: () => void calls.push(`${name}:beforeRender`),
            afterRender: () => void calls.push(`${name}:afterRender`),
            beforeExport: () => void calls.push(`${name}:beforeExport`)
        });

        const runner = new PluginRunner([make('a'), make('b')]);
        await runner.beforeClone(context);
        await runner.afterClone(context, {document: {} as Document, element: {} as HTMLElement});
        await runner.beforeRender(context, {engine: 'canvas'});
        await runner.afterRender(context, {output: {} as never});
        await runner.beforeExport(context, {format: 'png'});

        expect(calls).toEqual([
            'a:beforeClone',
            'b:beforeClone',
            'a:afterClone',
            'b:afterClone',
            'a:beforeRender',
            'b:beforeRender',
            'a:afterRender',
            'b:afterRender',
            'a:beforeExport',
            'b:beforeExport'
        ]);
    });

    it('should await async hooks sequentially', async () => {
        const calls: string[] = [];
        const runner = new PluginRunner([
            {
                beforeClone: async () => {
                    calls.push('a:start');
                    await tick();
                    calls.push('a:end');
                }
            },
            {
                beforeClone: () => {
                    calls.push('b:start');
                }
            }
        ]);

        await runner.beforeClone(context);
        expect(calls).toEqual(['a:start', 'a:end', 'b:start']);
    });

    it('should report no fallback when no beforeRender hook vetoes', async () => {
        const runner = new PluginRunner([{beforeRender: () => undefined}, {beforeRender: () => ({fallback: false})}]);
        expect(await runner.beforeRender(context, {engine: 'svg'})).toEqual({fallback: false});
    });

    it('should stop at the first beforeRender fallback signal and report its reason', async () => {
        const second = vi.fn();
        const runner = new PluginRunner([
            {name: 'veto', beforeRender: () => ({fallback: true, reason: 'tainted'})},
            {name: 'late', beforeRender: second}
        ]);

        expect(await runner.beforeRender(context, {engine: 'svg'})).toEqual({fallback: true, reason: 'tainted'});
        expect(second).not.toHaveBeenCalled();
    });

    it('should synthesize a fallback reason from the plugin name', async () => {
        const runner = new PluginRunner([{name: 'veto-plugin', beforeRender: () => ({fallback: true})}]);
        const outcome = await runner.beforeRender(context, {engine: 'svg'});
        expect(outcome.fallback).toBe(true);
        expect(outcome.reason).toContain('veto-plugin');
    });

    it('should support async beforeRender fallback signals', async () => {
        const runner = new PluginRunner([{beforeRender: () => Promise.resolve({fallback: true, reason: 'async'})}]);
        expect(await runner.beforeRender(context, {engine: 'svg'})).toEqual({fallback: true, reason: 'async'});
    });

    it('should propagate hook rejections', async () => {
        const runner = new PluginRunner([
            {
                beforeClone: () => {
                    throw new Error('boom');
                }
            }
        ]);
        await expect(runner.beforeClone(context)).rejects.toThrow('boom');
    });
});
