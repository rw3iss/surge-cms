import { Component, For, Show, } from 'solid-js';
import { GROUP_DEFAULT_ROWS, GROUP_MAX_COLUMNS, GROUP_MAX_ROWS, groupLayoutOf, } from '@sitesurge/types';
import { CommitInput, FormField, FormSection, } from '../../forms';
import { groupColumns, } from '../../../../utils/groupStyle';

export interface GroupBlockData {
    /** Layout (stored as `direction` for compatibility): row / column / grid. */
    direction?: 'horizontal' | 'vertical' | 'grid';
    columns?: number;
    /** Grid only: rows of `columns` cells. */
    rows?: number;
    /** RETIRED (migration 181 → `style.gap`): read only as a fallback. */
    gap?: string;
    wrap?: 'wrap' | 'nowrap';
    align?: 'start' | 'center' | 'end' | 'stretch';
    justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
    /** Defaults applied to every group_item child. */
    itemMinWidth?: string;
    itemMaxWidth?: string;
    itemMinHeight?: string;
    itemMaxHeight?: string;
}

interface GroupBlockProps {
    data: GroupBlockData & Record<string, any>;
    mode?: 'edit' | 'preview';
    onUpdate: (data: GroupBlockData & Record<string, any>,) => void;
}

const COLUMN_OPTIONS = Array.from({ length: GROUP_MAX_COLUMNS, }, (_, i,) => i + 1,);
const ROW_OPTIONS = Array.from({ length: GROUP_MAX_ROWS, }, (_, i,) => i + 1,);
const ALIGN_OPTIONS = ['start', 'center', 'end', 'stretch',] as const;
const JUSTIFY_OPTIONS = [
    'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',
] as const;

const GroupBlock: Component<GroupBlockProps> = (props,) => {
    const update = (patch: Partial<GroupBlockData>,) =>
        props.onUpdate({ ...props.data, ...patch, },);

    const direction = () => props.data.direction || 'horizontal';
    const isGrid = () => direction() === 'grid';
    const columns = () => groupLayoutOf(props.data,).columns;
    const rows = () => groupLayoutOf(props.data,).rows;

    return (
        <>
            <FormSection title="Layout">
                <FormField
                    label="Layout"
                    inline
                    tooltip="Row: slots side by side. Column: slots stacked. Grid: a table of cells (columns × rows), each an empty slot until you add a block."
                >
                    <select
                        value={direction()}
                        onChange={(e,) => {
                            const next = e.currentTarget.value as GroupBlockData['direction'];
                            const cur = groupLayoutOf(props.data,);
                            update({
                                direction: next,
                                // Entering Grid: start with the default row count.
                                ...(next === 'grid' && !props.data.rows ? { rows: GROUP_DEFAULT_ROWS, } : {}),
                                // Leaving Grid: keep every cell as a slot (a 2 × 2 grid
                                // becomes 4 slots), so no cell's block is deleted.
                                ...(cur.layout === 'grid' && next !== 'grid'
                                    ? { columns: Math.min(GROUP_MAX_COLUMNS, cur.slots,), }
                                    : {}),
                            },);
                        }}
                    >
                        <option value="horizontal">Row (horizontal)</option>
                        <option value="vertical">Column (vertical)</option>
                        <option value="grid">Grid</option>
                    </select>
                </FormField>

                <FormField label={isGrid() ? 'Columns' : direction() === 'vertical' ? 'Slots' : 'Columns / slots'} inline>
                    <select
                        value={String(columns(),)}
                        onChange={(e,) => update({ columns: Number(e.currentTarget.value,), },)}
                    >
                        <For each={COLUMN_OPTIONS}>
                            {(n,) => <option value={String(n,)}>{n}</option>}
                        </For>
                    </select>
                </FormField>
                <Show when={isGrid()}>
                    <FormField label="Rows" inline hint={`${columns() * rows()} cells. Lowering columns or rows removes the last cells and their blocks.`}>
                        <select
                            value={String(rows(),)}
                            onChange={(e,) => update({ rows: Number(e.currentTarget.value,), },)}
                        >
                            <For each={ROW_OPTIONS}>
                                {(n,) => <option value={String(n,)}>{n}</option>}
                            </For>
                        </select>
                    </FormField>
                </Show>
                <Show when={columns() > 12}>
                    <small class="form-help form-help--warning">
                        Heads up: more than 12 columns rarely lays out well at typical viewport widths.
                        Set an <strong>Item min width</strong> to control wrap behavior on smaller screens.
                    </small>
                </Show>

                {/* Wrap only affects a legacy Row without a column count (a flex
                    row); a Row with columns is a column grid, which never wraps. */}
                <Show when={groupColumns(props.data,) == null && direction() === 'horizontal'}>
                    <FormField label="Wrap" inline>
                        <select
                            value={props.data.wrap || 'wrap'}
                            onChange={(e,) => update({ wrap: e.currentTarget.value as 'wrap' | 'nowrap', },)}
                        >
                            <option value="wrap">Wrap (default)</option>
                            <option value="nowrap">No wrap</option>
                        </select>
                    </FormField>
                </Show>

                <small class="form-help-muted">
                    Space between slots: set <strong>Gap</strong> in this block's Style panel — it can differ per
                    breakpoint (e.g. a smaller gap on mobile).
                </small>
            </FormSection>

            <FormSection title="Alignment">
                <FormField label={direction() === 'vertical' ? 'Horizontal align (cross)' : 'Vertical align (cross)'} inline>
                    <select
                        value={props.data.align || 'stretch'}
                        onChange={(e,) => update({ align: e.currentTarget.value as GroupBlockData['align'], },)}
                    >
                        <For each={ALIGN_OPTIONS}>{(v,) => <option value={v}>{v}</option>}</For>
                    </select>
                </FormField>
                <FormField label={direction() === 'vertical' ? 'Vertical align (main)' : 'Horizontal align (main)'} inline>
                    <select
                        value={props.data.justify || 'start'}
                        onChange={(e,) => update({ justify: e.currentTarget.value as GroupBlockData['justify'], },)}
                    >
                        <For each={JUSTIFY_OPTIONS}>{(v,) => <option value={v}>{v}</option>}</For>
                    </select>
                </FormField>
            </FormSection>

            <FormSection title="Item size defaults">
                <small class="form-help-muted">
                    Applies to every slot in this group. Each slot can also override individually.
                </small>
                <FormField label="Item min width" inline>
                    <CommitInput
                        value={props.data.itemMinWidth || ''}
                        onCommit={(v,) => update({ itemMinWidth: v || undefined, },)}
                        placeholder="e.g. 200px, 20%"
                    />
                </FormField>
                <FormField label="Item max width" inline>
                    <CommitInput
                        value={props.data.itemMaxWidth || ''}
                        onCommit={(v,) => update({ itemMaxWidth: v || undefined, },)}
                        placeholder="e.g. 600px, 50%"
                    />
                </FormField>
                <FormField label="Item min height" inline>
                    <CommitInput
                        value={props.data.itemMinHeight || ''}
                        onCommit={(v,) => update({ itemMinHeight: v || undefined, },)}
                        placeholder="e.g. 100px"
                    />
                </FormField>
                <FormField label="Item max height" inline>
                    <CommitInput
                        value={props.data.itemMaxHeight || ''}
                        onCommit={(v,) => update({ itemMaxHeight: v || undefined, },)}
                        placeholder="e.g. 400px"
                    />
                </FormField>
            </FormSection>
        </>
    );
};

export default GroupBlock;
