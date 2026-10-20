/**
 * Template block — renders a reusable Component by reference, plus the shared entity-slide renderer the carousel injects.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, EntityRecord, SlotBinding, TemplateSlotContext, } from '@sitesurge/types';
import { Component, For, Show, createEffect, createResource, onCleanup, type JSX, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { mountComponentScript, } from '../../../services/componentScript';
import { useUser, } from '../../../stores/auth';
import { buildBlockTree, } from '@sitesurge/types';
import { entityVars, type EntityVars, mapTemplateBlocks, } from '../../../services/entityBinding';
import { type TplCtx, } from './shared';
import { BlockRenderer, } from '../BlockRenderer';
import { isAdminView, SlotContext, slotContextOf, withTemplateData, } from '../slotContext';
import { isTemplateCycle, TemplateAncestryContext, useTemplateAncestry, } from '../templateAncestry';
import { templateDataOf, } from '@sitesurge/types';

/**
 * Resolve once `el` has rendered children, or give up after ~1s.
 *
 * Polled per animation frame rather than derived from a signal: what matters is
 * the DOM, and no framework signal reports "the children are painted". A
 * MutationObserver would be tighter but needs the same timeout anyway, since a
 * component whose template legitimately renders nothing must not hang here.
 *
 * Giving up rather than failing is deliberate — the script still mounts, it
 * just mounts against whatever is there, which is exactly the old behaviour.
 */
async function waitForRenderedChildren(el: HTMLElement, frames = 60,): Promise<void> {
    for (let i = 0; i < frames; i++) {
        if (el.childElementCount > 0) return;
        await new Promise<void>((resolve,) => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve(),);
            else setTimeout(resolve, 16,);
        },);
    }
}

export const TemplateBlock: Component<{
    block: Block;
    ctx?: TplCtx;
    ancestry?: readonly string[];
}> = (props,) => {
    const templateId = () => (props.block.settings?.templateId as string | undefined) || '';
    // Ancestry from the context (survives groups, slides and entity templates)
    // plus the legacy prop.
    const inherited = useTemplateAncestry();
    const ancestry = () => [...inherited, ...(props.ancestry ?? []),];
    // Self-reference (direct or via a chain) would recurse forever. Detect it
    // before fetching, and say so rather than rendering nothing mysteriously.
    const isCycle = () => isTemplateCycle(ancestry(), templateId(),);

    const [tpl] = createResource(
        () => (templateId() && !isCycle() ? templateId() : null),
        async (id: string,) => {
            try {
                return await cms.components.getOne(id,);
            } catch {
                return null;
            }
        },
    );

    const roots = () => buildBlockTree(mapTemplateBlocks((tpl()?.blocks ?? []) as never,),);
    // The component's slots, filled by THIS block's `settings.slots`.
    // A component binds no entity, so its template data is empty (a block
    // inside with `source: 'template'` explains itself in the admin).
    const slotCtx = withTemplateData(slotContextOf(
        () => tpl()?.slots,
        () => props.block.settings?.slots as Record<string, SlotBinding> | undefined,
        () => props.block.settings?.props as Record<string, string> | undefined,
        // Slot DATA passed by `{{ component('x', events=list) }}` (InlineTemplate).
        () => props.block.settings?.[SLOT_VALUES_KEY] as Record<string, unknown> | undefined,
    ), null,);
    const nextAncestry = () => [...ancestry(), templateId(),];
    /** Guards the effect below against re-running on unrelated signal changes. */
    let mounted = false;

    /**
     * Mount the component's optional client module.
     *
     * Loaded as a REAL same-origin ES module rather than an inline <script>,
     * because CSP is `script-src 'self'` with no `'unsafe-inline'` — an inline
     * script, and an inline onclick, are both blocked. The endpoint always
     * returns valid JS (an empty `mount` when there is no script), so the import
     * can't throw on a healthy page.
     *
     * `ctx` hands the component the CMS SDK, the signed-in user (or null),
     * public settings, and its own block settings — which is what lets a
     * component do real work (call an endpoint, branch on auth) instead of
     * being static markup.
     */
    let mountEl: HTMLDivElement | undefined;
    const auth = useUser();
    // Mount only once the template's blocks are actually in the DOM. The
    // subtree arrives with an async fetch, so an onMount-only hook would run
    // against an empty container and every `el.querySelector` would miss.
    createEffect(() => {
        const id = templateId();
        // How many blocks this component has. NOTE: this used to read
        // `(tpl()?.blocks ?? []).length >= 0`, which is true for EVERY array
        // including an empty one — the check did nothing at all.
        const blockCount = (tpl()?.blocks ?? []).length;
        if (!id || isCycle() || !mountEl || tpl.loading || mounted) return;
        mounted = true;
        let teardown: (() => void) | undefined;
        let disposed = false;
        void (async () => {
            // Wait for the blocks to actually be IN THE DOM before handing the
            // element to the script.
            //
            // `tpl.loading` going false is not the same thing: on a client-cache
            // HIT the resource resolves in ~30ms, before Solid has rendered the
            // <For> below, so the script mounted into an empty container and the
            // render then replaced its children — the component's own UI was
            // added and removed inside the same millisecond. The first visit
            // worked only because a real network fetch left the DOM ready by
            // the time it resolved, which is why this looked like "it breaks
            // when logged in" (an admin's uncached first load vs everyone
            // else's) rather than a race.
            if (blockCount > 0) await waitForRenderedChildren(mountEl!,);
            if (disposed) return;
            const ret = await mountComponentScript({
                templateId: id,
                el: mountEl!,
                blockSettings: props.block.settings ?? {},
                user: auth.user ?? null,
            },);
            if (disposed) ret();
            else teardown = ret;
        })();
        onCleanup(() => {
            disposed = true;
            try {
                teardown?.();
            } catch { /* a failing teardown must not break unmount */ }
        },);
    },);

    return (
        <Show
            when={!isCycle()}
            fallback={
                <div class="block-message">
                    This component references itself, so it cannot be rendered here.
                </div>
            }
        >
            <Show when={templateId()} fallback={<div class="block-message">No component selected.</div>}>
                {/* The script mounts against the element WRAPPING the rendered
                    blocks, not a sibling. That's what lets it query into the
                    component's own markup (`el.querySelector('.my-thing')`) and
                    enhance it in place, rather than only being able to append
                    its own UI beside it. */}
                <Show when={!tpl.loading && tpl() === null && isAdminView()}>
                    <div class="block-message">Component not found (deleted?) — choose another in the block panel.</div>
                </Show>
                <div class="template-block__root" ref={(el,) => { mountEl = el; }}>
                <TemplateAncestryContext.Provider value={nextAncestry()}>
                <SlotContext.Provider value={slotCtx}>
                <For each={roots()}>
                    {(child,) => (
                        <Show when={child.isVisible !== false}>
                            <BlockRenderer
                                block={child}
                                templateContext={props.ctx}
                                noDefaultPadding
                                styleLayer="tpl"
                                templateAncestry={nextAncestry()}
                            />
                        </Show>
                    )}
                </For>
                </SlotContext.Provider>
                </TemplateAncestryContext.Provider>
                </div>
            </Show>
        </Show>
    );
};

/** Settings key a `{{ component(...) }}` render passes its slot DATA under. */
export const SLOT_VALUES_KEY = '__slotValues';

export function renderEntityTemplateSlide(
    args: {
        roots: Block[]; entityType: string; record: EntityRecord; ctx?: TplCtx;
        /** The template being rendered — added to the ancestry so a template
         *  that (indirectly) contains itself renders a notice, not forever. */
        templateId?: string;
        /** The type's variable names (from the template read); default names otherwise. */
        vars?: EntityVars;
        /** The template's slots + the using block's bindings. */
        slots?: TemplateSlotContext;
        /** Set when the template renders ONCE with every record (`listRender:
         *  'once'`): bound under the plural variable and handed to the blocks
         *  inside as template data. Absent = this render is `record` alone. */
        records?: EntityRecord[];
    },
): JSX.Element {
    const { singular, plural, } = args.vars ?? entityVars(args.entityType,);
    const one = { kind: args.entityType, data: args.record, id: String(args.record.id ?? ''), };
    // Same names as the template editor preview and email: the type's singular
    // and plural variables, plus the generic `entity`.
    const mergedCtx = {
        ...(args.ctx ?? {}),
        entity: one,
        [singular]: one,
        ...(args.records
            ? { [plural]: { kind: args.entityType, data: args.records as unknown as Record<string, unknown>, id: '', }, }
            : {}),
    } as TplCtx;
    const data = templateDataOf(args.entityType, args.records ?? [args.record,],);
    const parent = useTemplateAncestry();
    const ancestry = args.templateId ? [...parent, args.templateId,] : parent;
    return (
        <TemplateAncestryContext.Provider value={ancestry}>
        <SlotContext.Provider value={withTemplateData(args.slots, data,)}>
            <For each={args.roots}>
                {(child) => (
                    <Show when={child.isVisible !== false}>
                        <BlockRenderer block={child} templateContext={mergedCtx} noDefaultPadding />
                    </Show>
                )}
            </For>
        </SlotContext.Provider>
        </TemplateAncestryContext.Provider>
    );
}
