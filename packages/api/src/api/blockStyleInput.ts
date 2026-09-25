/**
 * The write-side schema for a block's `style` JSONB.
 *
 * The bag itself stays free-form — the style controls grow, and a closed
 * schema here would mean a new property is silently dropped on save until
 * someone remembers to add it in five route modules. What IS constrained is
 * `customCss`, because it is the one field an operator can paste an arbitrary
 * amount of text into.
 *
 * The cap is per BLOCK, so it is far tighter than the page-level one (64 KB):
 * a page holds one page-level sheet and can hold dozens of blocks, and a
 * per-block override that runs past 16 KB is a stylesheet that belongs in
 * Settings → Appearance, not in one block.
 */
import { z, } from 'zod';

/** Maximum length of one block's Custom CSS, in characters. */
export const BLOCK_CUSTOM_CSS_MAX = 16384;

const overLimit = (v: unknown,) => typeof v === 'string' && v.length > BLOCK_CUSTOM_CSS_MAX;

/**
 * A block `style` record, rejecting an oversized `customCss` at the base level
 * or inside any breakpoint override bag.
 *
 * Checking the breakpoint bags matters as much as the base: they are the same
 * editor writing to a different key, so a cap that only covered the default
 * would be trivially sidestepped by switching the breakpoint dropdown first.
 */
export const blockStyleRecord = z
    .record(z.string(), z.unknown(),)
    .refine(
        (style,) => {
            if (overLimit(style.customCss,)) return false;
            const bps = style.breakpoints;
            if (bps && typeof bps === 'object') {
                for (const bag of Object.values(bps as Record<string, unknown>,)) {
                    if (bag && typeof bag === 'object' && overLimit((bag as Record<string, unknown>).customCss,)) {
                        return false;
                    }
                }
            }
            return true;
        },
        { message: `Custom CSS must be ${BLOCK_CUSTOM_CSS_MAX} characters or fewer`, },
    );
