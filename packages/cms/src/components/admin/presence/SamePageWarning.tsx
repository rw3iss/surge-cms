/**
 * SamePageWarning — a dismissible corner banner shown when another *active*
 * admin/editor is on the SAME admin page as the current user, to warn about
 * concurrent edits. Re-appears when navigating to a different colliding page
 * (dismissal is scoped to the page it was dismissed on).
 */
import { Component, createEffect, createSignal, Show, } from 'solid-js';
import { adminChannel, } from '../../../services/adminChannel';
import './AdminPresence.scss';

const SamePageWarning: Component = () => {
    const [dismissedPage, setDismissedPage,] = createSignal<string | null>(null,);

    // Reset the dismissal whenever the current page changes, so a fresh
    // collision on a new page warns again.
    createEffect(() => {
        adminChannel.currentPage();
        setDismissedPage(null,);
    },);

    const others = () => adminChannel.samePageUsers();
    const show = () => others().length > 0 && dismissedPage() !== adminChannel.currentPage();
    const names = () => others().map((u,) => u.displayName,).join(', ',);

    return (
        <Show when={show()}>
            <div class="admin-samepage-warning" role="alert">
                <div class="admin-samepage-warning__icon" aria-hidden="true">⚠</div>
                <div class="admin-samepage-warning__body">
                    <strong>{names()}</strong> {others().length === 1 ? 'is' : 'are'} also on this page. Save
                    carefully to avoid overwriting each other's work.
                </div>
                <button
                    class="admin-samepage-warning__close"
                    aria-label="Dismiss"
                    onClick={() => setDismissedPage(adminChannel.currentPage(),)}
                >
                    ×
                </button>
            </div>
        </Show>
    );
};

export default SamePageWarning;
