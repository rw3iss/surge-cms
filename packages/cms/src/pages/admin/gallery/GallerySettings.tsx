/**
 * Admin → Gallery → Settings (`gallery_settings`; save needs
 * `gallery.settings:manage`). Two tabs, kept in `?tab=`:
 *   General     title, description, public URL, who may view, videos, comment defaults
 *   Appearance  layout, click behaviour, thumbnail size, spacing, aspect, fit,
 *               radius, gutter / padding / max width (site default or custom),
 *               titles, captions, hover zoom, page size, video badge — with a
 *               small live preview of the first few items.
 * Everything edits a local draft; Save sends it. Text fields commit on blur.
 */
import {
    DEFAULT_GALLERY_SETTINGS, type GalleryAppearance, type GalleryItem, type GallerySettings, type SubscriptionTierOption,
} from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createMemo, createSignal, For, onMount, Show, } from 'solid-js';
import { createStore, reconcile, unwrap, } from 'solid-js/store';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import Toggle from '../../../components/admin/common/Toggle';
import { FormField, } from '../../../components/admin/forms';
import CommitInput from '../../../components/admin/gallery/CommitInput';
import { useToast, } from '../../../components/common/toast';
import { Slider, } from '../../../components/ui/Slider';
import { Tabs, } from '../../../components/ui/Tabs';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import './GallerySettings.scss';

type Tab = 'general' | 'appearance';

const LAYOUTS: { value: GalleryAppearance['layout']; label: string; help: string; }[] = [
    { value: 'grid', label: 'Grid', help: 'Even rows of same-size tiles.', },
    { value: 'masonry', label: 'Masonry', help: 'Columns of tiles at their natural height (best with "Original" aspect).', },
    { value: 'carousel', label: 'Carousel', help: 'One row that scrolls sideways.', },
    { value: 'stage', label: 'Stage', help: 'The selected item large on top, a strip of thumbnails below.', },
];

const ASPECTS: { value: GalleryAppearance['aspect']; label: string; }[] = [
    { value: 'square', label: 'Square (1:1)', }, { value: '4:3', label: '4:3', }, { value: '3:2', label: '3:2', },
    { value: '16:9', label: '16:9', }, { value: 'original', label: 'Original (no crop)', },
];

const ASPECT_CSS: Record<GalleryAppearance['aspect'], string> = { square: '1 / 1', '4:3': '4 / 3', '3:2': '3 / 2', '16:9': '16 / 9', original: 'auto', };

const GallerySettingsPage: Component = () => {
    const toast = useToast();
    const [params, setParams,] = useSearchParams<{ tab?: string; }>();
    const tab = (): Tab => (params.tab === 'appearance' ? 'appearance' : 'general');
    const [loaded, setLoaded,] = createSignal<GallerySettings | null>(null,);
    const [draft, setDraft,] = createStore<{ s: GallerySettings; }>({ s: structuredClone(DEFAULT_GALLERY_SETTINGS,), },);
    const [tiers, setTiers,] = createSignal<SubscriptionTierOption[]>([],);
    const [sample, setSample,] = createSignal<GalleryItem[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [loadError, setLoadError,] = createSignal('',);

    const s = () => draft.s;
    const a = () => draft.s.appearance;
    const set = <K extends keyof GallerySettings,>(k: K, v: GallerySettings[K],) => setDraft('s', k as never, v as never,);
    const setA = <K extends keyof GalleryAppearance,>(k: K, v: GalleryAppearance[K],) => setDraft('s', 'appearance', k as never, v as never,);
    // Stringify the store PROXY: `unwrap` reads the raw object WITHOUT tracking, so the memo never re-ran and Save stayed disabled.
    const dirty = createMemo(() => !!loaded() && JSON.stringify(draft.s,) !== JSON.stringify(loaded(),));
    const commentsOn = () => isFeatureEnabled('comments',);

    onMount(async () => {
        try {
            const [st, t, items,] = await Promise.all([
                cms.gallery.settings(),
                cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),
                cms.gallery.admin.items().catch(() => [] as GalleryItem[]),
            ],);
            setLoaded(structuredClone(st,),);
            setDraft('s', reconcile(structuredClone(st,),),);
            setTiers(t.filter((x,) => !x.isFree,),);
            setSample(items.filter((i,) => i.media,).slice(0, 8,),);
        } catch (e) {
            setLoadError((e as Error)?.message || 'Could not load the gallery settings.',);
        }
    },);

    const save = async () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((r,) => requestAnimationFrame(() => r(null,),),);
        setSaving(true,);
        setError('',);
        try {
            const next = await cms.gallery.updateSettings(structuredClone(unwrap(draft.s,),),);
            setLoaded(structuredClone(next,),);
            setDraft('s', reconcile(structuredClone(next,),),);
            toast.success('Gallery settings saved.',);
        } catch (e) {
            const msg = (e as Error)?.message || 'Could not save the settings.';
            setError(msg,);
            toast.error(msg,);
        } finally {
            setSaving(false,);
        }
    };

    const revert = () => {
        const l = loaded();
        if (l) setDraft('s', reconcile(structuredClone(l,),),);
        setError('',);
    };

    /** Preview tile style from the appearance draft. */
    const previewGrid = () => ({
        'grid-template-columns': a().layout === 'carousel' || a().layout === 'stage'
            ? `repeat(${sample().length || 4}, ${Math.min(a().thumbSize, 180,)}px)`
            : `repeat(auto-fill, minmax(${Math.min(a().thumbSize, 180,)}px, 1fr))`,
        gap: a().gap || '12px',
    });

    return (
        <div class="gallery-settings">
            <AdminTitle>Gallery Settings</AdminTitle>
            <div class="admin-header">
                <A href="/admin/gallery" class="admin-header__back">← Gallery</A>
                <h1>Gallery Settings</h1>
                <div class="admin-header__actions">
                    <Show when={dirty()}>
                        <span class="admin-header__dirty">Unsaved changes</span>
                        <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={revert}>Revert</button>
                    </Show>
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={!dirty() || saving()} onClick={() => void save()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<Show when={loadError()} fallback={<p class="form-help-muted">Loading…</p>}><div class="alert alert--error">{loadError()}</div></Show>}>
                <Tabs<Tab>
                    items={[{ value: 'general', label: 'General', }, { value: 'appearance', label: 'Appearance', },]}
                    value={tab()}
                    onChange={(v,) => setParams({ tab: v === 'general' ? undefined : v, },)}
                />
                <Show when={error()}>
                    <div class="alert alert--error gallery-settings__error">{error()}</div>
                </Show>

                {/* ─── General ─── */}
                <Show when={tab() === 'general'}>
                    <div class="gallery-settings__grid">
                        <section class="settings-card">
                            <h3 class="settings-card__title">Gallery page</h3>
                            <FormField label="Title">
                                <CommitInput value={s().title} placeholder="Gallery" onCommit={(v,) => set('title', v,)} />
                            </FormField>
                            <FormField label="Description" hint="Markdown. Shown under the title on the gallery page.">
                                <CommitInput multiline rows={4} value={s().description} onCommit={(v,) => set('description', v,)} />
                            </FormField>
                            <FormField
                                label="Public URL"
                                hint="One path segment, e.g. /gallery or /photos. It cannot be a built-in route or an existing page's slug."
                            >
                                <CommitInput value={s().baseUrl} placeholder="/gallery" onCommit={(v,) => set('baseUrl', v.trim() || '/gallery',)} />
                            </FormField>
                            <p class="form-help-muted">
                                Live at <a href={loaded()!.baseUrl} target="_blank" rel="noopener">{loaded()!.baseUrl}</a>
                            </p>
                        </section>

                        <section class="settings-card">
                            <h3 class="settings-card__title">Who may view</h3>
                            <FormField
                                label="Access"
                                tooltip="The default for every item; an item can set its own visibility. This gates the site only — email and other public uses show an item's media whenever the media itself is public."
                            >
                                <select value={s().access} onChange={(e,) => set('access', e.currentTarget.value as GallerySettings['access'],)}>
                                    <option value="public">Public — everyone</option>
                                    <option value="members">Signed-in members</option>
                                    <option value="tier" disabled={!tiers().length}>Subscription tier…</option>
                                </select>
                            </FormField>
                            <Show when={s().access === 'tier'}>
                                <FormField label="Required tier" hint="Subscribers to this tier or a higher one.">
                                    <select value={s().minTierId ?? ''} onChange={(e,) => set('minTierId', e.currentTarget.value || null,)}>
                                        <option value="">Choose a tier…</option>
                                        <For each={tiers()}>{(t,) => <option value={t.id}>{t.name}</option>}</For>
                                    </select>
                                </FormField>
                            </Show>
                            <Toggle
                                checked={s().allowVideos}
                                onChange={(v,) => set('allowVideos', v,)}
                                label="Allow videos"
                                hint="Videos can be added and play in the site's video player. Off hides existing video items from the public."
                            />
                        </section>

                        <section class="settings-card">
                            <h3 class="settings-card__title">Comments</h3>
                            <Show
                                when={commentsOn()}
                                fallback={
                                    <div class="alert alert--warning">
                                        Comments on gallery items need the Comments feature.{' '}
                                        <A href="/admin/settings?tab=general#features">Turn it on in Settings → Features</A>.
                                    </div>
                                }
                            >
                                <p class="form-help-muted">Defaults for items set to "Inherit". Approval rules come from the Comments settings.</p>
                            </Show>
                            <Toggle
                                checked={s().commentsEnabled}
                                onChange={(v,) => set('commentsEnabled', v,)}
                                label="Commenting on by default"
                            />
                            <Toggle
                                checked={s().allowAnonymousComments}
                                onChange={(v,) => set('allowAnonymousComments', v,)}
                                label="Allow anonymous comments by default"
                                hint="Guests also need the 'Comment without an account' permission."
                            />
                        </section>
                    </div>
                </Show>

                {/* ─── Appearance ─── */}
                <Show when={tab() === 'appearance'}>
                    <div class="gallery-settings__grid">
                        <section class="settings-card">
                            <h3 class="settings-card__title">Layout</h3>
                            <div class="gallery-settings__layouts" role="radiogroup" aria-label="Layout">
                                <For each={LAYOUTS}>
                                    {(l,) => (
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={a().layout === l.value}
                                            class="gallery-settings__layout"
                                            classList={{ 'is-active': a().layout === l.value, }}
                                            onClick={() => setA('layout', l.value,)}
                                        >
                                            <strong>{l.label}</strong>
                                            <span>{l.help}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                            <FormField label="Clicking an item">
                                <select value={a().open} onChange={(e,) => setA('open', e.currentTarget.value as GalleryAppearance['open'],)}>
                                    <option value="lightbox">Opens a lightbox (full size, arrows between items)</option>
                                    <option value="page">Opens the item's own page (with comments)</option>
                                    <option value="none">Does nothing</option>
                                </select>
                            </FormField>
                            <FormField label="Items per page" hint="More items load with the Load more button.">
                                <Slider value={a().perPage} min={4} max={200} step={4} onCommit={(v,) => setA('perPage', v,)} ariaLabel="Items per page" />
                            </FormField>
                        </section>

                        <section class="settings-card">
                            <h3 class="settings-card__title">Tiles</h3>
                            <FormField label="Thumbnail size" hint="Minimum tile width; the grid fills the row.">
                                <Slider value={a().thumbSize} min={80} max={800} step={10} suffix="px" onCommit={(v,) => setA('thumbSize', v,)} ariaLabel="Thumbnail size" />
                            </FormField>
                            <FormField label="Spacing" hint="Any CSS length, e.g. 12px or 1rem.">
                                <CommitInput value={a().gap} placeholder="12px" onCommit={(v,) => setA('gap', v,)} />
                            </FormField>
                            <FormField label="Aspect ratio">
                                <select value={a().aspect} onChange={(e,) => setA('aspect', e.currentTarget.value as GalleryAppearance['aspect'],)}>
                                    <For each={ASPECTS}>{(x,) => <option value={x.value}>{x.label}</option>}</For>
                                </select>
                            </FormField>
                            <FormField label="Fit" tooltip="Cover fills the tile (cropping); Contain shows the whole image (letterboxed).">
                                <select value={a().fit} onChange={(e,) => setA('fit', e.currentTarget.value as GalleryAppearance['fit'],)}>
                                    <option value="cover">Cover (crop to fill)</option>
                                    <option value="contain">Contain (whole image)</option>
                                </select>
                            </FormField>
                            <FormField label="Corner radius" hint="Empty = the site radius.">
                                <CommitInput value={a().radius} placeholder="site default" onCommit={(v,) => setA('radius', v,)} />
                            </FormField>
                            <Toggle checked={a().showTitles} onChange={(v,) => setA('showTitles', v,)} label="Show titles" />
                            <Toggle checked={a().showCaptions} onChange={(v,) => setA('showCaptions', v,)} label="Show captions" />
                            <Toggle checked={a().hoverZoom} onChange={(v,) => setA('hoverZoom', v,)} label="Zoom slightly on hover" />
                            <Toggle checked={a().videoBadge} onChange={(v,) => setA('videoBadge', v,)} label="Play badge on videos" />
                        </section>

                        <section class="settings-card">
                            <h3 class="settings-card__title">Page spacing</h3>
                            <FormField label="Side gutter" tooltip="Space at the left and right of the gallery page.">
                                <select value={a().gutter} onChange={(e,) => setA('gutter', e.currentTarget.value as GalleryAppearance['gutter'],)}>
                                    <option value="site">Site default (Settings → Appearance)</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </FormField>
                            <Show when={a().gutter === 'custom'}>
                                <FormField label="Gutter">
                                    <CommitInput value={a().customGutter} placeholder="16px" onCommit={(v,) => setA('customGutter', v,)} />
                                </FormField>
                            </Show>
                            <FormField label="Top / bottom padding">
                                <select value={a().padding} onChange={(e,) => setA('padding', e.currentTarget.value as GalleryAppearance['padding'],)}>
                                    <option value="site">Site page padding</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </FormField>
                            <Show when={a().padding === 'custom'}>
                                <FormField label="Padding" hint="Any CSS padding, e.g. 24px or 32px 0.">
                                    <CommitInput value={a().customPadding} placeholder="24px" onCommit={(v,) => setA('customPadding', v,)} />
                                </FormField>
                            </Show>
                            <FormField label="Content width">
                                <select value={a().maxWidth} onChange={(e,) => setA('maxWidth', e.currentTarget.value as GalleryAppearance['maxWidth'],)}>
                                    <option value="site">Site max width</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </FormField>
                            <Show when={a().maxWidth === 'custom'}>
                                <FormField label="Max width" hint="e.g. 1600px; empty = full width.">
                                    <CommitInput value={a().customMaxWidth} placeholder="full width" onCommit={(v,) => setA('customMaxWidth', v,)} />
                                </FormField>
                            </Show>
                        </section>

                        <section class="settings-card gallery-settings__preview-card">
                            <h3 class="settings-card__title">Preview</h3>
                            <Show when={sample().length} fallback={<p class="form-help-muted">Publish some items to see a preview here.</p>}>
                                <div class="gallery-settings__preview" classList={{ 'is-row': a().layout === 'carousel' || a().layout === 'stage', }} style={previewGrid()}>
                                    <For each={sample()}>
                                        {(i,) => (
                                            <figure class="gallery-settings__tile" classList={{ 'is-zoom': a().hoverZoom, }}>
                                                <div
                                                    class="gallery-settings__tile-media"
                                                    style={{ 'aspect-ratio': ASPECT_CSS[a().aspect], 'border-radius': a().radius || 'var(--site-radius, 8px)', }}
                                                >
                                                    <img
                                                        src={i.media!.thumbnailUrl ?? i.media!.url}
                                                        alt=""
                                                        loading="lazy"
                                                        style={{ 'object-fit': a().fit, }}
                                                    />
                                                    <Show when={a().videoBadge && i.media!.type === 'video'}>
                                                        <span class="gallery-settings__play" aria-hidden="true">&#9654;</span>
                                                    </Show>
                                                </div>
                                                <Show when={a().showTitles}><figcaption class="gallery-settings__tile-title">{i.title}</figcaption></Show>
                                                <Show when={a().showCaptions && i.caption}><figcaption class="gallery-settings__tile-caption">{i.caption}</figcaption></Show>
                                            </figure>
                                        )}
                                    </For>
                                </div>
                                <p class="form-help-muted">A rough preview of tile size, spacing, aspect, fit and radius — the live page also applies the layout and page spacing.</p>
                            </Show>
                        </section>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default GallerySettingsPage;
