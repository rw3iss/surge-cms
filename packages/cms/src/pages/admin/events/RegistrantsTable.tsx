/**
 * Attendee list for one occurrence, shown inside the event modal once
 * registration is on. Paged because a popular event's list is unbounded, and
 * loading it whole would stall the modal it lives in.
 */
import { Component, For, Show, createResource, createSignal, } from 'solid-js';
import type { EventRegistration, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';

export interface RegistrantsTableProps {
    eventId: string;
    /** Which occurrence's attendees to show. */
    occurrenceDate: string;
}

const PAGE_SIZE = 25;

const RegistrantsTable: Component<RegistrantsTableProps> = (props,) => {
    const [page, setPage,] = createSignal(1,);

    const [result] = createResource(
        () => ({ id: props.eventId, date: props.occurrenceDate, page: page(), }),
        async (k,) => {
            try {
                return await cms.events.registrations(k.id, {
                    occurrenceDate: k.date, page: k.page, limit: PAGE_SIZE,
                },) as { data: EventRegistration[]; meta: { total: number; totalPages: number; }; };
            } catch {
                return { data: [], meta: { total: 0, totalPages: 0, }, };
            }
        },
    );

    const rows = () => result()?.data ?? [];
    const total = () => result()?.meta?.total ?? 0;
    const totalPages = () => result()?.meta?.totalPages ?? 0;

    return (
        <div class="event-registrants">
            <div class="event-registrants__head">
                <h3>Registrations</h3>
                <span class="form-help-muted">
                    {total()} {total() === 1 ? 'person' : 'people'} for {props.occurrenceDate}
                </span>
            </div>

            <Show when={result.loading}><p>Loading…</p></Show>

            <Show
                when={!result.loading && rows().length > 0}
                fallback={
                    <Show when={!result.loading}>
                        <p class="form-help-muted">No registrations for this date yet.</p>
                    </Show>
                }
            >
                <table class="admin-table">
                    <thead>
                        <tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Registered</th></tr>
                    </thead>
                    <tbody>
                        <For each={rows()}>
                            {(r,) => (
                                <tr>
                                    <td>{r.name || <em class="form-help-muted">—</em>}</td>
                                    <td>{r.email}</td>
                                    <td>{r.phone || <em class="form-help-muted">—</em>}</td>
                                    <td>
                                        <span class={`badge ${r.status === 'registered' ? 'badge--success' : ''}`}>
                                            {r.status}
                                        </span>
                                    </td>
                                    <td>{new Date(r.createdAt,).toLocaleDateString()}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>

                <Show when={totalPages() > 1}>
                    <div class="event-registrants__pager">
                        <button
                            type="button" class="ui-button ui-button--sm ui-button--secondary"
                            disabled={page() <= 1} onClick={() => setPage((p,) => p - 1)}
                        >Previous</button>
                        <span>Page {page()} of {totalPages()}</span>
                        <button
                            type="button" class="ui-button ui-button--sm ui-button--secondary"
                            disabled={page() >= totalPages()} onClick={() => setPage((p,) => p + 1)}
                        >Next</button>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default RegistrantsTable;
