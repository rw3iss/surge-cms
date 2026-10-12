/**
 * The live console's "Viewers" panel — shown in place of "Show settings".
 *
 * Lists who is connected to the show's room (`cms.posts.liveViewers`, polled
 * every 5 s while open), one row per PERSON (sockets sharing a viewer key are
 * grouped: "2 connections"), staff first, then members, then guests.
 *
 * Each non-staff row has an options menu that moderates by viewer key
 * (`cms.posts.liveModerate`): mute / unmute, silence for N minutes (min
 * `LIVE_SILENCE_MIN_MINUTES`) / unsilence, kick from this show, ban from all
 * live shows. Kick and ban are confirmed first. The list refreshes right
 * after every action.
 */
import type { LiveBan, LiveModerateBody, LiveModerationAction, LiveViewer, } from '@sitesurge/types';
import { LIVE_SILENCE_MIN_MINUTES, } from '@sitesurge/types';
import { type Component, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../../../../services/cmsClient';
import { useToast, } from '../../../../common/toast';
import AnchoredDropdown from '../../../common/AnchoredDropdown';
import ConfirmModal from '../../../common/ConfirmModal';
import { FormField, } from '../../../forms';
import {
    filterViewers, formatConnectedFor, formatCountdown, groupViewers, initialOf, isSilenced, sortViewers,
    type ViewerGroup,
} from './liveViewersModel';
import './LiveViewers.scss';

const POLL_MS = 5000;

export interface LiveViewersProps {
    postId: string;
    onClose: () => void;
    /** Each fresh list (the console feeds it to chat @mention autocomplete). */
    onList?: (rows: LiveViewer[],) => void;
}

const ACTION_DONE: Record<LiveModerationAction, string> = {
    mute: 'muted',
    unmute: 'unmuted',
    silence: 'silenced',
    unsilence: 'unsilenced',
    kick: 'kicked from this show',
    ban: 'banned from all live shows',
    unban: 'unbanned',
};

const LiveViewers: Component<LiveViewersProps> = (props,) => {
    const toast = useToast();
    const [list, setList,] = createSignal<LiveViewer[]>([],);
    const [loaded, setLoaded,] = createSignal(false,);
    const [refreshing, setRefreshing,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [query, setQuery,] = createSignal('',);
    const [now, setNow,] = createSignal(Date.now(),);
    const [busyKey, setBusyKey,] = createSignal<string | null>(null,);
    const [confirm, setConfirm,] = createSignal<{ group: ViewerGroup; action: 'kick' | 'ban'; } | null>(null,);
    const [banReason, setBanReason,] = createSignal('',);
    const [bansOpen, setBansOpen,] = createSignal(false,);
    const [bans, setBans,] = createSignal<LiveBan[] | null>(null,);
    const [unbanning, setUnbanning,] = createSignal<string | null>(null,);

    const loadBans = async () => {
        try {
            setBans(await cms.posts.liveBans(),);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not load bans.',);
        }
    };
    const toggleBans = () => {
        const next = !bansOpen();
        setBansOpen(next,);
        if (next) void loadBans();
    };
    const unban = async (b: LiveBan,) => {
        setUnbanning(b.key,);
        try {
            await cms.posts.liveModerate(props.postId, { key: b.key, action: 'unban', },);
            toast.success(`${b.name} unbanned.`,);
            await loadBans();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Could not unban ${b.name}.`,);
        } finally {
            setUnbanning(null,);
        }
    };

    let disposed = false;
    const load = async () => {
        if (refreshing()) return;
        setRefreshing(true,);
        try {
            const rows = await cms.posts.liveViewers(props.postId,);
            if (disposed) return;
            setList(rows,);
            setError(null,);
            props.onList?.(rows,);
        } catch (e) {
            if (!disposed) setError(e instanceof Error ? e.message : 'Could not load viewers.',);
        } finally {
            if (!disposed) { setRefreshing(false,); setLoaded(true,); }
        }
    };

    onMount(() => {
        void load();
        const poll = setInterval(() => void load(), POLL_MS,);
        const tick = setInterval(() => setNow(Date.now(),), 1000,);
        onCleanup(() => { disposed = true; clearInterval(poll,); clearInterval(tick,); },);
    },);

    const groups = createMemo(() => sortViewers(groupViewers(list(),),));
    const shown = createMemo(() => filterViewers(groups(), query(),));

    const moderate = async (group: ViewerGroup, action: LiveModerationAction, extra: Partial<LiveModerateBody> = {},) => {
        setBusyKey(group.key,);
        try {
            await cms.posts.liveModerate(props.postId, { key: group.key, action, ...extra, },);
            toast.success(`${group.viewer.name} ${ACTION_DONE[action]}.`,);
            await load();
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Could not ${action} ${group.viewer.name}.`,);
            return false;
        } finally {
            setBusyKey(null,);
        }
    };

    const runConfirm = async () => {
        const c = confirm();
        if (!c) return;
        const reason = banReason().trim();
        const ok = await moderate(c.group, c.action, c.action === 'ban' && reason ? { reason, } : {},);
        if (ok) {
            setConfirm(null,);
            setBanReason('',);
            if (c.action === 'ban' && bansOpen()) void loadBans();
        }
    };

    return (
        <div class="live-console__card live-viewers">
            <div class="live-viewers__head">
                <h3 class="live-console__card-title">Viewers ({groups().length})</h3>
                <span
                    class="live-viewers__refresh"
                    classList={{ 'is-active': refreshing(), }}
                    title={refreshing() ? 'Refreshing…' : `Updates every ${POLL_MS / 1000} s`}
                    aria-hidden="true"
                />
                <button type="button" class="live-viewers__close" aria-label="Close viewers" title="Close" onClick={() => props.onClose()}>
                    ×
                </button>
            </div>

            <input
                type="search"
                class="live-viewers__input live-viewers__search"
                placeholder="Search name or @handle"
                aria-label="Search viewers"
                // Search-as-you-type: filters the in-memory list, no request per key.
                value={query()}
                onInput={(e,) => setQuery(e.currentTarget.value,)}
            />

            <Show when={error()}>
                <p class="live-viewers__error">{error()}</p>
            </Show>

            <Show
                when={shown().length}
                fallback={
                    <p class="live-viewers__empty">
                        {!loaded() ? 'Loading…' : groups().length ? 'No viewers match.' : 'No one is watching yet.'}
                    </p>
                }
            >
                <ul class="live-viewers__list">
                    <For each={shown()}>
                        {(group,) => (
                            <ViewerRow
                                group={group}
                                now={now()}
                                busy={busyKey() === group.key}
                                onAction={(action, extra,) => moderate(group, action, extra,)}
                                onConfirm={(action,) => { setBanReason('',); setConfirm({ group, action, },); }}
                            />
                        )}
                    </For>
                </ul>
            </Show>

            <div class="live-viewers__bans">
                <button type="button" class="live-viewers__bans-toggle" aria-expanded={bansOpen()} onClick={toggleBans}>
                    {bansOpen() ? '▾' : '▸'} Banned viewers{bans() ? ` (${bans()!.length})` : ''}
                </button>
                <Show when={bansOpen()}>
                    <Show when={bans()} fallback={<p class="live-viewers__empty">Loading…</p>}>
                        <Show when={bans()!.length} fallback={<p class="live-viewers__empty">No one is banned.</p>}>
                            <ul class="live-viewers__list">
                                <For each={bans()!}>
                                    {(b,) => (
                                        <li class="live-viewers__row" classList={{ 'is-busy': unbanning() === b.key, }}>
                                            <span class="live-viewers__avatar" classList={{ 'is-guest': b.anonymous, }} aria-hidden="true">
                                                {b.anonymous ? <GuestIcon /> : initialOf(b.name,)}
                                            </span>
                                            <div class="live-viewers__who">
                                                <div class="live-viewers__name-line">
                                                    <span class="live-viewers__name">{b.name}</span>
                                                    <Show when={b.anonymous}><span class="live-viewers__badge">Guest</span></Show>
                                                    <Show when={b.handle}><span class="live-viewers__handle">@{b.handle}</span></Show>
                                                </div>
                                                <div class="live-viewers__meta">
                                                    <span>{new Date(b.createdAt,).toLocaleDateString()}</span>
                                                    <Show when={b.bannedBy}><span>· by {b.bannedBy}</span></Show>
                                                    <Show when={b.reason}><span>· {b.reason}</span></Show>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                class="live-viewers__unban"
                                                disabled={unbanning() === b.key}
                                                onClick={() => void unban(b,)}
                                            >
                                                Unban
                                            </button>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>
                    </Show>
                </Show>
            </div>

            <ConfirmModal
                open={!!confirm()}
                title={confirm()?.action === 'ban'
                    ? `Ban ${confirm()?.group.viewer.name} from all live shows?`
                    : `Kick ${confirm()?.group.viewer.name}?`}
                message={confirm()?.action === 'ban'
                    ? 'They are removed now and can\'t join this or any future live show until unbanned.'
                    : 'They are removed now and can\'t rejoin this show.'}
                confirmLabel={confirm()?.action === 'ban' ? 'Ban' : 'Kick'}
                busyLabel={confirm()?.action === 'ban' ? 'Banning…' : 'Kicking…'}
                loading={!!confirm() && busyKey() === confirm()?.group.key}
                danger
                onConfirm={() => void runConfirm()}
                onCancel={() => setConfirm(null,)}
            >
                <Show when={confirm()?.action === 'ban'}>
                    <FormField label="Reason (optional)" hint="Kept with the ban for other staff.">
                        <input
                            type="text"
                            class="live-viewers__input"
                            maxLength={200}
                            value={banReason()}
                            onBlur={(e,) => setBanReason(e.currentTarget.value,)}
                            onKeyDown={(e,) => { if (e.key === 'Enter') setBanReason(e.currentTarget.value,); }}
                        />
                    </FormField>
                </Show>
            </ConfirmModal>
        </div>
    );
};

const GuestIcon = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
);

interface ViewerRowProps {
    group: ViewerGroup;
    now: number;
    busy: boolean;
    onAction: (action: LiveModerationAction, extra?: Partial<LiveModerateBody>,) => Promise<boolean>;
    onConfirm: (action: 'kick' | 'ban',) => void;
}

const ViewerRow: Component<ViewerRowProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    const [silencing, setSilencing,] = createSignal(false,);
    const [minutes, setMinutes,] = createSignal(LIVE_SILENCE_MIN_MINUTES,);
    let rowEl: HTMLLIElement | undefined;
    let triggerEl: HTMLButtonElement | undefined;
    let menuEl: HTMLDivElement | undefined;

    const v = () => props.group.viewer;
    const silenced = () => isSilenced(props.group, props.now,);

    const close = (refocus = false,) => {
        setOpen(false,);
        setSilencing(false,);
        if (refocus) triggerEl?.focus();
    };

    const items = () => [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]',) ?? []),];
    const focusItem = (delta: number,) => {
        const list = items();
        if (!list.length) return;
        const i = list.indexOf(document.activeElement as HTMLElement,);
        list[(i + delta + list.length) % list.length].focus();
    };

    const toggle = () => {
        if (open()) { close(); return; }
        setOpen(true,);
        // Focus the first item once the portalled menu has rendered.
        requestAnimationFrame(() => items()[0]?.focus(),);
    };

    // Outside click + Escape while open.
    const onDocDown = (e: PointerEvent,) => {
        if (!open()) return;
        const t = e.target as Node;
        if (rowEl?.contains(t,) || menuEl?.contains(t,)) return;
        close();
    };
    const onDocKey = (e: KeyboardEvent,) => {
        if (open() && e.key === 'Escape') { e.preventDefault(); close(true,); }
    };
    onMount(() => {
        document.addEventListener('pointerdown', onDocDown, true,);
        document.addEventListener('keydown', onDocKey,);
        onCleanup(() => {
            document.removeEventListener('pointerdown', onDocDown, true,);
            document.removeEventListener('keydown', onDocKey,);
        },);
    },);

    const act = async (action: LiveModerationAction, extra?: Partial<LiveModerateBody>,) => {
        close(true,);
        await props.onAction(action, extra,);
    };

    const submitSilence = () => {
        const m = Math.max(LIVE_SILENCE_MIN_MINUTES, Math.round(Number(minutes(),) || LIVE_SILENCE_MIN_MINUTES,),);
        void act('silence', { minutes: m, },);
    };

    const onMenuKey = (e: KeyboardEvent,) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(1,); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(-1,); }
        else if (e.key === 'Tab') close();
    };

    return (
        <li ref={rowEl} class="live-viewers__row" classList={{ 'is-busy': props.busy, }}>
            <span class="live-viewers__avatar" classList={{ 'is-guest': v().anonymous, }} aria-hidden="true">
                <Show when={v().avatarUrl} fallback={v().anonymous ? <GuestIcon /> : initialOf(v().name,)}>
                    <img src={v().avatarUrl!} alt="" loading="lazy" />
                </Show>
            </span>

            <div class="live-viewers__who">
                <div class="live-viewers__name-line">
                    <span class="live-viewers__name">{v().name}</span>
                    <Show when={props.group.staff}><span class="live-viewers__badge live-viewers__badge--staff">Staff</span></Show>
                    <Show when={v().anonymous}><span class="live-viewers__badge">Guest</span></Show>
                    <Show when={!v().anonymous && v().handle}><span class="live-viewers__handle">@{v().handle}</span></Show>
                </div>
                <div class="live-viewers__meta">
                    <span title={new Date(props.group.connectedAt,).toLocaleString()}>
                        {formatConnectedFor(props.group.connectedAt, props.now,)}
                    </span>
                    <Show when={props.group.connections > 1}>
                        <span>· {props.group.connections} connections</span>
                    </Show>
                    <Show when={props.group.muted}><span class="live-viewers__chip">Muted</span></Show>
                    <Show when={silenced()}>
                        <span class="live-viewers__chip live-viewers__chip--warn" title="Silenced — can't chat or react">
                            Silenced {formatCountdown(props.group.silencedUntil, props.now,)}
                        </span>
                    </Show>
                </div>
            </div>

            <Show
                when={!props.group.staff}
                fallback={<span class="live-viewers__staff-note">Staff</span>}
            >
                <button
                    ref={triggerEl}
                    type="button"
                    class="live-viewers__menu-btn"
                    aria-haspopup="menu"
                    aria-expanded={open()}
                    aria-label={`Options for ${v().name}`}
                    disabled={props.busy}
                    onClick={toggle}
                    onKeyDown={(e,) => { if (e.key === 'ArrowDown' && !open()) { e.preventDefault(); toggle(); } }}
                >
                    ⋯
                </button>
                <AnchoredDropdown anchor={rowEl} open={open()} class="live-viewers__menu" maxHeight={260}>
                    <div ref={menuEl} role="menu" aria-label={`Moderate ${v().name}`} onKeyDown={onMenuKey}>
                        <Show
                            when={props.group.muted}
                            fallback={<button type="button" role="menuitem" onClick={() => void act('mute',)}>Mute (no chat)</button>}
                        >
                            <button type="button" role="menuitem" onClick={() => void act('unmute',)}>Unmute</button>
                        </Show>
                        <Show
                            when={silenced()}
                            fallback={
                                <Show
                                    when={silencing()}
                                    fallback={
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setSilencing(true,);
                                                requestAnimationFrame(() => menuEl?.querySelector<HTMLInputElement>('input',)?.focus(),);
                                            }}
                                        >
                                            Silence…
                                        </button>
                                    }
                                >
                                    <form
                                        class="live-viewers__silence"
                                        onSubmit={(e,) => { e.preventDefault(); submitSilence(); }}
                                    >
                                        <label class="live-viewers__silence-label">
                                            <span>Minutes</span>
                                            <input
                                                type="number"
                                                class="live-viewers__input"
                                                min={LIVE_SILENCE_MIN_MINUTES}
                                                step={1}
                                                value={minutes()}
                                                onBlur={(e,) => setMinutes(Number(e.currentTarget.value,) || LIVE_SILENCE_MIN_MINUTES,)}
                                                onKeyDown={(e,) => {
                                                    if (e.key === 'Enter') setMinutes(Number(e.currentTarget.value,) || LIVE_SILENCE_MIN_MINUTES,);
                                                }}
                                            />
                                        </label>
                                        <button type="submit" role="menuitem" class="live-viewers__silence-go">Silence</button>
                                    </form>
                                </Show>
                            }
                        >
                            <button type="button" role="menuitem" onClick={() => void act('unsilence',)}>Unsilence</button>
                        </Show>
                        <hr />
                        <button type="button" role="menuitem" class="is-danger" onClick={() => { close(true,); props.onConfirm('kick',); }}>
                            Kick from this show
                        </button>
                        <button type="button" role="menuitem" class="is-danger" onClick={() => { close(true,); props.onConfirm('ban',); }}>
                            Ban from all live shows
                        </button>
                    </div>
                </AnchoredDropdown>
            </Show>
        </li>
    );
};

export default LiveViewers;
