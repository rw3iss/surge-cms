/**
 * The guard decides whether an operator's unsaved work survives a navigation.
 *
 * Its sibling `useEditorDraft` shipped with tests; this did not, despite
 * holding the interrupted navigation's `retry` callback. Two things here are
 * invisible to a reader and load-bearing: `retry(true)` FORCES the navigation
 * past this same guard (without the flag it re-intercepts its own retry and the
 * operator can never leave), and the guard releases `retry` on every outcome so
 * a cancelled leave cannot be resumed later by a different navigation.
 *
 * `useBeforeLeave` is stubbed rather than mounted in a router: the hook's
 * contract is what it does with the event, not that Solid Router delivers one.
 */
import { createRoot, } from 'solid-js';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

/*
 * The cms vitest environment is deliberately 'node' — this package's tests are
 * pure logic and jsdom is not a dependency. The hook registers a `beforeunload`
 * listener, which is the one browser API it genuinely needs, so stub just that
 * rather than pulling in a DOM to get one method.
 */
const listeners: Record<string, unknown[]> = {};
(globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: unknown,) => {
        (listeners[type] ??= []).push(fn,);
    },
    removeEventListener: (type: string, fn: unknown,) => {
        listeners[type] = (listeners[type] ?? []).filter(f => f !== fn);
    },
};

/** The callback the hook registers, captured by the stub below. */
let onLeave: ((e: FakeLeaveEvent,) => void) | null = null;

vi.mock('@solidjs/router', () => ({
    useBeforeLeave: (fn: (e: FakeLeaveEvent,) => void,) => {
        onLeave = fn;
    },
}),);

const { useNavigationGuard, } = await import('./useNavigationGuard');

interface FakeLeaveEvent {
    to: string;
    defaultPrevented: boolean;
    preventDefault: () => void;
    retry: (force?: boolean,) => void;
}

/** A navigation the router is about to perform. */
function leaveEvent(to = '/elsewhere',) {
    const retry = vi.fn();
    const e: FakeLeaveEvent = {
        to,
        defaultPrevented: false,
        preventDefault: () => {
            e.defaultPrevented = true;
        },
        retry,
    };
    return e;
}

beforeEach(() => {
    onLeave = null;
},);

describe('useNavigationGuard — when it intercepts', () => {
    it('lets a navigation through when nothing is dirty', () => {
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => false, },));
        const e = leaveEvent();
        onLeave!(e,);
        expect(e.defaultPrevented,).toBe(false,);
        expect(guard.pending(),).toBe(false,);
    });

    it('intercepts and raises the confirmation when dirty', () => {
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        onLeave!(e,);
        expect(e.defaultPrevented,).toBe(true,);
        expect(guard.pending(),).toBe(true,);
        // Nothing happens until the operator answers.
        expect(e.retry,).not.toHaveBeenCalled();
    });

    it('defers to a navigation something else already prevented', () => {
        // Another guard got there first; two modals over one navigation would
        // leave the second holding a retry the first already consumed.
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        e.defaultPrevented = true;
        onLeave!(e,);
        expect(guard.pending(),).toBe(false,);
    });

    it('skips a navigation the editor performs itself', () => {
        /*
         * Saving a NEW entity redirects to its own edit URL. Prompting there
         * would ask the operator to confirm losing changes they just saved.
         */
        const guard = createRoot(() =>
            useNavigationGuard({
                isDirty: () => true,
                isSelfNavigation: (to,) => to.startsWith('/admin/campaigns/',),
            },)
        );
        const e = leaveEvent('/admin/campaigns/new-id',);
        onLeave!(e,);
        expect(e.defaultPrevented,).toBe(false,);
        expect(guard.pending(),).toBe(false,);
    });

    it('still guards a navigation that is NOT self-navigation', () => {
        const guard = createRoot(() =>
            useNavigationGuard({
                isDirty: () => true,
                isSelfNavigation: (to,) => to.startsWith('/admin/campaigns/',),
            },)
        );
        onLeave!(leaveEvent('/admin/posts',),);
        expect(guard.pending(),).toBe(true,);
    });
});

describe('useNavigationGuard — resolving the confirmation', () => {
    it('confirmLeave FORCES the retry past this same guard', () => {
        /*
         * The `true` is the whole mechanism. Without it the retried navigation
         * hits this guard again, is intercepted again, and the operator can
         * never actually leave.
         */
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        onLeave!(e,);
        guard.confirmLeave();
        expect(e.retry,).toHaveBeenCalledTimes(1,);
        expect(e.retry,).toHaveBeenCalledWith(true,);
        expect(guard.pending(),).toBe(false,);
    });

    it('cancelLeave closes the prompt and does NOT navigate', () => {
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        onLeave!(e,);
        guard.cancelLeave();
        expect(e.retry,).not.toHaveBeenCalled();
        expect(guard.pending(),).toBe(false,);
    });

    it('releases the retry after cancelling, so it cannot fire later', () => {
        // A stale retry would resume a navigation the operator declined, at
        // whatever moment they next confirmed a DIFFERENT one.
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        onLeave!(e,);
        guard.cancelLeave();
        guard.confirmLeave();
        expect(e.retry,).not.toHaveBeenCalled();
    });

    it('releases the retry after confirming, so it fires exactly once', () => {
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const e = leaveEvent();
        onLeave!(e,);
        guard.confirmLeave();
        guard.confirmLeave();
        expect(e.retry,).toHaveBeenCalledTimes(1,);
    });

    it('handles a second navigation after the first was cancelled', () => {
        const guard = createRoot(() => useNavigationGuard({ isDirty: () => true, },));
        const first = leaveEvent('/a',);
        onLeave!(first,);
        guard.cancelLeave();

        const second = leaveEvent('/b',);
        onLeave!(second,);
        guard.confirmLeave();

        expect(first.retry,).not.toHaveBeenCalled();
        expect(second.retry,).toHaveBeenCalledWith(true,);
    });
});
