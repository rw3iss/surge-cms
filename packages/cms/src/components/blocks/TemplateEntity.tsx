import { A, } from '@solidjs/router';
import type { Campaign, Form, Media, Post, } from '@sitesurge/types';
import { Component, For, Match, Show, Switch, } from 'solid-js';
import FormRenderer from '../forms/FormRenderer';
import CampaignDetail, { type CampaignDetailOptions, } from './CampaignDetail';
import CampaignCard from './CampaignCard';

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
            <Match when={props.kind === 'form'}>
                <FormRenderer
                    form={props.data as unknown as Form}
                    inline={true}
                    title={props.options?.title as boolean | string | undefined}
                    columns={props.options?.columns as number | undefined}
                    gap={props.options?.gap as string | undefined}
                />
            </Match>
            {/* Whole campaign — the full page render (progress + form etc.). */}
            <Match when={props.kind === 'campaign'}>
                <CampaignDetail
                    campaign={props.data as unknown as Campaign}
                    options={props.options as CampaignDetailOptions | undefined}
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
                            <Show when={p.featuredImage}>
                                <img src={p.featuredImage!} alt={p.title} class="template-entity__img" />
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
