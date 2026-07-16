import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '@/services/cmsClient';

interface UrlLinkBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const UrlLinkBlock: Component<UrlLinkBlockProps> = (props,) => {
    const [fetching, setFetching,] = createSignal(false,);

    const fetchPreview = async () => {
        if (!props.data.url) return;
        setFetching(true,);
        try {
            const preview = await cms.utils.urlPreview({ url: props.data.url, },);
            props.onUpdate({
                ...props.data,
                title: preview.title || props.data.title,
                description: preview.description || props.data.description,
                image: preview.image || props.data.image,
                siteName: preview.siteName || props.data.siteName,
            },);
        } catch {
            // Preview is best-effort — the admin can fill fields manually.
        } finally {
            setFetching(false,);
        }
    };

    return (
        <div class="block-url-link">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-url-link__preview">
                        <Show
                            when={props.data.url}
                            fallback={<span class="block-text__empty">No URL added. Click Edit to add a link.</span>}
                        >
                            <a href={props.data.url} target="_blank" rel="noopener" class="block-url-link__card">
                                <Show when={props.data.image}>
                                    <img src={props.data.image} alt="" class="block-url-link__image" />
                                </Show>
                                <div class="block-url-link__meta">
                                    <Show when={props.data.siteName}>
                                        <span class="block-url-link__site">{props.data.siteName}</span>
                                    </Show>
                                    <span class="block-url-link__title">{props.data.title || props.data.url}</span>
                                    <Show when={props.data.description}>
                                        <span class="block-url-link__desc">{props.data.description}</span>
                                    </Show>
                                </div>
                            </a>
                        </Show>
                    </div>
                }
            >
                <div class="form-row">
                    <div class="form-group form-group--grow">
                        <label>URL</label>
                        <input
                            type="url"
                            value={props.data.url || ''}
                            onInput={(e,) => props.onUpdate({ ...props.data, url: e.currentTarget.value, },)}
                            placeholder="https://example.com/article"
                        />
                    </div>
                    <div class="form-group" style={{ 'align-self': 'flex-end', }}>
                        <button
                            class="btn btn--secondary btn--small"
                            onClick={fetchPreview}
                            disabled={fetching() || !props.data.url}
                        >
                            {fetching() ? 'Fetching...' : 'Fetch Preview'}
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Title</label>
                    <input
                        type="text"
                        value={props.data.title || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, title: e.currentTarget.value, },)}
                        placeholder="Link title"
                    />
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea
                        rows={3}
                        value={props.data.description || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, description: e.currentTarget.value, },)}
                        placeholder="Link description"
                    />
                </div>
                <div class="form-row">
                    <div class="form-group form-group--grow">
                        <label>Image URL</label>
                        <input
                            type="url"
                            value={props.data.image || ''}
                            onInput={(e,) => props.onUpdate({ ...props.data, image: e.currentTarget.value, },)}
                            placeholder="Preview image URL"
                        />
                    </div>
                    <div class="form-group">
                        <label>Site Name</label>
                        <input
                            type="text"
                            value={props.data.siteName || ''}
                            onInput={(e,) => props.onUpdate({ ...props.data, siteName: e.currentTarget.value, },)}
                            placeholder="Example.com"
                        />
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default UrlLinkBlock;
