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
import type { MailingList, MailTemplate, } from '@rw/cms-shared';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import MailPreviewModal from '../../components/admin/mail/MailPreviewModal';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { cms, } from '../../services/cmsClient';

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

    // Snapshot of the chosen template's state at the moment it was
    // loaded into the draft. Used to compute `templateWasModified` at
    // send time so the job detail page can show "(custom)" when the
    // operator edited blocks / meta after picking a template.
    const [loadedTemplateSnapshot, setLoadedTemplateSnapshot,] = createSignal<{
        subject: string; preheader: string;
        fromName: string; fromEmail: string; replyTo: string;
        blocksJson: string;
    } | null>(null,);

    onMount(async () => {
        try {
            const [lr, tr,] = await Promise.all([cms.mailingLists.list(), cms.mailTemplates.list(),],);
            setLists(lr as MailingList[],);
            setTemplates(tr as MailTemplate[],);
        } catch {
            /* error toasted by the bus */
        }
    },);

    const selectedList = createMemo(() => lists().find((l,) => l.id === draft.listId,) ?? null,);

    const loadTemplate = async (id: string,): Promise<void> => {
        if (id === '' || id === '__new__') {
            setDraft({ templateId: null, blocks: [], });
            setLoadedTemplateSnapshot(null,);
            return;
        }
        let d: (MailTemplate & { blocks: BackendBlock[]; }) | null = null;
        try {
            d = await cms.mailTemplates.getById(id,) as MailTemplate & { blocks: BackendBlock[]; };
        } catch {
            return;
        }
        if (d) {
            const blocks = backendToEditor(d.blocks ?? [],);
            setDraft({
                templateId: d.id,
                subject: d.subject ?? '',
                preheader: d.preheader ?? '',
                fromName: d.fromName ?? '',
                fromEmail: d.fromEmail ?? '',
                replyTo: d.replyTo ?? '',
                blocks,
            });
            setLoadedTemplateSnapshot({
                subject: d.subject ?? '',
                preheader: d.preheader ?? '',
                fromName: d.fromName ?? '',
                fromEmail: d.fromEmail ?? '',
                replyTo: d.replyTo ?? '',
                // JSON the editor-shape blocks so deep compare is a
                // single string match at send time.
                blocksJson: JSON.stringify(blocks,),
            },);
        }
    };

    /** True when the operator picked a template and then edited
     *  blocks / meta. False when the template is untouched or when no
     *  template was picked at all. */
    const isModifiedFromTemplate = (): boolean => {
        const snap = loadedTemplateSnapshot();
        if (!snap || !draft.templateId) return false;
        return draft.subject !== snap.subject
            || draft.preheader !== snap.preheader
            || draft.fromName !== snap.fromName
            || draft.fromEmail !== snap.fromEmail
            || draft.replyTo !== snap.replyTo
            || JSON.stringify(draft.blocks,) !== snap.blocksJson;
    };

    const canConfirm = (): boolean => Boolean(draft.listId,) && draft.subject.trim().length > 0
        && (draft.templateId !== null || draft.blocks.length > 0);

    const handleSend = async (): Promise<void> => {
        setSending(true,);
        setError(null,);
        try {
            const r = await cms.mailSend.send({
                listId: draft.listId,
                templateId: draft.templateId,
                templateWasModified: isModifiedFromTemplate(),
                subject: draft.subject,
                preheader: draft.preheader || undefined,
                fromName: draft.fromName || undefined,
                fromEmail: draft.fromEmail || undefined,
                replyTo: draft.replyTo || undefined,
                blocks: editorToBackend(draft.blocks,),
            } as any,);
            navigate(`/admin/mail/jobs/${(r as { jobId: string; }).jobId}`,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Send failed.',);
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
                            {/* The <select>'s value attr is set when
                                the element first renders, but the <For>
                                options arrive async from onMount — so
                                pre-selection via ?list=<id> needs to
                                drive the `selected` attr on the right
                                option once it exists. */}
                            <select
                                onChange={(e,) => setDraft('listId', e.currentTarget.value,)}
                            >
                                <option value="" selected={draft.listId === ''}>Select a list…</option>
                                <For each={lists()}>
                                    {(l,) => (
                                        <option value={l.id} disabled={!l.isEnabled} selected={l.id === draft.listId}>
                                            {l.name} — {l.subscriberCount ?? 0} subscribers{!l.isEnabled ? ' (disabled)' : ''}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Template</label>
                            <select
                                onChange={(e,) => { void loadTemplate(e.currentTarget.value,); }}
                            >
                                <option value="__new__" selected={draft.templateId === null}>New blank template…</option>
                                <For each={templates().filter((t,) => t.isEnabled,)}>
                                    {(t,) => <option value={t.id} selected={t.id === draft.templateId}>{t.name}</option>}
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

            {/* Preview modal mount lives at the top level so the
                Preview button on either step opens it. */}
            <Show when={showPreview()}>
                <MailPreviewModal
                    blocks={editorToBackend(draft.blocks,)}
                    subject={draft.subject}
                    preheader={draft.preheader || undefined}
                    onClose={() => setShowPreview(false,)}
                />
            </Show>
        </div>
    );
};

export default MailSend;
