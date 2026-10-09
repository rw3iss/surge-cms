/**
 * Default-block helpers for post types: seed a new post from its type's
 * `defaultBlocks`, and tell whether a block list is still just those
 * untouched defaults (so a type switch may replace it without losing work).
 */
import type { BlockType, PostTypeDefinition, } from '@sitesurge/types';
import { createBlockDefaultData, } from '../../../config/blockTypes';
import { generateBlockId, } from '../../../utils/blockId';
import type { BlockData, } from '../blocks/ContentBlock';

function seedData(type: string, data: Record<string, unknown> | undefined,): Record<string, unknown> {
    return { ...createBlockDefaultData(type as BlockType,), ...(data ?? {}), };
}

/** Fresh blocks for a type's `defaultBlocks` (new ids every call). */
export function seedDefaultBlocks(def: PostTypeDefinition,): BlockData[] {
    return (def.defaultBlocks ?? []).map((b, i,) => ({
        id: generateBlockId(),
        type: b.type as BlockType,
        parentBlockId: null,
        sort_order: i,
        data: seedData(b.type, b.data,),
    }));
}

/** JSON with sorted keys, so a server round-trip's key order can't matter. */
function stable(v: unknown,): string {
    if (Array.isArray(v,)) return `[${v.map(stable,).join(',',)}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o,).filter((k,) => o[k] !== undefined).toSorted()
            .map((k,) => `${JSON.stringify(k,)}:${stable(o[k],)}`).join(',',)}}`;
    }
    return JSON.stringify(v ?? null,);
}

function isPlain(block: BlockData,): boolean {
    const ref = block.styleRef;
    const styled = !!(ref && (ref.templateId || (ref.custom && Object.keys(ref.custom,).length)));
    return !styled && !block.data?.__styleRef && !block.parentBlockId;
}

/**
 * True when `blocks` is empty, or exactly `def`'s default blocks with their
 * seed data unchanged (no edits, no style). Anything else is user content.
 */
export function isEmptyOrUntouchedDefaults(blocks: BlockData[], def: PostTypeDefinition,): boolean {
    if (!blocks.length) return true;
    const defaults = def.defaultBlocks ?? [];
    if (blocks.length !== defaults.length) return false;
    return blocks.every((b, i,) => {
        const d = defaults[i];
        if (b.type !== d.type || !isPlain(b,)) return false;
        const { __styleRef: _s, ...data } = b.data ?? {};
        return stable(data,) === stable(seedData(d.type, d.data,),);
    },);
}
