/**
 * `{{ template(...) }}` / `{{ component(...) }}` rendered inside templated text
 * (TemplatedContent → TemplateEntity → here).
 *
 *  - component: rendered by the real Component (`template`) block — the same
 *    scripts, props, cycle guard and style layer — with the call's slot DATA
 *    passed as `values` (read before any binding, nothing fetched).
 *  - template: the entity template's blocks rendered for the passed record (or,
 *    for a list template that renders once, all of them), exactly as the Entity
 *    block renders one record (`renderEntityTemplateSlide`).
 *
 * A failed call (`data.error`) renders nothing on the site and a one-line
 * notice in the admin. A template that would render itself is refused by the
 * shared ancestry guard.
 */
import type { Block, ContentBlockTemplateBlock, EntityRecord, TemplateRenderData, TemplateSlot, } from '@sitesurge/types';
import { buildBlockTree, COMPONENT_KIND, MAX_TEMPLATE_DEPTH, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import { mapTemplateBlocks, } from '../../services/entityBinding';
import { BlockRenderer, } from './BlockRenderer';
import { isAdminView, slotContextOf, } from './slotContext';
import { useTemplateAncestry, } from './templateAncestry';
import { renderEntityTemplateSlide, SLOT_VALUES_KEY, } from './types/TemplateBlock';

type InlineData = TemplateRenderData & {
    blocks?: ContentBlockTemplateBlock[];
    slots?: TemplateSlot[];
    singularVar?: string;
    pluralVar?: string;
    listRender?: 'each' | 'once';
    mode?: 'single' | 'list';
};

const Notice: Component<{ text: string; }> = (p,) => (
    <Show when={isAdminView()}>
        <div class="block-message">{p.text}</div>
    </Show>
);

const InlineTemplate: Component<{ kind: string; data: Record<string, unknown> | null; }> = (props,) => {
    const d = () => (props.data ?? {}) as InlineData;
    const ancestry = useTemplateAncestry();
    const tooDeep = () => ancestry.length >= MAX_TEMPLATE_DEPTH;
    const cycle = () => Boolean(d().templateId && ancestry.includes(d().templateId!,),);

    return (
        <Show when={!d().error} fallback={<Notice text={d().error ?? ''} />}>
            <Show
                when={!cycle() && !tooDeep()}
                fallback={<Notice text={`{{ ${props.kind === COMPONENT_KIND ? 'component' : 'template'}('${d().templateName ?? ''}') }}: not rendered — it would contain itself (or nests too deep).`} />}
            >
                <Show
                    when={props.kind === COMPONENT_KIND}
                    fallback={<EntityTemplateInline data={d()} />}
                >
                    <BlockRenderer
                        block={{
                            id: `inline-${d().templateId}`,
                            type: 'template',
                            isVisible: true,
                            settings: { templateId: d().templateId, props: d().props ?? {}, [SLOT_VALUES_KEY]: d().values ?? {}, },
                        } as unknown as Block}
                        noDefaultPadding
                    />
                </Show>
            </Show>
        </Show>
    );
};

/** An entity template for the passed record(s). */
const EntityTemplateInline: Component<{ data: InlineData; }> = (props,) => {
    const roots = () => buildBlockTree(mapTemplateBlocks((props.data.blocks ?? []) as never,),) as Block[];
    const once = () => props.data.mode === 'list' && props.data.listRender === 'once';
    const record = () => (props.data.record ?? {}) as EntityRecord;
    return (
        <Show
            when={props.data.record || props.data.records?.length}
            fallback={<Notice text={`{{ template('${props.data.templateName ?? ''}') }}: no record passed — e.g. template('${props.data.templateName ?? 'Name'}', item).`} />}
        >
            {renderEntityTemplateSlide({
                roots: roots(),
                entityType: props.data.entityType ?? 'entity',
                record: record(),
                templateId: props.data.templateId,
                vars: props.data.singularVar ? { singular: props.data.singularVar, plural: props.data.pluralVar ?? `${props.data.singularVar}s`, } : undefined,
                slots: slotContextOf(() => props.data.slots ?? [], () => ({}),),
                records: once() ? (props.data.records as EntityRecord[]) : undefined,
            },)}
        </Show>
    );
};

export default InlineTemplate;
