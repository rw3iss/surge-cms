import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { SocialPublishResult, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import MediaSelectModal, { type MediaItem, } from '../../../components/admin/media/MediaSelectModal';

/** Providers that currently support composing/publishing from the CMS. */
const PUBLISHABLE = new Set(['twitter',],);
const PROVIDERS = ['twitter', 'facebook', 'instagram', 'tiktok', 'patreon', 'youtube',];
const LABELS: Record<string, string> = {
    twitter: 'X / Twitter', facebook: 'Facebook', instagram: 'Instagram',
    tiktok: 'TikTok', patreon: 'Patreon', youtube: 'YouTube',
};
const MAX_LEN = 280;

const SocialComposePanel: Component = () => {
    const [text, setText,] = createSignal('',);
    const [selected, setSelected,] = createSignal<Record<string, boolean>>({ twitter: true, },);
    const [media, setMedia,] = createSignal<MediaItem[]>([],);
    const [showMediaModal, setShowMediaModal,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [results, setResults,] = createSignal<SocialPublishResult[] | null>(null,);
    const [error, setError,] = createSignal('',);

    const isVideo = (m: MediaItem,): boolean => m.mimeType.startsWith('video/',) || m.mimeType === 'image/gif';
    const addMedia = (item: MediaItem,): void => {
        setShowMediaModal(false,);
        const list = media();
        if (list.some((m,) => m.id === item.id)) return;
        // X rule: a video/GIF is exclusive; photos allow up to 4.
        if (isVideo(item,) || list.some(isVideo,)) { setMedia([item,],); return; }
        if (list.length >= 4) return;
        setMedia([...list, item,],);
    };
    const removeMedia = (id: string,): void => { setMedia(media().filter((m,) => m.id !== id),); };

    const [connections,] = createResource(async () => {
        try {
            return await cms.connections.list() as any[];
        } catch {
            return [] as any[];
        }
    },);

    const isConnected = (provider: string,): boolean =>
        Boolean(connections()?.find((c: any,) => c.provider === provider)?.isConnected,);
    const canPublish = (provider: string,): boolean => PUBLISHABLE.has(provider,) && isConnected(provider,);

    const toggle = (provider: string,): void => {
        if (!canPublish(provider,)) return;
        setSelected((s,) => ({ ...s, [provider]: !s[provider], }),);
    };

    const chosen = (): string[] => PROVIDERS.filter((p,) => selected()[p] && canPublish(p,),);

    const publish = async (): Promise<void> => {
        setError('',);
        setResults(null,);
        const providers = chosen();
        if (!text().trim() && media().length === 0) { setError('Write something or attach media.',); return; }
        if (providers.length === 0) { setError('Select at least one connected provider.',); return; }
        setBusy(true,);
        try {
            const res = await cms.social.publish({
                providers,
                text: text().trim(),
                mediaUrls: media().map((m,) => m.url),
            },);
            setResults(res.results,);
            if (res.results.every((r,) => r.ok)) { setText('',); setMedia([],); }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Publish failed.',);
        } finally {
            setBusy(false,);
        }
    };

    const overLimit = (): boolean => selected().twitter && text().length > MAX_LEN;

    return (
        <section class="social-compose">
            <div class="social-compose__editor">
                <textarea
                    class="social-compose__text"
                    rows={5}
                    placeholder="What's happening?"
                    value={text()}
                    onInput={(e,) => setText(e.currentTarget.value,)}
                />
                <div class="social-compose__meta">
                    <span class={`social-compose__count ${overLimit() ? 'is-over' : ''}`}>
                        {text().length}{selected().twitter ? ` / ${MAX_LEN}` : ''}
                    </span>
                </div>
            </div>

            <div class="social-compose__media">
                <For each={media()}>
                    {(m,) => (
                        <div class="social-compose__media-item">
                            <Show
                                when={m.mimeType.startsWith('video/',)}
                                fallback={<img src={m.thumbnailUrl || m.url} alt={m.originalName} />}
                            >
                                <video src={m.url} muted preload="metadata" />
                            </Show>
                            <button
                                type="button"
                                class="social-compose__media-remove"
                                title="Remove"
                                onClick={() => removeMedia(m.id,)}
                            >
                                ×
                            </button>
                        </div>
                    )}
                </For>
                <button
                    type="button"
                    class="social-compose__media-add ui-button ui-button--sm ui-button--secondary"
                    onClick={() => setShowMediaModal(true,)}
                >
                    + Add media
                </button>
            </div>

            <div class="social-compose__providers">
                <For each={PROVIDERS}>
                    {(provider,) => {
                        const publishable = () => canPublish(provider,);
                        const reason = () =>
                            !PUBLISHABLE.has(provider,)
                                ? 'Publishing not supported yet'
                                : !isConnected(provider,)
                                ? 'Not connected — set it up in Configuration'
                                : '';
                        return (
                            <label
                                class={`social-compose__provider ${publishable() ? '' : 'is-disabled'}`}
                                title={reason()}
                            >
                                <input
                                    type="checkbox"
                                    checked={Boolean(selected()[provider]) && publishable()}
                                    disabled={!publishable()}
                                    onChange={() => toggle(provider,)}
                                />
                                <span>{LABELS[provider]}</span>
                                <Show when={!publishable()}>
                                    <span class="social-compose__provider-note">{reason()}</span>
                                </Show>
                            </label>
                        );
                    }}
                </For>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={results()}>
                {(rs,) => (
                    <ul class="social-compose__results">
                        <For each={rs()}>
                            {(r,) => (
                                <li class={r.ok ? 'is-ok' : 'is-error'}>
                                    <strong>{LABELS[r.provider] ?? r.provider}:</strong>{' '}
                                    {r.ok ? `Published (${r.id})` : r.error}
                                </li>
                            )}
                        </For>
                    </ul>
                )}
            </Show>

            <div class="social-compose__actions">
                <button
                    class="ui-button ui-button--primary"
                    disabled={busy() || overLimit()}
                    onClick={publish}
                >
                    {busy() ? 'Publishing…' : 'Publish'}
                </button>
            </div>

            <div class="alert alert--warning" style={{ 'margin-top': '1rem', }}>
                <strong>Publishing to X requires a paid X API plan.</strong> X no longer offers a
                usable free posting tier — the free plan's write allowance is exhausted quickly and
                then returns a “credits depleted” error. To add X posts for free, paste their URLs on
                the <strong>Posts</strong> tab instead.
            </div>
            <p class="form-help">
                Posts you publish here are captured back into the feed automatically. Attach up to 4
                photos, or one video/GIF; videos may take a few seconds to process on publish.
            </p>

            <Show when={showMediaModal()}>
                <MediaSelectModal onSelect={addMedia} onClose={() => setShowMediaModal(false,)} />
            </Show>
        </section>
    );
};

export default SocialComposePanel;
