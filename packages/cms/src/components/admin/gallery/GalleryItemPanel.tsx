/**
 * Gallery admin → the selected item's options (a side panel). Every change
 * goes into the page's DRAFT via `onChange`; nothing saves until Publish.
 * Text fields commit on blur / Enter (project rule).
 */
import type { SubscriptionTierOption, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { createSignal, For, Show, } from 'solid-js';
import { openMediaViewer, } from '../../../stores/mediaViewer';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import CommitInput from './CommitInput';
import { formatSize, } from '../media/mediaUtils';
import { displayTitle, type DraftItem, type DraftOptions, } from './galleryDraft';

export interface GalleryDefaults {
    /** "Public" / "Signed-in members" / "Gold subscribers" — the gallery's access, for "Inherit (…)". */
    accessLabel: string;
    commentsEnabled: boolean;
    allowAnonymousComments: boolean;
}

export interface GalleryItemPanelProps {
    item: DraftItem;
    defaults: GalleryDefaults;
    tiers: SubscriptionTierOption[];
    /** The Comments feature is on (comment options are shown only then). */
    commentsOn: boolean;
    onChange: (patch: Partial<DraftOptions>,) => void;
    onRemove: () => void;
    onRestore: () => void;
    onDeleteMediaChange: (v: boolean,) => void;
    onClose: () => void;
}

/** Tags as chips: Enter or comma adds, × removes. */
function TagsInput(p: { value: string[]; onChange: (tags: string[],) => void; },) {
    const [text, setText,] = createSignal('',);
    const add = () => {
        const fresh = text().split(',',).map((t,) => t.trim().toLowerCase()).filter(Boolean,).filter((t,) => !p.value.includes(t,),);
        setText('',);
        if (fresh.length) p.onChange([...p.value, ...fresh,],);
    };
    return (
        <div class="gallery-tags">
            <For each={p.value}>
                {(t,) => (
                    <span class="gallery-tags__chip">
                        {t}
                        <button type="button" aria-label={`Remove tag ${t}`} onClick={() => p.onChange(p.value.filter((x,) => x !== t,),)}>&times;</button>
                    </span>
                )}
            </For>
            <input
                class="gallery-tags__input"
                type="text"
                placeholder={p.value.length ? 'Add tag' : 'Add tags (Enter or comma)'}
                value={text()}
                onInput={(e,) => {
                    const v = e.currentTarget.value;
                    if (v.includes(',',)) { setText(v,); add(); } else setText(v,);
                }}
                onKeyDown={(e,) => {
                    if (e.key === 'Enter') { e.preventDefault(); add(); }
                    if (e.key === 'Backspace' && !text() && p.value.length) p.onChange(p.value.slice(0, -1,),);
                }}
                onBlur={add}
            />
        </div>
    );
}

const SWITCH_LABELS = { inherit: 'Inherit', on: 'On', off: 'Off', } as const;
const onOff = (b: boolean,) => (b ? 'on' : 'off');

export default function GalleryItemPanel(props: GalleryItemPanelProps,) {
    const o = () => props.item.options;
    const media = () => props.item.media;
    const dims = () => (media()?.width && media()?.height ? `${media()!.width} × ${media()!.height}` : '');

    return (
        <aside class="gallery-panel" aria-label="Item options">
            <div class="gallery-panel__head">
                <h3 title={displayTitle(props.item,)}>{displayTitle(props.item,)}</h3>
                <button type="button" class="gallery-panel__close" aria-label="Close options" onClick={props.onClose}>&times;</button>
            </div>

            <Show when={props.item.removed}>
                <div class="alert alert--warning gallery-panel__removed">
                    <p>This item is removed when you publish.</p>
                    <Toggle
                        checked={Boolean(props.item.deleteMedia,)}
                        onChange={props.onDeleteMediaChange}
                        label="Also delete the media from the library"
                        disabled={!props.item.id || !media()}
                    />
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onRestore}>Undo remove</button>
                </div>
            </Show>

            <div class="gallery-panel__media">
                <Show when={props.item.file}>
                    <p class="gallery-panel__pending">Pending upload — {props.item.file!.name} ({formatSize(props.item.file!.size,)})</p>
                </Show>
                <Show when={media()} fallback={<Show when={!props.item.file}><p class="gallery-panel__missing">The media for this item was deleted from the library. Remove the item.</p></Show>}>
                    <dl class="gallery-panel__facts">
                        <dt>Type</dt><dd>{media()!.type === 'video' ? 'Video' : 'Image'} · {media()!.mimeType}</dd>
                        <Show when={dims()}><dt>Size</dt><dd>{dims()}</dd></Show>
                        <Show when={media()!.accessLevel === 'private'}><dt>Media</dt><dd>Private (full video for permitted viewers only)</dd></Show>
                        <Show when={media()!.status !== 'ready'}><dt>Status</dt><dd>{media()!.status} — shown once ready</dd></Show>
                    </dl>
                    <div class="gallery-panel__links">
                        <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => openMediaViewer({ ...media()!, id: media()!.id, url: media()!.url, } as never,)}>
                            View media
                        </button>
                        <Show when={props.item.id && props.item.url}>
                            <a class="ui-button ui-button--ghost ui-button--sm" href={props.item.url} target="_blank" rel="noopener">View public page ↗</a>
                        </Show>
                    </div>
                </Show>
            </div>

            <FormField label="Title" hint="Empty = the media's title.">
                <CommitInput value={o().titleOverride} placeholder={media()?.title || props.item.file?.name || ''} onCommit={(v,) => props.onChange({ titleOverride: v, },)} />
            </FormField>
            <FormField label="Caption" hint="Empty = the media's description.">
                <CommitInput multiline value={o().captionOverride} placeholder={media()?.caption || ''} onCommit={(v,) => props.onChange({ captionOverride: v, },)} />
            </FormField>
            <FormField label="Tags" tooltip="Used to query items: the Gallery block, {{gallery(tag='…')}} and the SDK.">
                <TagsInput value={o().tags} onChange={(tags,) => props.onChange({ tags, },)} />
            </FormField>

            <FormField label="Visibility" tooltip="Who may see this item on the site. Email and other public uses show the media whenever the MEDIA itself is public.">
                <select value={o().visibility} onChange={(e,) => props.onChange({ visibility: e.currentTarget.value as DraftOptions['visibility'], },)}>
                    <option value="inherit">Inherit ({props.defaults.accessLabel})</option>
                    <option value="public">Public</option>
                    <option value="members">Signed-in members</option>
                    <option value="tier" disabled={!props.tiers.length}>Subscription tier…</option>
                </select>
            </FormField>
            <Show when={o().visibility === 'tier'}>
                <FormField label="Required tier" hint="Subscribers to this tier or a higher one.">
                    <select value={o().minTierId ?? ''} onChange={(e,) => props.onChange({ minTierId: e.currentTarget.value || null, },)}>
                        <option value="">Choose a tier…</option>
                        <For each={props.tiers}>{(t,) => <option value={t.id}>{t.name}</option>}</For>
                    </select>
                </FormField>
            </Show>

            <Show
                when={props.commentsOn}
                fallback={<p class="form-help-muted">Commenting needs the Comments feature (<A href="/admin/settings?tab=general#features">Settings → Features</A>).</p>}
            >
                <FormField label="Comments" tooltip="Inherit follows the gallery setting.">
                    <select value={o().comments} onChange={(e,) => props.onChange({ comments: e.currentTarget.value as DraftOptions['comments'], },)}>
                        <option value="inherit">Inherit ({SWITCH_LABELS[onOff(props.defaults.commentsEnabled,)]})</option>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                    </select>
                </FormField>
                <FormField label="Anonymous comments" tooltip="Guests still need the 'Comment without an account' permission; Comments settings decide approval.">
                    <select value={o().anonymousComments} onChange={(e,) => props.onChange({ anonymousComments: e.currentTarget.value as DraftOptions['anonymousComments'], },)}>
                        <option value="inherit">Inherit ({SWITCH_LABELS[onOff(props.defaults.allowAnonymousComments,)]})</option>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                    </select>
                </FormField>
                <Show when={props.item.id}>
                    <p class="gallery-panel__comments">
                        {props.item.commentCount ?? 0} comment{(props.item.commentCount ?? 0) === 1 ? '' : 's'} ·{' '}
                        <A href={`/admin/comments?target=gallery_item:${props.item.id}`}>Moderate</A>
                    </p>
                </Show>
            </Show>

            <Show when={!props.item.removed}>
                <div class="gallery-panel__foot">
                    <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={props.onRemove}>Remove from gallery</button>
                </div>
            </Show>
        </aside>
    );
}
