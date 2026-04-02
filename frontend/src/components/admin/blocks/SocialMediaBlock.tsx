import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../../services/api';

interface SocialMediaBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const PROVIDERS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter',];

const SocialMediaBlock: Component<SocialMediaBlockProps> = (props,) => {
    const [selectedProvider, setSelectedProvider,] = createSignal(props.data.provider || '',);

    const [posts,] = createResource(() => selectedProvider(), async (provider,) => {
        if (!provider) return [];
        const response = await api.get(`/social/feed/${provider}?limit=20`,);
        return response.success ? (response as any).data : [];
    },);

    const selectPost = (post: any,) => {
        props.onUpdate({
            provider: selectedProvider(),
            postId: post.externalId || post.id,
            postUrl: post.mediaUrl,
            thumbnailUrl: post.thumbnailUrl,
            content: post.content || '',
            showComments: false,
            authorName: post.authorName,
        },);
    };

    return (
        <div class="block-social-media">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-social-media__preview">
                        <Show
                            when={props.data.postUrl}
                            fallback={
                                <span class="block-text__empty">
                                    No social media post selected. Click Edit to choose one.
                                </span>
                            }
                        >
                            <div class="block-social-media__selected">
                                <Show when={props.data.thumbnailUrl}>
                                    <img src={props.data.thumbnailUrl} alt="" class="block-social-media__thumb" />
                                </Show>
                                <div class="block-social-media__details">
                                    <span class="badge badge--info">{props.data.provider}</span>
                                    <p>
                                        {props.data.content?.substring(0, 120,)}
                                        {props.data.content?.length > 120 ? '...' : ''}
                                    </p>
                                </div>
                            </div>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Provider</label>
                    <select value={selectedProvider()} onChange={(e,) => setSelectedProvider(e.currentTarget.value,)}>
                        <option value="">Select a provider...</option>
                        <For each={PROVIDERS}>
                            {(p,) => <option value={p}>{p.charAt(0,).toUpperCase() + p.slice(1,)}</option>}
                        </For>
                    </select>
                </div>
                <Show when={selectedProvider() && posts()}>
                    <div class="form-group">
                        <label>Select a post</label>
                        <div class="social-media-grid">
                            <For
                                each={posts()}
                                fallback={<div class="empty-state">No posts found for this provider.</div>}
                            >
                                {(post: any,) => (
                                    <div
                                        class={`social-media-grid__item ${
                                            props.data.postId === post.id ? 'social-media-grid__item--selected' : ''
                                        }`}
                                        onClick={() => selectPost(post,)}
                                    >
                                        <Show when={post.thumbnailUrl || post.imageUrl}>
                                            <img src={post.thumbnailUrl || post.imageUrl} alt="" />
                                        </Show>
                                        <div class="social-media-grid__caption">
                                            {(post.content || post.caption || '').substring(0, 60,)}
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>
                    </div>
                </Show>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input
                            type="checkbox"
                            checked={props.data.showComments || false}
                            onChange={(e,) =>
                                props.onUpdate({ ...props.data, showComments: e.currentTarget.checked, },)}
                        />
                        Show comments
                    </label>
                </div>
            </Show>
        </div>
    );
};

export default SocialMediaBlock;
