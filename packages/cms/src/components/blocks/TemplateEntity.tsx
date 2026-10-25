import {
    DISCUSSION_LIST_KIND, type DiscussionItem, EVENT_KIND, EVENT_LIST_KIND, eventDisplayFrom, FORUM_THREAD_KIND, featuredImagePath, GALLERY_ITEM_KIND, GALLERY_LIST_KIND, galleryDisplayFrom,
    type GalleryItem, COMPONENT_KIND, TEMPLATE_KIND,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import type { Campaign, Form, Media, Post, } from '@sitesurge/types';
import { Component, For, lazy, Match, Show, Switch, } from 'solid-js';
import DiscussionList from '../discussions/DiscussionList';
import EventCard from '../events/EventCard';
import InlineTemplate from './InlineTemplate';
import EventCardList from '../events/EventCardList';
import type { EventCardRecord, } from '../events/eventsLayout';
import GalleryView from '../gallery/GalleryView';
import MediaVideo from './media/MediaVideo';
import FormRenderer from '../forms/FormRenderer';
import CampaignDetail, { type CampaignDetailOptions, } from './CampaignDetail';
import CampaignCard from './CampaignCard';
import CampaignForm, { type CampaignFormOptions, } from './CampaignForm';
import CampaignStatus, { type CampaignStatusOptions, } from './CampaignStatus';
// Membership cards + the apply flow (Stripe, forms) load only when used.
const MembershipLevels = lazy(() => import('../membership/MembershipLevels'),);

/** Default renderer for a whole entity of a CUSTOM type (no bespoke component):
 *  a title + its scalar string fields. Used when a `{{recipe('id')}}`-style
 *  whole-entity ref has no dedicated card. */
const GenericEntityCard: Component<{ kind: string; data: Record<string, unknown>; }> = (props,) => {
    const title = () =>
        String(props.data.title ?? props.data.name ?? props.data.slug ?? '',);
    const fields = () =>
        Object.entries(props.data,)
            .filter(([k, v],) =>
                typeof v === 'string' && v && !['id', 'slug', 'title', 'name', 'status'].includes(k,)
            )
            .slice(0, 6,) as [string, string][];
    return (
        <div class={`template-entity template-entity--${props.kind}`}>
            <Show when={title()}>
                <h3 class="template-entity__title">{title()}</h3>
            </Show>
            <For each={fields()}>
                {([, v],) => <p class="template-entity__desc">{v}</p>}
            </For>
        </div>
    );
};

/**
 * Renders a WHOLE entity in place — used when a template references an entity
 * with no trailing property (`{{form(id)}}`, `{{post(id)}}`, `{{campaign(id)}}`).
 * Forms reuse the real `FormRenderer` (interactive); posts/campaigns/media render
 * a self-contained card/media element. A null entity (not found) renders nothing.
 */
const TemplateEntity: Component<{
    kind: string;
    data: Record<string, unknown> | null;
    /** Keyword-arg render options, e.g. `{{form(id, title=false, columns=2)}}`. */
    options?: Record<string, unknown>;
}> = (props,) => (
    <Show when={props.data} fallback={null}>
        <Switch fallback={<GenericEntityCard kind={props.kind} data={props.data!} />}>
            {/* `{{ template('Product Card', p) }}` / `{{ component('Upcoming Events', events=list) }}`. */}
            <Match when={props.kind === TEMPLATE_KIND || props.kind === COMPONENT_KIND}>
                <InlineTemplate kind={props.kind} data={props.data} />
            </Match>
            {/* Discovery lists (`{{ hotThreads(5) }}`) + one forum thread. */}
            <Match when={props.kind === DISCUSSION_LIST_KIND}>
                <DiscussionList items={(props.data as unknown as DiscussionItem[]) ?? []} excerpts={props.options?.excerpts !== false} />
            </Match>
            <Match when={props.kind === FORUM_THREAD_KIND}>
                <DiscussionList items={[{ kind: 'thread', ...props.data, } as unknown as DiscussionItem,]} excerpts={props.options?.excerpts !== false} />
            </Match>
            {/* `{{events(...)}}` — event cards in a grid / column; `{{event('x')}}` — one card. Render options = the call's named args. */}
            <Match when={props.kind === EVENT_LIST_KIND}>
                {(() => {
                    const o = eventDisplayFrom(props.options,);
                    return (
                        <EventCardList
                            events={(props.data as unknown as EventCardRecord[]) ?? []}
                            layout={o.layout}
                            display={o}
                            columns={o.columns}
                            gap={o.gap}
                        />
                    );
                })()}
            </Match>
            <Match when={props.kind === EVENT_KIND}>
                <EventCard event={props.data as EventCardRecord} display={eventDisplayFrom(props.options,)} class="event-card--template" />
            </Match>
            {/* `{{gallery(...)}}` — a list through the shared GalleryView (render options = the call's named args), or one item's media. */}
            <Match when={props.kind === GALLERY_LIST_KIND}>
                <GalleryView items={(props.data as unknown as GalleryItem[]) ?? []} settings={galleryDisplayFrom(props.options,)} videoBadge />
            </Match>
            <Match when={props.kind === GALLERY_ITEM_KIND}>
                {(() => {
                    const item = props.data as unknown as GalleryItem;
                    return (
                        <Show when={item.media}>
                            {(m,) => (
                                <figure class="template-entity template-entity--gallery-item">
                                    <Show when={m().type === 'video'} fallback={<img src={m().url} alt={m().alt || item.title || ''} loading="lazy" />}>
                                        <MediaVideo mediaId={m().id} fallbackSrc={m().url} />
                                    </Show>
                                    <Show when={props.options?.caption !== false && (item.caption || props.options?.title === true)}>
                                        <figcaption>
                                            <Show when={props.options?.title === true}><strong>{item.title}</strong> </Show>
                                            {item.caption}
                                        </figcaption>
                                    </Show>
                                </figure>
                            )}
                        </Show>
                    );
                })()}
            </Match>
            {/* `{{ membershipLevels(levels='a,b') }}` — those levels as /subscribe-style cards (apply in place). */}
            <Match when={props.kind === 'membershipLevels'}>
                <MembershipLevels levels={((props.data?.levels as string[] | undefined) ?? [])} />
            </Match>
            <Match when={props.kind === 'form'}>
                <FormRenderer
                    form={props.data as unknown as Form}
                    inline={true}
                    title={props.options?.title as boolean | string | undefined}
                    columns={props.options?.columns as number | undefined}
                    gap={props.options?.gap as string | undefined}
                    submitLabel={typeof props.options?.submitLabel === 'string' ? props.options.submitLabel : undefined}
                />
            </Match>
            {/* Whole campaign — the full page render (progress + form etc.). */}
            <Match when={props.kind === 'campaign'}>
                <CampaignDetail
                    campaign={props.data as unknown as Campaign}
                    options={props.options as CampaignDetailOptions | undefined}
                />
            </Match>
            {/* The campaign's status panel alone: raised/goal + Recent Donors. */}
            <Match when={props.kind === 'campaignStatus'}>
                <CampaignStatus
                    campaign={props.data as unknown as Campaign}
                    options={props.options as CampaignStatusOptions | undefined}
                />
            </Match>
            {/* The donation form alone (text fields opt-in). */}
            <Match when={props.kind === 'campaignForm'}>
                <CampaignForm
                    campaign={props.data as unknown as Campaign}
                    options={props.options as CampaignFormOptions | undefined}
                />
            </Match>
            {/* Campaign teaser/link — the same card the `campaign` content block shows. */}
            <Match when={props.kind === 'campaignLink'}>
                <CampaignCard campaign={props.data as unknown as Campaign} />
            </Match>
            <Match when={props.kind === 'post'}>
                {(() => {
                    const p = props.data as unknown as Post;
                    return (
                        <A href={`/posts/${p.slug}`} class="template-entity template-entity--post">
                            <Show when={featuredImagePath(p)}>
                                <img src={featuredImagePath(p)} alt={p.title} class="template-entity__img" />
                            </Show>
                            <h3 class="template-entity__title">{p.title}</h3>
                            <Show when={p.excerpt}>
                                <p class="template-entity__desc">{p.excerpt}</p>
                            </Show>
                        </A>
                    );
                })()}
            </Match>
            <Match when={props.kind === 'media'}>
                {(() => {
                    const m = props.data as unknown as Media;
                    return (
                        <Show
                            when={(m.mimeType || '').startsWith('video')}
                            fallback={<img class="template-entity template-entity--media" src={m.url} alt={m.alt ?? ''} />}
                        >
                            <video class="template-entity template-entity--media" src={m.url} controls />
                        </Show>
                    );
                })()}
            </Match>
            <Match when={props.kind === 'page'}>
                {(() => {
                    const pg = props.data as unknown as { slug: string; title: string; };
                    return <A href={`/${pg.slug}`} class="template-entity template-entity--page">{pg.title}</A>;
                })()}
            </Match>
            <Match when={props.kind === 'user'}>
                <span class="template-entity template-entity--user">
                    {(props.data as { displayName?: string; name?: string; }).displayName
                        ?? (props.data as { name?: string; }).name}
                </span>
            </Match>
        </Switch>
    </Show>
);

export default TemplateEntity;
