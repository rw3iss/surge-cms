import { Component, } from 'solid-js';

interface SortThProps {
    label: string;
    field: string;
    current: string;
    onSort: (sort: string,) => void;
    style?: Record<string, string>;
}

/** Sortable table column header — clicking toggles asc/desc for that column. */
const SortTh: Component<SortThProps> = (props,) => {
    const dir = () => {
        if (props.current === `${props.field}_asc`) return 'asc';
        if (props.current === `${props.field}_desc`) return 'desc';
        return null;
    };
    const toggle = () => {
        props.onSort(dir() === 'desc' ? `${props.field}_asc` : `${props.field}_desc`,);
    };
    return (
        <th
            class="admin-table__sortable"
            onClick={toggle}
            style={props.style}
        >
            {props.label}
            <span class="admin-table__sort-icon">
                {dir() === 'asc' ? ' ↑' : dir() === 'desc' ? ' ↓' : ''}
            </span>
        </th>
    );
};

export default SortTh;
