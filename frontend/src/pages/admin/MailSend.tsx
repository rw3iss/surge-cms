/**
 * Two-step send wizard. ?step=1 (compose) lets the operator pick a
 * list + template, edit meta + content blocks for this send only,
 * preview. ?step=2 (confirm) shows the embedded preview + recipient
 * count + Send button.
 *
 * State lives in createStore so navigating between steps via the
 * query param preserves the draft.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import {
    Component, createMemo, createSignal, For, onMount, Show,
} from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { MailingList, MailTemplate, } from '@rw/shared';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import MailPreviewModal from '../../components/admin/mail/MailPreviewModal';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { mailingListsApi, mailTemplatesApi, mailSendApi, } from '../../services/api';

interface DraftStore {
    listId: string;
    templateId: string | null;
    subject: string;
    preheader: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    blocks: BlockData[];
}

const MailSend: Component = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams,] = useSearchParams();

    const step = (): '1' | '2' => searchParams.step === '2' ? '2' : '1';

    const [lists, setLists,] = createSignal<MailingList[]>([],);
    const [templates, setTemplates,] = createSignal<MailTemplate[]>([],);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [sending, setSending,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const initialListId = typeof searchParams.list === 'string' ? searchParams.list : '';
    const [draft, setDraft,] = createStore<DraftStore>({
        listId: initialListId,
        templateId: null,
        subject: '',
        preheader: '',
        fromName: '',
        fromEmail: '',
        replyTo: '',
        blocks: [],
    },);

    onMount(async () => {
        const [lr, tr,] = await Promise.all([mailingListsApi.list(), mailTemplatesApi.list(),],);
        if (lr.success && lr.data) setLists(lr.data as MailingList[],);
        if (tr.success && tr.data) setTemplates(tr.data as MailTemplate[],);
    },);

    const selectedList = createMemo(() => lists().find((l,) => l.id === draft.listId,) ?? null,);

    const loadTemplate = async (id: string,): Promise<void> => {
        if (id === '' || id === '__new__') {
            setDraft({ templateId: null, blocks: [], });
            return;
        }
        const r = await mailTemplatesApi.get(id,);
        if (r.success && r.data) {
            const d = r.data as MailTemplate & { blocks: BackendBlock[]; };
            setDraft({
                templateId: d.id,
                subject: d.subject ?? '',
                preheader: d.preheader ?? '',
                fromName: d.fromName ?? '',
                fromEmail: d.fromEmail ?? '',
                replyTo: d.replyTo ?? '',
                blocks: backendToEditor(d.blocks ?? [],),
            });
        }
    };

    const canConfirm = (): boolean => Boolean(draft.listId,) && draft.subject.trim().length > 0
        && (draft.templateId !== null || draft.blocks.length > 0);

    const handleSend = async (): Promise<void> => {
        setSending(true,);
        setError(null,);
        try {
            const r = await mailSendApi.send({
                listId: draft.listId,
                templateId: draft.templateId,
                subject: draft.subject,
                preheader: draft.preheader || undefined,
                fromName: draft.fromName || undefined,
                fromEmail: draft.fromEmail || undefined,
                replyTo: draft.replyTo || undefined,
                blocks: editorToBackend(draft.blocks,),
            },);
            if (r.success && r.data) {
                const d = r.data as { jobId: string; };
                navigate(`/admin/mail/jobs/${d.jobId}`,);
            } else {
                setError(typeof r.error === 'string' ? r.error : 'Send failed.',);
            }
        } finally { setSending(false,); }
    };

    return (
        <div class="mail-send-page mailing-list-edit-page">
            <Title>Send Mail - Admin</Title>

            <div class="admin-header">
                <A href="/admin/mailing-lists" class="admin-header__back">← Mailing Lists</A>
                <h1>Send a Message — Step {step()} of 2</h1>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={step() === '1'}>
                <section class="admin-section">
                    <header class="admin-section__header"><h2>Choose list + template</h2></header>
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Mailing list</label>
                            <select
                                value={draft.listId}
                                onChange={(e,) => setDraft('listId', e.currentTarget.value,)}
                            >
                                <option value="">Select a list…</option>
                                <For each={lists()}>
                                    {(l,) => (
                                        <option value={l.id} disabled={!l.isEnabled}>
                                            {l.name} — {l.subscriberCount ?? 0} subscribers{!l.isEnabled ? ' (disabled)' : ''}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Template</label>
                            <select
                                value={draft.templateId ?? ''}
                                onChange={(e,) => { void loadTemplate(e.currentTarget.value,); }}
                            >
                                <option value="__new__">New blank template…</option>
                                <For each={templates().filter((t,) => t.isEnabled,)}>
                                    {(t,) => <option value={t.id}>{t.name}</option>}
                                </For>
                            </select>
                        </div>
                    </div>
                </section>

                <Show when={draft.listId}>
                    <section class="admin-section">
                        <header class="admin-section__header"><h2>Message details</h2></header>
                        <div class="form-grid">
                            <div class="form-group form-group--full">
                                <label>Subject <small class="form-help-muted">(supports {`{{variables}}`})</small></label>
                                <input type="text" value={draft.subject} onInput={(e,) => setDraft('subject', e.currentTarget.value,)} />
                            </div>
                            <div class="form-group form-group--full">
                                <label>Preheader</label>
                                <input type="text" value={draft.preheader} onInput={(e,) => setDraft('preheader', e.currentTarget.value,)} />
                            </div>
                            <div class="form-group">
                                <label>From name</label>
                                <input type="text" value={draft.fromName} onInput={(e,) => setDraft('fromName', e.currentTarget.value,)} />
                            </div>
                            <div class="form-group">
                                <label>From email</label>
                                <input type="email" value={draft.fromEmail} onInput={(e,) => setDraft('fromEmail', e.currentTarget.value,)} />
                            </div>
                            <div class="form-group form-group--full">
                                <label>Reply-to</label>
                                <input type="email" value={draft.replyTo} onInput={(e,) => setDraft('replyTo', e.currentTarget.value,)} />
                            </div>
                        </div>
                    </section>

                    <BlockEditor
                        title="Content (edits apply only to this send)"
                        blocks={draft.blocks}
                        onBlocksChange={(blocks,) => setDraft('blocks', blocks,)}
                    />

                    <div class="form-actions">
                        <button type="button" class="btn btn--secondary" onClick={() => setShowPreview(true,)} disabled={draft.blocks.length === 0}>
                            Preview
                        </button>
                        <button
                            type="button"
                            class="btn btn--primary"
                            disabled={!canConfirm()}
                            onClick={() => setSearchParams({ step: '2', },)}
                        >
                            Confirmation →
                        </button>
                    </div>
                </Show>
            </Show>

            <Show when={step() === '2'}>
                <section class="admin-section">
                    <header class="admin-section__header"><h2>Confirm + send</h2></header>
                    <Show when={selectedList()}>
                        {(l,) => (
                            <div class="send-confirm-summary">
                                <div><strong>List:</strong> {l().name}</div>
                                <div><strong>Recipients:</strong> {l().subscriberCount ?? 0}</div>
                                <Show when={l().registeredUsersOnly}><div><small>Registered users only</small></div></Show>
                                <Show when={l().doubleOptIn}><div><small>Double opt-in</small></div></Show>
                            </div>
                        )}
                    </Show>

                    <div class="send-confirm-preview">
                        <Show when={showPreview()}>
                            <MailPreviewModal
                                blocks={editorToBackend(draft.blocks,)}
                                subject={draft.subject}
                                preheader={draft.preheader || undefined}
                                onClose={() => setShowPreview(false,)}
                            />
                        </Show>
                        <button type="button" class="btn btn--secondary" onClick={() => setShowPreview(true,)}>
                            Open preview…
                        </button>
                    </div>

                    <div class="form-actions">
                        <button type="button" class="btn btn--secondary" onClick={() => setSearchParams({ step: '1', },)}>
                            ← Back
                        </button>
                        <button type="button" class="btn btn--primary" onClick={handleSend} disabled={sending()}>
                            {sending() ? 'Scheduling…' : `Send to ${selectedList()?.subscriberCount ?? 0} recipients`}
                        </button>
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default MailSend;
