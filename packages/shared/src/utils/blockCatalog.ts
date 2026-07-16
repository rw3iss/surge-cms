import type { BlockType, } from '../types/content';

/**
 * Runtime enumeration of every block type. The `satisfies` +
 * exhaustiveness assertion below make this list provably complete
 * against the BlockType union — drop or add a union member and this
 * file fails to compile until ALL_BLOCK_TYPES matches. Consumers
 * (mail + ssr render registries, coverage tests) iterate this so a
 * new block type can never be silently ignored.
 */
export const ALL_BLOCK_TYPES = [
    'rich_text',
    'text',
    'post',
    'post_list',
    'form',
    'image',
    'video',
    'gallery',
    'social',
    'campaign',
    'hero',
    'html',
    'document',
    'url_link',
    'carousel',
    'spacer',
    'group',
    'group_item',
] as const satisfies readonly BlockType[];

// Exhaustiveness guard: if a BlockType is added to the union but not
// to ALL_BLOCK_TYPES, `Exclude<BlockType, …>` is non-never and this
// line errors.
type _MissingBlockType = Exclude<BlockType, (typeof ALL_BLOCK_TYPES)[number]>;
const _exhaustive: _MissingBlockType extends never ? true : never = true;
void _exhaustive;
