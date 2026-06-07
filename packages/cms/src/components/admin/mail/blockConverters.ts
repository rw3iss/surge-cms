/**
 * BlockData ↔ backend-block converters for mail-template content.
 *
 * The wire shape diverges from the page/post block shape:
 *   - `mail_template_blocks` stores everything in `settings` (no
 *     explicit title/content columns, no is_visible).
 *   - Mail blocks use `position`; page blocks use `order`.
 *
 * The styleRef ↔ style.id|customProps logic is shared with the page
 * and post converters via `services/blockStyleRef.ts`.
 */
import type { BlockData, } from '../blocks/BlockEditor';
import {
    deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle,
} from '../../../services/blockStyleRef';

export interface BackendBlock {
    id: string;
    parentBlockId: string | null;
    blockType: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

export function backendToEditor(rows: BackendBlock[],): BlockData[] {
    return rows.map((r,) => ({
        id: r.id,
        type: r.blockType as BlockData['type'],
        parentBlockId: r.parentBlockId,
        sort_order: r.position,
        data: r.settings ?? {},
        styleRef: deriveStyleRefFromStyle(r.style,),
    }));
}

export function editorToBackend(blocks: BlockData[],): BackendBlock[] {
    return blocks.map((b, i,) => {
        const data = b.data ?? {};
        const { title, content, __styleRef: _unused, ...settings } = data as
            Record<string, unknown> & { __styleRef?: unknown; };

        const resolved = resolveActiveStyleRef(data, b.styleRef,);
        const persisted = styleRefToPersistedStyle(resolved,);
        // mail_template_blocks doesn't accept null for the style
        // column today (the repo writes '{}'::jsonb on insert). Map
        // explicit-clear or "no style" to an empty object — same
        // observed behaviour.
        const style = persisted ?? {};

        // Carry title/content fields back into settings — the renderer
        // reads them from there.
        const mergedSettings: Record<string, unknown> = { ...settings, };
        if (title !== undefined) mergedSettings.title = title;
        if (content !== undefined) mergedSettings.content = content;

        return {
            id: b.id,
            parentBlockId: b.parentBlockId ?? null,
            blockType: b.type,
            position: b.sort_order ?? i,
            settings: mergedSettings,
            style,
        };
    },);
}
