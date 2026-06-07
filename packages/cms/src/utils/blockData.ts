/**
 * Shared transform from the editor's `BlockData` shape to the public
 * `Block` shape that BlockRenderer expects.
 *
 * Both PageEditor's inline preview and the standalone PagePreview /
 * PostPreview routes used to inline this transform — keep one source
 * of truth here so future field changes don't drift.
 */
import type { Block, } from '@rw/cms-shared';
import type { BlockData, } from '../components/admin/blocks/ContentBlock';
import { BlockStyleService, type BlockStyleData, } from '../services/blockStyles';

/** Resolve a block's draft styleRef into a concrete style object the
 *  renderer can apply. Mirrors the inline logic both editors duplicated. */
export function resolveDraftStyle(block: BlockData,): Record<string, unknown> | undefined {
    const ref = (block.data?.__styleRef as { templateId?: string; custom?: Record<string, unknown>; } | undefined)
        ?? block.styleRef;
    if (!ref) return undefined;
    if (ref.custom) return ref.custom;
    if (ref.templateId) {
        const tmpl = BlockStyleService.getCached().find((s: BlockStyleData,) => s.id === ref.templateId);
        return (tmpl as unknown as Record<string, unknown>) || { id: ref.templateId, };
    }
    return undefined;
}

/** Build a `Block` from a `BlockData` so the public BlockRenderer can
 *  render the draft. The returned object omits server-only fields
 *  (createdAt / updatedAt are filled with `new Date()` to satisfy the
 *  type — the renderer doesn't read them). */
export function blockDataToRenderBlock(block: BlockData, pageId: string,): Block {
    const data = block.data || {};
    const { title, content, __styleRef: _ignored, ...settings } = data as Record<string, unknown>;
    return {
        id: block.id,
        pageId,
        parentBlockId: block.parentBlockId ?? null,
        type: block.type,
        title: (title as string | undefined) ?? undefined,
        content: (content as string | undefined) ?? undefined,
        settings: settings as Block['settings'],
        order: block.sort_order || 0,
        isVisible: true,
        style: resolveDraftStyle(block,) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}
