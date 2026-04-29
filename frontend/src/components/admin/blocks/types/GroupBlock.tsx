import { Component, For, Show, } from 'solid-js';
import { FormCheck, FormField, FormSection, } from '../../forms';

export interface GroupBlockData {
    direction?: 'horizontal' | 'vertical';
    columns?: number;
    /** flex `gap` between children. Block style's gap takes precedence
     *  if set; this is the per-block override. */
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

const COLUMN_OPTIONS = Array.from({ length: 16, }, (_, i,) => i + 1,);
const ALIGN_OPTIONS = ['start', 'center', 'end', 'stretch',] as const;
const JUSTIFY_OPTIONS = [
    'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',
] as const;

const GroupBlock: Component<GroupBlockProps> = (props,) => {
    const update = (patch: Partial<GroupBlockData>,) =>
        props.onUpdate({ ...props.data, ...patch, },);

    const direction = () => props.data.direction || 'horizontal';
    const columns = () => props.data.columns ?? 2;

    return (
        <>
            <FormSection title="Layout">
                <FormField label="Direction" inline>
                    <select
                        value={direction()}
                        onChange={(e,) => update({ direction: e.currentTarget.value as 'horizontal' | 'vertical', },)}
                    >
                        <option value="horizontal">Horizontal (row)</option>
                        <option value="vertical">Vertical (column)</option>
                    </select>
                </FormField>

                <FormField label="Columns / slots" inline>
                    <select
                        value={String(columns(),)}
                        onChange={(e,) => update({ columns: Number(e.currentTarget.value,), },)}
                    >
                        <For each={COLUMN_OPTIONS}>
                            {(n,) => <option value={String(n,)}>{n}</option>}
                        </For>
                    </select>
                </FormField>
                <Show when={columns() > 12}>
                    <small class="form-help" style={{ color: '#b46b00', }}>
                        Heads up: more than 12 columns rarely lays out well at typical viewport widths.
                        Set an `Item min width` to control wrap behavior on smaller screens.
                    </small>
                </Show>

                <FormField label="Wrap" inline>
                    <select
                        value={props.data.wrap || 'wrap'}
                        onChange={(e,) => update({ wrap: e.currentTarget.value as 'wrap' | 'nowrap', },)}
                    >
                        <option value="wrap">Wrap (default)</option>
                        <option value="nowrap">No wrap</option>
                    </select>
                </FormField>

                <FormField label="Gap (between items)" inline>
                    <input
                        type="text"
                        value={props.data.gap || ''}
                        onInput={(e,) => update({ gap: e.currentTarget.value, },)}
                        placeholder="e.g. 12px, 1rem"
                    />
                </FormField>
            </FormSection>

            <FormSection title="Alignment">
                <FormField label={direction() === 'horizontal' ? 'Vertical align (cross)' : 'Horizontal align (cross)'} inline>
                    <select
                        value={props.data.align || 'stretch'}
                        onChange={(e,) => update({ align: e.currentTarget.value as GroupBlockData['align'], },)}
                    >
                        <For each={ALIGN_OPTIONS}>{(v,) => <option value={v}>{v}</option>}</For>
                    </select>
                </FormField>
                <FormField label={direction() === 'horizontal' ? 'Horizontal align (main)' : 'Vertical align (main)'} inline>
                    <select
                        value={props.data.justify || 'start'}
                        onChange={(e,) => update({ justify: e.currentTarget.value as GroupBlockData['justify'], },)}
                    >
                        <For each={JUSTIFY_OPTIONS}>{(v,) => <option value={v}>{v}</option>}</For>
                    </select>
                </FormField>
            </FormSection>

            <FormSection title="Item size defaults">
                <small class="form-help" style={{ display: 'block', 'margin-bottom': '0.5rem', color: '#888', }}>
                    Applies to every slot in this group. Each slot can also override individually.
                </small>
                <FormField label="Item min width" inline>
                    <input
                        type="text"
                        value={props.data.itemMinWidth || ''}
                        onInput={(e,) => update({ itemMinWidth: e.currentTarget.value, },)}
                        placeholder="e.g. 200px, 20%"
                    />
                </FormField>
                <FormField label="Item max width" inline>
                    <input
                        type="text"
                        value={props.data.itemMaxWidth || ''}
                        onInput={(e,) => update({ itemMaxWidth: e.currentTarget.value, },)}
                        placeholder="e.g. 600px, 50%"
                    />
                </FormField>
                <FormField label="Item min height" inline>
                    <input
                        type="text"
                        value={props.data.itemMinHeight || ''}
                        onInput={(e,) => update({ itemMinHeight: e.currentTarget.value, },)}
                        placeholder="e.g. 100px"
                    />
                </FormField>
                <FormField label="Item max height" inline>
                    <input
                        type="text"
                        value={props.data.itemMaxHeight || ''}
                        onInput={(e,) => update({ itemMaxHeight: e.currentTarget.value, },)}
                        placeholder="e.g. 400px"
                    />
                </FormField>
            </FormSection>
        </>
    );
};

export default GroupBlock;
