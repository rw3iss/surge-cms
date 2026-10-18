import { createSignal, For, Show, } from 'solid-js';
import type { BreakpointLayout, SiteBreakpoint, } from '@sitesurge/types';
import ThemeField from './ThemeField';

/**
 * Managed list of responsive breakpoints (Settings → Appearance). Edits are
 * lifted to the parent AppearancePanel, which persists them inside
 * `site_appearance` via the shared "Save Appearance" button. Any subset of the
 * four bounds may be set (open-ended ranges allowed); numeric-only values are
 * treated as px at render time.
 */
/** Tooltip shared by the Default Layout + per-breakpoint "Post Header Banner
 *  Height" fields. */
export const POST_HEADER_BANNER_HEIGHT_TOOLTIP =
    "Sets the post's header image (background) to a static height at the top of "
    + 'the post pages, so the banner has a fixed size (no load-time shift) and the '
    + 'title reads more centered. Any valid CSS value (e.g. 220px, 40vh). Leave '
    + 'blank to not set a static height.';

/** The per-breakpoint LAYOUT fields — mirror the "Default Layout" section. */
const BREAKPOINT_LAYOUT_FIELDS: {
    key: keyof BreakpointLayout;
    label: string;
    placeholder: string;
    tooltip?: string;
}[] = [
    { key: 'gutterWidth', label: 'Site Gutter', placeholder: 'e.g. 40px, 5%', },
    { key: 'pagePadding', label: 'Page Padding', placeholder: 'e.g. 80px, 4rem 0', },
    { key: 'postPadding', label: 'Post Padding', placeholder: 'e.g. 80px, 4rem 0', },
    { key: 'borderRadius', label: 'Border Radius', placeholder: 'e.g. 8px', },
    { key: 'maxContentWidth', label: 'Max Content Width', placeholder: 'e.g. 1200px', },
    { key: 'blockPadding', label: 'Block Default Padding', placeholder: 'e.g. 1rem, 20px', },
    {
        key: 'postHeaderBannerHeight',
        label: 'Post Header Banner Height',
        placeholder: 'e.g. 220px, 40vh',
        tooltip: POST_HEADER_BANNER_HEIGHT_TOOLTIP,
    },
];

export default function BreakpointsEditor(props: {
    value: SiteBreakpoint[];
    onChange: (bps: SiteBreakpoint[],) => void;
},) {
    // Which breakpoint's LAYOUT is being edited (right column), + a local draft
    // so Cancel discards and Save commits to the parent draft (persisted only by
    // the top "Save Appearance" button).
    const [editingId, setEditingId,] = createSignal<string | null>(null,);
    const [layoutDraft, setLayoutDraft,] = createSignal<BreakpointLayout>({},);
    const editing = () => props.value.find((b,) => b.id === editingId(),) ?? null;

    const update = (i: number, patch: Partial<SiteBreakpoint>,) =>
        props.onChange(props.value.map((b, idx,) => (idx === i ? { ...b, ...patch, } : b)),);
    const remove = (i: number,) => {
        if (props.value[i].id === editingId()) setEditingId(null,);
        props.onChange(props.value.filter((_, idx,) => idx !== i),);
    };
    const add = () =>
        props.onChange([
            ...props.value,
            { id: crypto.randomUUID(), name: '', minWidth: '', maxWidth: '', minHeight: '', maxHeight: '', },
        ],);

    const startEdit = (bp: SiteBreakpoint,) => { setLayoutDraft({ ...(bp.layout ?? {}), },); setEditingId(bp.id,); };
    const saveLayout = () => {
        const id = editingId();
        if (!id) return;
        props.onChange(props.value.map((b,) => (b.id === id ? { ...b, layout: { ...layoutDraft(), }, } : b)),);
        setEditingId(null,);
    };
    const setDraftField = (key: keyof BreakpointLayout, val: string,) =>
        setLayoutDraft((d,) => ({ ...d, [key]: val, }),);

    const boundInput = (i: number, key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',) => (
        <input
            type="text"
            class="theme-field__input"
            style={{ width: '65px', padding: '5px', }}
            maxLength={6}
            value={(props.value[i][key] as string | undefined) ?? ''}
            // onChange (commit on blur), NOT onInput: updating the array on every
            // keystroke gives the row a new object ref, so the keyed <For>
            // recreates the row and the focused input loses focus mid-type.
            onChange={(e,) => update(i, { [key]: e.currentTarget.value, },)}
            placeholder="—"
        />
    );

    // Layout lives in a class, not an inline style: it needs a media query to
    // collapse on a phone, and inline styles cannot carry one. See
    // `.breakpoints-layout` in _appearance.scss.
    return (
        <div class={`breakpoints-layout${editing() ? ' breakpoints-layout--editing' : ''}`}>
            {/* ── Left: the breakpoints list (its own section) ── */}
            <div class="theme-section breakpoints-editor">
                <h4 class="theme-section__title">Breakpoints</h4>
                <p class="theme-field__sublabel" style={{ 'margin-bottom': '0.75rem', }}>
                    Define responsive breakpoints (e.g. Mobile, Tablet). Content blocks then expose a
                    per-breakpoint style override, and the ✎ button here sets per-breakpoint site LAYOUT
                    overrides. Set any subset — a bare number is read as px; leave a bound blank for an
                    open-ended range.
                </p>
                    <Show
                        when={props.value.length}
                        fallback={<p class="form-help-muted" style={{ margin: '0 0 0.75rem', }}>No breakpoints yet.</p>}
                    >
                        {/* Wrapped so the six-column table scrolls inside its
                            own box on a narrow screen. Unwrapped it widened the
                            whole panel and the far columns were clipped by the
                            admin shell with no way to reach them. */}
                        <div class="admin-table-container">
                        <table class="admin-table breakpoints-editor__table" style={{ 'margin-bottom': '0.75rem', width: 'auto', }}>
                            <thead style={{ 'font-size': '0.7rem', }}>
                                <tr>
                                    <th>Name</th>
                                    <th>Min W</th>
                                    <th>Max W</th>
                                    <th>Min H</th>
                                    <th>Max H</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                <For each={props.value}>
                                    {(bp, i,) => (
                                        <tr style={editingId() === bp.id ? { background: 'var(--admin-bg-subtle, #f3f4f6)', } : {}}>
                                            <td>
                                                <input
                                                    type="text"
                                                    class="theme-field__input"
                                                    style={{ width: '96px', }}
                                                    value={bp.name}
                                                    onChange={(e,) => update(i(), { name: e.currentTarget.value, },)}
                                                    placeholder="e.g. Mobile"
                                                />
                                            </td>
                                            <td>{boundInput(i(), 'minWidth',)}</td>
                                            <td>{boundInput(i(), 'maxWidth',)}</td>
                                            <td>{boundInput(i(), 'minHeight',)}</td>
                                            <td>{boundInput(i(), 'maxHeight',)}</td>
                                            <td style={{ 'white-space': 'nowrap', }}>
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--secondary"
                                                    onClick={() => startEdit(bp,)}
                                                    title="Edit layout overrides for this breakpoint"
                                                    style={{ 'margin-right': '4px', }}
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--danger"
                                                    onClick={() => remove(i(),)}
                                                    title="Remove breakpoint"
                                                >
                                                    ✕
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                        </div>
                    </Show>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={add}>+ Add breakpoint</button>
            </div>

            {/* ── Right: per-breakpoint LAYOUT editor (its own section, shown while editing) ── */}
            <Show when={editing()}>
                <div class="theme-section breakpoints-editor__layout">
                        <h4 class="theme-section__title">Breakpoint Layout: {editing()!.name || '(unnamed)'}</h4>
                        <p class="theme-field__sublabel" style={{ 'margin-bottom': '0.75rem', }}>
                            Site-wide layout overrides applied only within this breakpoint's media query
                            (pages, posts, blocks). Leave a field blank to inherit the Default Layout.
                        </p>
                        <div class="theme-section__fields">
                            <For each={BREAKPOINT_LAYOUT_FIELDS}>
                                {(f,) => (
                                    <ThemeField label={f.label} tooltip={f.tooltip}>
                                        <input
                                            type="text"
                                            class="theme-field__input"
                                            style={{ width: '200px', }}
                                            value={(layoutDraft()[f.key] as string | undefined) ?? ''}
                                            onChange={(e,) => setDraftField(f.key, e.currentTarget.value,)}
                                            placeholder={f.placeholder}
                                        />
                                    </ThemeField>
                                )}
                            </For>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', 'margin-top': '0.75rem', }}>
                            <button type="button" class="ui-button ui-button--sm ui-button--primary" onClick={saveLayout}>Save</button>
                            <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => setEditingId(null,)}>Cancel</button>
                        </div>
                        <p class="form-help-muted" style={{ margin: '0.5rem 0 0', 'font-size': '0.75rem', }}>
                            "Save Appearance" (top) still persists everything.
                        </p>
                </div>
            </Show>
        </div>
    );
}
