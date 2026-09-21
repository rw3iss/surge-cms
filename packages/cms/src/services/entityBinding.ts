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
    ContentBlockTemplateBlock,
    EntityBinding,
    EntityRecord,
} from '@sitesurge/types';
import { cms, } from './cmsClient';

/** Template-context bag shape (mirrors RuntimeOptions['entities']). */
export type TplEntities = Record<string, { kind: string; data: Record<string, unknown> | null; id?: string; } | null>;

/** Singular/plural template variable names for an entity type (heuristic —
 *  matches the default var names, so no staff-only registry fetch is needed on
 *  the public site). */
export function entityVars(entityType: string,): { singular: string; plural: string; } {
    return { singular: entityType, plural: `${entityType}s`, };
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

/**
 * Resolve the records a binding points at (already capped at `maxRecords`).
 * `ctx` supplies the current route entity for `context` binding.
 */
export async function resolveRecords(
    entityType: string,
    binding: EntityBinding,
    maxRecords: number | null | undefined,
    ctx: TplEntities | undefined,
): Promise<EntityRecord[]> {
    const cap = (arr: EntityRecord[],) => (maxRecords && maxRecords > 0 ? arr.slice(0, maxRecords,) : arr);
    try {
        switch (binding.mode) {
            // Render the template once with nothing bound.
            case 'none':
                return [{} as EntityRecord,];
            case 'context': {
                const { singular, } = entityVars(entityType,);
                const wrapped = ctx?.[singular] ?? ctx?.[entityType];
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
                const recs = await Promise.all((binding.refs ?? []).map((r,) => getOne(entityType, r,)),);
                return cap(recs.filter((r,): r is EntityRecord => r !== null),);
            }
            case 'query': {
                const res = await cms.entities.list(entityType, {
                    ...binding.query,
                    limit: maxRecords || binding.query?.limit || 20,
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
