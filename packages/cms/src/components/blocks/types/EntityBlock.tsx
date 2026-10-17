/**
 * Entity block — renders a content-block template per bound record (or ONCE
 * with every record when the list template's `listRender` is `once`).
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, ContentBlockTemplate, EntityRecord, TemplateSlot, TemplateSlotContext, } from '@sitesurge/types';
import { rendersOnce, templateRenderGroups, } from '@sitesurge/types';
import { Component, For, Show, createResource, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { buildBlockTree, } from '@sitesurge/types';
import { type TplCtx, } from './shared';
import { mapTemplateBlocks, resolveRecords, } from '../../../services/entityBinding';
import { renderEntityTemplateSlide, } from './TemplateBlock';
import { slotContextOf, } from '../slotContext';

export const EntityBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const settings = () => (props.block.settings?.entity ?? null) as
        | import('@sitesurge/types').EntityBlockSettings
        | null;

    const [resolved] = createResource(
        () => {
            const s = settings();
            if (!s || !s.templateId || !s.entityType) return null;
            // Read the binding DEEPLY: the admin preview patches settings in
            // place (a reconciled store), so the `entity` object keeps its
            // identity when only the data source / records change — keying on
            // it alone left the block on its old (empty) records until reload.
            const key = JSON.stringify([s.templateId, s.entityType, s.binding ?? null,],);
            return { s: { ...s, binding: s.binding ? JSON.parse(JSON.stringify(s.binding,),) : s.binding, }, ctx: props.ctx, key, };
        },
        async (input) => {
            const { s, ctx, } = input;
            const tpl = await cms.contentBlockTemplates.getOne(s.entityType, s.templateId,).catch(() => null);
            if (!tpl) return { roots: [] as Block[], groups: [] as EntityRecord[][], once: false, entityType: s.entityType, tplSlots: [] as TemplateSlot[], };
            const recs = await resolveRecords(s.entityType, s.binding, tpl.maxRecords, ctx,);
            const roots = buildBlockTree(mapTemplateBlocks(tpl.blocks ?? [],),);
            // The template's slot DEFINITIONS come with the template; the
            // bindings are read LIVE below, so setting a slot's data in the
            // panel re-renders without refetching the template.
            // `each` (default): one render per record. `once` (list template):
            // ONE render with every record (plural var + template data).
            const meta = tpl as ContentBlockTemplate;
            return { roots, groups: templateRenderGroups(recs, meta,), once: rendersOnce(meta,), entityType: s.entityType, tplSlots: tpl.slots ?? [], };
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
        <Show when={resolved()} fallback={null}>
            {(r) => {
                const renderGroup = (group: EntityRecord[],) =>
                    renderEntityTemplateSlide({
                        roots: r().roots,
                        entityType: r().entityType,
                        record: group[0]!,
                        ctx: props.ctx,
                        slots: slotCtx,
                        records: r().once ? group : undefined,
                    },);
                return (
                    <Show
                        when={layout() === 'carousel' && r().groups.length > 1}
                        fallback={<For each={r().groups}>{(g) => renderGroup(g,)}</For>}
                    >
                        <div class="entity-carousel">
                            <For each={r().groups}>
                                {(g) => <div class="entity-carousel__item">{renderGroup(g,)}</div>}
                            </For>
                        </div>
                    </Show>
                );
            }}
        </Show>
    );
};
