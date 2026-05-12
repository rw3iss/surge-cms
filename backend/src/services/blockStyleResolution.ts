/**
 * Resolve block-style template refs. Blocks (page, post, mail
 * template) store style as one of:
 *   - `{ id: <uuid> }` — reference to a row in `block_styles`
 *   - flat custom property bag (`{ backgroundColor, padding, ... }`)
 *
 * The renderer wants flat props either way, so this helper takes a
 * list of blocks and inlines every `style = { id: <uuid> }` with the
 * referenced template's properties.
 *
 * We KEEP the `id` field in the resolved style — that's how the
 * frontend converter (`blockStyleRef.deriveStyleRefFromStyle`)
 * decides between `styleRef = { templateId }` (picker remembers
 * which template was selected) and `styleRef = { custom }` (operator
 * tweaked inline). The renderer ignores the `id`; only identity
 * metadata fields (name, isDefault, timestamps) are scrubbed.
 *
 * Lives once here so the page, post, and mail-template repositories
 * can't drift apart on the contract.
 */
import * as blockStylesRepo from '../repositories/blockStyles.repo';

export interface HasStyle { style?: Record<string, unknown> | null; }

// `id` is intentionally NOT stripped — see header comment.
const STRIPPED_KEYS = new Set(['name', 'isDefault', 'createdAt', 'updatedAt',],);

function stripMetadata(template: Record<string, unknown>,): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v,] of Object.entries(template,)) {
        if (!STRIPPED_KEYS.has(k,)) out[k] = v;
    }
    return out;
}

export async function populateBlockStyles<T extends HasStyle,>(
    blocks: T[],
): Promise<T[]> {
    const templateIds = [
        ...new Set(
            blocks
                .filter((b,) => b.style && typeof b.style === 'object' && typeof (b.style as { id?: unknown; }).id === 'string',)
                .map((b,) => (b.style as { id: string; }).id,),
        ),
    ];
    if (templateIds.length === 0) return blocks;

    const stylesMap = await blockStylesRepo.findByIds(templateIds,);
    return blocks.map((block,) => {
        const id = block.style && typeof block.style === 'object'
            ? (block.style as { id?: unknown; }).id as string | undefined
            : undefined;
        if (typeof id === 'string' && stylesMap.has(id,)) {
            const template = stylesMap.get(id,)!;
            return { ...block, style: stripMetadata(template as unknown as Record<string, unknown>,), };
        }
        return block;
    },);
}
