/**
 * `/mail` — the public archive of sent emails ("View newsletter archive"):
 * completed sends of every mailing list with "Public archive" on, newest first.
 * Each opens the non-personalised web view (`/mail/:jobId`).
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../services/cmsClient';
import { formatPageTitle, } from '../stores/siteSettings';
import './MailView.scss';

const PAGE_SIZE = 20;

const MailArchive: Component = () => {
    const [page, setPage,] = createSignal(1,);
    const [archive,] = createResource(page, async (p,) => {
        try {
            return await cms.mailArchive.list({ page: p, limit: PAGE_SIZE, },);
        } catch {
            return { data: [], meta: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0, }, };
        }
    },);
    const totalPages = () => archive()?.meta.totalPages ?? 0;

    return (
        <div class="mail-archive page-wrapper">
            <Title>{formatPageTitle('Email archive',)}</Title>
            <h1>Email archive</h1>
            <Show when={!archive.loading} fallback={<p class="mail-archive__empty">Loading…</p>}>
                <Show
                    when={(archive()?.data.length ?? 0) > 0}
                    fallback={<p class="mail-archive__empty">No emails have been published yet.</p>}
                >
                    <ul class="mail-archive__list">
                        <For each={archive()!.data}>
                            {(m,) => (
                                <li class="mail-archive__item">
                                    <A href={`/mail/${m.jobId}`}>
                                        <strong>{m.subject}</strong>
                                        <span class="mail-archive__meta">
                                            {m.listName}
                                            <Show when={m.sentAt}> · {new Date(m.sentAt!,).toLocaleDateString()}</Show>
                                        </span>
                                    </A>
                                </li>
                            )}
                        </For>
                    </ul>
                    <Show when={totalPages() > 1}>
                        <div class="mail-archive__pager">
                            <button type="button" class="btn" disabled={page() <= 1} onClick={() => setPage((p,) => p - 1,)}>← Newer</button>
                            <span>Page {page()} of {totalPages()}</span>
                            <button type="button" class="btn" disabled={page() >= totalPages()} onClick={() => setPage((p,) => p + 1,)}>Older →</button>
                        </div>
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default MailArchive;
