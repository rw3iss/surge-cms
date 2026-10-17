/**
 * Resolve the DYNAMIC block types before the (synchronous) mail renderer runs.
 *
 * `entity` and `template` blocks don't carry their own content — they point at
 * a row in `content_block_templates` and, for `entity`, at the record(s) to
 * bind. Resolving that needs database reads, and the mail emitter is
 * deliberately synchronous, so both types were registered as `() => ''`: an
 * email containing an entity block rendered the block as NOTHING, silently.
 *
 * Rather than make eighteen renderers async, this pass runs BEFORE them and
 * attaches the resolved subtree as the block's CHILDREN. The renderers for
 * `entity`/`template` then just emit their children, and `renderNode` wraps
 * them in the block's own styled cell exactly as it does for every other type
 * — so the block's custom styles apply without a synthetic wrapper.
 *
 * Runs in the shared path used by BOTH preview and send, so the two cannot
 * disagree about what an email contains.
 */
import {
    isSocialAutoFeed, resolveSocialCount,
    type SlotBinding, type TemplateSlotContext,
} from '@sitesurge/types';
import * as contentBlockTemplates from '../../repositories/contentBlockTemplates.repo';
import * as socialFeed from '../socialFeed';
import * as entitiesService from '../entities';
import { logger, } from '../../utils/logger';
import { GALLERY_RESOLVED_KEY, resolveGalleryBlockItems, } from '../gallery/serverRender';
import { resolveMailTemplate, } from './templateRuntime';
import { attachVideoMediaSize, } from './videoMediaSize';
import { MAX_BINDING_RECORDS, recordIds, resolveBindingRecords, resolveSlotRecords, SLOT_CONTEXT_KEY, } from '../templateSlots';

/** The flat block shape the mail renderer's tree builder consumes. */
export interface FlatMailBlock {
    id: string;
    parentBlockId: string | null;
    blockType: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

/** `settings.entity` on an `entity` block. */
interface EntityCfg {
    entityType?: string;
    templateId?: string;
    binding?: {
        mode?: 'none' | 'context' | 'single' | 'list' | 'query';
        ref?: string;
        refs?: string[];
        query?: Record<string, unknown>;
    };
    /** Fills the template's slots (slot id → binding). */
    slots?: Record<string, SlotBinding>;
}

/** Text fields that may carry `{{ }}` and must be resolved per record. */
const TEMPLATED_SETTING_KEYS = [
    'content', 'title', 'text', 'html', 'subtitle', 'description',
    'buttonText', 'buttonUrl', 'url', 'href', 'alt', 'caption',
];

/**
 * How many records a `list`/`query` binding may expand to.
 *
 * An unbounded binding in an email is a way to accidentally send a 50,000-row
 * message; the web page can scroll, an inbox cannot.
 */
const MAX_RECORDS = MAX_BINDING_RECORDS;

/** Guard against a component that includes itself, directly or via a chain. */
const MAX_DEPTH = 5;

/**
 * Resolve which records an entity block binds to.
 *
 * `none` and `context` both resolve to ONE empty record — render the template
 * once with nothing bound. An email has no "current page entity", and a
 * template that never references the entity (a "latest video" tout) is the
 * common case; skipping the block made it silently invisible.
 */
async function resolveRecords(cfg: EntityCfg,): Promise<Record<string, unknown>[]> {
    const type = cfg.entityType;
    const binding = cfg.binding ?? {};
    if (!type) return [];

    // An email has no "current page entity": `none` and `context` both
    // render the template once with nothing bound rather than skipping the
    // block — a template that doesn't use the entity (a social feed, a static
    // tout) is the common case, and rendering nothing looks like a bug.
    if (binding.mode === 'none' || binding.mode === 'context') return [{},];
    if (binding.mode !== 'single' && binding.mode !== 'list' && binding.mode !== 'query') return [];
    // The SAME resolver every slot-reading block uses (services/templateSlots).
    return resolveBindingRecords(type, binding as SlotBinding, MAX_RECORDS,) as Promise<Record<string, unknown>[]>;
}

/**
 * Resolve `{{ }}` in a template block's text fields against ONE record.
 *
 * Done here, per record, rather than in the final whole-email pass: that pass
 * has a single recipient-scoped context and could not give two entity blocks
 * different bindings, nor a `list` binding a different record per repetition.
 *
 * CONSEQUENCE, deliberately: an entity template resolves against its ENTITY,
 * not the recipient. `{{subscriber.email}}` inside one renders empty — the
 * engine blanks unresolved refs rather than preserving them. Per-recipient
 * tokens belong in the blocks around the entity block, which the final pass
 * still handles normally.
 */
async function resolveBlockText(
    settings: Record<string, unknown>,
    context: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...settings, };
    for (const key of TEMPLATED_SETTING_KEYS) {
        const v = out[key];
        if (typeof v === 'string' && v.includes('{{',)) {
            out[key] = await resolveMailTemplate(v, context,);
        }
    }
    return out;
}

/**
 * Clone a template's blocks under a new parent, re-linking nested children.
 *
 * Ids are rewritten because the same template can appear twice in one email
 * (or once per record of a list binding), and duplicate ids would collide in
 * the tree builder and in the per-block `data-block-id` responsive CSS.
 */
async function cloneBlocks(
    blocks: Array<{ id: string; parentBlockId?: string | null; blockType: string; position: number; settings?: Record<string, unknown> | null; style?: Record<string, unknown> | null; }>,
    parentId: string,
    keyPrefix: string,
    context: Record<string, unknown> | null,
    positionOffset: number,
    /** The enclosing template's slots + the using block's bindings; stamped on
     *  every slot-reading block (Gallery / Posts with `source: 'slot'`). */
    slotCtx?: TemplateSlotContext | null,
): Promise<FlatMailBlock[]> {
    const idMap = new Map<string, string>();
    for (const b of blocks) idMap.set(b.id, `${keyPrefix}-${b.id}`,);

    return Promise.all(blocks.map(async (b,) => ({
        id: idMap.get(b.id,)!,
        // A root of the cloned template hangs off the block being expanded;
        // a nested child keeps its (remapped) parent.
        parentBlockId: b.parentBlockId ? (idMap.get(b.parentBlockId,) ?? parentId) : parentId,
        blockType: b.blockType,
        position: b.parentBlockId ? b.position : positionOffset + b.position,
        settings: withSlotContext(
            context
                ? await resolveBlockText((b.settings ?? {}) as Record<string, unknown>, context,)
                : ((b.settings ?? {}) as Record<string, unknown>),
            slotCtx,
        ),
        style: (b.style ?? {}) as Record<string, unknown>,
    }),),);
}

/** Stamp the slot context on a block that reads a slot; others untouched. */
function withSlotContext(settings: Record<string, unknown>, slotCtx: TemplateSlotContext | null | undefined,): Record<string, unknown> {
    if (!slotCtx || settings.source !== 'slot') return settings;
    return { ...settings, [SLOT_CONTEXT_KEY]: slotCtx, };
}

/** The slot context for one use of template `templateId`, or null when it has no slots. */
async function slotContextFor(templateId: string, bindings: Record<string, SlotBinding> | undefined,): Promise<TemplateSlotContext | null> {
    let tpl: Awaited<ReturnType<typeof contentBlockTemplates.findById>> = null;
    try {
        tpl = await contentBlockTemplates.findById(templateId,);
    } catch {
        return null; // slots are optional; never cost the block its render
    }
    if (!tpl?.slots?.length) return null;
    return { slots: tpl.slots, bindings: bindings ?? {}, };
}

/**
 * A `post_list` block reading a slot → `settings.resolvedPosts` (what the
 * email post renderer draws). Missing / unfilled slot → an empty list, so the
 * block renders nothing (not the "View latest posts" fallback).
 */
async function resolveSlotPosts(settings: Record<string, unknown>,): Promise<Record<string, unknown>> {
    const ctx = settings[SLOT_CONTEXT_KEY] as TemplateSlotContext | undefined;
    const records = await resolveSlotRecords(ctx, settings.slotId as string | undefined, 'post',);
    const posts = records
        .map((r,) => r as Record<string, unknown>)
        // An inbox is public: never a draft.
        .filter((p,) => p.status == null || p.status === 'published')
        .map((p,) => ({
            slug: String(p.slug ?? '',),
            title: String(p.title ?? '',),
            excerpt: typeof p.excerpt === 'string' ? p.excerpt : undefined,
            featuredImage: typeof p.featuredImage === 'string' ? p.featuredImage : undefined,
        }))
        .filter((p,) => p.slug);
    return { ...settings, resolvedPosts: posts, };
}

/** Gallery items for a block reading a slot (records of type `gallery_item`, in order). */
async function resolveSlotGallery(settings: Record<string, unknown>,): Promise<Record<string, unknown>> {
    const ctx = settings[SLOT_CONTEXT_KEY] as TemplateSlotContext | undefined;
    const ids = recordIds(await resolveSlotRecords(ctx, settings.slotId as string | undefined, 'gallery_item',),);
    const items = ids.length
        ? await resolveGalleryBlockItems({ ...(settings as Record<string, unknown>), source: 'items', itemIds: ids, } as never, 'email',)
        : [];
    return { ...settings, [GALLERY_RESOLVED_KEY]: items, };
}

/**
 * Materialise an auto-feed social block's posts into `settings.items`.
 *
 * The email renderer reads pinned `items` and nothing else — it is synchronous
 * and cannot query the feed — so a block set to "latest videos" rendered as
 * NOTHING in an email while showing fine on the site. Resolving here, into the
 * exact shape `renderSocial` already consumes, means that renderer needs no
 * changes and pinned/auto-feed blocks take the same path.
 *
 * Returns the block's new settings, or null when there is nothing to do.
 */
async function resolveSocialFeed(
    block: FlatMailBlock,
): Promise<Record<string, unknown> | null> {
    const settings = block.settings;
    if (!isSocialAutoFeed(settings,)) return null;
    const platform = settings.provider as string | undefined;
    if (!platform) return null;

    const limit = resolveSocialCount(settings as never,);
    const kind = (settings.kind as string) || undefined;

    const res = await socialFeed.listPlatformPosts({
        platform: platform as never,
        page: 1,
        limit,
        sort: 'date',
        sortDir: 'desc',
        ...(kind ? { kind, } : {}),
        // An email is public; a hidden post is hidden from it too.
        includeHidden: false,
    } as never,);

    const posts = (res?.data ?? []) as unknown as Array<Record<string, unknown>>;
    if (posts.length === 0) return null;

    return {
        ...settings,
        // Exactly the shape renderSocial expects from a pinned slot.
        items: posts.slice(0, limit,).map((p,) => ({
            postId: p.externalId,
            postUrl: p.mediaUrl,
            content: p.content,
            authorName: p.authorName,
            thumbnailUrl: p.thumbnailUrl,
            // Carried so `showDate` has something to render; a pinned slot
            // saved before this existed simply has no date and shows none.
            publishedAt: p.publishedAt,
        }),),
    };
}

/**
 * Expand every `entity` / `template` block into its resolved subtree.
 *
 * Returns a NEW flat list: the original blocks (unchanged, so their styles
 * still apply) plus the resolved children parented to them.
 */
export async function expandDynamicBlocks(
    blocks: FlatMailBlock[],
    depth = 0,
    /**
     * Ids already expanded on a previous pass.
     *
     * Load-bearing: the source block STAYS in the list (it carries the style
     * and is what renders the children), so without this every pass would
     * expand it again and the email would contain the template once per pass.
     */
    done: Set<string> = new Set(),
): Promise<FlatMailBlock[]> {
    // The outermost call also sizes library videos (after expansion, so a
    // video inside a component or entity template is sized too).
    if (depth === 0) return attachVideoMediaSize(await expandPass(blocks, 0, done,),);
    return expandPass(blocks, depth, done,);
}

async function expandPass(
    blocks: FlatMailBlock[],
    depth: number,
    done: Set<string>,
): Promise<FlatMailBlock[]> {
    if (depth >= MAX_DEPTH) {
        logger.warn('Mail: dynamic block nesting too deep — stopping expansion',);
        return blocks;
    }
    const pending = blocks.filter(
        (b,) => (b.blockType === 'entity' || b.blockType === 'template' || b.blockType === 'social' || b.blockType === 'gallery'
            || (b.blockType === 'post_list' && b.settings?.source === 'slot'))
            && !done.has(b.id,),
    );
    if (pending.length === 0) return blocks;

    const out: FlatMailBlock[] = [...blocks,];

    for (const block of pending) {
        done.add(block.id,);
        try {
            if (block.blockType === 'entity') {
                const cfg = (block.settings.entity ?? {}) as EntityCfg;
                if (!cfg.templateId) continue;
                const tplBlocks = await contentBlockTemplates.findBlocksResolved(cfg.templateId,);
                if (tplBlocks.length === 0) continue;

                const records = await resolveRecords(cfg,);
                if (records.length === 0) {
                    logger.warn('Mail: entity block resolved to no records', {
                        blockId: block.id, type: cfg.entityType, mode: cfg.binding?.mode,
                    },);
                    continue;
                }

                const slotCtx = await slotContextFor(cfg.templateId, cfg.slots,);
                // One copy of the template per record — the same rule the web
                // renderer uses for a list binding.
                let offset = 0;
                for (const [i, record,] of records.entries()) {
                    const varName = cfg.entityType ?? 'entity';
                    const cloned = await cloneBlocks(
                        tplBlocks as never, block.id, `${block.id}-r${i}`,
                        { [varName]: record, entity: record, }, offset, slotCtx,
                    );
                    out.push(...cloned,);
                    offset += tplBlocks.length;
                }
            } else if (block.blockType === 'social') {
                // Not an expansion — the block stays, its settings gain the
                // resolved posts. Mutating `out` in place keeps its position.
                const resolved = await resolveSocialFeed(block,);
                if (resolved) {
                    const idx = out.findIndex((b,) => b.id === block.id);
                    if (idx >= 0) out[idx] = { ...out[idx], settings: resolved, };
                }
            } else if (block.blockType === 'gallery') {
                // Not an expansion either: the block's items (public media only —
                // the in-site gate never applies to an inbox) ride on its settings.
                const idx = out.findIndex((b,) => b.id === block.id);
                if (idx < 0) continue;
                if (out[idx].settings.source === 'slot') {
                    out[idx] = { ...out[idx], settings: await resolveSlotGallery(out[idx].settings,), };
                    continue;
                }
                const items = await resolveGalleryBlockItems(block.settings as never, 'email',);
                out[idx] = { ...out[idx], settings: { ...out[idx].settings, [GALLERY_RESOLVED_KEY]: items, }, };
            } else if (block.blockType === 'post_list') {
                // Posts from the enclosing template's slot (only slot sources are pending).
                const idx = out.findIndex((b,) => b.id === block.id);
                if (idx >= 0) out[idx] = { ...out[idx], settings: await resolveSlotPosts(out[idx].settings,), };
            } else if (block.blockType === 'template') {
                const templateId = block.settings.templateId as string | undefined;
                if (!templateId) continue;
                const tplBlocks = await contentBlockTemplates.findBlocksResolved(templateId,);
                if (tplBlocks.length === 0) continue;
                const slotCtx = await slotContextFor(templateId, block.settings.slots as Record<string, SlotBinding> | undefined,);
                out.push(...await cloneBlocks(tplBlocks as never, block.id, `${block.id}-c`, null, 0, slotCtx,),);
            }
        } catch (e) {
            // One unresolvable block must not cost the whole email.
            logger.warn('Mail: dynamic block expansion failed', {
                blockId: block.id, type: block.blockType, error: (e as Error).message,
            },);
        }
    }

    // A component can contain an entity block (and vice versa) — expand the
    // newly-added ones too, bounded by MAX_DEPTH.
    return expandPass(out, depth + 1, done,);
}
