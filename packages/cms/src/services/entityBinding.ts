/**
 * Data binding for the `entity` block: resolve a block's `EntityBinding` into
 * the entity record(s) to render, and map a content-block-template's flat block
 * list into the `Block` tree the renderer expects.
 *
 * List templates render the subtree ONCE PER resolved record (each with the
 * singular variable bound) — the pattern shared with carousels/cards.
 */
import type {
    Block,
    ContentBlockTemplate,
    ContentBlockTemplateBlock,
    EntityBinding,
    EntityRecord,
    TemplateSlot,
} from '@sitesurge/types';
import { bindingQueryLimit, buildBlockTree, rendersOnce, templateRenderGroups, } from '@sitesurge/types';
import { cms, } from './cmsClient';

/** Template-context bag shape (mirrors RuntimeOptions['entities']). */
export type TplEntities = Record<string, { kind: string; data: Record<string, unknown> | null; id?: string; } | null>;

export interface EntityVars { singular: string; plural: string; }

/**
 * Singular/plural template variable names for an entity type. The template
 * read carries the type's real `singularVar` / `pluralVar` (pass it as `tpl`);
 * without one this falls back to the default names (`type` / `types`).
 */
export function entityVars(
    entityType: string,
    tpl?: Pick<ContentBlockTemplate, 'singularVar' | 'pluralVar'> | null,
): EntityVars {
    return { singular: tpl?.singularVar || entityType, plural: tpl?.pluralVar || `${entityType}s`, };
}

/**
 * Entity-block reads bypass the per-browser SWR cache.
 *
 * An `entity` block bound to a query ("the newest published post") is a LIVE
 * view of the database, and it is frequently the most prominent thing on a
 * page — a featured-article tout, a product carousel. Serving it from a cache
 * held in one visitor's localStorage means the correctness of the front page
 * depends on when that particular browser last happened to refetch, which no
 * writer can influence: publishing a post clears the cache of the browser that
 * published it and of nobody else. That is how a homepage came to show an
 * article that had been superseded a day earlier.
 *
 * This is not the same as "uncached". The server caches the identical read in
 * Redis for the entity type's `indexTtlSeconds`, and that cache IS dropped by
 * every writer, so the cost here is one conditional round trip to an in-memory
 * store — while the freshness guarantee becomes global instead of per-browser.
 */
const LIVE: { cache: false; } = { cache: false, };

async function getOne(entityType: string, ref: string,): Promise<EntityRecord | null> {
    try {
        return await cms.entities.getOne(entityType, ref, LIVE,);
    } catch {
        return null;
    }
}

/** Query limit for a binding — the shared rule (`@sitesurge/types`), same as email. */
export { bindingQueryLimit, } from '@sitesurge/types';

/**
 * Records for `refs`, in `refs` order, with ONE list request (`id in refs`)
 * instead of one request per record. A ref the list did not return (a slug, or
 * a type whose data provider ignores the id filter) falls back to a single read.
 */
export async function fetchRecordsByRefs(entityType: string, refs: string[],): Promise<EntityRecord[]> {
    if (refs.length === 0) return [];
    const byId = new Map<string, EntityRecord>();
    try {
        const res = await cms.entities.list(entityType, {
            filter: { id: { op: 'in', value: refs, }, },
            limit: Math.min(200, refs.length,),
        } as never, LIVE,);
        for (const r of (res.data ?? []) as EntityRecord[]) byId.set(String(r.id,), r,);
    } catch { /* fall back to single reads below */ }
    const out = await Promise.all(refs.map(async (ref,) => byId.get(ref,) ?? await getOne(entityType, ref,)),);
    return out.filter((r,): r is EntityRecord => r !== null);
}

/**
 * Resolve the records a binding points at (already capped at `maxRecords`).
 * `ctx` supplies the current route entity for `context` binding; `vars` the
 * type's variable names (the context entity is looked up under them).
 */
export async function resolveRecords(
    entityType: string,
    binding: EntityBinding,
    maxRecords: number | null | undefined,
    ctx: TplEntities | undefined,
    vars: EntityVars = entityVars(entityType,),
): Promise<EntityRecord[]> {
    const cap = (arr: EntityRecord[],) => (maxRecords && maxRecords > 0 ? arr.slice(0, maxRecords,) : arr);
    try {
        switch (binding.mode) {
            // Render the template once with nothing bound.
            case 'none':
                return [{} as EntityRecord,];
            case 'context': {
                const wrapped = ctx?.[vars.singular] ?? ctx?.[entityType];
                if (wrapped?.data) return [wrapped.data as EntityRecord,];
                // No current-page entity — a mail template, a standalone
                // template preview, a generic page. Render the template ONCE
                // with nothing bound rather than nothing at all: a template
                // that doesn't use the entity (a social feed, a static tout)
                // then works, and one that does shows its structure with empty
                // values, which is debuggable. Rendering nothing looked
                // identical to a broken block.
                return [{} as EntityRecord,];
            }
            case 'single': {
                const rec = binding.ref ? await getOne(entityType, binding.ref,) : null;
                return rec ? [rec,] : [];
            }
            case 'list': {
                // Cap BEFORE fetching — a 20-record pick capped at 4 fetches 4.
                const refs = (binding.refs ?? []).filter(Boolean,);
                return await fetchRecordsByRefs(entityType, maxRecords && maxRecords > 0 ? refs.slice(0, maxRecords,) : refs,);
            }
            case 'query': {
                const res = await cms.entities.list(entityType, {
                    ...binding.query,
                    // The query's own limit wins when it is lower than the template's cap.
                    limit: bindingQueryLimit(maxRecords, binding.query?.limit,),
                } as never, LIVE,);
                return cap((res.data ?? []) as EntityRecord[],);
            }
            default:
                return [];
        }
    } catch {
        return [];
    }
}

/** A template resolved for one binding: everything a renderer needs. */
export interface ResolvedEntityTemplate {
    /** False when the template does not exist (deleted?) or failed to load. */
    found: boolean;
    templateId: string;
    entityType: string;
    roots: Block[];
    /** One entry per render: `[record]` each, or `[all]` for a `once` list template. */
    groups: EntityRecord[][];
    once: boolean;
    tplSlots: TemplateSlot[];
    vars: EntityVars;
}

/**
 * THE one "render an entity template for a binding" resolver — used by the
 * `entity` block and by carousel entity items, so the two cannot drift (they
 * had: different limits, different variable names, frozen vs live slots).
 * Never throws.
 */
export async function resolveEntityTemplate(
    cfg: { entityType: string; templateId: string; binding?: EntityBinding | null; },
    ctx: TplEntities | undefined,
): Promise<ResolvedEntityTemplate> {
    const empty: ResolvedEntityTemplate = {
        found: false, templateId: cfg.templateId, entityType: cfg.entityType, roots: [], groups: [], once: false,
        tplSlots: [], vars: entityVars(cfg.entityType,),
    };
    const tpl = await cms.contentBlockTemplates.getOne(cfg.entityType, cfg.templateId,).catch(() => null);
    if (!tpl) return empty;
    const vars = entityVars(cfg.entityType, tpl,);
    const recs = await resolveRecords(cfg.entityType, cfg.binding ?? { mode: 'context', }, tpl.maxRecords, ctx, vars,);
    const meta = tpl as ContentBlockTemplate;
    return {
        found: true,
        templateId: cfg.templateId,
        entityType: cfg.entityType,
        roots: buildBlockTree(mapTemplateBlocks(tpl.blocks ?? [],),),
        groups: templateRenderGroups(recs, meta,),
        once: rendersOnce(meta,),
        tplSlots: tpl.slots ?? [],
        vars,
    };
}

/** Map a content-block template's flat blocks into the `Block` shape the
 *  renderer/`buildBlockTree` consumes. */
export function mapTemplateBlocks(blocks: ContentBlockTemplateBlock[],): Block[] {
    return blocks.map((b,) => ({
        id: b.id,
        pageId: '',
        parentBlockId: b.parentBlockId,
        type: b.blockType,
        settings: (b.settings ?? {}) as Block['settings'],
        style: b.style ?? null,
        order: b.position,
        isVisible: true,
    } as Block));
}
