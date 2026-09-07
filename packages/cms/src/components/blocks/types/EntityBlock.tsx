/**
 * Entity block — renders a content-block template per bound record.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, EntityRecord, } from '@sitesurge/types';
import { Component, For, Show, createResource, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { buildBlockTree, } from '@sitesurge/types';
import { type TplCtx, } from './shared';
import { mapTemplateBlocks, resolveRecords, } from '../../../services/entityBinding';
import { renderEntityTemplateSlide, } from './TemplateBlock';

export const EntityBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const settings = () => (props.block.settings?.entity ?? null) as
        | import('@sitesurge/types').EntityBlockSettings
        | null;

    const [resolved] = createResource(
        () => {
            const s = settings();
            if (!s || !s.templateId || !s.entityType) return null;
            return { s, ctx: props.ctx, };
        },
        async (input) => {
            const { s, ctx, } = input;
            const tpl = await cms.contentBlockTemplates.getOne(s.entityType, s.templateId,).catch(() => null);
            if (!tpl) return { roots: [] as Block[], items: [] as Array<Record<string, unknown>>, entityType: s.entityType, };
            const recs = await resolveRecords(s.entityType, s.binding, tpl.maxRecords, ctx,);
            const roots = buildBlockTree(mapTemplateBlocks(tpl.blocks ?? [],),);
            return { roots, items: recs as Array<Record<string, unknown>>, entityType: s.entityType, };
        },
    );

    const layout = () => settings()?.layout ?? 'stack';

    return (
        <Show when={resolved()} fallback={null}>
            {(r) => {
                const renderRecord = (rec: Record<string, unknown>,) =>
                    renderEntityTemplateSlide({
                        roots: r().roots,
                        entityType: r().entityType,
                        record: rec as EntityRecord,
                        ctx: props.ctx,
                    },);
                return (
                    <Show
                        when={layout() === 'carousel' && r().items.length > 1}
                        fallback={<For each={r().items}>{(rec) => renderRecord(rec,)}</For>}
                    >
                        <div class="entity-carousel">
                            <For each={r().items}>
                                {(rec) => <div class="entity-carousel__item">{renderRecord(rec,)}</div>}
                            </For>
                        </div>
                    </Show>
                );
            }}
        </Show>
    );
};
