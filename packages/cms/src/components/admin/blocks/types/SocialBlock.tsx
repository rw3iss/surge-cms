/**
 * Social block editor — operator picks a provider, sets a count, then
 * either lets the block auto-fill from recent posts (no slots filled)
 * or hand-picks specific posts via the per-slot picker.
 *
 * Each slot has a search input that opens a recent-posts dropdown for
 * the selected provider, plus an "Edit" button that opens a fuller
 * SocialPostSelectModal for advanced search / pagination.
 */
import { Component, createMemo, createSignal, For, Index, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import Toggle from '../../common/Toggle';
import SocialPostSelectModal, { type SocialPost, } from '../SocialPostSelectModal';

/** Editor for the unified Social block. Picks a provider, sets a count,
 *  and either auto-fills (no slots filled) or hand-picks posts via the
 *  per-slot search dropdown / SocialPostSelectModal. */
interface SocialBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

interface SocialItem {
    id: string;
    postId?: string;
    postUrl?: string;
    thumbnailUrl?: string;
    content?: string;
    authorName?: string;
}

const PROVIDERS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter',];
const LAYOUT_OPTIONS = [
    { value: 'grid', label: 'Grid (auto-fill)', },
    { value: '2-col', label: '2 Columns', },
    { value: '1-col', label: '1 Column', },
    { value: 'row', label: 'Horizontal Row', },
];

const newId = (): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ?
        crypto.randomUUID() :
        `si-${Date.now()}-${Math.random().toString(16,).slice(2,)}`;

const blankItem = (): SocialItem => ({ id: newId(), });

function resolveItems(data: Record<string, any>,): SocialItem[] {
    return Array.isArray(data.items,) ? (data.items as SocialItem[]) : [];
}

const SocialBlock: Component<SocialBlockProps> = (props,) => {
    const provider = () => (props.data.provider || '') as string;
    const items = (): SocialItem[] => resolveItems(props.data);
    const count = (): number => {
        const c = Number(props.data.count ?? items().length ?? 1);
        return Number.isFinite(c,) && c > 0 ? Math.min(50, Math.max(1, c,),) : 1;
    };

    const [connections, setConnections,] = createSignal<any[]>([],);
    onMount(async () => {
        try {
            const list = await cms.connections.list();
            setConnections((list as any[]).filter((c: any,) => c.isConnected),);
        } catch { /* ignore — bus toasts; provider list just stays empty */ }
    },);

    const connectedSet = () => new Set(connections().map((c: any,) => c.provider as string,),);

    const update = (patch: Record<string, any>,) => props.onUpdate({ ...props.data, ...patch, },);

    const writeItems = (next: SocialItem[],) => {
        props.onUpdate({ ...props.data, provider: provider(), items: next, count: next.length, },);
    };

    const padToCount = (n: number,): SocialItem[] => {
        const list = [...items(),];
        while (list.length < n) list.push(blankItem(),);
        return list.slice(0, n,);
    };

    const setCount = (n: number,) => {
        const clamped = Math.min(50, Math.max(1, n,),);
        const list = padToCount(clamped,);
        props.onUpdate({ ...props.data, provider: provider(), items: list, count: clamped, },);
    };

    const updateItem = (idx: number, patch: Partial<SocialItem>,) => {
        const list = padToCount(count(),);
        list[idx] = { ...list[idx], ...patch, };
        writeItems(list,);
    };

    const clearItem = (idx: number,) => updateItem(idx, { postId: undefined, postUrl: undefined, thumbnailUrl: undefined, content: undefined, authorName: undefined, });

    return (
        <div class="block-social-feed">
            <Show when={props.mode === 'edit'} fallback={<div />}>
                {/* Provider */}
                <div class="form-group">
                    <label>Provider</label>
                    <select
                        value={provider()}
                        onChange={(e,) => update({ provider: e.currentTarget.value, },)}
                    >
                        <option value="">Select a provider…</option>
                        <For each={PROVIDERS}>
                            {(p,) => (
                                <option value={p} disabled={!connectedSet().has(p,)}>
                                    {p.charAt(0,).toUpperCase() + p.slice(1,)}
                                    {!connectedSet().has(p,) ? ' (not connected)' : ''}
                                </option>
                            )}
                        </For>
                    </select>
                </div>

                <Show when={provider()}>
                    {/* Count */}
                    <div class="form-group">
                        <label>Number of posts</label>
                        <input
                            type="number"
                            min="1"
                            max="50"
                            value={count()}
                            onInput={(e,) => setCount(Number(e.currentTarget.value,) || 1,)}
                        />
                        <small class="form-help">Leave slots empty to auto-fill from recent posts; pick specific posts to pin.</small>
                    </div>

                    {/* Layout (used when slots are empty / auto-feed) */}
                    <div class="form-group">
                        <label>Layout</label>
                        <select
                            value={props.data.layout || 'grid'}
                            onChange={(e,) => update({ layout: e.currentTarget.value, },)}
                        >
                            <For each={LAYOUT_OPTIONS}>
                                {(o,) => <option value={o.value}>{o.label}</option>}
                            </For>
                        </select>
                    </div>

                    {/* Per-slot pickers */}
                    <div class="form-group">
                        <label>Posts</label>
                        <div class="social-slot-list">
                            <Index each={padToCount(count(),)}>
                                {(item, idx,) => (
                                    <SocialSlotRow
                                        item={item()}
                                        provider={provider()}
                                        index={idx}
                                        onChange={(patch,) => updateItem(idx, patch,)}
                                        onClear={() => clearItem(idx,)}
                                    />
                                )}
                            </Index>
                        </div>
                    </div>

                    {/* Show comments — preserved from old SocialMedia editor */}
                    <div class="form-group">
                        <Toggle
                            checked={props.data.showComments || false}
                            onChange={(next,) => update({ showComments: next, },)}
                            label="Show comments"
                        />
                    </div>
                </Show>
            </Show>
        </div>
    );
};

// ─── Per-slot row ──────────────────────────────────────────────────

interface SocialSlotRowProps {
    item: SocialItem;
    provider: string;
    index: number;
    onChange: (patch: Partial<SocialItem>,) => void;
    onClear: () => void;
}

const SocialSlotRow: Component<SocialSlotRowProps> = (props,) => {
    const [search, setSearch,] = createSignal('',);
    const [showDropdown, setShowDropdown,] = createSignal(false,);
    const [showModal, setShowModal,] = createSignal(false,);
    const [recent, setRecent,] = createSignal<SocialPost[]>([],);
    const [loading, setLoading,] = createSignal(false,);

    let containerRef: HTMLDivElement | undefined;

    const display = () => props.item.content?.substring(0, 80,) || props.item.postId || '';

    const loadRecent = async () => {
        if (!props.provider) return;
        setLoading(true,);
        try {
            const res = await cms.social.platformPosts(props.provider, { limit: 10, sort: 'date', sortDir: 'desc', } as any,);
            setRecent((res.data || []) as unknown as SocialPost[],);
        } catch { /* ignore — bus toasts; recent list just stays empty */ } finally { setLoading(false,); }
    };

    const onFocus = () => {
        if (recent().length === 0 && !loading()) void loadRecent();
        setShowDropdown(true,);
    };

    const handleClickOutside = (e: MouseEvent,) => {
        if (containerRef && !containerRef.contains(e.target as Node,)) {
            setShowDropdown(false,);
        }
    };

    onMount(() => {
        document.addEventListener('mousedown', handleClickOutside,);
    },);
    onCleanup(() => document.removeEventListener('mousedown', handleClickOutside,),);

    const filtered = createMemo(() => {
        const q = search().toLowerCase().trim();
        if (!q) return recent();
        return recent().filter(p =>
            (p.content || '').toLowerCase().includes(q,) ||
            (p.authorName || '').toLowerCase().includes(q,),
        );
    },);

    const selectPost = (post: SocialPost,) => {
        props.onChange({
            postId: post.externalId || post.id,
            postUrl: post.mediaUrl,
            thumbnailUrl: post.thumbnailUrl,
            content: post.content,
            authorName: post.authorName,
        },);
        setShowDropdown(false,);
        setSearch('',);
    };

    return (
        <div class="social-slot-row" ref={containerRef}>
            <span class="social-slot-row__num">{props.index + 1}</span>
            <Show when={props.item.thumbnailUrl}>
                <img class="social-slot-row__thumb" src={props.item.thumbnailUrl} alt="" />
            </Show>
            <div class="social-slot-row__field">
                <input
                    type="text"
                    placeholder={display() ? '' : 'Search posts… (or leave blank for auto-feed)'}
                    value={search() || display()}
                    onFocus={onFocus}
                    onInput={(e,) => { setSearch(e.currentTarget.value,); setShowDropdown(true,); }}
                />
                <Show when={showDropdown()}>
                    <div class="social-slot-row__dropdown">
                        <Show when={loading()} fallback={
                            <Show
                                when={filtered().length > 0}
                                fallback={<div class="social-slot-row__empty">No recent posts.</div>}
                            >
                                <For each={filtered()}>
                                    {(p,) => (
                                        <button
                                            type="button"
                                            class="social-slot-row__option"
                                            onClick={() => selectPost(p,)}
                                        >
                                            <Show when={p.thumbnailUrl}>
                                                <img src={p.thumbnailUrl} alt="" />
                                            </Show>
                                            <span class="social-slot-row__option-text">
                                                {(p.content || '(no caption)').substring(0, 100,)}
                                            </span>
                                        </button>
                                    )}
                                </For>
                            </Show>
                        }>
                            <div class="social-slot-row__loading">Loading…</div>
                        </Show>
                    </div>
                </Show>
            </div>
            <button
                type="button"
                class="btn btn--small btn--secondary"
                onClick={() => setShowModal(true,)}
                disabled={!props.provider}
                title="Open advanced post search"
            >
                Edit…
            </button>
            <Show when={props.item.postId}>
                <button
                    type="button"
                    class="btn btn--small btn--ghost"
                    onClick={() => props.onClear()}
                    title="Clear this slot"
                >
                    ×
                </button>
            </Show>

            <Show when={showModal()}>
                <SocialPostSelectModal
                    provider={props.provider}
                    initialPostId={props.item.postId}
                    onSelect={selectPost}
                    onClose={() => setShowModal(false,)}
                />
            </Show>
        </div>
    );
};

export default SocialBlock;
