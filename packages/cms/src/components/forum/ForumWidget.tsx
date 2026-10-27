/**
 * The Forum widget — an in-page forum / live discussion. Rendered by the
 * `forum` content block and by `{{ forum(...) }}`, from resolved
 * `ForumBlockSettings` (`normalizeForumBlockSettings`).
 *
 *   list mode    thread cards from GET /forum/feed (ForumListView)
 *   thread mode  one thread as a chat stream (ForumThreadView)
 *
 * This shell decides whether anything shows (feature on, members-only block,
 * a 401/403 from the feed), provides the shared context (settings, feed
 * limits, login prompt, notices, "is someone typing" for live polling) and
 * lays the widget out to fill its block: header and composer fixed, the list
 * scrolling between them (`--forum-list-max-height` when the block sets no
 * height). The server decides every right; this only shapes the UI.
 */
import type { ResolvedForumBlockSettings, } from '@sitesurge/types';
import { Component, createMemo, createSignal, Match, onCleanup, Show, Switch, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import LoginModal from '../auth/LoginModal';
import { isAdminView, } from '../blocks/slotContext';
import UpgradeTout from '../content/UpgradeTout';
import { ForumContext, type ForumWidgetCtx, } from './forumContext';
import { someoneTyping, } from './forumFeed';
import { useForumFeed, } from './forumHooks';
import ForumListView from './ForumListView';
import ForumThreadView from './ForumThreadView';
import './ForumWidget.scss';

export interface ForumWidgetProps {
    settings: ResolvedForumBlockSettings;
    /** Admin editor preview. */
    preview?: boolean;
}

/** "Sign in to view the discussion" — members-only block, or a 401/403 for a visitor. */
const SignInCard: Component<{ onLogin: () => void; message?: string; }> = (props,) => (
    <div class="forum-gate">
        <div class="forum-gate__icon" aria-hidden="true">💬</div>
        <h3 class="forum-gate__title">Sign in to view the discussion</h3>
        <p class="forum-gate__text">{props.message ?? 'This discussion is for members. Sign in to read and join in.'}</p>
        <button type="button" class="forum-btn" onClick={props.onLogin}>Log in</button>
    </div>
);

const ForumWidget: Component<ForumWidgetProps> = (props,) => {
    const auth = useAuth();
    // One resolved object per settings change (the prop may be computed on read).
    const s = createMemo(() => props.settings,);
    const admin = () => Boolean(props.preview,) || isAdminView();
    const signedIn = () => auth.isAuthenticated;
    const featureOn = () => isFeatureEnabled('forum',);
    const membersGate = () => s().visibility === 'members' && !signedIn();
    const viewer = () => auth.user?.id ?? 'anon';

    // Thread mode with no thread chosen asks for nothing (an empty `threads`
    // would read as "the latest threads").
    const noThread = () => s().mode === 'thread' && !s().thread;
    const feed = useForumFeed({ settings: s, enabled: () => featureOn() && !membersGate() && !noThread(), viewer, },);

    // ─── Login prompt ───
    const [login, setLogin,] = createSignal<string | null>(null,);
    const requestLogin = (title = 'Log in',) => {
        if (!admin()) setLogin(title,);
    };

    // ─── Notice line ("Posted", "Waiting for approval") ───
    const [notice, setNotice,] = createSignal('',);
    let noticeTimer: number | undefined;
    const notify = (text: string,) => {
        setNotice(text,);
        if (noticeTimer) window.clearTimeout(noticeTimer,);
        noticeTimer = window.setTimeout(() => setNotice('',), 4000,);
    };
    onCleanup(() => noticeTimer && window.clearTimeout(noticeTimer,),);

    // ─── Live updates pause while anyone types in this widget ───
    let root: HTMLDivElement | undefined;
    const typing = () => {
        if (!root) return false;
        const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea',),);
        return someoneTyping(fields.map((el,) => ({ focused: el === document.activeElement, value: el.value, name: el.name, })),);
    };
    // Polling is a site feature; the editor preview stays still.
    const live = () => s().liveUpdates && !admin() && !feed.error();

    const guestWriting = () => !signedIn() && s().allowAnonymous && Boolean(feed.meta()?.anonymousAllowed,);
    const reactionKinds = createMemo(() => {
        const m = feed.meta();
        return s().allowReactions && m?.reactionsEnabled ? m.reactions ?? [] : [];
    },);

    const ctx: ForumWidgetCtx = {
        settings: s,
        meta: feed.meta,
        signedIn,
        guestWriting,
        readOnly: admin,
        reactionKinds,
        requestLogin,
        notify,
        refreshFeed: () => void feed.refresh(),
        viewer,
        live,
        typing,
    };

    const denied = () => {
        const e = feed.error();
        return e && (e.status === 401 || e.status === 403) ? e : null;
    };
    const failed = () => {
        const e = feed.error();
        return e && !denied() ? e : null;
    };

    return (
        <Show
            when={featureOn()}
            fallback={
                <Show when={admin()}>
                    <p class="block-message">The Forum feature is off — this block shows nothing until it is enabled in Settings → Features.</p>
                </Show>
            }
        >
            <ForumContext.Provider value={ctx}>
                <div
                    ref={root}
                    class={`forum-widget forum-widget--${s().mode}`}
                    classList={{ 'forum-widget--chat': s().mode === 'thread' || s().chatOrder, }}
                    style={{ '--forum-list-max-height': s().listMaxHeight, }}
                >
                    <Show when={s().heading || live()}>
                        <header class={`forum-widget__header forum-widget__header--${s().headingAlign}`}>
                            <Show when={s().heading}><h2 class="forum-widget__heading">{s().heading}</h2></Show>
                            <Show when={live()}>
                                <span class="forum-widget__live" title={`Updates every ${s().refreshSeconds} seconds`}>
                                    <span class="forum-widget__live-dot" aria-hidden="true" />Live
                                </span>
                            </Show>
                        </header>
                    </Show>
                    <Show when={s().subheading}>
                        <p class={`forum-widget__subheading forum-widget__subheading--${s().subheadingAlign}`}>{s().subheading}</p>
                    </Show>

                    <Switch>
                        <Match when={membersGate()}>
                            <SignInCard onLogin={() => requestLogin('Log in to view the discussion',)} />
                        </Match>
                        <Match when={denied()}>
                            {(e,) => (
                                <Show
                                    when={signedIn()}
                                    fallback={<SignInCard onLogin={() => requestLogin('Log in to view the discussion',)} message={e().message} />}
                                >
                                    <UpgradeTout title="Members-only discussion" message={e().message} onLoggedIn={() => void feed.load()} />
                                </Show>
                            )}
                        </Match>
                        <Match when={failed()}>
                            {(e,) => (
                                <Show when={admin()}>
                                    <p class="block-message">The forum could not be loaded: {e().message}</p>
                                </Show>
                            )}
                        </Match>
                        <Match when={s().mode === 'thread'}>
                            <ForumThreadView feed={feed} />
                        </Match>
                        <Match when={true}>
                            <ForumListView feed={feed} />
                        </Match>
                    </Switch>

                    <div class="forum-widget__notice" role="status" aria-live="polite">
                        <Show when={notice()}><span class="forum-widget__notice-pill">{notice()}</span></Show>
                    </div>
                </div>
            </ForumContext.Provider>
            <Show when={login()}>
                {(title,) => (
                    <LoginModal
                        title={title()}
                        onClose={() => setLogin(null,)}
                        // The viewer changes → the feed and every reply list re-read themselves.
                        onSuccess={() => setLogin(null,)}
                    />
                )}
            </Show>
        </Show>
    );
};

export default ForumWidget;
