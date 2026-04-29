import { Component, } from 'solid-js';
import { FormField, FormSection, } from '../../forms';

export interface GroupItemBlockData {
    width?: string;
    minWidth?: string;
    maxWidth?: string;
    height?: string;
    minHeight?: string;
    maxHeight?: string;
    alignSelf?: 'start' | 'center' | 'end' | 'stretch';
}

interface GroupItemBlockProps {
    data: GroupItemBlockData & Record<string, any>;
    mode?: 'edit' | 'preview';
    onUpdate: (data: GroupItemBlockData & Record<string, any>,) => void;
}

const GroupItemBlock: Component<GroupItemBlockProps> = (props,) => {
    const update = (patch: Partial<GroupItemBlockData>,) =>
        props.onUpdate({ ...props.data, ...patch, },);

    return (
        <FormSection title="Slot size & alignment">
            <small class="form-help" style={{ display: 'block', 'margin-bottom': '0.5rem', color: '#888', }}>
                Override the parent group's defaults for this slot. Any valid CSS length (px, %, rem) works.
            </small>
            <FormField label="Width" inline>
                <input
                    type="text"
                    value={props.data.width || ''}
                    onInput={(e,) => update({ width: e.currentTarget.value, },)}
                    placeholder="e.g. 200px, 30%"
                />
            </FormField>
            <FormField label="Min width" inline>
                <input
                    type="text"
                    value={props.data.minWidth || ''}
                    onInput={(e,) => update({ minWidth: e.currentTarget.value, },)}
                    placeholder="e.g. 200px"
                />
            </FormField>
            <FormField label="Max width" inline>
                <input
                    type="text"
                    value={props.data.maxWidth || ''}
                    onInput={(e,) => update({ maxWidth: e.currentTarget.value, },)}
                    placeholder="e.g. 600px"
                />
            </FormField>
            <FormField label="Height" inline>
                <input
                    type="text"
                    value={props.data.height || ''}
                    onInput={(e,) => update({ height: e.currentTarget.value, },)}
                    placeholder="e.g. 200px"
                />
            </FormField>
            <FormField label="Min height" inline>
                <input
                    type="text"
                    value={props.data.minHeight || ''}
                    onInput={(e,) => update({ minHeight: e.currentTarget.value, },)}
                    placeholder="e.g. 100px"
                />
            </FormField>
            <FormField label="Max height" inline>
                <input
                    type="text"
                    value={props.data.maxHeight || ''}
                    onInput={(e,) => update({ maxHeight: e.currentTarget.value, },)}
                    placeholder="e.g. 400px"
                />
            </FormField>
            <FormField label="Align self (cross axis)" inline>
                <select
                    value={props.data.alignSelf || ''}
                    onChange={(e,) => update({ alignSelf: (e.currentTarget.value || undefined) as GroupItemBlockData['alignSelf'], },)}
                >
                    <option value="">Inherit from group</option>
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                    <option value="stretch">Stretch</option>
                </select>
            </FormField>
        </FormSection>
    );
};

export default GroupItemBlock;
