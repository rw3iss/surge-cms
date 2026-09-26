/**
 * Track unsaved edits in an editor and warn before leaving.
 *
 * This owns the dirty FLAG (`markDirty` / `markClean`); the interception is
 * `useNavigationGuard`'s job. It used to own that too, with a native
 * `window.confirm` — so the admin had two different answers to the same
 * question depending on which editor you were in: the mail template editor
 * showed the admin's own modal, while the campaign and form editors showed an
 * OS-styled browser box that cannot say which editor it came from or be styled
 * to match anything around it.
 *
 * One implementation of `beforeunload` + `useBeforeLeave` now serves both.
 *
 * A caller must render the confirmation itself — this returns
 * `pending`/`confirmLeave`/`cancelLeave` for exactly that. A caller that
 * ignores them still gets the browser's own tab-close warning, which is the
 * half no page is allowed to draw; it simply will not intercept in-app
 * navigation, which is the behaviour it had before this hook existed.
 */
import { createSignal, } from 'solid-js';
import { useNavigationGuard, } from './useNavigationGuard';

export function useUnsavedChanges() {
    const [isDirty, setIsDirty,] = createSignal(false,);

    const guard = useNavigationGuard({ isDirty, },);

    const markDirty = () => setIsDirty(true,);
    const markClean = () => setIsDirty(false,);

    return {
        isDirty,
        markDirty,
        markClean,
        /** True while the leave confirmation should be on screen. */
        pending: guard.pending,
        /** Proceed with the navigation the guard interrupted. */
        confirmLeave: guard.confirmLeave,
        /** Stay on the page. */
        cancelLeave: guard.cancelLeave,
    };
}
