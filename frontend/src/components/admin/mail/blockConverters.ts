/**
 * BlockData ↔ backend-block converters for mail-template content.
 *
 * Mirrors the conversion logic in PageEditor.tsx so the same style
 * semantics apply — block-style templates referenced via
 * `block.data.__styleRef.templateId` collapse into the persisted
 * `style = { id: <uuid> }` shape that `mailTemplateBlocks.repo` and
 * the email renderer can resolve. Custom inline styles go through
 * as a flat property bag.
 */
import type { BlockData, } from '../blocks/BlockEditor';

export interface BackendBlock {
    id: string;
    parentBlockId: string | null;
    blockType: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

/**
 * Translate backend rows (as returned by `GET /admin/mail-templates/:id`)
 * into BlockData entries the editor understands.
 *
 *   block.style = { id: "uuid" }    → styleRef = { templateId: id }
 *   block.style = { backgroundColor, ... } → styleRef = { custom: props }
 *   block.style absent / empty      → styleRef = undefined
 */
export function backendToEditor(rows: BackendBlock[],): BlockData[] {
    return rows.map((r,) => {
        const styleRef = r.style && typeof r.style === 'object' && (r.style as { id?: unknown; }).id
            ? { templateId: String((r.style as { id: unknown; }).id,), }
            : r.style && Object.keys(r.style,).length > 0
                ? { custom: r.style as Record<string, unknown>, }
                : undefined;

        return {
            id: r.id,
            type: r.blockType as BlockData['type'],
            parentBlockId: r.parentBlockId,
            sort_order: r.position,
            data: r.settings ?? {},
            styleRef,
        };
    },);
}

/**
 * Translate editor BlockData entries into the wire shape the
 * mail-templates routes expect. The editor's BlockEditController
 * writes the most recent style picker action to `block.data.__styleRef`
 * (so React-style re-renders see it), then PageEditor resolves it
 * back into the canonical style column. We mirror that here.
 */
export function editorToBackend(blocks: BlockData[],): BackendBlock[] {
    return blocks.map((b, i,) => {
        const data = b.data ?? {};
        const { title, content, __styleRef, ...settings } = data as
            Record<string, unknown> & { __styleRef?: unknown; };

        // The editor writes __styleRef to data on every picker action.
        // It's the source of truth for the most recent choice; fall
        // back to BlockData.styleRef for blocks that haven't been
        // re-styled since load.
        const hasExplicit = '__styleRef' in data;
        const ref = hasExplicit
            ? (__styleRef as { templateId?: string; custom?: Record<string, unknown>; } | null | undefined)
            : b.styleRef;

        let style: Record<string, unknown> = {};
        if (ref && typeof ref === 'object') {
            if (ref.templateId) {
                style = { id: ref.templateId, };
            } else if (ref.custom) {
                // Strip block-style-template metadata that leaks in
                // when the editor copies a template's props into the
                // custom field for tweaking.
                const { id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua, ...customProps } =
                    ref.custom as Record<string, unknown>;
                style = Object.keys(customProps,).length > 0 ? customProps : {};
            }
        }

        // Carry the title/content fields back into settings — that's
        // where the editor reads them from on the next load (and the
        // public renderer / our email renderer treat them as settings
        // fields too).
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
