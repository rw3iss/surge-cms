/**
 * Mailing Lists admin index. Renders two collapsible sections — Lists
 * and Templates — plus a "Send a Message…" CTA at the top. Templates
 * section is a placeholder until Phase 3 wires the template editor.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { MailSendJob, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../../components/common/toast';

type JobWithListName = MailSendJob & { listName: string | null; };

const MailingLists: Component = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [copyingId, setCopyingId,] = createSignal<string | null>(null,);

    /** Clone a template (meta + blocks) and jump into editing the copy. */
    const copyTemplate = async (id: string,): Promise<void> => {
        if (copyingId()) return;
        setCopyingId(id,);
        try {
            const created = await cms.mailTemplates.copy(id,);
            toast.success('Template cloned',);
            navigate(`/admin/mail-templates/${created.id}`,); // leaving unmounts the spinner
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to clone template',);
            setCopyingId(null,);
        }
    };

    const [lists,] = createResource(async () => {
        try {
            return await cms.mailingLists.list();
        } catch {
            return [];
        }
    },);
    const [templates,] = createResource(async () => {
        try {
            return await cms.mailTemplates.list();
        } catch {
            return [];
        }
    },);
    const [jobs,] = createResource(async () => {
        try {
            return await cms.mailSend.listJobs({ limit: 50, },) as JobWithListName[];
        } catch {
            return [];
        }
    },);

    const statusBadge = (s: MailSendJob['status'],): string => {
        switch (s) {
            case 'completed': return 'badge--success';
            case 'failed':
            case 'cancelled': return 'badge--error';
            case 'running':
            case 'pending': return 'badge--info';
            default: return '';
        }
    };

    const formatTimestamp = (iso?: string,): string => iso ? new Date(iso,).toLocaleString() : '—';

    return (
        <div class="mailing-lists-page">
            <Title>Mailing Lists - Admin</Title>
            <div class="admin-header">
                <h1>Mailing Lists</h1>
                <div class="admin-header__actions">
                    <A href="/admin/mail/send" class="ui-button ui-button--secondary">Send a Message…</A>
                    <A href="/admin/mailing-lists/new" class="ui-button ui-button--primary">+ New List</A>
                </div>
            </div>

            <section class="admin-section admin-section--wide">
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
                                                    <A href={`/admin/mailing-lists/${l.id}`} class="ui-button ui-button--sm ui-button--secondary">Edit</A>
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

            <section class="admin-section admin-section--wide">
                <header class="admin-section__header">
                    <h2>Mail Templates</h2>
                    <div class="admin-section__actions">
                        <A href="/admin/mail-templates/new" class="ui-button ui-button--sm ui-button--primary">+ New Template</A>
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
                                                    <div style={{ display: 'flex', gap: '6px', }}>
                                                        <A href={`/admin/mail-templates/${t.id}`} class="ui-button ui-button--sm ui-button--secondary">Edit</A>
                                                        <button
                                                            type="button"
                                                            class="ui-button ui-button--sm ui-button--secondary"
                                                            disabled={copyingId() === t.id}
                                                            onClick={() => copyTemplate(t.id,)}
                                                        >
                                                            {copyingId() === t.id ? 'Copying…' : 'Copy'}
                                                        </button>
                                                    </div>
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

            <section class="admin-section admin-section--wide">
                <header class="admin-section__header">
                    <h2>Jobs (Sent)</h2>
                </header>
                <Show when={!jobs.loading} fallback={<p>Loading…</p>}>
                    <Show
                        when={(jobs() ?? []).length > 0}
                        fallback={<div class="empty-state"><em>No send jobs yet.</em></div>}
                    >
                        <div class="admin-table-container">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>Template</th>
                                        <th>List</th>
                                        <th>Status</th>
                                        <th>Progress</th>
                                        <th>Started</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={jobs() ?? []}>
                                        {(j,) => (
                                            <tr>
                                                <td>
                                                    <A href={`/admin/mail/jobs/${j.id}`} class="job-row__template">
                                                        {j.templateName ?? 'Custom (no template)'}
                                                        <Show when={j.templateName && j.templateWasModified}>
                                                            {' '}<span class="job-row__custom-tag">(custom)</span>
                                                        </Show>
                                                    </A>
                                                    <div class="job-row__subject">{j.subject}</div>
                                                </td>
                                                <td>{j.listName ?? <em class="form-help-muted">(deleted)</em>}</td>
                                                <td><span class={`badge ${statusBadge(j.status,)}`}>{j.status}</span></td>
                                                <td>{j.sentCount + j.failedCount}/{j.totalRecipients}</td>
                                                <td>{formatTimestamp(j.startedAt,)}</td>
                                                <td>
                                                    <A href={`/admin/mail/jobs/${j.id}`} class="ui-button ui-button--sm ui-button--secondary">View</A>
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
