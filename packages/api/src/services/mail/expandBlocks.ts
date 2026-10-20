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
    bindingIdsIfStatic, isEventsBlockType, isSocialAutoFeed, resolveSocialCount, templateDataFor, templateDataIds, templateDataOf, templateRenderGroups, rendersOnce,
    slotFor, type ContentBlockTemplate, type SlotBinding, type TemplateSlotContext,
} from '@sitesurge/types';
import * as entityManager from '../../entities/entityManager';
import * as contentBlockTemplates from '../../repositories/contentBlockTemplates.repo';
import * as socialFeed from '../socialFeed';
import { logger, } from '../../utils/logger';
import { GALLERY_RESOLVED_KEY, resolveGalleryBlockItems, } from '../gallery/serverRender';
import { EVENTS_RESOLVED_KEY, resolveEventsBlockRecords, } from '../events/serverRender';
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

/** The templated keys that hold HTML (the rest are plain text). */
const HTML_SETTING_KEYS = new Set(['content', 'html',],);

/**
 * How many records a `list`/`query` binding may expand to.
 *
 * An unbounded binding in an email is a way to accidentally send a 50,000-row
 * message; the web page can scroll, an inbox cannot.
 */
const MAX_RECORDS = MAX_BINDING_RECORDS;

/**
 * Backstop on nesting depth. The real cycle guard is per-branch ANCESTRY
 * (`ExpandState.ancestry`): a template is never expanded inside itself, so a
 * self-referencing template stops at once instead of growing 2^depth copies.
 */
const MAX_DEPTH = 5;

/**
 * Who the expansion is for. Mail is the default; SSR reuses the same pass so a
 * crawler sees an entity/component block's resolved subtree.
 */
export interface ExpandOptions {
    /** Gallery read audience: `email` (public media, in-site gate ignored) or `site` (anonymous visitor). */
    audience?: 'email' | 'site';
    /** Resolve `{{ }}` in one templated setting against a record context. Defaults to the mail engine. */
    resolveText?: (text: string, context: Record<string, unknown>, opts: { html: boolean; },) => Promise<string>;
    /** Resolve auto-feed social blocks + slot-fed post lists (mail renders them; SSR does not). Default true. */
    feeds?: boolean;
    /** Size library videos after expansion (mail only). Default true. */
    videoSize?: boolean;
}

const mailResolveText: NonNullable<ExpandOptions['resolveText']> = (text, context, opts,) => resolveMailTemplate(text, context, opts,);

/** Per-`expandDynamicBlocks` call state. */
interface ExpandState {
    opts: Required<ExpandOptions>;
    /** Block ids already expanded (the source block stays in the list). */
    done: Set<string>;
    /** Block id → template ids already being expanded above it. */
    ancestry: Map<string, string[]>;
    /** Template reads, memoised for the call: one email may use a template many times. */
    templates: Map<string, Promise<LoadedTemplate>>;
}

interface LoadedTemplate {
    meta: ContentBlockTemplate | null;
    blocks: Awaited<ReturnType<typeof contentBlockTemplates.findBlocksResolved>>;
}

/** A template's meta + resolved blocks, read once per expansion call. Never throws. */
function loadTemplate(state: ExpandState, templateId: string,): Promise<LoadedTemplate> {
    let p = state.templates.get(templateId,);
    if (!p) {
        p = Promise.all([
            templateMeta(templateId,),
            contentBlockTemplates.findBlocksResolved(templateId,).catch(() => []),
        ],).then(([meta, blocks,],) => ({ meta, blocks, }));
        state.templates.set(templateId, p,);
    }
    return p;
}

/** Record the ancestry of freshly cloned blocks: their source's, plus `templateId`. */
function stampAncestry(state: ExpandState, cloned: FlatMailBlock[], sourceId: string, templateId: string,): void {
    const anc = [...(state.ancestry.get(sourceId,) ?? []), templateId,];
    for (const b of cloned) state.ancestry.set(b.id, anc,);
}

/** True (and logged) when expanding `templateId` under `blockId` would recurse. */
function isCycle(state: ExpandState, blockId: string, templateId: string,): boolean {
    if (!(state.ancestry.get(blockId,) ?? []).includes(templateId,)) return false;
    logger.warn('Mail: template references itself — not expanded', { blockId, templateId, },);
    return true;
}

/**
 * Resolve which records an entity block binds to.
 *
 * `none` and `context` both resolve to ONE empty record — render the template
 * once with nothing bound. An email has no "current page entity", and a
 * template that never references the entity (a "latest video" tout) is the
 * common case; skipping the block made it silently invisible.
 */
async function resolveRecords(cfg: EntityCfg, max = MAX_RECORDS,): Promise<Record<string, unknown>[]> {
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
    return resolveBindingRecords(type, binding as SlotBinding, max,) as Promise<Record<string, unknown>[]>;
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
    resolveText: NonNullable<ExpandOptions['resolveText']> = mailResolveText,
): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...settings, };
    for (const key of TEMPLATED_SETTING_KEYS) {
        const v = out[key];
        if (typeof v === 'string' && v.includes('{{',)) {
            // HTML fields escape interpolated values; the others are plain text the
            // block renderer escapes itself (escaping here too would double it).
            out[key] = await resolveText(v, context, { html: HTML_SETTING_KEYS.has(key,), },);
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
    /** The enclosing template's slots + the using block's bindings + the
     *  record(s) this render binds; stamped on every block that reads them
     *  (Gallery / Posts with `source: 'slot'`, Gallery `source: 'template'`). */
    slotCtx?: TemplateSlotContext | null,
    resolveText?: ExpandOptions['resolveText'],
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
                ? await resolveBlockText((b.settings ?? {}) as Record<string, unknown>, context, resolveText,)
                : ((b.settings ?? {}) as Record<string, unknown>),
            slotCtx,
        ),
        style: (b.style ?? {}) as Record<string, unknown>,
    }),),);
}

/**
 * The template's SLOTS as `{{ }}` variables for its blocks' text — the same
 * rule as the web (`useSlotVariables`): only slots a block's text mentions are
 * resolved; array slot → records, single → the record (or null); missing /
 * unfilled → [] / null.
 */
async function slotVariables(
    slotCtx: TemplateSlotContext,
    blocks: Array<{ settings?: Record<string, unknown> | null; }>,
    audience?: 'email' | 'site',
): Promise<Record<string, unknown>> {
    const text = blocks.map((b,) => JSON.stringify(b.settings ?? {},)).join(' ',);
    const out: Record<string, unknown> = {};
    if (!text.includes('{{',)) return out;
    // Component props from the using template block (`{{ props.layout }}`).
    if (slotCtx.props && Object.keys(slotCtx.props,).length && /\bprops\b/.test(text,)) out.props = slotCtx.props;
    for (const slot of slotCtx.slots ?? []) {
        const id = slot.id.replace(/[^\w-]/g, '',);
        if (!id || !new RegExp(`(^|[^\\w.])${id}\\b`,).test(text,)) continue;
        const records = await resolveSlotRecords(slotCtx, slot.id, slot.entityType, MAX_RECORDS, audience === 'email' ? { audience: 'email', } : {},);
        out[slot.id] = slot.array ? records : (records[0] ?? null);
    }
    return out;
}

/** Stamp the slot/template-data context on a block that reads it; others untouched. */
function withSlotContext(settings: Record<string, unknown>, slotCtx: TemplateSlotContext | null | undefined,): Record<string, unknown> {
    if (!slotCtx || (settings.source !== 'slot' && settings.source !== 'template')) return settings;
    return { ...settings, [SLOT_CONTEXT_KEY]: slotCtx, };
}

/** The entity type's definition (variable names), or undefined when unknown / not loaded. */
function typeDef(key: string,): ReturnType<typeof entityManager.getType> {
    try {
        return entityManager.getType(key,);
    } catch {
        return undefined;
    }
}

/** Template metadata (slots, mode, listRender). Optional: a failed read never costs the block its render. */
async function templateMeta(templateId: string,): Promise<ContentBlockTemplate | null> {
    try {
        return await contentBlockTemplates.findById(templateId,);
    } catch {
        return null;
    }
}

/** The slot context for one use of a template (its slots + the using block's bindings). */
function slotContextOf(tpl: ContentBlockTemplate | null, bindings: Record<string, SlotBinding> | undefined,): TemplateSlotContext {
    return { slots: tpl?.slots ?? [], bindings: bindings ?? {}, };
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

/** Gallery items for a block reading its template's data (`source: 'template'`). */
async function resolveTemplateGallery(settings: Record<string, unknown>, audience: 'email' | 'site' = 'email',): Promise<Record<string, unknown>> {
    const ctx = settings[SLOT_CONTEXT_KEY] as TemplateSlotContext | undefined;
    const found = templateDataFor(ctx?.templateData, 'gallery_item',);
    const ids = found.ok ? templateDataIds(found.records,) : [];
    const items = ids.length
        ? await resolveGalleryBlockItems({ ...(settings as Record<string, unknown>), source: 'items', itemIds: ids, } as never, audience,)
        : [];
    return { ...settings, [GALLERY_RESOLVED_KEY]: items, };
}

/** Gallery items for a block reading a slot (records of type `gallery_item`, in order). */
async function resolveSlotGallery(settings: Record<string, unknown>, audience: 'email' | 'site' = 'email',): Promise<Record<string, unknown>> {
    const ctx = settings[SLOT_CONTEXT_KEY] as TemplateSlotContext | undefined;
    // A `single` / `list` slot already names its items: hand the ids straight
    // to the EMAIL-audience gallery read (public media, in-site gate ignored).
    // Fetching the records first went through the site-anonymous gate and
    // dropped members-only items an items-fed gallery would show. `query`
    // still has to be resolved.
    const found = slotFor(ctx, settings.slotId as string | undefined, 'gallery_item',);
    const staticIds = found.ok ? bindingIdsIfStatic(found.binding, found.slot.array ? MAX_RECORDS : 1,) : null;
    const ids = staticIds
        // A `query` slot reads through the gallery provider with the same
        // audience hint, so it filters exactly like an items-fed gallery.
        ?? recordIds(await resolveSlotRecords(ctx, settings.slotId as string | undefined, 'gallery_item', MAX_RECORDS,
            audience === 'email' ? { audience: 'email', } : {},),);
    const items = ids.length
        ? await resolveGalleryBlockItems({ ...(settings as Record<string, unknown>), source: 'items', itemIds: ids, } as never, audience,)
        : [];
    return { ...settings, [GALLERY_RESOLVED_KEY]: items, };
}

/**
 * An Events block's records → `settings[EVENTS_RESOLVED_KEY]`: its own binding
 * (`source: 'data'`), the enclosing template's slot (`slot`, type `event`) or
 * the event record(s) the enclosing template is rendering (`template`). Read
 * as the anonymous visitor — public-view events only (SSR and email alike).
 */
async function resolveEventsBlock(settings: Record<string, unknown>, audience: 'email' | 'site' = 'email',): Promise<Record<string, unknown>> {
    const ctx = settings[SLOT_CONTEXT_KEY] as TemplateSlotContext | undefined;
    let records: unknown[] = [];
    if (settings.source === 'slot') {
        records = await resolveSlotRecords(ctx, settings.slotId as string | undefined, 'event', MAX_RECORDS, audience === 'email' ? { audience: 'email', } : {},);
    } else if (settings.source === 'template') {
        const found = templateDataFor(ctx?.templateData, 'event',);
        records = found.ok ? found.records : [];
    } else {
        records = await resolveEventsBlockRecords(settings, audience,);
    }
    return { ...settings, [EVENTS_RESOLVED_KEY]: records, };
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
    options: ExpandOptions = {},
): Promise<FlatMailBlock[]> {
    const opts: Required<ExpandOptions> = {
        audience: options.audience ?? 'email',
        resolveText: options.resolveText ?? mailResolveText,
        feeds: options.feeds ?? true,
        videoSize: options.videoSize ?? true,
    };
    // The outermost call also sizes library videos (after expansion, so a
    // video inside a component or entity template is sized too).
    const state: ExpandState = { opts, done, ancestry: new Map(), templates: new Map(), };
    if (depth === 0 && opts.videoSize) return attachVideoMediaSize(await expandPass(blocks, 0, state,),);
    return expandPass(blocks, depth, state,);
}

async function expandPass(
    blocks: FlatMailBlock[],
    depth: number,
    state: ExpandState,
): Promise<FlatMailBlock[]> {
    const { done, opts, } = state;
    if (depth >= MAX_DEPTH) {
        logger.warn('Mail: dynamic block nesting too deep — stopping expansion',);
        return blocks;
    }
    const pending = blocks.filter(
        (b,) => (b.blockType === 'entity' || b.blockType === 'template' || b.blockType === 'gallery' || isEventsBlockType(b.blockType,)
            || (opts.feeds && (b.blockType === 'social' || (b.blockType === 'post_list' && b.settings?.source === 'slot'))))
            && !done.has(b.id,),
    );
    if (pending.length === 0) return blocks;

    const out: FlatMailBlock[] = [...blocks,];

    for (const block of pending) {
        done.add(block.id,);
        try {
            if (block.blockType === 'entity') {
                const cfg = (block.settings.entity ?? {}) as EntityCfg;
                if (!cfg.templateId || isCycle(state, block.id, cfg.templateId,)) continue;
                const { meta: tpl, blocks: tplBlocks, } = await loadTemplate(state, cfg.templateId,);
                if (tplBlocks.length === 0) continue;

                // The template's own cap applies in email too (never above the inbox cap).
                const cap = Math.min(tpl?.maxRecords && tpl.maxRecords > 0 ? tpl.maxRecords : MAX_RECORDS, MAX_RECORDS,);
                const records = await resolveRecords(cfg, cap,);
                if (records.length === 0) {
                    logger.warn('Mail: entity block resolved to no records', {
                        blockId: block.id, type: cfg.entityType, mode: cfg.binding?.mode,
                    },);
                    continue;
                }

                const slots = slotContextOf(tpl, cfg.slots,);
                const slotVars = await slotVariables(slots, tplBlocks as never, opts.audience,);
                // One copy of the template per record (`each`, the default) or
                // ONE copy with every record (`once`) — the same rule the web
                // renderer uses (`templateRenderGroups`).
                const varName = cfg.entityType ?? 'entity';
                const def = cfg.entityType ? typeDef(cfg.entityType,) : undefined;
                const pluralVar = def?.pluralVar || `${varName}s`;
                const once = rendersOnce(tpl,);
                let offset = 0;
                for (const [i, group,] of templateRenderGroups(records, tpl,).entries()) {
                    const first = group[0];
                    const context: Record<string, unknown> = { ...slotVars, [varName]: first, entity: first, };
                    if (def?.singularVar && def.singularVar !== varName) context[def.singularVar] = first;
                    if (once) context[pluralVar] = group;
                    const cloned = await cloneBlocks(
                        tplBlocks as never, block.id, `${block.id}-r${i}`,
                        context, offset, { ...slots, templateData: templateDataOf(cfg.entityType, group,), }, opts.resolveText,
                    );
                    stampAncestry(state, cloned, block.id, cfg.templateId,);
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
                    out[idx] = { ...out[idx], settings: await resolveSlotGallery(out[idx].settings, opts.audience,), };
                    continue;
                }
                if (out[idx].settings.source === 'template') {
                    out[idx] = { ...out[idx], settings: await resolveTemplateGallery(out[idx].settings, opts.audience,), };
                    continue;
                }
                const items = await resolveGalleryBlockItems(block.settings as never, opts.audience,);
                out[idx] = { ...out[idx], settings: { ...out[idx].settings, [GALLERY_RESOLVED_KEY]: items, }, };
            } else if (isEventsBlockType(block.blockType,)) {
                // Not an expansion: the block's event records ride on its settings.
                const idx = out.findIndex((b,) => b.id === block.id);
                if (idx < 0) continue;
                out[idx] = { ...out[idx], settings: await resolveEventsBlock(out[idx].settings, opts.audience,), };
            } else if (block.blockType === 'post_list') {
                // Posts from the enclosing template's slot (only slot sources are pending).
                const idx = out.findIndex((b,) => b.id === block.id);
                if (idx >= 0) out[idx] = { ...out[idx], settings: await resolveSlotPosts(out[idx].settings,), };
            } else if (block.blockType === 'template') {
                const templateId = block.settings.templateId as string | undefined;
                if (!templateId || isCycle(state, block.id, templateId,)) continue;
                const { meta, blocks: tplBlocks, } = await loadTemplate(state, templateId,);
                if (tplBlocks.length === 0) continue;
                // A component binds no entity: its template data is empty.
                const slotCtx = {
                    ...slotContextOf(meta, block.settings.slots as Record<string, SlotBinding> | undefined,),
                    props: (block.settings.props ?? {}) as Record<string, string>,
                };
                // Its slots, as `{{ }}` variables for the blocks' text (none → leave text for the final pass).
                const slotVars = await slotVariables(slotCtx, tplBlocks as never, opts.audience,);
                const context = Object.keys(slotVars,).length ? slotVars : null;
                const cloned = await cloneBlocks(tplBlocks as never, block.id, `${block.id}-c`, context, 0, { ...slotCtx, templateData: null, }, opts.resolveText,);
                stampAncestry(state, cloned, block.id, templateId,);
                out.push(...cloned,);
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
    return expandPass(out, depth + 1, state,);
}
