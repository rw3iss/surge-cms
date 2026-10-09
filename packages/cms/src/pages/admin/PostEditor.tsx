import {
    BANNER_HEIGHT_MAX, BANNER_POSITION_CUSTOM_MAX, type BannerImagePosition, isValidBannerHeight,
    isValidBannerPositionCustom, resolveBannerHeight, resolveBannerPosition,
} from '@sitesurge/types';
import { Component, createEffect, createSignal, For, Match, Show, Switch, } from 'solid-js';
import { contentPaddingStyle, } from '../../utils/appearanceStyle';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import { Slider, } from '../../components/ui/Slider';
import { BlockData, } from '../../components/admin/blocks/ContentBlock';
import { FormField, } from '../../components/admin/forms';
import EntityEditorShell from '../../components/admin/editors/EntityEditorShell';
import { deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle, } from '../../services/blockStyleRef';
import MediaSelectModal from '../../components/admin/media/MediaSelectModal';
import MediaUploadModal from '../../components/admin/media/MediaUploadModal';
import { Layout, } from '../../components/layout/Layout';
import PostContentBlock from '../../components/blocks/posts/PostContentBlock';
import { createSafeResource, } from '../../hooks/createSafeResource';
import { useEntityEditor, type EntitySaveContext, } from '../../hooks/useEntityEditor';
import { invalidatePostsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { BlockStyleService, } from '../../services/blockStyles';
import { generateBlockId, } from '../../utils/blockId';
import type { Post, } from '@sitesurge/types';

const AdminPostEditor: Component = () => {
    const auth = useAuth();
    // ─── Post property signals ───
    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [excerpt, setExcerpt,] = createSignal('',);
    const [status, setStatus,] = createSignal('draft',);
    const [tags, setTags,] = createSignal('',);
    const [featuredImage, setFeaturedImage,] = createSignal('',);
    /** How the banner image + title/meta header renders: standalone (default),
     *  hero (image full-width with title/meta over it), or thumbnail (small
     *  image beside the title/meta). Only meaningful when a banner is set. */
    const [bannerLayout, setBannerLayout,] = createSignal<'hero' | 'hero-full' | 'standalone' | 'thumbnail'>('standalone',);
    const [bannerImagePosition, setBannerImagePosition,] = createSignal<BannerImagePosition>('center',);
    /** CSS position used when Vertical Position is Custom. */
    const [bannerImagePositionCustom, setBannerImagePositionCustom,] = createSignal('',);
    /** Banner height for every image layout (any CSS height); '' = layout default. */
    const [bannerHeight, setBannerHeight,] = createSignal('',);
    const [showPhotoCredits, setShowPhotoCredits,] = createSignal(false,);
    /** Subscription tier required to read the post ('' = public). */
    const [requiredTierId, setRequiredTierId,] = createSignal('',);
    /** Hide the post entirely (listings + 404) from viewers without the tier. */
    const [gateHidden, setGateHidden,] = createSignal(false,);
    /** Show non-subscribers the start of the article + an upgrade prompt. */
    const [gateShowSample, setGateShowSample,] = createSignal(false,);
    /** Share of the article text shown as the sample (1–100). */
    const [gateSamplePercent, setGateSamplePercent,] = createSignal(25,);
    /** The saved banner's media item — for the preview's credit line. */
    const [loadedMedia, setLoadedMedia,] = createSignal<{ path?: string; credits?: string | null; } | null>(null,);
    const [publishAt, setPublishAt,] = createSignal('',);
    const [authorId, setAuthorId,] = createSignal('',);
    /** Whether the post renderer applies the site's Post Padding (top/bottom)
     *  and/or the site gutter (left/right). Both default on. */
    const [applyPostPadding, setApplyPostPadding,] = createSignal(true,);
    const [applySiteGutter, setApplySiteGutter,] = createSignal(true,);
    /** Header color style for this post ('' = '-' → inherit the site default). */
    const [headerStyle, setHeaderStyle,] = createSignal('',);
    /** Header position for this post ('' = '-' → inherit the site default). */
    const [headerPosition, setHeaderPosition,] = createSignal('',);
    const [showImageSelect, setShowImageSelect,] = createSignal(false,);
    const [showImageUpload, setShowImageUpload,] = createSignal(false,);

    // Staff users (admin / sysadmin / editor) for the Author dropdown.
    const [staffUsers,] = createSafeResource(
        async () => await cms.users.authors(),
        [] as { id: string; displayName: string; role: string; }[],
    );

    // Subscription tiers for the Access picker. A failure
    // (feature off / no permission) leaves just the Public option.
    const [tierOptions,] = createSafeResource(
        async () => await cms.subscriptionTiers.options(),
        [] as { id: string; name: string; slug: string; isFree: boolean; isActive: boolean; sortOrder: number; }[],
    );
    const requiredTierName = () => {
        const id = requiredTierId();
        if (!id) return '';
        return (tierOptions() ?? []).find((t,) => t.id === id)?.name ?? 'Subscribers';
    };

    const editor = useEntityEditor<Post>({
        entityKind: 'post',
        listPath: '/admin/posts',
        load: (id,) => cms.posts.getById(id,) as Promise<Post>,
        status,
        autoSaveState: () => ({
            title: title(),
            slug: slug(),
            excerpt: excerpt(),
            status: status(),
            tags: tags(),
            featuredImage: featuredImage(),
            bannerLayout: bannerLayout(),
            bannerImagePosition: bannerImagePosition(),
            bannerImagePositionCustom: bannerImagePositionCustom(),
            bannerHeight: bannerHeight(),
            showPhotoCredits: showPhotoCredits(),
            requiredTierId: requiredTierId(),
            gateHidden: gateHidden(),
            gateShowSample: gateShowSample(),
            gateSamplePercent: gateSamplePercent(),
            publishAt: publishAt(),
            authorId: authorId(),
            applyPostPadding: applyPostPadding(),
            applySiteGutter: applySiteGutter(),
            headerStyle: headerStyle(),
            headerPosition: headerPosition(),
        }),
        validate: () => {
            if (!title()) return 'Title is required';
            if (!slug()) return 'Slug is required';
            return null;
        },
        save: async (ctx: EntitySaveContext,) => {
            const tagList = tags().split(',',).map(t => t.trim()).filter(Boolean,);
            const data: any = {
                title: title(),
                slug: slug(),
                excerpt: excerpt(),
                status: status(),
                tags: tagList,
                featuredImage: featuredImage() || null,
                bannerLayout: bannerLayout(),
                bannerImagePosition: bannerImagePosition(),
                // Only meaningful in Custom mode; cleared otherwise so a stale value
                // can't resurface when Custom is picked again later.
                bannerImagePositionCustom: bannerImagePosition() === 'custom' ? bannerImagePositionCustom().trim() || null : null,
                bannerHeight: bannerHeight().trim() || null,
                showPhotoCredits: showPhotoCredits(),
                requiredTierId: requiredTierId() || null,
                gateHidden: gateHidden(),
                gateShowSample: gateShowSample(),
                gateSamplePercent: gateSamplePercent(),
                authorId: authorId() || null,
                publishAt: publishAt() ? new Date(publishAt(),).toISOString() : null,
                applyPostPadding: applyPostPadding(),
                applySiteGutter: applySiteGutter(),
                headerStyle: headerStyle() || undefined,
                headerPosition: headerPosition() || undefined,
                contentBlocks: ctx.blocks.map((b, i,) => {
                    // Persist the block's style. The backend reads it from
                    // `data.__styleRef`; resolve the active ref (an explicit
                    // picker action beats the loaded value) and embed it —
                    // previously this was dropped, so styles set in the post
                    // editor never saved.
                    const resolved = resolveActiveStyleRef(b.data, b.styleRef,);
                    const persisted = styleRefToPersistedStyle(resolved,);
                    const { __styleRef: _drop, ...cleanData } = b.data as Record<string, any>;
                    const blockData: Record<string, any> = { ...cleanData, };
                    if (resolved.explicitlyCleared) {
                        // No templateId/custom → backend writes style = null.
                    } else if (persisted && typeof persisted === 'object' && 'id' in persisted) {
                        blockData.__styleRef = { templateId: (persisted as { id: string; }).id, };
                    } else if (persisted) {
                        blockData.__styleRef = { custom: persisted, };
                    }
                    return { id: b.id, type: b.type, sort_order: i, data: blockData, };
                }),
            };
            const saved = ctx.isNew
                ? await cms.posts.create(data,)
                : await cms.posts.update(ctx.id, data,);
            return (saved as any)?.id ?? ctx.id;
        },
        onSaved: () => invalidatePostsCache(),
        snapshot: (id,) => cms.posts.snapshotRevision(id,),
        softDelete: (id,) => cms.posts.update(id, { status: 'deleted', } as any,) as any,
        onDeleted: () => invalidatePostsCache(),
        restore: (id,) => cms.posts.update(id, { status: 'draft', } as any,) as any,
        onRestored: () => setStatus('draft',),
        messages: {
            saved: () => `Post '${title()}' saved`,
            saveError: 'Failed to save post',
            deleteError: 'Failed to delete post',
            restoreError: 'Failed to restore post',
        },
    },);

    // Default a NEW post's author to the signed-in user, so the dropdown shows
    // who is about to be credited instead of an empty field that silently
    // publishes an anonymous article. The backend also defaults this on create;
    // doing it here as well makes the choice VISIBLE and editable before save.
    let authorSelect: HTMLSelectElement | undefined;
    let tierSelect: HTMLSelectElement | undefined;
    createEffect(() => {
        // `auth.user` is a PROPERTY on the store, not an accessor — calling it
        // threw and killed the effect silently.
        const staff = staffUsers() ?? [];
        if (!editor.isNew() || authorId()) return;
        const me = auth.user;
        if (!me) return;
        // Only if the current user can actually be an author (staff).
        if (staff.some((u,) => u.id === me.id)) setAuthorId(me.id,);
    },);

    /**
     * Re-apply the selected author once the option list exists.
     *
     * `staffUsers` loads asynchronously, so on first paint the dropdown holds
     * only the "—" placeholder. A `<select>` whose value matches no option
     * falls back to the first one and is NOT re-synced when the options
     * arrive — the signal said "Ryan Weiss" while the control read "—".
     * Skipped while the field has focus so it can't yank a live selection.
     */
    createEffect(() => {
        staffUsers();
        const v = authorId();
        if (authorSelect && document.activeElement !== authorSelect) authorSelect.value = v;
    },);

    // Same async-options re-sync for the tier picker.
    createEffect(() => {
        tierOptions();
        const v = requiredTierId();
        if (tierSelect && document.activeElement !== tierSelect) tierSelect.value = v;
    },);

    // ─── Offer to restore a localStorage draft for NEW posts ───
    // (only if a draft exists and the current state is empty)
    createEffect(() => {
        if (!editor.isNew()) return;
        if (title() || editor.blocks().length) return;
        const draft = editor.autoSave.getDraft();
        if (draft && confirm('A draft was found from a previous session. Restore it?',)) {
            const d = draft.data as any;
            setTitle(d.title || '',);
            setSlug(d.slug || '',);
            setExcerpt(d.excerpt || '',);
            setStatus(d.status || 'draft',);
            setTags(d.tags || '',);
            setFeaturedImage(d.featuredImage || '',);
            setBannerLayout(d.bannerLayout || 'standalone',);
            setBannerImagePosition((d.bannerImagePosition as BannerImagePosition) || 'center',);
            setBannerImagePositionCustom(d.bannerImagePositionCustom || '',);
            setBannerHeight(d.bannerHeight || '',);
            setShowPhotoCredits(d.showPhotoCredits === true,);
            setRequiredTierId(d.requiredTierId || '',);
            setGateHidden(d.gateHidden === true,);
            setGateShowSample(d.gateShowSample === true,);
            setGateSamplePercent(typeof d.gateSamplePercent === 'number' ? d.gateSamplePercent : 25,);
            setPublishAt(d.publishAt || '',);
            setAuthorId(d.authorId || '',);
            setApplyPostPadding(d.applyPostPadding !== false,);
            setApplySiteGutter(d.applySiteGutter !== false,);
            setHeaderStyle(d.headerStyle || '',);
            setHeaderPosition(d.headerPosition || '',);
            editor.setBlocks(d.blocks || [],);
        }
    },);

    // ─── Hydrate signals from the loaded post ───
    createEffect(() => {
        const p = editor.entity();
        if (!p) return;
        setTitle(p.title || '',);
        setSlug(p.slug || '',);
        setExcerpt(p.excerpt || '',);
        setStatus(p.status || 'draft',);
        setTags((p.tags || []).join(', ',),);
        setFeaturedImage(p.featuredImage || '',);
        setBannerLayout(((p as any).bannerLayout as 'hero' | 'hero-full' | 'standalone' | 'thumbnail') || 'standalone',);
        setBannerImagePosition(((p as any).bannerImagePosition as BannerImagePosition) || 'center',);
        setBannerImagePositionCustom((p as any).bannerImagePositionCustom || '',);
        setBannerHeight((p as any).bannerHeight || '',);
        setShowPhotoCredits((p as any).showPhotoCredits === true,);
        setRequiredTierId(p.requiredTierId || '',);
        setGateHidden(p.gateHidden === true,);
        setGateShowSample(p.gateShowSample === true,);
        setGateSamplePercent(typeof p.gateSamplePercent === 'number' ? p.gateSamplePercent : 25,);
        setLoadedMedia((p as any).featuredMedia ?? null,);
        setAuthorId((p as any).authorId || '',);
        setApplyPostPadding((p as any).applyPostPadding !== false,);
        setApplySiteGutter((p as any).applySiteGutter !== false,);
        setHeaderStyle((p as any).headerStyle || '',);
        setHeaderPosition((p as any).headerPosition || '',);
        setPublishAt(p.publishAt ? new Date(p.publishAt,).toISOString().slice(0, 16,) : '',);
        const blockList = (p as any).contentBlocks as any[] | undefined;
        if (blockList?.length) {
            const converted = blockList.map((b,) => ({
                // b.style is the persisted style payload: either
                // `{ id: <uuid> }` (template ref) or flat custom props.
                // The shared kernel produces the editor's styleRef shape
                // from either.
                id: b.id || generateBlockId(),
                type: b.type,
                sort_order: b.sortOrder ?? b.sort_order,
                data: b.data || {},
                styleRef: deriveStyleRefFromStyle(b.style,),
            } as BlockData));
            editor.setBlocks(converted,);
            editor.setSavedBlocks(structuredClone(converted,),);
        }
    },);

    const properties = (
        <CollapsiblePanel
            title="Post Properties"
            defaultOpen
            headerContent={
                <span class="editor-brief">
                    <span class={`editor-brief__title ${!title() ? 'editor-brief__title--placeholder' : ''}`}>
                        {title() || 'Untitled post'}
                    </span>
                    <Show when={slug()}>
                        <span class="editor-brief__slug">/{slug()}</span>
                    </Show>
                </span>
            }
            headerExtra={
                <>
                    <span class={`editor-pill editor-pill--${status()}`}>{status()}</span>
                    <Show
                        when={requiredTierId()}
                        fallback={<span class="editor-pill editor-pill--public">public</span>}
                    >
                        <span class="editor-pill editor-pill--member" title="Subscription required">🔒 {requiredTierName()}</span>
                    </Show>
                </>
            }
        >
            <div class="editor-properties">
                <div class="editor-properties__main">
                    <FormField label="Title">
                        <input
                            type="text"
                            value={title()}
                            onInput={(e,) => { setTitle(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="Post title"
                        />
                    </FormField>
                    <FormField label="Slug">
                        <input
                            type="text"
                            value={slug()}
                            onInput={(e,) => { setSlug(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="post-slug"
                        />
                        <small class="form-help">URL: /posts/{slug() || 'post-slug'}</small>
                    </FormField>
                    <FormField label="Excerpt">
                        <textarea
                            rows={3}
                            value={excerpt()}
                            onInput={(e,) => { setExcerpt(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="Brief summary of the post..."
                        />
                    </FormField>
                    <FormField label="Tags" hint="Comma-separated">
                        <input
                            type="text"
                            value={tags()}
                            onInput={(e,) => { setTags(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="tag1, tag2, tag3"
                        />
                    </FormField>
                    <div class="form-group">
                        <label style={{ 'margin-bottom': '4px', }}>Banner Image</label>
                        <div class="post-banner-field">
                            {/* Preview + the layout/position controls sit side by side,
                                directly next to the image. */}
                            <div class="post-banner-field__row">
                                <Show when={featuredImage()}>
                                    <div class="post-banner-field__preview-col">
                                        <img
                                            class="post-banner-field__preview"
                                            src={featuredImage()}
                                            alt="Banner preview"
                                        />
                                        <div class="post-banner-field__credits-toggle">
                                        <Toggle
                                            checked={showPhotoCredits()}
                                            onChange={(next,) => {
                                                setShowPhotoCredits(next,);
                                                editor.markDirty();
                                            }}
                                            label="Show photo credits"
                                        />
                                        <Tooltip
                                            header="Show photo credits"
                                            content={`Shows the banner image's Credits at the right end of the post's author/date row (edit them in Admin → Media → Edit). Nothing shows if the image has no credits.`}
                                        />
                                        </div>
                                    </div>
                                </Show>
                                <Show when={featuredImage()}>
                                    <div class="post-banner-field__layout">
                                        <div class="post-banner-field__layout-row">
                                            <label>Image Layout</label>
                                            <select
                                                value={bannerLayout()}
                                                onChange={(e,) => {
                                                    setBannerLayout(e.currentTarget.value as 'hero' | 'hero-full' | 'standalone' | 'thumbnail',);
                                                    editor.markDirty();
                                                }}
                                            >
                                                <option value="hero">Hero</option>
                                                <option value="hero-full">Hero Full</option>
                                                <option value="standalone">Standalone</option>
                                                <option value="thumbnail">Thumbnail</option>
                                            </select>
                                            <Tooltip
                                                header="Image Layout"
                                                content="How the banner image + title/meta render at the top of the post. Hero: full-width image with the title & meta over it (white text). Hero Full: same as Hero, but the banner background spans the ENTIRE page width edge-to-edge (no left/right gap) while the title & meta stay within the centered content column. Standalone: title & meta on top, image full-width below. Thumbnail: a small image beside the title & meta in a single row. The post content renders below either way."
                                            />
                                        </div>
                                        <div class="post-banner-field__layout-row">
                                            <label>Vertical Position</label>
                                            <select
                                                value={bannerImagePosition()}
                                                onChange={(e,) => {
                                                    setBannerImagePosition(e.currentTarget.value as BannerImagePosition,);
                                                    editor.markDirty();
                                                }}
                                            >
                                                <option value="start">Start (top)</option>
                                                <option value="center">Center</option>
                                                <option value="end">End (bottom)</option>
                                                <option value="custom">Custom</option>
                                            </select>
                                            <Tooltip
                                                header="Vertical Position"
                                                content="Where a large banner image is anchored when it's cropped. Start shows the TOP of the image, End shows the BOTTOM, Center (default) shows the middle. Custom takes any CSS background-position (e.g. center 30%, left 20px bottom). Useful when centering cuts off the top of the subject."
                                            />
                                        </div>
                                        <Show when={bannerImagePosition() === 'custom'}>
                                            <div class="post-banner-field__layout-row">
                                                <label>Custom Position</label>
                                                {/* Commits on blur / Enter (admin input rule). */}
                                                <input
                                                    type="text"
                                                    placeholder="center 30%"
                                                    maxLength={BANNER_POSITION_CUSTOM_MAX}
                                                    value={bannerImagePositionCustom()}
                                                    onBlur={(e,) => {
                                                        const v = e.currentTarget.value.trim();
                                                        if (v === bannerImagePositionCustom()) return;
                                                        setBannerImagePositionCustom(v,);
                                                        editor.markDirty();
                                                    }}
                                                    onKeyDown={(e,) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            e.currentTarget.blur();
                                                        }
                                                    }}
                                                />
                                                <Show when={bannerImagePositionCustom() && !isValidBannerPositionCustom(bannerImagePositionCustom(),)}>
                                                    <small class="form-help-muted">Not a valid position — the banner stays centred.</small>
                                                </Show>
                                            </div>
                                        </Show>
                                        <div class="post-banner-field__layout-row">
                                            <label>Height</label>
                                            {/* Commits on blur / Enter (admin input rule). */}
                                            <input
                                                type="text"
                                                placeholder="default"
                                                maxLength={BANNER_HEIGHT_MAX}
                                                value={bannerHeight()}
                                                onBlur={(e,) => {
                                                    const v = e.currentTarget.value.trim();
                                                    if (v === bannerHeight()) return;
                                                    setBannerHeight(v,);
                                                    editor.markDirty();
                                                }}
                                                onKeyDown={(e,) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                            />
                                            <Tooltip
                                                header="Banner Height"
                                                content="Height of the banner image in every layout — Hero and Hero Full (overrides Appearance → Post header banner height), Standalone (the image is cropped to it) and Thumbnail. Any CSS height: 420px, 50vh, clamp(240px, 40vw, 520px). Leave empty for each layout's default."
                                            />
                                            <Show when={bannerHeight() && !isValidBannerHeight(bannerHeight(),)}>
                                                <small class="form-help-muted">Not a valid CSS height — the default is used.</small>
                                            </Show>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                            <div class="post-banner-field__actions">
                                <button
                                    type="button"
                                    class="ui-button ui-button--sm ui-button--secondary"
                                    onClick={() => setShowImageSelect(true,)}
                                >
                                    Select Media
                                </button>
                                <button
                                    type="button"
                                    class="btn btn--small btn--outline"
                                    onClick={() => setShowImageUpload(true,)}
                                >
                                    Upload New
                                </button>
                                <Show when={featuredImage()}>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--danger"
                                        onClick={() => { setFeaturedImage('',); editor.markDirty(); }}
                                        title="Remove banner image"
                                    >
                                        Remove
                                    </button>
                                </Show>
                            </div>
                        </div>
                        <small class="form-help">
                            Used as the top &ldquo;banner image&rdquo; on the post.
                        </small>
                    </div>
                    <div class="form-group">
                        {/* Both toggles on one row. */}
                        <div class="u-flex-row post-padding-toggles">
                            <div class="u-flex-row">
                                <Toggle
                                    checked={applyPostPadding()}
                                    onChange={(next,) => { setApplyPostPadding(next,); editor.markDirty(); }}
                                    label="Apply Post Padding"
                                />
                                <Tooltip
                                    header="Apply Post Padding"
                                    content="Apply the site's Post Padding (Settings → Appearance → Layout) to this post — primarily top/bottom. Default 0 until you set a value there."
                                />
                            </div>
                            <div class="u-flex-row">
                                <Toggle
                                    checked={applySiteGutter()}
                                    onChange={(next,) => { setApplySiteGutter(next,); editor.markDirty(); }}
                                    label="Apply Site Gutter"
                                />
                                <Tooltip
                                    header="Apply Site Gutter"
                                    content="Apply the site's Gutter (left/right padding) to this post's content. Turn off for a full-bleed post."
                                />
                            </div>
                        </div>
                    </div>
                    <div class="page-editor__header-row">
                        <div class="form-group">
                            <label>Header Style</label>
                            <div class="u-flex-row" style={{ 'align-items': 'center', gap: '6px', }}>
                                <select
                                    value={headerStyle()}
                                    onChange={(e,) => { setHeaderStyle(e.currentTarget.value,); editor.markDirty(); }}
                                >
                                    <option value="">- (use site default)</option>
                                    <option value="default">Default</option>
                                    <option value="alt">Alt</option>
                                </select>
                                <Tooltip
                                    header="Header Style"
                                    content="Which Site Header colors this post renders. '-' follows the site's 'Default Post Header Style' (Settings → Site Header). 'Default' forces the regular header colors; 'Alt' forces the alternate colors."
                                />
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Header Position</label>
                            <div class="u-flex-row" style={{ 'align-items': 'center', gap: '6px', }}>
                                <select
                                    value={headerPosition()}
                                    onChange={(e,) => { setHeaderPosition(e.currentTarget.value,); editor.markDirty(); }}
                                >
                                    <option value="">- (use site default)</option>
                                    <option value="static">Static</option>
                                    <option value="float">Float</option>
                                </select>
                                <Tooltip
                                    header="Header Position"
                                    content="How the site header sits on this post. '-' follows the site's 'Header Position' (Settings → Site Header). 'Static' renders the header at the top with the content below it; 'Float' places the header above (overlaying) the content."
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <div class="editor-properties__sidebar">
                    <FormField label="Status">
                        <select
                            value={status()}
                            onChange={(e,) => { setStatus(e.currentTarget.value,); editor.markDirty(); }}
                        >
                            <option value="draft">Draft</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="published">Published</option>
                            <option value="archived">Archived</option>
                        </select>
                    </FormField>
                    <Show when={status() === 'scheduled'}>
                        <FormField label="Publish At">
                            <input
                                type="datetime-local"
                                value={publishAt()}
                                onInput={(e,) => { setPublishAt(e.currentTarget.value,); editor.markDirty(); }}
                            />
                        </FormField>
                    </Show>
                    <FormField
                        label="Access"
                        tooltip="Public, or a subscription tier (Users → Settings → Subscriptions). A reader passes with that tier or any tier ranked above it; staff always see the full post."
                    >
                        <select
                            ref={tierSelect}
                            value={requiredTierId()}
                            onChange={(e,) => { setRequiredTierId(e.currentTarget.value,); editor.markDirty(); }}
                        >
                            <option value="">Public</option>
                            <For each={tierOptions() || []}>
                                {(t,) => <option value={t.id}>{t.name}{t.isActive ? '' : ' (inactive)'}</option>}
                            </For>
                        </select>
                    </FormField>
                    <Show when={requiredTierId()}>
                        <div style={{ 'padding-left': '0.75rem', 'border-left': '2px solid var(--admin-border)', 'margin-bottom': '1rem', display: 'flex', 'flex-direction': 'column', gap: '0.75rem', }}>
                            <Toggle
                                checked={gateHidden()}
                                onChange={(next,) => { setGateHidden(next,); editor.markDirty(); }}
                                label="Hide from non-subscribers"
                                hint="Left out of listings and 404s for anyone without this tier."
                            />
                            <Show when={!gateHidden()}>
                                <Toggle
                                    checked={gateShowSample()}
                                    onChange={(next,) => { setGateShowSample(next,); editor.markDirty(); }}
                                    label="Show a sample"
                                    hint="Non-subscribers see the start of the article and an upgrade prompt. Off: just the title, banner and the prompt."
                                />
                                <Show when={gateShowSample()}>
                                    <FormField
                                        label="Sample size"
                                        hint="Share of the article text shown (taken from the first Rich Text block; blocks above it are shown too)."
                                    >
                                        <Slider
                                            value={gateSamplePercent()}
                                            min={1}
                                            max={100}
                                            step={1}
                                            suffix="%"
                                            ariaLabel="Sample size"
                                            onCommit={(v,) => { setGateSamplePercent(v,); editor.markDirty(); }}
                                        />
                                    </FormField>
                                </Show>
                            </Show>
                        </div>
                    </Show>
                    <FormField label="Author" hint="Staff user credited as the post's author.">
                        <select
                            ref={authorSelect}
                            value={authorId()}
                            onChange={(e,) => { setAuthorId(e.currentTarget.value,); editor.markDirty(); }}
                        >
                            <option value="">—</option>
                            <For each={staffUsers() || []}>
                                {(u,) => <option value={u.id}>{u.displayName}</option>}
                            </For>
                        </select>
                    </FormField>
                </div>
            </div>
        </CollapsiblePanel>
    );

    // Vertical anchor of the banner image (mirrors Post.tsx). start=top, end=bottom.
    const previewBannerPos = () => resolveBannerPosition(bannerImagePosition(), bannerImagePositionCustom(),);
    const previewBannerHeightVar = () => {
        const h = resolveBannerHeight(bannerHeight(),);
        return h ? { '--post-banner-height': h, } : {};
    };
    // Shared post header content (back link + title + a status/excerpt meta line)
    // used inside every banner layout in the preview.
    const previewHeading = () => (
        <>
            <a class="post-page__back" href="/posts" onClick={(e,) => e.preventDefault()}>← Back to Posts</a>
            <h1 class="post-page__title">{title() || 'Untitled Post'}</h1>
            <div class="post-page__meta">
                <span>{status() === 'draft' ? 'Draft' : 'Preview'}{excerpt() ? ` — ${excerpt()}` : ''}</span>
                {/* Credits are known for the SAVED banner only (the server attaches
                    them); a newly picked image shows its credits after saving. */}
                <Show when={showPhotoCredits() && loadedMedia()?.credits && loadedMedia()?.path === featuredImage()}>
                    <span class="post-page__credits">{loadedMedia()!.credits}</span>
                </Show>
            </div>
        </>
    );

    const previewBody = (
        // Wrap in the public <Layout> so the preview shows the configured
        // site header, footer, navigation, appearance vars, swatches, and
        // fonts.
        <Layout>
            {/* Match the public Post page wrapper so scoped styles apply
                identically in preview. */}
            {/* See PageEditor — `.page-wrapper`'s hard-coded padding is
                cancelled per the post's own toggles. */}
            <div class="post-page page-wrapper" style={contentPaddingStyle('--site-post-padding', applyPostPadding(), applySiteGutter(),)}>
                <article class="post-page__article" style={{ 'max-width': 'var(--site-max-width, 800px)', margin: '0 auto', padding: '2rem 1rem', }}>
                    {/* Faithful header: Hero / Hero Full render the real banner so
                        the configured "Post Header Banner Height" (default +
                        breakpoint) is reflected in the preview, not just live. */}
                    <Switch fallback={<header class="page-header">{previewHeading()}</header>}>
                        <Match when={featuredImage() && bannerLayout() === 'hero'}>
                            <header
                                class="post-page__hero"
                                style={{
                                    'background-image': `url("${featuredImage()}")`,
                                    'background-position': previewBannerPos(),
                                    ...previewBannerHeightVar(),
                                }}
                            >
                                <div class="post-page__hero-overlay">{previewHeading()}</div>
                            </header>
                        </Match>
                        <Match when={featuredImage() && bannerLayout() === 'hero-full'}>
                            <header
                                class="post-page__hero post-page__hero--full"
                                style={{
                                    '--hero-image': `url("${featuredImage()}")`,
                                    '--hero-position': previewBannerPos(),
                                    ...previewBannerHeightVar(),
                                }}
                            >
                                <div class="post-page__hero-overlay post-page__hero-overlay--full">{previewHeading()}</div>
                            </header>
                        </Match>
                    </Switch>
                    <Show when={editor.blocks().length}>
                        <div class="u-flex-col u-gap-md">
                            <For each={editor.blocks()}>
                                {(block,) => {
                                    // Resolve style for preview
                                    const ref = block.data?.__styleRef || block.styleRef;
                                    let resolvedStyle: any = undefined;
                                    if (ref?.custom) {
                                        resolvedStyle = ref.custom;
                                    } else if (ref?.templateId) {
                                        const tmpl = BlockStyleService.getCached().find((s: any,) => s.id === ref.templateId,);
                                        resolvedStyle = tmpl || undefined;
                                    }
                                    return <PostContentBlock block={{ ...block, style: resolvedStyle, } as any} />;
                                }}
                            </For>
                        </div>
                    </Show>
                    <Show when={!editor.blocks().length}>
                        <div class="empty-state empty-state--plain">No content blocks to preview</div>
                    </Show>
                </article>
            </div>
        </Layout>
    );

    const extraModals = (
        <>
            <Show when={showImageSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        setFeaturedImage(media.url,);
                        editor.markDirty();
                        setShowImageSelect(false,);
                    }}
                    onClose={() => setShowImageSelect(false,)}
                />
            </Show>
            <Show when={showImageUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => {
                        setFeaturedImage(media.url,);
                        editor.markDirty();
                        setShowImageUpload(false,);
                    }}
                    onClose={() => setShowImageUpload(false,)}
                />
            </Show>
        </>
    );

    return (
        <EntityEditorShell
            editor={editor}
            revisionsEntityType="post"
            title={title}
            status={status}
            publicUrl={() => `/posts/${(editor.entity() as any)?.slug || slug()}`}
            previewStatus={() =>
                status() === 'published' ? 'Published' : status() === 'archived' ? 'Archived' : 'Draft'}
            rootClass={() => 'admin-full-bleed'}
            labels={{
                newHeading: 'New Post',
                editHeading: (t,) => `Edit Post: ${t || 'Untitled'}`,
                blockEditorTitle: 'Content Blocks',
                saveLabel: 'Save Post',
                deleteLabel: 'Delete Post',
                previewLabel: 'Preview Changes',
                restoreLabel: 'Un-delete Post',
                viewLabel: 'View Post ↗',
                deleteModalTitle: 'Delete Post',
                deleteModalMessage:
                    'Are you sure you want to delete this post? It will be moved to the trash and can be restored later.',
                restoreModalTitle: 'Restore Post',
                restoreModalMessage:
                    'Are you sure you want to restore this post? It will be changed back to draft status.',
            }}
            properties={properties}
            previewBody={previewBody}
            extraModals={extraModals}
        />
    );
};

export default AdminPostEditor;
