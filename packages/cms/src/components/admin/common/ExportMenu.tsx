/**
 * "Export ▾" — CSV download or a printable page for an admin table.
 *
 * The caller passes a URL builder (from `cms.exports.*`) and the table's
 * CURRENT query (search / filter / sort), so what is exported is what is on
 * screen — every record, not just the visible page. Both formats are opened
 * by navigation: CSV becomes a download (the page stays put), Print opens a
 * standalone page in a new tab. Needs the `data:export` permission.
 */
import { createSignal, onCleanup, onMount, Show, type Component, } from 'solid-js';
import type { ExportFormat, ExportQuery, } from '@sitesurge/client';
import { isAdminRole, } from '@sitesurge/types';
import { useAuth, } from '../../../stores/auth';
import './ExportMenu.scss';

export interface ExportMenuProps {
    /** Builds the export URL for a format, with the table's current query. */
    url: (format: ExportFormat, query: ExportQuery,) => string;
    /** The table's current search / filter / sort. Read at click time. */
    query?: () => ExportQuery;
    class?: string;
}

const ExportMenu: Component<ExportMenuProps> = (props,) => {
    const auth = useAuth();
    const [open, setOpen,] = createSignal(false,);
    let root: HTMLDivElement | undefined;

    const onDocDown = (e: MouseEvent,) => {
        if (open() && root && !root.contains(e.target as Node,)) setOpen(false,);
    };
    const onKey = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') setOpen(false,);
    };
    onMount(() => {
        document.addEventListener('mousedown', onDocDown,);
        document.addEventListener('keydown', onKey,);
    },);
    onCleanup(() => {
        document.removeEventListener('mousedown', onDocDown,);
        document.removeEventListener('keydown', onKey,);
    },);

    const go = (format: ExportFormat, extra: ExportQuery = {},) => {
        setOpen(false,);
        const href = props.url(format, { ...(props.query?.() ?? {}), ...extra, },);
        if (format === 'csv') window.location.assign(href,); // attachment → download, page stays
        else window.open(href, '_blank', 'noopener',);
    };

    // Exports are admin-tier (+ `data:export`); an editor would only get a 403.
    return (
        <Show when={isAdminRole(auth.user?.role,)}>
        <div class={`export-menu ${props.class ?? ''}`} ref={root}>
            <button
                type="button"
                class="ui-button ui-button--secondary ui-button--sm"
                aria-haspopup="menu"
                aria-expanded={open()}
                onClick={() => setOpen(!open(),)}
            >
                Export ▾
            </button>
            <Show when={open()}>
                <div class="export-menu__list" role="menu">
                    <button type="button" role="menuitem" onClick={() => go('csv',)}>
                        <strong>CSV</strong>
                        <span>Download every matching record (all columns)</span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('print',)}>
                        <strong>Print</strong>
                        <span>Printable page in a new tab (basic columns)</span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('print', { columns: 'all', },)}>
                        <strong>Print — all columns</strong>
                        <span>Printable page with every column</span>
                    </button>
                </div>
            </Show>
        </div>
        </Show>
    );
};

export default ExportMenu;
