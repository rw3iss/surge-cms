/**
 * A text input for a filter clause's VALUE, with suggestions for the field.
 *
 * Typing a filter value means guessing what the data actually contains — is the
 * status `active` or `published`? is the tag `T-Shirts` or `t-shirts`? This asks
 * the server what values exist for the selected field and offers them.
 *
 * Two shapes of answer come back, and the distinction matters:
 *  - enum / boolean fields answer from their DECLARED values, so a valid option
 *    appears even when no record uses it yet.
 *  - everything else answers with DISTINCT column values, which is a description
 *    of the data rather than a constraint on it — so the input stays free text
 *    and a suggestion is only ever a shortcut.
 *
 * Picking a suggestion APPENDS with a comma rather than replacing, because the
 * `in` operator takes a list and building one by hand is exactly where typos
 * come from. Re-picking an existing value is a no-op.
 */
import { Component, createEffect, createSignal, For, onCleanup, Show, } from 'solid-js';
import type { EntityFieldOption, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import './EntityValueInput.scss';

export interface EntityValueInputProps {
    /** Entity type key, e.g. `product`. */
    typeKey: string;
    /** Field key whose values to suggest. Empty disables suggestions. */
    field: string;
    value: string;
    onInput: (next: string,) => void;
    placeholder?: string;
    /** Free-text fields search server-side as you type; debounce in ms. */
    debounceMs?: number;
}

/** Split a comma-separated value into its parts, dropping blanks. */
function parts(value: string,): string[] {
    return value.split(',',).map((v,) => v.trim()).filter(Boolean,);
}

const EntityValueInput: Component<EntityValueInputProps> = (props,) => {
    const [options, setOptions,] = createSignal<EntityFieldOption[]>([],);
    const [open, setOpen,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(false,);
    const [failed, setFailed,] = createSignal(false,);

    let rootEl: HTMLDivElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Guards against a slow early request overwriting a newer one's results.
    let requestSeq = 0;

    const load = async (search: string,) => {
        if (!props.typeKey || !props.field) { setOptions([],); return; }
        const seq = ++requestSeq;
        setLoading(true,);
        try {
            const res = await cms.entities.filterValues(props.typeKey, props.field, search || undefined,);
            if (seq !== requestSeq) return;
            setOptions(res.values ?? [],);
            setFailed(false,);
        } catch {
            // A field with no suggestable values (rich text, blocks) 4xxs here.
            // That is not an error the operator needs to see — the input still
            // works as free text, so just stop offering a dropdown.
            if (seq !== requestSeq) return;
            setOptions([],);
            setFailed(true,);
        } finally {
            if (seq === requestSeq) setLoading(false,);
        }
    };

    // Refetch when the FIELD changes — a new field means a new value set, and
    // the old field's suggestions would be actively misleading.
    createEffect(() => {
        props.field;
        props.typeKey;
        setFailed(false,);
        setOptions([],);
        void load('',);
    },);

    const onInput = (next: string,) => {
        props.onInput(next,);
        if (failed()) return;
        setOpen(true,);
        clearTimeout(timer,);
        // Search on the LAST comma-separated part: mid-list, the earlier
        // entries aren't what the operator is currently typing.
        const term = parts(next,).length && !next.trim().endsWith(',',)
            ? (parts(next,).at(-1,) ?? '')
            : '';
        timer = setTimeout(() => void load(term,), props.debounceMs ?? 250,);
    };

    /** Append a picked value, comma-separated, ignoring duplicates. */
    const pick = (value: string,) => {
        const existing = parts(props.value,);
        if (existing.includes(value,)) { setOpen(false,); return; }
        props.onInput(existing.length ? `${existing.join(', ',)}, ${value}` : value,);
        setOpen(false,);
    };

    const onDocClick = (e: MouseEvent,) => {
        if (rootEl && !rootEl.contains(e.target as Node,)) setOpen(false,);
    };
    document.addEventListener('mousedown', onDocClick,);
    onCleanup(() => {
        document.removeEventListener('mousedown', onDocClick,);
        clearTimeout(timer,);
    },);

    /** Hide values already present — re-picking one does nothing anyway. */
    const visible = () => {
        const chosen = new Set(parts(props.value,),);
        return options().filter((o,) => !chosen.has(o.value,));
    };

    return (
        <div class="entity-value-input" ref={(el,) => { rootEl = el; }}>
            <input
                type="text"
                value={props.value}
                placeholder={props.placeholder}
                onInput={(e,) => onInput(e.currentTarget.value,)}
                onFocus={() => { if (!failed()) setOpen(true,); }}
                onKeyDown={(e,) => { if (e.key === 'Escape' && open()) { e.stopPropagation(); setOpen(false,); } }}
                autocomplete="off"
            />
            <Show when={open() && !failed() && (visible().length > 0 || loading())}>
                <ul class="entity-value-input__menu">
                    <Show when={!loading()} fallback={<li class="entity-value-input__hint">Loading…</li>}>
                        <For each={visible()}>
                            {(o,) => (
                                <li>
                                    {/* mousedown, not click: the input's blur would
                                        otherwise close the menu before click fires. */}
                                    <button
                                        type="button"
                                        class="entity-value-input__option"
                                        onMouseDown={(e,) => { e.preventDefault(); pick(o.value,); }}
                                    >
                                        {o.label}
                                        <Show when={o.label !== o.value}>
                                            <span class="entity-value-input__value">{o.value}</span>
                                        </Show>
                                    </button>
                                </li>
                            )}
                        </For>
                    </Show>
                </ul>
            </Show>
        </div>
    );
};

export default EntityValueInput;
