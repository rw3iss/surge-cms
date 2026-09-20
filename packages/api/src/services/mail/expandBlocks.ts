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
import * as contentBlockTemplates from '../../repositories/contentBlockTemplates.repo';
import * as entitiesService from '../entities';
import { logger, } from '../../utils/logger';
import { resolveMailTemplate, } from './templateRuntime';

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
const MAX_RECORDS = 25;

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

    try {
        switch (binding.mode) {
            // Nothing bound — render the template once, as-is.
            case 'none':
                return [{},];
            case 'context':
                // An email has no "current page entity". Render the template
                // once with nothing bound rather than skipping the block: a
                // template that doesn't use the entity (a social feed, a
                // static tout) is the common case here, and rendering nothing
                // is indistinguishable from a broken block.
                return [{},];
            case 'single': {
                if (!binding.ref) return [];
                const rec = await entitiesService.get(type, binding.ref,);
                return rec ? [rec as Record<string, unknown>,] : [];
            }
            case 'list': {
                const refs = (binding.refs ?? []).slice(0, MAX_RECORDS,);
                const recs = await Promise.all(
                    refs.map((r,) => entitiesService.get(type, r,).catch(() => null)),
                );
                return recs.filter((r,) => r !== null) as Record<string, unknown>[];
            }
            case 'query': {
                const q = { ...(binding.query ?? {}), };
                const limit = Math.min(MAX_RECORDS, Number(q.limit ?? MAX_RECORDS,) || MAX_RECORDS,);
                const res = await entitiesService.list(type, { ...q, limit, } as never,);
                return (res.items ?? []) as Record<string, unknown>[];
            }
            default:
                return [];
        }
    } catch (e) {
        logger.warn('Mail: entity binding failed', {
            type, mode: binding.mode, error: (e as Error).message,
        },);
        return [];
    }
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
        settings: context
            ? await resolveBlockText((b.settings ?? {}) as Record<string, unknown>, context,)
            : ((b.settings ?? {}) as Record<string, unknown>),
        style: (b.style ?? {}) as Record<string, unknown>,
    }),),);
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
    if (depth >= MAX_DEPTH) {
        logger.warn('Mail: dynamic block nesting too deep — stopping expansion',);
        return blocks;
    }
    const pending = blocks.filter(
        (b,) => (b.blockType === 'entity' || b.blockType === 'template') && !done.has(b.id,),
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

                // One copy of the template per record — the same rule the web
                // renderer uses for a list binding.
                let offset = 0;
                for (const [i, record,] of records.entries()) {
                    const varName = cfg.entityType ?? 'entity';
                    const cloned = await cloneBlocks(
                        tplBlocks as never, block.id, `${block.id}-r${i}`,
                        { [varName]: record, entity: record, }, offset,
                    );
                    out.push(...cloned,);
                    offset += tplBlocks.length;
                }
            } else if (block.blockType === 'template') {
                const templateId = block.settings.templateId as string | undefined;
                if (!templateId) continue;
                const tplBlocks = await contentBlockTemplates.findBlocksResolved(templateId,);
                if (tplBlocks.length === 0) continue;
                out.push(...await cloneBlocks(tplBlocks as never, block.id, `${block.id}-c`, null, 0,),);
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
    return expandDynamicBlocks(out, depth + 1, done,);
}
