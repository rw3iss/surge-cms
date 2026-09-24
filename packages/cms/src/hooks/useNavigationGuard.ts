/**
 * Warn before leaving an editor with unsaved changes — through the admin's own
 * confirmation modal rather than `window.confirm`.
 *
 * `useUnsavedChanges` already guards navigation, but with a native
 * `window.confirm`: an OS-styled box that cannot say which editor it came
 * from, cannot be styled, and reads as a browser error rather than a decision
 * the app is asking for. This keeps the same interception and hands the choice
 * to the caller, so it can render a `ConfirmModal` like every other
 * destructive confirmation in the admin.
 *
 * The `beforeunload` half stays native — a tab close or reload CANNOT be
 * intercepted with custom UI by any page, by design. That one is the browser's
 * to draw.
 */
import { useBeforeLeave, } from '@solidjs/router';
import { createSignal, onCleanup, } from 'solid-js';

export interface NavigationGuard {
    /** True while the confirmation is on screen. */
    pending: () => boolean;
    /** Proceed with the navigation the guard interrupted. */
    confirmLeave: () => void;
    /** Stay on the page. */
    cancelLeave: () => void;
}

export interface UseNavigationGuardOptions {
    /** Whether there is anything worth warning about. */
    isDirty: () => boolean;
    /**
     * Skip the guard for a navigation the editor itself performs — saving a NEW
     * entity redirects to its own edit URL, and prompting there would ask the
     * operator to confirm losing changes they just saved.
     */
    isSelfNavigation?: (to: string,) => boolean;
}

export function useNavigationGuard(opts: UseNavigationGuardOptions,): NavigationGuard {
    const [pending, setPending,] = createSignal(false,);
    /** The interrupted navigation's `retry`, held until the operator decides. */
    let retry: ((force: boolean,) => void) | null = null;

    const onBeforeUnload = (e: BeforeUnloadEvent,) => {
        if (!opts.isDirty()) return;
        e.preventDefault();
        e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload,);
    onCleanup(() => window.removeEventListener('beforeunload', onBeforeUnload,));

    useBeforeLeave((e,) => {
        if (!opts.isDirty() || e.defaultPrevented) return;
        if (opts.isSelfNavigation?.(String(e.to,),)) return;
        e.preventDefault();
        retry = e.retry;
        setPending(true,);
    },);

    return {
        pending,
        confirmLeave: () => {
            setPending(false,);
            // `true` forces the navigation through this same guard, which would
            // otherwise intercept it a second time and loop.
            retry?.(true,);
            retry = null;
        },
        cancelLeave: () => {
            setPending(false,);
            retry = null;
        },
    };
}
