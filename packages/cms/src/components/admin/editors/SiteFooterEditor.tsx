import type { SiteFooterColumn, SiteFooterRow, SiteFooterSettings, SiteLayoutItem, SiteLayoutItemType, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { colorCssValue, } from '../../../services/colorResolver';
import { fontStack, } from '../../../utils/appearanceStyle';
import ColorPicker from '../appearance/ColorPicker';
import FontSelect from '../common/FontSelect';
import Toggle from '../common/Toggle';
import Tooltip from '../common/Tooltip';
import { useToast, } from '../../common/toast';
import './SiteFooterEditor.scss';

/**
 * Site Footer editor.
 *
 * Hierarchy: Rows → Columns → Items. The user picks one of three
 * editing modes by clicking on the corresponding element in either
 * the structure tree (left rail) or the live preview (top). Each
 * level has a focused settings panel underneath so the field set
 * stays small and learnable.
 *
 * Persistence: a single `site_footer` row in `site_settings` holds
 * the entire structure as JSON. Saves are explicit (Save button)
 * rather than auto-save so the operator can experiment without
 * partial commits going live.
 *
 * The renderer in Layout/Footer.tsx is reused for the live preview
 * so what they see here is exactly what visitors will see.
 */

const genId = (prefix: string,) => `${prefix}-${Date.now()}-${Math.random().toString(36,).slice(2, 7,)}`;

/** Module-level alias of the editor's drop-hint state so the
 *  RowTreeItem / ColumnTreeItem subcomponents (defined outside the
 *  editor's lexical scope) can type their `dropHint` prop. */
type DropHintLike =
    | null
    | { kind: 'row'; targetIndex: number; }
    | { kind: 'column'; rowId: string; targetIndex: number; };

const ITEM_TYPES: { value: SiteLayoutItemType; label: string; }[] = [
    { value: 'text', label: 'Text', },
    { value: 'text_link', label: 'Text Link', },
    { value: 'image', label: 'Image', },
    { value: 'image_link', label: 'Image Link', },
    { value: 'button', label: 'Button', },
    { value: 'gap', label: 'Gap', },
    { value: 'flex_spacer', label: 'Flex Spacer', },
];

const ALIGN_OPTIONS = [
    { value: 'start', label: 'Start', },
    { value: 'center', label: 'Center', },
    { value: 'end', label: 'End', },
    { value: 'space-between', label: 'Space Between', },
    { value: 'space-around', label: 'Space Around', },
] as const;

const VALIGN_OPTIONS = [
    { value: 'start', label: 'Start', },
    { value: 'center', label: 'Center', },
    { value: 'end', label: 'End', },
    { value: 'stretch', label: 'Stretch', },
] as const;

// ─── Defaults ─────────────────────────────────────────────────────

function newItem(): SiteLayoutItem {
    return {
        id: genId('itm',),
        type: 'text_link',
        text: 'New link',
        url: '/',
        order: 0,
    };
}

function newColumn(): SiteFooterColumn {
    return {
        id: genId('col',),
        flex: 1,
        direction: 'column',
        gap: '8px',
        alignment: 'start',
        verticalAlignment: 'stretch',
        items: [],
    };
}

function newRow(): SiteFooterRow {
    return {
        id: genId('row',),
        useGutter: true,
        gap: '24px',
        padding: '24px 0',
        columns: [newColumn(),],
    };
}

// ─── Selection model ──────────────────────────────────────────────

type Selection =
    | { kind: 'none'; }
    | { kind: 'row'; rowId: string; }
    | { kind: 'column'; rowId: string; columnId: string; }
    | { kind: 'item'; rowId: string; columnId: string; itemId: string; };

// ─── Editor ───────────────────────────────────────────────────────

/** Auto-append 'px' if value is a bare integer (e.g. "10" → "10px"). */
function normalizeCssValue(val: string,): string {
    const trimmed = val.trim();
    if (!trimmed) return trimmed;
    if (/^\d+$/.test(trimmed,)) return `${trimmed}px`;
    return trimmed;
}

const SiteFooterEditor: Component = () => {
    const toast = useToast();
    const [settings, setSettings,] = createSignal<SiteFooterSettings>({ enabled: false, rows: [], },);
    const [selection, setSelection,] = createSignal<Selection>({ kind: 'none', },);
    const [saving, setSaving,] = createSignal(false,);
    const [loaded, setLoaded,] = createSignal(false,);
    const [dirty, setDirty,] = createSignal(false,);
    // General footer-level settings (background / padding / margin)
    // are collapsed behind this disclosure to keep the section header
    // tight when an operator just wants to edit rows. Same pattern as
    // SiteHeaderEditor's Settings link.
    const [showSettings, setShowSettings,] = createSignal(false,);

    onMount(async () => {
        try {
            const data = await cms.settings.getSiteFooter() as SiteFooterSettings;
            if (data) setSettings(data,);
        } catch {
            /* error toasted by the bus */
        }
        setLoaded(true,);
    },);

    // Mark dirty whenever the settings object changes after first load.
    createEffect(() => {
        // Read settings() to subscribe — body of effect runs on changes.
        settings();
        if (loaded()) setDirty(true,);
    },);

    const update = (mutator: (s: SiteFooterSettings,) => SiteFooterSettings,) => {
        setSettings((current,) => mutator(structuredClone(current,),),);
    };

    // ── Row mutations ─────────────────────────────────────────────

    const addRow = () => {
        const row = newRow();
        update((s,) => { s.rows.push(row,); return s; },);
        setSelection({ kind: 'row', rowId: row.id, },);
    };

    const removeRow = (rowId: string,) => {
        update((s,) => { s.rows = s.rows.filter((r,) => r.id !== rowId,); return s; },);
        setSelection({ kind: 'none', },);
    };

    const moveRow = (rowId: string, dir: -1 | 1,) => {
        update((s,) => {
            const idx = s.rows.findIndex((r,) => r.id === rowId,);
            if (idx < 0) return s;
            const target = idx + dir;
            if (target < 0 || target >= s.rows.length) return s;
            [s.rows[idx], s.rows[target],] = [s.rows[target], s.rows[idx],];
            return s;
        },);
    };

    const updateRow = (rowId: string, patch: Partial<SiteFooterRow>,) => {
        update((s,) => {
            const r = s.rows.find((x,) => x.id === rowId,);
            if (r) Object.assign(r, patch,);
            return s;
        },);
    };

    // ── Column mutations ──────────────────────────────────────────

    const addColumn = (rowId: string,) => {
        const col = newColumn();
        update((s,) => {
            const r = s.rows.find((x,) => x.id === rowId,);
            if (r) r.columns.push(col,);
            return s;
        },);
        setSelection({ kind: 'column', rowId, columnId: col.id, },);
    };

    const removeColumn = (rowId: string, columnId: string,) => {
        update((s,) => {
            const r = s.rows.find((x,) => x.id === rowId,);
            if (r) r.columns = r.columns.filter((c,) => c.id !== columnId,);
            return s;
        },);
        setSelection({ kind: 'row', rowId, },);
    };

    const moveColumn = (rowId: string, columnId: string, dir: -1 | 1,) => {
        update((s,) => {
            const r = s.rows.find((x,) => x.id === rowId,);
            if (!r) return s;
            const idx = r.columns.findIndex((c,) => c.id === columnId,);
            if (idx < 0) return s;
            const target = idx + dir;
            if (target < 0 || target >= r.columns.length) return s;
            [r.columns[idx], r.columns[target],] = [r.columns[target], r.columns[idx],];
            return s;
        },);
    };

    const updateColumn = (rowId: string, columnId: string, patch: Partial<SiteFooterColumn>,) => {
        update((s,) => {
            const c = s.rows.find((x,) => x.id === rowId,)?.columns.find((y,) => y.id === columnId,);
            if (c) Object.assign(c, patch,);
            return s;
        },);
    };

    // ── Item mutations ────────────────────────────────────────────

    const addItem = (rowId: string, columnId: string,) => {
        const item = newItem();
        update((s,) => {
            const c = s.rows.find((x,) => x.id === rowId,)?.columns.find((y,) => y.id === columnId,);
            if (!c) return s;
            item.order = c.items.length;
            c.items.push(item,);
            return s;
        },);
        setSelection({ kind: 'item', rowId, columnId, itemId: item.id, },);
    };

    const removeItem = (rowId: string, columnId: string, itemId: string,) => {
        update((s,) => {
            const c = s.rows.find((x,) => x.id === rowId,)?.columns.find((y,) => y.id === columnId,);
            if (c) c.items = c.items.filter((i,) => i.id !== itemId,);
            return s;
        },);
        setSelection({ kind: 'column', rowId, columnId, },);
    };

    const moveItem = (rowId: string, columnId: string, itemId: string, dir: -1 | 1,) => {
        update((s,) => {
            const c = s.rows.find((x,) => x.id === rowId,)?.columns.find((y,) => y.id === columnId,);
            if (!c) return s;
            const idx = c.items.findIndex((i,) => i.id === itemId,);
            if (idx < 0) return s;
            const target = idx + dir;
            if (target < 0 || target >= c.items.length) return s;
            [c.items[idx], c.items[target],] = [c.items[target], c.items[idx],];
            // Re-stamp order so the renderer's sort is stable.
            c.items.forEach((item, i,) => { item.order = i; },);
            return s;
        },);
    };

    // ── Drag-and-drop reorder ─────────────────────────────────────
    //
    // Rows can be reordered amongst themselves; columns can be
    // reordered within a row OR moved between rows entirely. The
    // existing arrow-button move helpers stay (single-step nudge);
    // these are absolute-position variants the drag handlers call.

    /** Move a row to an absolute target index (0..rows.length).
     *  `targetIndex` represents the slot to insert the row INTO after
     *  it's been removed from its current position — semantics match
     *  Array.splice. */
    const moveRowTo = (rowId: string, targetIndex: number,) => {
        update((s,) => {
            const idx = s.rows.findIndex((r,) => r.id === rowId,);
            if (idx < 0) return s;
            const [row,] = s.rows.splice(idx, 1,);
            const clamped = Math.max(0, Math.min(targetIndex, s.rows.length,),);
            s.rows.splice(clamped, 0, row,);
            return s;
        },);
    };

    /** Move a column out of its source row and into `destRowId` at
     *  `targetIndex`. When `destRowId` equals the source row, this
     *  reorders within the row. Empties columns disappear from their
     *  source row but the row itself stays (might still hold others). */
    const moveColumnTo = (
        sourceRowId: string,
        columnId: string,
        destRowId: string,
        targetIndex: number,
    ) => {
        update((s,) => {
            const srcRow = s.rows.find((r,) => r.id === sourceRowId,);
            if (!srcRow) return s;
            const idx = srcRow.columns.findIndex((c,) => c.id === columnId,);
            if (idx < 0) return s;
            const [col,] = srcRow.columns.splice(idx, 1,);
            const destRow = s.rows.find((r,) => r.id === destRowId,);
            if (!destRow) {
                // Source-row delete already happened; bail by putting it back.
                srcRow.columns.splice(idx, 0, col,);
                return s;
            }
            const clamped = Math.max(0, Math.min(targetIndex, destRow.columns.length,),);
            destRow.columns.splice(clamped, 0, col,);
            return s;
        },);
    };

    // ── Drag state ─────────────────────────────────────────────────
    //
    // `dragState` describes what's currently being dragged; `dropHint`
    // is the active visual indicator showing where the drop will land.
    // Indicator-only — the actual move runs in onDrop.

    type DragState =
        | { kind: 'none'; }
        | { kind: 'row'; sourceRowId: string; }
        | { kind: 'column'; sourceRowId: string; sourceColumnId: string; };

    type DropHint =
        | null
        | { kind: 'row'; targetIndex: number; }
        | { kind: 'column'; rowId: string; targetIndex: number; };

    const [dragState, setDragState,] = createSignal<DragState>({ kind: 'none', },);
    const [dropHint, setDropHint,] = createSignal<DropHint>(null,);

    /** Compute the row drop slot from a pointer position. Walks each
     *  row's bounding rect; the row whose vertical midpoint we're
     *  past determines the insertion index. Returns 0..rows.length. */
    const computeRowDropIndex = (clientY: number, treeEl: HTMLElement,): number => {
        const rowEls = treeEl.querySelectorAll('[data-row-id]',);
        let target = rowEls.length;
        for (let i = 0; i < rowEls.length; i++) {
            const rect = (rowEls[i] as HTMLElement).getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (clientY < mid) {
                target = i;
                break;
            }
        }
        return target;
    };

    /** Compute the column drop slot within `colsEl` for a pointer Y.
     *  Same midpoint rule as rows. */
    const computeColumnDropIndex = (clientY: number, colsEl: HTMLElement,): number => {
        const colEls = colsEl.querySelectorAll(':scope > [data-col-id]',);
        let target = colEls.length;
        for (let i = 0; i < colEls.length; i++) {
            const rect = (colEls[i] as HTMLElement).getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (clientY < mid) {
                target = i;
                break;
            }
        }
        return target;
    };

    const onRowDragStart = (e: DragEvent, rowId: string, rowEl: HTMLElement,) => {
        setDragState({ kind: 'row', sourceRowId: rowId, },);
        // Use the row card itself as the ghost so the drag visual
        // matches what's being moved. The (x,y) offsets pin the
        // cursor to the same spot relative to the card it grabbed.
        try {
            e.dataTransfer?.setDragImage(rowEl, 12, 12,);
        } catch { /* setDragImage is a best-effort cosmetic */ }
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Set some payload so non-Solid drag listeners don't
            // misinterpret the drag (browsers require a non-empty
            // dataTransfer for drop events to fire on some targets).
            e.dataTransfer.setData('text/plain', `row:${rowId}`,);
        }
    };

    const onColumnDragStart = (
        e: DragEvent,
        rowId: string,
        columnId: string,
        colEl: HTMLElement,
    ) => {
        setDragState({ kind: 'column', sourceRowId: rowId, sourceColumnId: columnId, },);
        try {
            e.dataTransfer?.setDragImage(colEl, 12, 12,);
        } catch { /* ignore */ }
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `col:${columnId}`,);
        }
    };

    const onTreeDragOver = (e: DragEvent, treeEl: HTMLElement,) => {
        const ds = dragState();
        if (ds.kind !== 'row') return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setDropHint({ kind: 'row', targetIndex: computeRowDropIndex(e.clientY, treeEl,), },);
    };

    const onColsDragOver = (e: DragEvent, rowId: string, colsEl: HTMLElement,) => {
        const ds = dragState();
        if (ds.kind !== 'column') return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setDropHint({
            kind: 'column',
            rowId,
            targetIndex: computeColumnDropIndex(e.clientY, colsEl,),
        },);
    };

    const onTreeDrop = (e: DragEvent, treeEl: HTMLElement,) => {
        const ds = dragState();
        if (ds.kind !== 'row') return;
        e.preventDefault();
        const targetIndex = computeRowDropIndex(e.clientY, treeEl,);
        // Splice math: removing from idx then inserting at targetIndex
        // is what `moveRowTo` already does. Skip the no-op move where
        // dragging a row over its own slot.
        const currentIdx = settings().rows.findIndex((r,) => r.id === ds.sourceRowId,);
        if (currentIdx >= 0 && currentIdx !== targetIndex && currentIdx + 1 !== targetIndex) {
            // Adjust target when dragging downward — the index shifts
            // by one after the source is removed.
            const adjusted = targetIndex > currentIdx ? targetIndex - 1 : targetIndex;
            moveRowTo(ds.sourceRowId, adjusted,);
        }
        setDragState({ kind: 'none', },);
        setDropHint(null,);
    };

    const onColsDrop = (e: DragEvent, rowId: string, colsEl: HTMLElement,) => {
        const ds = dragState();
        if (ds.kind !== 'column') return;
        e.preventDefault();
        const targetIndex = computeColumnDropIndex(e.clientY, colsEl,);
        const sameRow = ds.sourceRowId === rowId;
        const srcRow = settings().rows.find((r,) => r.id === ds.sourceRowId,);
        const currentIdx = srcRow?.columns.findIndex((c,) => c.id === ds.sourceColumnId,) ?? -1;
        if (
            sameRow
            && currentIdx >= 0
            && (currentIdx === targetIndex || currentIdx + 1 === targetIndex)
        ) {
            // No-op drop on its own slot.
            setDragState({ kind: 'none', },);
            setDropHint(null,);
            return;
        }
        const adjusted = sameRow && targetIndex > currentIdx ? targetIndex - 1 : targetIndex;
        moveColumnTo(ds.sourceRowId, ds.sourceColumnId, rowId, adjusted,);
        setDragState({ kind: 'none', },);
        setDropHint(null,);
    };

    const onDragEnd = () => {
        setDragState({ kind: 'none', },);
        setDropHint(null,);
    };

    const updateItem = (rowId: string, columnId: string, itemId: string, patch: Partial<SiteLayoutItem>,) => {
        update((s,) => {
            const c = s.rows.find((x,) => x.id === rowId,)?.columns.find((y,) => y.id === columnId,);
            if (!c) return s;
            const it = c.items.find((i,) => i.id === itemId,);
            if (it) Object.assign(it, patch,);
            return s;
        },);
    };

    // ── Save ──────────────────────────────────────────────────────

    const save = async () => {
        setSaving(true,);
        try {
            await cms.settings.siteFooter(settings() as any,);
            toast.success('Footer saved',);
            setDirty(false,);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Save failed',);
        } finally {
            setSaving(false,);
        }
    };

    // ── Selected lookups (helpers for the panels) ─────────────────

    const selectedRow = (): SiteFooterRow | null => {
        const sel = selection();
        if (sel.kind === 'none') return null;
        return settings().rows.find((r,) => r.id === sel.rowId,) ?? null;
    };
    const selectedColumn = (): SiteFooterColumn | null => {
        const sel = selection();
        if (sel.kind !== 'column' && sel.kind !== 'item') return null;
        return selectedRow()?.columns.find((c,) => c.id === sel.columnId,) ?? null;
    };
    const selectedItem = (): SiteLayoutItem | null => {
        const sel = selection();
        if (sel.kind !== 'item') return null;
        return selectedColumn()?.items.find((i,) => i.id === sel.itemId,) ?? null;
    };

    // ── Render ────────────────────────────────────────────────────

    return (
        <div class="footer-editor">
            <Show when={loaded()} fallback={<p>Loading…</p>}>
                {/* Top bar: enable toggle + save */}
                <div class="footer-editor__topbar">
                    <div class="footer-editor__enable">
                        <Toggle
                            checked={settings().enabled}
                            onChange={(next,) => update((s,) => { s.enabled = next; return s; },)}
                            label={<span class="footer-editor__enable-label">Enable site footer</span>}
                        />
                    </div>
                    <div class="footer-editor__topbar-spacer" />
                    <Show when={dirty()}>
                        <span class="footer-editor__dirty">Unsaved changes</span>
                    </Show>
                    <button
                        type="button"
                        class="footer-editor__save"
                        onClick={save}
                        disabled={saving() || !dirty()}
                    >
                        {saving() ? 'Saving…' : 'Save footer'}
                    </button>
                </div>

                {/* General footer settings — collapsed disclosure. Background,
                    padding, and margin live here rather than at the row level
                    because they apply to the entire footer wrapper. Mirrors
                    the SiteHeaderEditor's "Settings" disclosure. */}
                <Show when={settings().enabled}>
                    <div class="footer-editor__general-settings-row">
                        <button
                            type="button"
                            class="footer-editor__general-settings-toggle"
                            onClick={() => setShowSettings(!showSettings(),)}
                        >
                            <span class="footer-editor__general-settings-chevron" aria-hidden="true">
                                {showSettings() ? '▼' : '▶'}
                            </span>
                            {showSettings() ? 'Hide footer settings' : 'Footer settings'}
                        </button>
                    </div>

                    <Show when={showSettings()}>
                        <FooterGeneralSettings
                            background={settings().backgroundColor ?? ''}
                            textColor={settings().textColor ?? ''}
                            defaultFont={settings().defaultFont ?? ''}
                            padding={settings().padding ?? ''}
                            margin={settings().margin ?? ''}
                            onBackgroundChange={(v,) => update((s,) => { s.backgroundColor = v || undefined; return s; },)}
                            onTextColorChange={(v,) => update((s,) => { s.textColor = v || undefined; return s; },)}
                            onDefaultFontChange={(v,) => update((s,) => { s.defaultFont = v || undefined; return s; },)}
                            onPaddingChange={(v,) => update((s,) => { s.padding = v || undefined; return s; },)}
                            onMarginChange={(v,) => update((s,) => { s.margin = v || undefined; return s; },)}
                        />
                    </Show>
                </Show>

                {/* The whole editor body is gated on the enable toggle —
                    when disabled, the operator sees just the toggle and
                    a one-line explanation, not 800 pixels of disabled UI. */}
                <Show
                    when={settings().enabled}
                    fallback={
                        <p class="footer-editor__disabled-note">
                            The site footer is disabled. Enable it above to start designing it. Until then,
                            no footer is rendered on the public site.
                        </p>
                    }
                >
                    <PreviewBlock
                        settings={settings()}
                        selection={selection()}
                        onSelect={setSelection}
                    />

                    <div class="footer-editor__body">
                        {/* Left rail: structure tree */}
                        {(() => {
                            let treeRef: HTMLElement | undefined;
                            return (
                                <aside
                                    class="footer-editor__tree"
                                    ref={(el,) => { treeRef = el; }}
                                    onDragOver={(e,) => treeRef && onTreeDragOver(e, treeRef,)}
                                    onDrop={(e,) => treeRef && onTreeDrop(e, treeRef,)}
                                    onDragLeave={(e,) => {
                                        // Only clear when leaving the tree entirely; bubbled
                                        // drag-leaves from inner elements would otherwise
                                        // clear the indicator mid-drag.
                                        if (e.currentTarget === e.target) setDropHint(null,);
                                    }}
                                >
                                    <div class="footer-editor__tree-head">
                                        <span>Rows</span>
                                        <button type="button" onClick={addRow}>+ Add row</button>
                                    </div>
                                    <Show when={settings().rows.length === 0}>
                                        <p class="empty-state empty-state--plain">No rows yet. Click "Add row" to begin.</p>
                                    </Show>
                                    <For each={settings().rows}>
                                        {(row, rowIdx,) => (
                                            <RowTreeItem
                                                row={row}
                                                rowIndex={rowIdx()}
                                                rowCount={settings().rows.length}
                                                selection={selection()}
                                                dropHint={dropHint()}
                                                onSelect={setSelection}
                                                onAddColumn={() => addColumn(row.id,)}
                                                onAddItem={(columnId,) => addItem(row.id, columnId,)}
                                                onMoveRow={(dir,) => moveRow(row.id, dir,)}
                                                onMoveColumn={(columnId, dir,) => moveColumn(row.id, columnId, dir,)}
                                                onMoveItem={(columnId, itemId, dir,) => moveItem(row.id, columnId, itemId, dir,)}
                                                onRemoveRow={() => removeRow(row.id,)}
                                                onRemoveColumn={(columnId,) => removeColumn(row.id, columnId,)}
                                                onRemoveItem={(columnId, itemId,) => removeItem(row.id, columnId, itemId,)}
                                                onRowDragStart={(e, el,) => onRowDragStart(e, row.id, el,)}
                                                onColDragStart={(e, columnId, el,) => onColumnDragStart(e, row.id, columnId, el,)}
                                                onColsDragOver={(e, el,) => onColsDragOver(e, row.id, el,)}
                                                onColsDrop={(e, el,) => onColsDrop(e, row.id, el,)}
                                                onDragEnd={onDragEnd}
                                            />
                                        )}
                                    </For>
                                </aside>
                            );
                        })()}

                        {/* Right pane: contextual settings panel */}
                        <section class="footer-editor__panel">
                            <Show when={selection().kind === 'none'}>
                                <p class="footer-editor__hint">
                                    Select a row, column, or item from the left to edit it. The preview above updates in
                                    real time.
                                </p>
                            </Show>

                            <Show when={selectedItem()}>
                                {(item) => (
                                    <ItemPanel
                                        item={item()}
                                        onChange={(patch) => {
                                            const sel = selection();
                                            if (sel.kind === 'item') updateItem(sel.rowId, sel.columnId, sel.itemId, patch,);
                                        }}
                                    />
                                )}
                            </Show>

                            <Show when={!selectedItem() && selectedColumn()}>
                                {(column) => (
                                    <ColumnPanel
                                        column={column()}
                                        onChange={(patch) => {
                                            const sel = selection();
                                            const rowId = sel.kind === 'column' ? sel.rowId : sel.kind === 'item' ? sel.rowId : '';
                                            const columnId = sel.kind === 'column' ? sel.columnId : sel.kind === 'item' ? sel.columnId : '';
                                            if (rowId && columnId) updateColumn(rowId, columnId, patch,);
                                        }}
                                    />
                                )}
                            </Show>

                            <Show when={!selectedColumn() && selectedRow()}>
                                {(row) => (
                                    <RowPanel
                                        row={row()}
                                        onChange={(patch) => {
                                            const sel = selection();
                                            if (sel.kind === 'row') updateRow(sel.rowId, patch,);
                                        }}
                                    />
                                )}
                            </Show>
                        </section>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

// ─── Live preview ─────────────────────────────────────────────────
//
// The preview IS the public footer renderer — but every row, column,
// and item is wrapped in a clickable shell that gets a colored outline
// when selected. There is NO separate absolute-positioned overlay.
//
// Why: the previous overlay-on-top approach drifted because its
// flexbox math, padding, and item sizes never perfectly matched the
// real renderer's layout (gutter, content-driven item sizes, etc.).
// Using a single integrated tree means the selection rings sit on
// the actual elements and align by definition.
//
// The duplication of rendering rules with `Layout/Footer.tsx` is
// deliberate — the editor's preview has different concerns (clickable,
// outlineable, never collapsing to zero-size) than the public render,
// so a shared abstraction would just create a worse version of both.

function PreviewBlock(props: {
    settings: SiteFooterSettings;
    selection: Selection;
    onSelect: (s: Selection,) => void;
},) {
    // Mirror the public renderer's outer styles so the preview shows
    // the configured background / padding / margin exactly. Any of
    // these falling through to undefined keeps the SCSS default.
    const previewStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(props.settings.backgroundColor, '',);
        if (bg) s['background-color'] = bg;
        // Footer default text color + font, mirroring the public renderer.
        const tc = colorCssValue(props.settings.textColor, '',);
        if (tc) s['color'] = tc;
        const ff = fontStack(props.settings.defaultFont,);
        if (ff) s['font-family'] = ff;
        if (props.settings.padding) s['padding'] = props.settings.padding;
        if (props.settings.margin) s['margin'] = props.settings.margin;
        return s;
    };
    return (
        <div class="footer-editor__preview-wrap">
            <div class="footer-editor__preview-label">Preview</div>
            <div class="footer-editor__preview" style={previewStyle()}>
                <Show
                    when={props.settings.rows.length > 0}
                    fallback={
                        <div class="footer-editor__preview-empty">
                            Add a row to start designing the footer.
                        </div>
                    }
                >
                    <For each={props.settings.rows}>
                        {(row,) => (
                            <EditableRow
                                row={row}
                                footerTextColor={props.settings.textColor}
                                selection={props.selection}
                                onSelect={props.onSelect}
                            />
                        )}
                    </For>
                </Show>
            </div>
        </div>
    );
}

function EditableRow(props: {
    row: SiteFooterRow;
    footerTextColor?: string;
    selection: Selection;
    onSelect: (s: Selection,) => void;
},) {
    const r = () => props.row;
    const isSelected = () =>
        props.selection.kind !== 'none' && props.selection.rowId === r().id;

    const outerStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(r().backgroundColor, '',);
        if (bg) s['background-color'] = bg;
        if (r().padding) s['padding'] = r().padding!;
        if (r().margin) s['margin'] = r().margin!;
        return s;
    };

    const innerStyle = () => {
        const s: Record<string, string> = {
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'stretch',
            width: '100%',
        };
        if (r().gap) s['gap'] = r().gap!;
        if (r().useGutter) {
            s['max-width'] = '1200px';
            s['margin'] = '0 auto';
            s['padding-left'] = '16px';
            s['padding-right'] = '16px';
        }
        return s;
    };

    return (
        <div
            class={`footer-editor__pv-row ${isSelected() ? 'is-selected' : ''}`}
            style={outerStyle()}
            onClick={(e,) => { e.stopPropagation(); props.onSelect({ kind: 'row', rowId: r().id, },); }}
        >
            <div class="footer-editor__pv-row-inner" style={innerStyle()}>
                <For each={r().columns}>
                    {(column,) => (
                        <EditableColumn
                            row={r()}
                            column={column}
                            footerTextColor={props.footerTextColor}
                            selection={props.selection}
                            onSelect={props.onSelect}
                        />
                    )}
                </For>
            </div>
        </div>
    );
}

function EditableColumn(props: {
    row: SiteFooterRow;
    column: SiteFooterColumn;
    footerTextColor?: string;
    selection: Selection;
    onSelect: (s: Selection,) => void;
},) {
    const c = () => props.column;
    const isSelected = () =>
        (props.selection.kind === 'column' || props.selection.kind === 'item')
        && props.selection.rowId === props.row.id
        && props.selection.columnId === c().id;

    const direction = () => c().direction === 'row' ? 'row' : 'column';
    const justify = () => {
        const a = c().alignment ?? 'start';
        return a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a;
    };
    const align = () => {
        const a = c().verticalAlignment ?? (direction() === 'column' ? 'start' : 'center');
        return a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a;
    };

    const style = () => {
        const s: Record<string, string> = {
            display: 'flex',
            'flex-direction': direction(),
            'justify-content': justify(),
            'align-items': align(),
            'flex-grow': String(c().flex ?? 1,),
            'flex-basis': '0',
            'min-width': '0',
        };
        if (c().gap) s['gap'] = c().gap!;
        if (c().padding) s['padding'] = c().padding!;
        if (c().margin) s['margin'] = c().margin!;
        return s;
    };

    const items = () => [...c().items,].toSorted((a, b,) => (a.order ?? 0) - (b.order ?? 0));

    return (
        <div
            class={`footer-editor__pv-col ${isSelected() ? 'is-selected' : ''}`}
            style={style()}
            onClick={(e,) => { e.stopPropagation(); props.onSelect({ kind: 'column', rowId: props.row.id, columnId: c().id, },); }}
        >
            <Show when={items().length === 0}>
                <span class="footer-editor__pv-col-empty">(empty column)</span>
            </Show>
            <For each={items()}>
                {(item,) => (
                    <EditableItem
                        row={props.row}
                        column={c()}
                        item={item}
                        footerTextColor={props.footerTextColor}
                        selection={props.selection}
                        onSelect={props.onSelect}
                    />
                )}
            </For>
        </div>
    );
}

function EditableItem(props: {
    row: SiteFooterRow;
    column: SiteFooterColumn;
    item: SiteLayoutItem;
    footerTextColor?: string;
    selection: Selection;
    onSelect: (s: Selection,) => void;
},) {
    const it = () => props.item;
    const isSelected = () =>
        props.selection.kind === 'item'
        && props.selection.rowId === props.row.id
        && props.selection.columnId === props.column.id
        && props.selection.itemId === it().id;

    const baseStyle = () => {
        const s: Record<string, string> = {};
        if (it().fontSize) s['font-size'] = it().fontSize!;
        if (it().fontWeight) s['font-weight'] = it().fontWeight!;
        const ff = fontStack(it().fontFamily,);
        if (ff) s['font-family'] = ff;
        const tc = colorCssValue(it().textColor, '',);
        if (tc) s['color'] = tc;
        if (it().width) s['width'] = it().width!;
        if (it().margin) s['margin'] = it().margin!;
        if (it().padding) s['padding'] = it().padding!;
        if (it().alignment) s['text-align'] = it().alignment!;
        return s;
    };

    const buttonTextColor = () =>
        colorCssValue(it().textColor, '',)
        || colorCssValue(props.footerTextColor, '',)
        || '#fff';

    // Render the actual item content. We use real anchors / images / text
    // so it visually matches the public output, but with `pointer-events:
    // none` on inner elements so clicks always hit the wrapper.
    const renderContent = () => {
        switch (it().type) {
            case 'image':
                return <img src={it().imageUrl} alt="" style={baseStyle()} class="footer__item-img" />;
            case 'image_link':
                return (
                    <span style={baseStyle()} class="footer__item-img-link">
                        <img src={it().imageUrl} alt={it().text || ''} />
                    </span>
                );
            case 'text':
                return <span style={baseStyle()} class="footer__item-text">{it().text}</span>;
            case 'text_link':
                return <span style={baseStyle()} class="footer__item-link">{it().text}</span>;
            case 'button':
                return (
                    <span
                        style={{
                            ...baseStyle(),
                            'background-color': colorCssValue(it().buttonColor, '#3498cf',),
                            color: buttonTextColor(),
                        }}
                        class="footer__item-button"
                    >
                        {it().text}
                    </span>
                );
            case 'gap':
                return <span class="footer__item-gap" style={{ width: it().width || '12px', }} />;
            case 'flex_spacer':
                return <span class="footer__item-flex-spacer" />;
            case 'menu':
                return null;
        }
    };

    return (
        <span
            class={`footer-editor__pv-item ${isSelected() ? 'is-selected' : ''}`}
            onClick={(e,) => { e.stopPropagation(); props.onSelect({ kind: 'item', rowId: props.row.id, columnId: props.column.id, itemId: it().id, },); }}
        >
            {renderContent()}
        </span>
    );
}

// ─── Tree (left rail) ─────────────────────────────────────────────

function RowTreeItem(props: {
    row: SiteFooterRow;
    rowIndex: number;
    rowCount: number;
    selection: Selection;
    dropHint: DropHintLike;
    onSelect: (s: Selection,) => void;
    onAddColumn: () => void;
    onAddItem: (columnId: string,) => void;
    onMoveRow: (dir: -1 | 1,) => void;
    onMoveColumn: (columnId: string, dir: -1 | 1,) => void;
    onMoveItem: (columnId: string, itemId: string, dir: -1 | 1,) => void;
    onRemoveRow: () => void;
    onRemoveColumn: (columnId: string,) => void;
    onRemoveItem: (columnId: string, itemId: string,) => void;
    onRowDragStart: (e: DragEvent, rowEl: HTMLElement,) => void;
    onColDragStart: (e: DragEvent, columnId: string, colEl: HTMLElement,) => void;
    onColsDragOver: (e: DragEvent, colsEl: HTMLElement,) => void;
    onColsDrop: (e: DragEvent, colsEl: HTMLElement,) => void;
    onDragEnd: () => void;
},) {
    const rowSelected = () =>
        props.selection.kind !== 'none' && props.selection.rowId === props.row.id;

    /** Drop indicators rendered relative to this row's index. The
     *  outer tree maintains the indicator state; we just render the
     *  matching `is-drop-before` / `is-drop-after` modifier on this
     *  row when the indicator's targetIndex points here. */
    const isDropBefore = () => {
        const h = props.dropHint;
        return h?.kind === 'row' && h.targetIndex === props.rowIndex;
    };
    const isDropAfter = () => {
        const h = props.dropHint;
        return h?.kind === 'row'
            && h.targetIndex === props.rowCount
            && props.rowIndex === props.rowCount - 1;
    };

    /** True when an active column-drop is targeting this row AND
     *  this row has no columns yet — the per-column `is-drop-*`
     *  indicators have nothing to attach to, so we light up the cols
     *  container itself as a "drop here" zone. */
    const isDropIntoEmpty = () => {
        const h = props.dropHint;
        return h?.kind === 'column'
            && h.rowId === props.row.id
            && props.row.columns.length === 0;
    };

    let rowEl: HTMLDivElement | undefined;
    let colsEl: HTMLDivElement | undefined;

    return (
        <div
            class={`footer-editor__tree-row ${rowSelected() ? 'is-selected' : ''} ${
                isDropBefore() ? 'is-drop-before' : ''
            } ${isDropAfter() ? 'is-drop-after' : ''}`}
            ref={(el,) => { rowEl = el; }}
            data-row-id={props.row.id}
        >
            <div class="footer-editor__tree-row-head">
                {/* Drag handle — only this element initiates a row
                    drag, so clicking the label or action buttons
                    doesn't accidentally start one. */}
                <span
                    class="footer-editor__tree-handle"
                    draggable={true}
                    onDragStart={(e,) => rowEl && props.onRowDragStart(e, rowEl,)}
                    onDragEnd={props.onDragEnd}
                    title="Drag to reorder"
                    aria-label="Drag row"
                >
                    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                        <circle cx="2.5" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="2.5" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="2.5" cy="11" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
                    </svg>
                </span>
                <button
                    type="button"
                    class="footer-editor__tree-label"
                    onClick={() => props.onSelect({ kind: 'row', rowId: props.row.id, },)}
                >
                    Row {props.rowIndex + 1}
                </button>
                <span class="footer-editor__tree-actions">
                    <button type="button" disabled={props.rowIndex === 0} onClick={() => props.onMoveRow(-1,)} title="Move up">↑</button>
                    <button type="button" disabled={props.rowIndex >= props.rowCount - 1} onClick={() => props.onMoveRow(1,)} title="Move down">↓</button>
                    <button type="button" onClick={props.onRemoveRow} title="Delete row" class="is-danger">×</button>
                </span>
            </div>
            <div
                class={`footer-editor__tree-cols ${
                    props.row.columns.length === 0 ? 'is-empty' : ''
                } ${isDropIntoEmpty() ? 'is-drop-into' : ''}`}
                ref={(el,) => { colsEl = el; }}
                onDragOver={(e,) => colsEl && props.onColsDragOver(e, colsEl,)}
                onDrop={(e,) => colsEl && props.onColsDrop(e, colsEl,)}
            >
                <For each={props.row.columns}>
                    {(col, colIdx,) => (
                        <ColumnTreeItem
                            row={props.row}
                            column={col}
                            colIndex={colIdx()}
                            colCount={props.row.columns.length}
                            selection={props.selection}
                            dropHint={props.dropHint}
                            onSelect={props.onSelect}
                            onAddItem={() => props.onAddItem(col.id,)}
                            onMoveColumn={(dir,) => props.onMoveColumn(col.id, dir,)}
                            onMoveItem={(itemId, dir,) => props.onMoveItem(col.id, itemId, dir,)}
                            onRemoveColumn={() => props.onRemoveColumn(col.id,)}
                            onRemoveItem={(itemId,) => props.onRemoveItem(col.id, itemId,)}
                            onColDragStart={(e, el,) => props.onColDragStart(e, col.id, el,)}
                            onDragEnd={props.onDragEnd}
                        />
                    )}
                </For>
                <button type="button" class="footer-editor__add-col" onClick={props.onAddColumn}>
                    + Add column
                </button>
            </div>
        </div>
    );
}

function ColumnTreeItem(props: {
    row: SiteFooterRow;
    column: SiteFooterColumn;
    colIndex: number;
    colCount: number;
    selection: Selection;
    dropHint: DropHintLike;
    onSelect: (s: Selection,) => void;
    onAddItem: () => void;
    onMoveColumn: (dir: -1 | 1,) => void;
    onMoveItem: (itemId: string, dir: -1 | 1,) => void;
    onRemoveColumn: () => void;
    onRemoveItem: (itemId: string,) => void;
    onColDragStart: (e: DragEvent, colEl: HTMLElement,) => void;
    onDragEnd: () => void;
},) {
    const colSelected = () =>
        (props.selection.kind === 'column' || props.selection.kind === 'item')
        && props.selection.rowId === props.row.id
        && props.selection.columnId === props.column.id;

    const isDropBefore = () => {
        const h = props.dropHint;
        return h?.kind === 'column'
            && h.rowId === props.row.id
            && h.targetIndex === props.colIndex;
    };
    const isDropAfter = () => {
        const h = props.dropHint;
        return h?.kind === 'column'
            && h.rowId === props.row.id
            && h.targetIndex === props.colCount
            && props.colIndex === props.colCount - 1;
    };

    let colEl: HTMLDivElement | undefined;

    return (
        <div
            class={`footer-editor__tree-col ${colSelected() ? 'is-selected' : ''} ${
                isDropBefore() ? 'is-drop-before' : ''
            } ${isDropAfter() ? 'is-drop-after' : ''}`}
            ref={(el,) => { colEl = el; }}
            data-col-id={props.column.id}
        >
            <div class="footer-editor__tree-col-head">
                <span
                    class="footer-editor__tree-handle"
                    draggable={true}
                    onDragStart={(e,) => colEl && props.onColDragStart(e, colEl,)}
                    onDragEnd={props.onDragEnd}
                    title="Drag to reorder"
                    aria-label="Drag column"
                >
                    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                        <circle cx="2.5" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="2.5" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="2.5" cy="11" r="1.2" fill="currentColor" />
                        <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
                    </svg>
                </span>
                <button
                    type="button"
                    class="footer-editor__tree-label"
                    onClick={() => props.onSelect({ kind: 'column', rowId: props.row.id, columnId: props.column.id, },)}
                >
                    Column {props.colIndex + 1} <span class="footer-editor__tree-meta">flex: {props.column.flex ?? 1}</span>
                </button>
                <span class="footer-editor__tree-actions">
                    <button type="button" disabled={props.colIndex === 0} onClick={() => props.onMoveColumn(-1,)} title="Move left">←</button>
                    <button type="button" disabled={props.colIndex >= props.colCount - 1} onClick={() => props.onMoveColumn(1,)} title="Move right">→</button>
                    <button type="button" onClick={props.onRemoveColumn} title="Delete column" class="is-danger">×</button>
                </span>
            </div>
            <div class="footer-editor__tree-items">
                <For each={props.column.items}>
                    {(item, itemIdx,) => (
                        <ItemTreeItem
                            row={props.row}
                            column={props.column}
                            item={item}
                            itemIndex={itemIdx()}
                            itemCount={props.column.items.length}
                            selection={props.selection}
                            onSelect={props.onSelect}
                            onMove={(dir,) => props.onMoveItem(item.id, dir,)}
                            onRemove={() => props.onRemoveItem(item.id,)}
                        />
                    )}
                </For>
                <button type="button" class="footer-editor__add-item" onClick={props.onAddItem}>
                    + Add item
                </button>
            </div>
        </div>
    );
}

function ItemTreeItem(props: {
    row: SiteFooterRow;
    column: SiteFooterColumn;
    item: SiteLayoutItem;
    itemIndex: number;
    itemCount: number;
    selection: Selection;
    onSelect: (s: Selection,) => void;
    onMove: (dir: -1 | 1,) => void;
    onRemove: () => void;
},) {
    const itemSelected = () =>
        props.selection.kind === 'item'
        && props.selection.rowId === props.row.id
        && props.selection.columnId === props.column.id
        && props.selection.itemId === props.item.id;

    const label = () => {
        const t = props.item.type;
        if (t === 'gap' || t === 'flex_spacer') return t;
        return props.item.text || `(${t})`;
    };

    return (
        <div class={`footer-editor__tree-item ${itemSelected() ? 'is-selected' : ''}`}>
            <button
                type="button"
                class="footer-editor__tree-label"
                onClick={() => props.onSelect({ kind: 'item', rowId: props.row.id, columnId: props.column.id, itemId: props.item.id, },)}
            >
                <span class="footer-editor__tree-meta">{props.item.type}</span> {label()}
            </button>
            <span class="footer-editor__tree-actions">
                <button type="button" disabled={props.itemIndex === 0} onClick={() => props.onMove(-1,)} title="Move up">↑</button>
                <button type="button" disabled={props.itemIndex >= props.itemCount - 1} onClick={() => props.onMove(1,)} title="Move down">↓</button>
                <button type="button" onClick={props.onRemove} title="Delete item" class="is-danger">×</button>
            </span>
        </div>
    );
}

// ─── Settings panels ──────────────────────────────────────────────

/**
 * General footer-level settings: background color, padding, margin.
 * These map to the top-level `SiteFooterSettings` fields and are
 * applied to the outer `<footer>` element by the renderer (and by
 * the editor's preview, since it shares the same renderer).
 *
 * Padding/margin accept any valid CSS value (e.g. `12px 0`, `1rem`,
 * `0 auto`). A bare integer is auto-suffixed to `px` on blur, matching
 * the SiteHeaderEditor's behavior.
 */
function FooterGeneralSettings(props: {
    background: string;
    textColor: string;
    defaultFont: string;
    padding: string;
    margin: string;
    onBackgroundChange: (value: string,) => void;
    onTextColorChange: (value: string,) => void;
    onDefaultFontChange: (value: string,) => void;
    onPaddingChange: (value: string,) => void;
    onMarginChange: (value: string,) => void;
},) {
    return (
        <div class="footer-editor__general-settings">
            <div class="footer-editor__general-field">
                <label class="footer-editor__general-label">Default font</label>
                <FontSelect
                    value={props.defaultFont}
                    onChange={(v,) => props.onDefaultFontChange(v,)}
                    noneLabel="Default (site font)"
                />
            </div>
            <div class="footer-editor__general-field">
                <label class="footer-editor__general-label">Text Color</label>
                <ColorPicker
                    value={props.textColor}
                    onChange={(hex,) => props.onTextColorChange(hex,)}
                    clearable
                    onClear={() => props.onTextColorChange('',)}
                />
            </div>
            <div class="footer-editor__general-field">
                <label class="footer-editor__general-label">Background</label>
                <ColorPicker
                    value={props.background}
                    onChange={(hex,) => props.onBackgroundChange(hex,)}
                    clearable
                    onClear={() => props.onBackgroundChange('',)}
                />
            </div>
            <div class="footer-editor__general-field">
                <div class="footer-editor__general-label-row">
                    <label class="footer-editor__general-label">Padding</label>
                    <Tooltip
                        content="Valid CSS values: px, em, rem, vw, %, or shorthand like '8px 16px'. Plain numbers will auto-append px."
                        header="Padding"
                    />
                </div>
                <input
                    type="text"
                    class="footer-editor__general-input"
                    value={props.padding}
                    placeholder="0px"
                    onInput={(e,) => props.onPaddingChange(e.currentTarget.value,)}
                    onBlur={(e,) => {
                        const v = normalizeCssValue(e.currentTarget.value,);
                        props.onPaddingChange(v,);
                        e.currentTarget.value = v;
                    }}
                />
            </div>
            <div class="footer-editor__general-field">
                <div class="footer-editor__general-label-row">
                    <label class="footer-editor__general-label">Margin</label>
                    <Tooltip
                        content="Valid CSS values: px, em, rem, vw, %, auto, or shorthand like '0 auto'. Plain numbers will auto-append px."
                        header="Margin"
                    />
                </div>
                <input
                    type="text"
                    class="footer-editor__general-input"
                    value={props.margin}
                    placeholder="0px"
                    onInput={(e,) => props.onMarginChange(e.currentTarget.value,)}
                    onBlur={(e,) => {
                        const v = normalizeCssValue(e.currentTarget.value,);
                        props.onMarginChange(v,);
                        e.currentTarget.value = v;
                    }}
                />
            </div>
        </div>
    );
}

function RowPanel(props: { row: SiteFooterRow; onChange: (p: Partial<SiteFooterRow>,) => void; },) {
    return (
        <div class="footer-editor__form">
            <h3>Row settings</h3>
            <div class="footer-editor__field">
                <span>Inherit site gutter (constrains row to container width)</span>
                <Toggle
                    checked={Boolean(props.row.useGutter,)}
                    onChange={(next,) => props.onChange({ useGutter: next, },)}
                    ariaLabel="Inherit site gutter"
                />
            </div>
            <label class="footer-editor__field">
                <span>Gap between columns</span>
                <input
                    type="text"
                    value={props.row.gap ?? ''}
                    placeholder="e.g. 24px"
                    onInput={(e,) => props.onChange({ gap: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Padding</span>
                <input
                    type="text"
                    value={props.row.padding ?? ''}
                    placeholder="e.g. 24px 0"
                    onInput={(e,) => props.onChange({ padding: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Margin</span>
                <input
                    type="text"
                    value={props.row.margin ?? ''}
                    placeholder="e.g. 0"
                    onInput={(e,) => props.onChange({ margin: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Background color</span>
                <input
                    type="text"
                    value={props.row.backgroundColor ?? ''}
                    placeholder="e.g. #1d3557"
                    onInput={(e,) => props.onChange({ backgroundColor: e.currentTarget.value, },)}
                />
            </label>
        </div>
    );
}

function ColumnPanel(props: { column: SiteFooterColumn; onChange: (p: Partial<SiteFooterColumn>,) => void; },) {
    return (
        <div class="footer-editor__form">
            <h3>Column settings</h3>
            <label class="footer-editor__field">
                <span>Layout direction</span>
                <select
                    value={props.column.direction ?? 'column'}
                    onChange={(e,) => props.onChange({ direction: e.currentTarget.value as 'row' | 'column', },)}
                >
                    <option value="column">Vertical (column)</option>
                    <option value="row">Horizontal (row)</option>
                </select>
            </label>
            <label class="footer-editor__field">
                <span>Flex size (proportion of row width)</span>
                <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={props.column.flex ?? 1}
                    onInput={(e,) => props.onChange({ flex: Number(e.currentTarget.value,) || 1, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Item alignment (main axis)</span>
                <select
                    value={props.column.alignment ?? 'start'}
                    onChange={(e,) => props.onChange({ alignment: e.currentTarget.value as SiteFooterColumn['alignment'], },)}
                >
                    <For each={ALIGN_OPTIONS}>{(opt,) => <option value={opt.value}>{opt.label}</option>}</For>
                </select>
            </label>
            <label class="footer-editor__field">
                <span>Item alignment (cross axis)</span>
                <select
                    value={props.column.verticalAlignment ?? 'stretch'}
                    onChange={(e,) => props.onChange({ verticalAlignment: e.currentTarget.value as SiteFooterColumn['verticalAlignment'], },)}
                >
                    <For each={VALIGN_OPTIONS}>{(opt,) => <option value={opt.value}>{opt.label}</option>}</For>
                </select>
            </label>
            <label class="footer-editor__field">
                <span>Gap between items</span>
                <input
                    type="text"
                    value={props.column.gap ?? ''}
                    placeholder="e.g. 8px"
                    onInput={(e,) => props.onChange({ gap: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Padding</span>
                <input
                    type="text"
                    value={props.column.padding ?? ''}
                    placeholder="e.g. 8px"
                    onInput={(e,) => props.onChange({ padding: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Margin</span>
                <input
                    type="text"
                    value={props.column.margin ?? ''}
                    placeholder="e.g. 0"
                    onInput={(e,) => props.onChange({ margin: e.currentTarget.value, },)}
                />
            </label>
        </div>
    );
}

function ItemPanel(props: { item: SiteLayoutItem; onChange: (p: Partial<SiteLayoutItem>,) => void; },) {
    const t = () => props.item.type;
    const supportsText = () => ['text', 'text_link', 'button',].includes(t(),);
    const supportsUrl = () => ['text_link', 'image_link', 'button',].includes(t(),);
    const supportsImage = () => ['image', 'image_link',].includes(t(),);
    const supportsTypography = () => ['text', 'text_link', 'button',].includes(t(),);

    return (
        <div class="footer-editor__form">
            <h3>Item settings</h3>
            <label class="footer-editor__field">
                <span>Type</span>
                <select
                    value={t()}
                    onChange={(e,) => props.onChange({ type: e.currentTarget.value as SiteLayoutItemType, },)}
                >
                    <For each={ITEM_TYPES}>{(opt,) => <option value={opt.value}>{opt.label}</option>}</For>
                </select>
            </label>

            <Show when={supportsText()}>
                <label class="footer-editor__field">
                    <span>Text</span>
                    <input
                        type="text"
                        value={props.item.text ?? ''}
                        onInput={(e,) => props.onChange({ text: e.currentTarget.value, },)}
                    />
                </label>
            </Show>

            <Show when={supportsUrl()}>
                <label class="footer-editor__field">
                    <span>URL</span>
                    <input
                        type="text"
                        value={props.item.url ?? ''}
                        placeholder="/about or https://…"
                        onInput={(e,) => props.onChange({ url: e.currentTarget.value, },)}
                    />
                </label>
                <div class="footer-editor__field footer-editor__field--inline">
                    <Toggle
                        checked={Boolean(props.item.openInNewTab,)}
                        onChange={(next,) => props.onChange({ openInNewTab: next, },)}
                        label="Open in new tab"
                    />
                </div>
            </Show>

            <Show when={supportsImage()}>
                <label class="footer-editor__field">
                    <span>Image URL</span>
                    <input
                        type="text"
                        value={props.item.imageUrl ?? ''}
                        placeholder="/uploads/… or https://…"
                        onInput={(e,) => props.onChange({ imageUrl: e.currentTarget.value, },)}
                    />
                </label>
            </Show>

            <Show when={supportsTypography()}>
                <label class="footer-editor__field">
                    <span>Font</span>
                    <FontSelect
                        value={props.item.fontFamily ?? ''}
                        onChange={(v,) => props.onChange({ fontFamily: v || undefined, },)}
                        noneLabel="Default (footer font)"
                    />
                </label>
                <label class="footer-editor__field">
                    <span>Font size</span>
                    <input
                        type="text"
                        value={props.item.fontSize ?? ''}
                        placeholder="e.g. 14px"
                        onInput={(e,) => props.onChange({ fontSize: e.currentTarget.value, },)}
                    />
                </label>
                <label class="footer-editor__field">
                    <span>Font weight</span>
                    <select
                        value={props.item.fontWeight ?? ''}
                        onChange={(e,) => props.onChange({ fontWeight: e.currentTarget.value || undefined, },)}
                    >
                        <option value="">Default</option>
                        <option value="100">100 — Thin</option>
                        <option value="200">200 — Extra Light</option>
                        <option value="300">300 — Light</option>
                        <option value="400">400 — Regular</option>
                        <option value="500">500 — Medium</option>
                        <option value="600">600 — Semibold</option>
                        <option value="700">700 — Bold</option>
                        <option value="800">800 — Extrabold</option>
                        <option value="900">900 — Black</option>
                    </select>
                </label>
                <label class="footer-editor__field">
                    <span>Text color</span>
                    <input
                        type="text"
                        value={props.item.textColor ?? ''}
                        placeholder="e.g. #ffffff"
                        onInput={(e,) => props.onChange({ textColor: e.currentTarget.value, },)}
                    />
                </label>
            </Show>

            <Show when={t() === 'button'}>
                <label class="footer-editor__field">
                    <span>Button color</span>
                    <input
                        type="text"
                        value={props.item.buttonColor ?? ''}
                        placeholder="e.g. #3498cf"
                        onInput={(e,) => props.onChange({ buttonColor: e.currentTarget.value, },)}
                    />
                </label>
            </Show>

            <Show when={t() === 'gap'}>
                <label class="footer-editor__field">
                    <span>Gap size (width)</span>
                    <input
                        type="text"
                        value={props.item.width ?? ''}
                        placeholder="e.g. 12px"
                        onInput={(e,) => props.onChange({ width: e.currentTarget.value, },)}
                    />
                </label>
            </Show>

            <label class="footer-editor__field">
                <span>Padding</span>
                <input
                    type="text"
                    value={props.item.padding ?? ''}
                    placeholder="e.g. 4px 0"
                    onInput={(e,) => props.onChange({ padding: e.currentTarget.value, },)}
                />
            </label>
            <label class="footer-editor__field">
                <span>Margin</span>
                <input
                    type="text"
                    value={props.item.margin ?? ''}
                    placeholder="e.g. 0"
                    onInput={(e,) => props.onChange({ margin: e.currentTarget.value, },)}
                />
            </label>
        </div>
    );
}

export default SiteFooterEditor;
