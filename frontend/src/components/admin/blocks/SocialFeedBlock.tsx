import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { api, } from '../../../services/api';

interface SocialFeedBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const PROVIDERS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter',];

const LAYOUT_OPTIONS = [
    { value: 'grid', label: 'Grid (auto-fill columns)', },
    { value: '2-col', label: '2 Columns', },
    { value: '1-col', label: '1 Column', },
    { value: 'row', label: 'Horizontal Row (scrollable)', },
];

/**
 * Admin editor for the "Social Feed" block type.
 * Lets the user pick a connected social provider — the public-side
 * BlockRenderer then renders a grid of recent posts from that provider.
 *
 * Unlike SocialMediaBlock (which picks a SINGLE post), this selects an
 * entire feed / provider to display.
 */
const SocialFeedBlock: Component<SocialFeedBlockProps> = (props,) => {
    // Fetch connected providers without createResource to avoid
    // triggering the app-level Suspense boundary (which causes a
    // scroll-to-top jump when the flyout panel loads this component).
    const [connections, setConnections,] = createSignal<any[]>([],);
    onMount(async () => {
        try {
            const response = await api.get('/connections',);
            if (response.success) {
                setConnections(((response as any).data as any[]).filter((c: any,) => c.isConnected),);
            }
        } catch { /* ignore */ }
    },);

    const connectedProviders = () => {
        const connected = new Set(
            connections().map((c: any,) => c.provider as string),
        );
        return PROVIDERS.map(p => ({
            id: p,
            label: p.charAt(0,).toUpperCase() + p.slice(1,),
            connected: connected.has(p,),
        }),);
    };

    const selectedPlatform = () => props.data.socialPlatform || props.data.platform || '';

    return (
        <div class="block-social-feed">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-social-feed__preview">
                        <Show
                            when={selectedPlatform()}
                            fallback={
                                <span class="block-text__empty">
                                    No social feed configured. Click Edit to choose a provider.
                                </span>
                            }
                        >
                            <span class="badge badge--info">
                                {selectedPlatform().charAt(0,).toUpperCase() + selectedPlatform().slice(1,)}
                            </span>
                            <span>
                                {' '}feed — {props.data.limit || 6} posts,{' '}
                                {LAYOUT_OPTIONS.find(o => o.value === (props.data.layout || 'grid'),)?.label || 'Grid'} layout
                            </span>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Provider</label>
                    <select
                        value={selectedPlatform()}
                        onChange={(e,) => {
                            props.onUpdate({
                                ...props.data,
                                socialPlatform: e.currentTarget.value,
                                platform: e.currentTarget.value,
                            },);
                        }}
                    >
                        <option value="">Select a provider...</option>
                        <For each={connectedProviders()}>
                            {(p,) => (
                                <option value={p.id} disabled={!p.connected}>
                                    {p.label}{!p.connected ? ' (not connected)' : ''}
                                </option>
                            )}
                        </For>
                    </select>
                </div>

                <div class="form-group">
                    <label>Layout</label>
                        <select
                            value={props.data.layout || 'grid'}
                            onChange={(e,) => {
                                props.onUpdate({
                                    ...props.data,
                                    layout: e.currentTarget.value,
                                },);
                            }}
                        >
                            <For each={LAYOUT_OPTIONS}>
                                {(o,) => <option value={o.value}>{o.label}</option>}
                            </For>
                        </select>
                </div>
                <div class="form-group">
                    <label>Posts</label>
                    <input
                        type="number"
                        min="1"
                        max="50"
                        value={props.data.limit || 6}
                        onInput={(e,) => {
                            props.onUpdate({
                                ...props.data,
                                limit: Math.max(1, Math.min(50, Number(e.currentTarget.value,) || 6,),),
                            },);
                        }}
                    />
                </div>
                <Show when={(props.data.layout || 'grid') === 'row'}>
                    <div class="form-group">
                        <label>Row Height</label>
                        <input
                            type="text"
                            value={props.data.rowHeight || ''}
                            onChange={(e,) => props.onUpdate({ ...props.data, rowHeight: e.currentTarget.value, },)}
                            onKeyDown={(e,) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            placeholder="e.g. 300px, 40vh (blank for auto)"
                        />
                    </div>
                </Show>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input
                            type="checkbox"
                            checked={props.data.snapScroll ?? false}
                            onChange={(e,) => props.onUpdate({ ...props.data, snapScroll: e.currentTarget.checked, },)}
                        />
                        <span>Snap scrolling</span>
                    </label>
                </div>
            </Show>
        </div>
    );
};

export default SocialFeedBlock;
