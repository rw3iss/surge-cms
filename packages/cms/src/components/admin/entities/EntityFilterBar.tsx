/**
 * EntityFilterBar — a row of dropdowns, one per `filterable` field of an entity
 * type, used by the Data tab and the entity search modal to narrow results by a
 * field's distinct/enum values.
 *
 * Each field's option list comes from `cms.entities.filterValues` (enum fields
 * return their defined label/value options; other filterable fields return
 * DISTINCT column values). Those are cached server-side (and SWR-cached by the
 * client), so the distinct query runs at most once per field until records
 * change. Selecting a value emits an updated `{ fieldKey: value }` map; the
 * parent turns it into an `EntityQuery.filter` (bare-value equality clauses).
 */
import type { EntityFieldDef, EntityFieldOption, EntityTypeDef, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';

export interface EntityFilterBarProps {
    typeDef: EntityTypeDef | null | undefined;
    /** fieldKey → selected value (absent/empty = no filter on that field). */
    value: Record<string, string>;
    onChange: (next: Record<string, string>,) => void;
}

/** One filterable field's dropdown. Loads its options lazily + cached. */
const FieldFilter: Component<{
    type: string;
    field: EntityFieldDef;
    selected: string | undefined;
    onSelect: (value: string,) => void;
}> = (props,) => {
    const [options] = createResource(
        () => [props.type, props.field.key,] as const,
        async ([type, key,],) => {
            try {
                const res = await cms.entities.filterValues(type, key,);
                return res.values ?? [];
            } catch {
                return [] as EntityFieldOption[];
            }
        },
    );

    return (
        <label class="entity-filter-bar__field">
            <span class="entity-filter-bar__label">{props.field.label || props.field.key}</span>
            <select
                value={props.selected ?? ''}
                onChange={(e,) => props.onSelect(e.currentTarget.value,)}
            >
                <option value="">All</option>
                <For each={options() ?? []}>
                    {(opt,) => <option value={opt.value}>{opt.label}</option>}
                </For>
            </select>
        </label>
    );
};

const EntityFilterBar: Component<EntityFilterBarProps> = (props,) => {
    const filterableFields = () => (props.typeDef?.fields ?? []).filter((f,) => f.filterable && f.type !== 'blocks');
    const hasActive = () => Object.values(props.value,).some((v,) => v !== '' && v != null);

    const setField = (key: string, value: string,) => {
        const next = { ...props.value, };
        if (value === '') delete next[key];
        else next[key] = value;
        props.onChange(next,);
    };

    return (
        <Show when={filterableFields().length > 0}>
            <div class="entity-filter-bar">
                <For each={filterableFields()}>
                    {(field,) => (
                        <FieldFilter
                            type={props.typeDef!.key}
                            field={field}
                            selected={props.value[field.key]}
                            onSelect={(v,) => setField(field.key, v,)}
                        />
                    )}
                </For>
                <Show when={hasActive()}>
                    <button
                        type="button"
                        class="ui-button ui-button--sm ui-button--ghost entity-filter-bar__clear"
                        onClick={() => props.onChange({},)}
                    >
                        Clear filters
                    </button>
                </Show>
            </div>
        </Show>
    );
};

export default EntityFilterBar;
