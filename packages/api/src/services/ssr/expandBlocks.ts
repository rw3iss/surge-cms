/**
 * SSR pre-pass for the DYNAMIC block types (`entity`, `template`, `gallery`, `events`).
 *
 * The SEO emitters are synchronous, so an entity or component block used to
 * reach the crawler as a naming comment only. This runs the SAME expansion the
 * email renderer uses (`mail/expandBlocks.ts` `expandDynamicBlocks`) with the
 * anonymous-site options — gallery items read as the `site` audience, `{{ }}`
 * resolved by the SSR engine, no social/feed reads — and attaches each
 * resolved subtree as the block's CHILDREN, so `renderChildren` can walk it.
 *
 * Entity records are read through the public entity service (no `admin`), so
 * drafts, gated posts and private types never reach the SEO body.
 *
 * Never throws: on failure the input list is returned (gallery blocks then
 * render nothing, as they would with the feature off).
 */
import type { FlatMailBlock, } from '../mail/expandBlocks';
import type { SsrBlockInput, } from './blocks';
import { resolveContentForSsr, } from './templateRuntime';
import { logger, } from '../../utils/logger';

const DYNAMIC = new Set(['entity', 'template', 'gallery', 'events', 'event',],);

/** Expand the dynamic blocks of a FLAT SSR list (before `assembleSsrBlockTree`). */
export async function expandSsrDynamicBlocks(flat: SsrBlockInput[],): Promise<SsrBlockInput[]> {
    if (!flat.some((b,) => DYNAMIC.has(b.type,),)) return flat;
    const byId = new Map<string, SsrBlockInput>();
    const input: FlatMailBlock[] = flat.map((b, i,) => {
        const id = b.id ?? `ssr-${i}`;
        byId.set(id, b,);
        return {
            id,
            parentBlockId: b.parentBlockId ?? null,
            blockType: b.type,
            position: i,
            settings: { ...(b.settings ?? {}), },
            style: {},
        };
    },);
    try {
        // Lazy: the mail pass pulls in the mail runtime, which pages with no
        // dynamic block (the common case) never need at module load.
        const { expandDynamicBlocks, } = await import('../mail/expandBlocks.js');
        const out = await expandDynamicBlocks(input, 0, new Set(), {
            audience: 'site',
            feeds: false,
            videoSize: false,
            resolveText: (text, context, opts,) => resolveContentForSsr(text, context as never, opts,),
        },);
        const originals: SsrBlockInput[] = [];
        const added: Array<SsrBlockInput & { position: number; }> = [];
        for (const b of out) {
            const src = byId.get(b.id,);
            if (src) {
                // Same block, possibly with stashed gallery items on its settings.
                originals.push({ ...src, settings: b.settings, },);
                continue;
            }
            const s = b.settings ?? {};
            added.push({
                id: b.id,
                parentBlockId: b.parentBlockId,
                type: b.blockType,
                title: typeof s.title === 'string' ? s.title : null,
                content: typeof s.content === 'string' ? s.content : (typeof s.html === 'string' ? s.html : null),
                settings: s,
                position: b.position,
            },);
        }
        // Siblings in template order (the tree assembler keeps list order).
        added.sort((a, b,) => a.position - b.position);
        return [...originals, ...added.map(({ position: _p, ...rest },) => rest),];
    } catch (e) {
        logger.warn('SSR: dynamic block expansion failed', { error: (e as Error).message, },);
        return flat;
    }
}
