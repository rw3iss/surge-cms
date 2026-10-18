/**
 * Entity block — renders a content-block template per bound record (or ONCE
 * with every record when the list template's `listRender` is `once`).
 *
 * Resolution goes through `resolveEntityTemplate` (services/entityBinding.ts),
 * the same resolver carousel entity items use, so the two cannot drift.
 */
import type { Block, EntityBlockSettings, EntityRecord, TemplateSlotContext, } from '@sitesurge/types';
import { Component, For, Show, createResource, } from 'solid-js';
import { resolveEntityTemplate, } from '../../../services/entityBinding';
import { type TplCtx, } from './shared';
import { renderEntityTemplateSlide, } from './TemplateBlock';
import { isAdminView, slotContextOf, } from '../slotContext';
import { isTemplateCycle, useTemplateAncestry, } from '../templateAncestry';
import HeroCarousel, { type HeroSlide, } from '../HeroCarousel';

export const EntityBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const settings = () => (props.block.settings?.entity ?? null) as EntityBlockSettings | null;
    const ancestry = useTemplateAncestry();
    const isCycle = () => isTemplateCycle(ancestry, settings()?.templateId,);

    // The source is a PRIMITIVE key of only what the fetch reads (template, type,
    // binding — read deeply, since the admin preview patches settings in place)
    // plus the route context. A layout / slot / style edit leaves the key equal,
    // so Solid does not refetch the template and records for it.
    const [resolved,] = createResource(
        () => {
            const s = settings();
            if (!s || !s.templateId || !s.entityType || isCycle()) return null;
            // A `context` binding reads the route entity, so its id is part of the key.
            const ctxKey = (s.binding?.mode ?? 'context') === 'context'
                ? Object.entries(props.ctx ?? {},).map(([k, v,],) => `${k}:${v?.id ?? ''}`,).join('|',)
                : '';
            return JSON.stringify([s.templateId, s.entityType, s.binding ?? null, ctxKey,],);
        },
        async (key: string,) => {
            const [templateId, entityType, binding,] = JSON.parse(key,) as [string, string, EntityBlockSettings['binding'] | null,];
            return resolveEntityTemplate({ templateId, entityType, binding, }, props.ctx,);
        },
    );

    // This block's `settings.entity.slots`, read through accessors so a changed
    // binding reaches the slot-reading blocks inside (they re-resolve on it).
    const slotCtx: TemplateSlotContext = slotContextOf(
        () => resolved.latest?.tplSlots,
        () => settings()?.slots,
    );

    const layout = () => settings()?.layout ?? 'stack';

    return (
        <Show
            when={!isCycle()}
            fallback={
                <Show when={isAdminView()}>
                    <div class="block-message">This template references itself, so it cannot be rendered here.</div>
                </Show>
            }
        >
            <Show when={resolved.latest} fallback={null}>
                {(r,) => {
                    const renderGroup = (group: EntityRecord[],) =>
                        renderEntityTemplateSlide({
                            roots: r().roots,
                            entityType: r().entityType,
                            templateId: r().templateId,
                            vars: r().vars,
                            record: group[0]!,
                            ctx: props.ctx,
                            slots: slotCtx,
                            records: r().once ? group : undefined,
                        },);
                    const slides = (): HeroSlide[] => r().groups.map((g, i,) => ({
                        id: `${props.block.id}:${String(g[0]?.id ?? i,)}`,
                        type: 'entity',
                        order: i,
                        contentNode: renderGroup(g,),
                    } as HeroSlide));
                    return (
                        <Show
                            when={r().found}
                            fallback={
                                <Show when={isAdminView()}>
                                    <div class="block-message">
                                        Template not found (deleted?) — choose another in the block panel.
                                    </div>
                                </Show>
                            }
                        >
                            <Show
                                when={layout() === 'carousel' && r().groups.length > 1}
                                fallback={<For each={r().groups}>{(g,) => renderGroup(g,)}</For>}
                            >
                                {/* A real carousel (arrows, dots, paging, swipe) — the
                                    same presentational component the carousel block uses. */}
                                <div class="entity-carousel">
                                    <HeroCarousel
                                        items={slides()}
                                        height="auto"
                                        options={{
                                            autoScroll: false,
                                            autoScrollInterval: 5000,
                                            repeat: false,
                                            customHeight: false,
                                            height: '',
                                            itemsPerPage: Math.max(1, settings()?.carouselPerPage ?? 3,),
                                            scrollBy: 1,
                                            itemGap: settings()?.carouselGap || '16px',
                                            sidePadding: '48px',
                                            dotColor: 'var(--site-text-muted, #6b7280)',
                                        }}
                                    />
                                </div>
                            </Show>
                        </Show>
                    );
                }}
            </Show>
        </Show>
    );
};
