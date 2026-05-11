/**
 * Mailing Lists admin index. Renders two collapsible sections — Lists
 * and Templates — plus a "Send a Message…" CTA at the top. Templates
 * section is a placeholder until Phase 3 wires the template editor.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import type { MailingList, MailTemplate, } from '@rw/shared';
import { mailingListsApi, mailTemplatesApi, } from '../../services/api';

const MailingLists: Component = () => {
    const [lists,] = createResource(async () => {
        const res = await mailingListsApi.list();
        return res.success ? (res as { data: MailingList[]; }).data : [];
    },);
    const [templates,] = createResource(async () => {
        const res = await mailTemplatesApi.list();
        return res.success ? (res as { data: MailTemplate[]; }).data : [];
    },);

    return (
        <div class="mailing-lists-page">
            <Title>Mailing Lists - Admin</Title>
            <div class="admin-header">
                <h1>Mailing Lists</h1>
                <div class="admin-header__actions">
                    <A href="/admin/mail/send" class="btn btn--secondary">Send a Message…</A>
                    <A href="/admin/mailing-lists/new" class="btn btn--primary">+ New List</A>
                </div>
            </div>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Lists</h2>
                </header>
                <Show when={!lists.loading} fallback={<p>Loading…</p>}>
                    <Show
                        when={(lists() ?? []).length > 0}
                        fallback={<div class="empty-state"><em>No lists yet. Create one to get started.</em></div>}
                    >
                        <div class="admin-table-container">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Slug</th>
                                        <th>Subscribers</th>
                                        <th>Status</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={lists() ?? []}>
                                        {(l,) => (
                                            <tr>
                                                <td><A href={`/admin/mailing-lists/${l.id}`}>{l.name}</A></td>
                                                <td><code>{l.slug}</code></td>
                                                <td>{l.subscriberCount ?? 0}</td>
                                                <td>{l.isEnabled ? <span class="badge badge--success">Enabled</span> : <span class="badge">Disabled</span>}</td>
                                                <td>
                                                    <A href={`/admin/mailing-lists/${l.id}`} class="btn btn--small btn--secondary">Edit</A>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </Show>
                </Show>
            </section>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Mail Templates</h2>
                    <div class="admin-section__actions">
                        <A href="/admin/mail-templates/new" class="btn btn--small btn--primary">+ New Template</A>
                    </div>
                </header>
                <Show when={!templates.loading} fallback={<p>Loading…</p>}>
                    <Show
                        when={(templates() ?? []).length > 0}
                        fallback={<div class="empty-state"><em>No templates yet. Create one to use in sends.</em></div>}
                    >
                        <div class="admin-table-container">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Subject</th>
                                        <th>Status</th>
                                        <th>Updated</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={templates() ?? []}>
                                        {(t,) => (
                                            <tr>
                                                <td><A href={`/admin/mail-templates/${t.id}`}>{t.name}</A></td>
                                                <td>{t.subject || <em class="form-help-muted">(none)</em>}</td>
                                                <td>{t.isEnabled ? <span class="badge badge--success">Enabled</span> : <span class="badge">Disabled</span>}</td>
                                                <td>{new Date(t.updatedAt,).toLocaleDateString()}</td>
                                                <td>
                                                    <A href={`/admin/mail-templates/${t.id}`} class="btn btn--small btn--secondary">Edit</A>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </Show>
                </Show>
            </section>
        </div>
    );
};

export default MailingLists;
