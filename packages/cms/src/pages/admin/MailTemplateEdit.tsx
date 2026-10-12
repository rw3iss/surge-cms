/**
 * Mail template create/edit page. Top section: meta (name, description,
 * enabled, subject, preheader, from/reply). Middle: BlockEditor mounted
 * on the template's blocks. Bottom: collapsible Variables reference.
 *
 * The block tree is loaded from `GET /mail-templates/:id` and saved
 * via `PUT /mail-templates/:id/blocks` (transactional replace).
 *
 * Drafts: unsaved edits are kept in localStorage (`rw-draft:mail-template-draft-<id>`)
 * — debounced on every change, every 10 s while dirty, and when the page is
 * left or the tab is hidden/closed. Opening the template again restores a
 * draft that is NEWER than the saved version (same rule as the page/post
 * editors); Revert discards it. So leaving never asks "discard changes?" —
 * nothing is discarded.
 */
import { A, useNavigate, useParams, } from '@solidjs/router';
import {
    Component, createEffect, createSignal, For, onCleanup, onMount, Show,
} from 'solid-js';
import type { MailingListsSettings, MailTemplate, VariableDescriptor, } from '@sitesurge/types';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import { FormField, FormSection, } from '../../components/admin/forms';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import MailPreviewModal from '../../components/admin/mail/MailPreviewModal';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../../components/common/toast';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import { useEditorDraft, } from '../../hooks/useEditorDraft';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { buildMailPreviewVariables, setPreviewVariables, } from '../../stores/previewVariables';
import RevisionsPanel from '../../components/admin/panels/RevisionsPanel';
import AdminTitle from '../../components/admin/common/AdminTitle';

const MailTemplateEdit: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const toast = useToast();
    const [copying, setCopying,] = createSignal(false,);
    const isNew = () => params.id === 'new';

    const [name, setName,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [isEnabled, setIsEnabled,] = createSignal(true,);
    const [subject, setSubject,] = createSignal('',);
    const [preheader, setPreheader,] = createSignal('',);
    const [fromName, setFromName,] = createSignal('',);
    const [fromEmail, setFromEmail,] = createSignal('',);
    const [replyTo, setReplyTo,] = createSignal('',);
    /**
     * Sender defaults from Settings → Mailing Lists, shown as PLACEHOLDER text.
     *
     * Placeholder rather than a pre-filled value on purpose: a blank field
     * means "use the default", so the template keeps following the setting if
     * the operator changes it later. Pre-filling would copy the value in and
     * freeze it — the classic way a defaults page stops having any effect.
     * The send worker applies the same values, so this shows what will
     * genuinely be used.
     */
    const [listDefaults, setListDefaults,] = createSignal<MailingListsSettings>({},);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [variableCatalog, setVariableCatalog,] = createSignal<VariableDescriptor[]>([],);
    const [varsRefOpen, setVarsRefOpen,] = createSignal(false,);
    const [showRevertConfirm, setShowRevertConfirm,] = createSignal(false,);
    const [showDeleteConfirm, setShowDeleteConfirm,] = createSignal(false,);

    /**
     * The block list as last SAVED.
     *
     * The BlockEditor derives each block's "Unsaved changes" bar by diffing
     * against this. It was never passed, so `savedSnapshots` stayed empty and
     * every block compared against `undefined` — which the diff treats as a
     * brand-new block, i.e. permanently dirty. That is why saving never
     * cleared the bar: nothing ever told the editor what "saved" looked like.
     */
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    /** Bumped after a save / restore so the History panel re-reads. */
    const [historyToken, setHistoryToken,] = createSignal(0,);

    /** Everything a save writes, in one object — the unit of comparison. */
    const formState = () => ({
        name: name(),
        description: description(),
        isEnabled: isEnabled(),
        subject: subject(),
        preheader: preheader(),
        fromName: fromName(),
        fromEmail: fromEmail(),
        replyTo: replyTo(),
        blocks: blocks(),
    });
    type FormState = ReturnType<typeof formState>;

    const draft = useEditorDraft<FormState>({ current: formState, },);

    /**
     * The persisted draft. The key is a GETTER: `/mail-templates/new` and
     * `/mail-templates/:id` are one route, so saving a new template changes
     * the id without remounting this page.
     */
    /** Set once the saved version is loaded AND any draft restored — before
     *  that the form is mid-load and must neither write nor clear a draft. */
    const [ready, setReady,] = createSignal(false,);
    const autoSave = useAutoSave<FormState>({
        get key() {
            return `mail-template-draft-${params.id || 'new'}`;
        },
        state: formState,
        // Only once loaded (the baseline exists) and only while it differs —
        // a form that matches the saved version has no draft to keep.
        enabled: () => ready() && draft.isDirty(),
    },);

    // Back to the saved state (typed back, Revert, Save, History restore):
    // the stored draft is now stale — drop it.
    createEffect(() => {
        if (ready() && !draft.isDirty() && autoSave.hasDraft()) autoSave.clear();
    },);

    /** Write the draft now, if there is anything to keep. */
    const flushDraft = () => {
        if (ready() && draft.isDirty()) autoSave.flush();
    };
    // Every 10 s while dirty, and when the tab is hidden / closed / reloaded.
    const interval = setInterval(flushDraft, 10_000,);
    const onHidden = () => { if (document.visibilityState === 'hidden') flushDraft(); };
    window.addEventListener('pagehide', flushDraft,);
    document.addEventListener('visibilitychange', onHidden,);
    onCleanup(() => {
        // Leaving the page inside the admin: keep the edits for next time.
        flushDraft();
        clearInterval(interval,);
        window.removeEventListener('pagehide', flushDraft,);
        document.removeEventListener('visibilitychange', onHidden,);
    },);

    const applyState = (st: FormState,): void => {
        setName(st.name ?? '',);
        setDescription(st.description ?? '',);
        setIsEnabled(st.isEnabled ?? true,);
        setSubject(st.subject ?? '',);
        setPreheader(st.preheader ?? '',);
        setFromName(st.fromName ?? '',);
        setFromEmail(st.fromEmail ?? '',);
        setReplyTo(st.replyTo ?? '',);
        setBlocks(st.blocks ?? [],);
    };

    /** Put every field back to the saved version and delete the draft. */
    const revertDraft = (): void => {
        const base = draft.revert();
        setShowRevertConfirm(false,);
        autoSave.clear();
        if (!base) return;
        applyState(base,);
        setSavedBlocks(structuredClone(base.blocks,),);
        toast.info('Reverted to the last saved version.',);
    };

    /**
     * After the saved version is loaded (and captured as the baseline): put a
     * stored draft back over it when the draft is NEWER than the saved
     * template. An older draft means someone saved since — it is discarded.
     * The baseline stays the saved version, so the header shows Unsaved
     * changes + Revert, and the per-block bars show what the draft changed.
     */
    const restoreDraft = (savedAt: number,): void => {
        const stored = autoSave.getDraft();
        if (!stored) return;
        if (stored.timestamp > savedAt + 1000) {
            applyState(stored.data,);
            toast.info('Restored your unsaved draft of this template. Use Revert to discard it.',);
        } else {
            autoSave.clear();
        }
    };

    /** Read the saved template into the form (on open, and after a restore). */
    const loadTemplate = async (): Promise<number> => {
        let d: (MailTemplate & { blocks: BackendBlock[]; }) | null = null;
        try {
            d = await cms.mailTemplates.getById(params.id,) as MailTemplate & { blocks: BackendBlock[]; };
        } catch {
            return 0;
        }
        if (d) {
            setName(d.name,);
            setDescription(d.description ?? '',);
            setIsEnabled(d.isEnabled,);
            setSubject(d.subject ?? '',);
            setPreheader(d.preheader ?? '',);
            setFromName(d.fromName ?? '',);
            setFromEmail(d.fromEmail ?? '',);
            setReplyTo(d.replyTo ?? '',);
            const loaded = backendToEditor(d.blocks ?? [],);
            setBlocks(loaded,);
            setSavedBlocks(structuredClone(loaded,),);
        }
        return d ? new Date(d.updatedAt || 0,).getTime() : 0;
    };

    onMount(async () => {
        // Load the variable catalog once on mount; cheap, no DB read.
        try {
            setVariableCatalog(await cms.mailTemplates.variables() as VariableDescriptor[],);
        } catch { /* ignore */ }

        // Sender defaults — shown as placeholders so the operator can see what
        // a blank field will actually send as.
        try {
            setListDefaults(await cms.settings.getMailingListsSettings() as MailingListsSettings,);
        } catch { /* non-fatal — placeholders fall back to generic text */ }

        if (isNew()) {
            draft.capture(formState(),);
            restoreDraft(0,); // nothing saved yet: any draft is newer
            setReady(true,);
            return;
        }
        const savedAt = await loadTemplate();
        draft.capture(formState(),);
        restoreDraft(savedAt,);
        setReady(true,);
    },);

    /**
     * Make the current state the saved state.
     *
     * Two things, and BOTH are needed: the draft baseline (drives the header's
     * unsaved-changes bar and Revert) and `savedBlocks` (drives the per-block
     * bar inside the BlockEditor). Updating only one leaves the other claiming
     * unsaved changes forever, which is the bug this fixes.
     */
    const commitSaved = (): void => {
        setSavedBlocks(structuredClone(blocks(),),);
        draft.capture(formState(),);
    };

    const handleSave = async (): Promise<void> => {
        // The server save takes over from the draft: no competing write.
        autoSave.cancel();
        setSaving(true,);
        setError(null,);
        try {
            const meta = {
                name: name(),
                description: description() || undefined,
                isEnabled: isEnabled(),
                subject: subject(),
                preheader: preheader() || undefined,
                fromName: fromName() || undefined,
                fromEmail: fromEmail() || undefined,
                replyTo: replyTo() || undefined,
            };
            if (isNew()) {
                const created = await cms.mailTemplates.create(meta as any,) as MailTemplate;
                if (blocks().length > 0) {
                    await cms.mailTemplates.replaceBlocks(created.id, { blocks: editorToBackend(blocks(),), } as any,);
                }
                commitSaved();
                autoSave.clear(); // the `new` draft — the key moves to the id below
                toast.success('Template saved',);
                navigate(`/admin/mail-templates/${created.id}`,);
            } else {
                await cms.mailTemplates.update(params.id, meta as any,);
                await cms.mailTemplates.replaceBlocks(params.id, { blocks: editorToBackend(blocks(),), } as any,);
                commitSaved();
                autoSave.clear();
                toast.success('Template saved',);
                // List the new version straight away rather than after the
                // server's settle delay.
                void cms.mailTemplates.snapshotRevision(params.id,).catch(() => {},).finally(() => setHistoryToken((n,) => n + 1,),);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Save failed.';
            setError(msg,);
            toast.error(msg,);
        } finally { setSaving(false,); }
    };

    const handleDelete = async (): Promise<void> => {
        try {
            await cms.mailTemplates.remove(params.id,);
            // The row is gone: drop the draft and stop keeping one.
            setReady(false,);
            autoSave.clear();
            draft.reset();
            toast.success('Template deleted',);
            navigate('/admin/mailing-lists',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete template',);
        }
    };

    /** Clone this template (its saved state + blocks) and open the copy. */
    const handleCopy = async (): Promise<void> => {
        if (copying()) return;
        setCopying(true,);
        try {
            const created = await cms.mailTemplates.copy(params.id,);
            toast.success('Template cloned',);
            navigate(`/admin/mail-templates/${created.id}`,);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to clone template',);
            setCopying(false,);
        }
    };

    /*
     * Publish the mail variable bag for the admin BLOCK previews.
     *
     * `{{list.*}}` / `{{template.*}}` are bound by the send worker, so the
     * client runtime has no source for them and a block preview rendered a
     * blank where the sent email will have a value — visible in the Custom
     * HTML editor's Preview tab, which resolves through that runtime.
     *
     * Samples come from the same catalog the Variables reference below shows,
     * so the two cannot disagree. The fields the editor genuinely knows are
     * overridden with their REAL values.
     */
    createEffect(() => {
        setPreviewVariables(buildMailPreviewVariables(variableCatalog(), {
            'template.name': name(),
            'template.subject': subject(),
            'template.preheader': preheader(),
        },),);
    },);

    // Leave the store empty for every other editor, or a page preview would
    // inherit this one's sample subscriber.
    onCleanup(() => setPreviewVariables(undefined,));

    const previewBlocks = (): unknown[] => editorToBackend(blocks(),);

    return (
        <div class="mail-template-edit-page mailing-list-edit-page">
            <AdminTitle>{isNew() ? 'New Template' : name() || 'Edit Template'}</AdminTitle>

            <ConfirmModal
                open={showRevertConfirm()}
                title="Discard draft edits"
                message={
                    'This removes every unsaved change to this template (including the stored draft) and '
                    + 'restores the version that is currently saved. It cannot be undone.'
                }
                confirmLabel="Discard edits"
                danger
                onConfirm={revertDraft}
                onCancel={() => setShowRevertConfirm(false,)}
            />

            <ConfirmModal
                open={showDeleteConfirm()}
                title="Delete template"
                message="Delete this template? This cannot be undone."
                confirmLabel="Delete"
                danger
                onConfirm={() => { setShowDeleteConfirm(false,); void handleDelete(); }}
                onCancel={() => setShowDeleteConfirm(false,)}
            />

            <div class="admin-header admin-header--sticky">
                <A href="/admin/mailing-lists" class="admin-header__back">← Mailing Lists</A>
                <h1>{isNew() ? 'New Mail Template' : name() || '…'}</h1>
                <div class="admin-header__actions">
                    {/* Mirrors the page editor: the unsaved-changes note and
                        Revert sit with the actions, so one glance answers
                        "is there anything outstanding?" */}
                    <Show when={draft.isDirty()}>
                        <span
                            class="admin-header__dirty"
                            title="Your edits are kept as a draft in this browser and come back when you open this template again."
                        >
                            Unsaved changes{autoSave.lastSavedAt() ? ' · draft kept' : ''}
                        </span>
                        <button
                            type="button"
                            class="ui-button ui-button--ghost ui-button--sm"
                            title="Remove all current draft edits and return this template to its saved version."
                            onClick={() => setShowRevertConfirm(true,)}
                        >
                            Revert
                        </button>
                    </Show>
                    <button
                        type="button"
                        class="ui-button ui-button--ghost ui-button--sm"
                        onClick={() => setShowPreview(true,)}
                        disabled={isNew() && blocks().length === 0}
                    >
                        Preview
                    </button>
                    <Show when={!isNew()}>
                        <button
                            type="button"
                            class="ui-button ui-button--secondary ui-button--sm"
                            title="Create a copy of this template and open it"
                            onClick={handleCopy}
                            disabled={copying()}
                        >
                            {copying() ? 'Cloning…' : 'Clone'}
                        </button>
                        <button
                            type="button"
                            class="ui-button ui-button--danger ui-button--sm"
                            onClick={() => setShowDeleteConfirm(true,)}
                        >
                            Delete
                        </button>
                    </Show>
                    <button
                        type="button"
                        class="ui-button ui-button--primary ui-button--sm"
                        onClick={handleSave}
                        disabled={saving()}
                    >
                        {saving() ? 'Saving…' : 'Save Template'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <section class="admin-section template-settings">
                <header class="admin-section__header"><h2>Settings</h2></header>

                <div class="template-settings__grid">
                    <FormSection title="Identity">
                        <div class="template-settings__row">
                            <FormField label="Name" class="template-settings__field--grow">
                                <input
                                    type="text"
                                    value={name()}
                                    onInput={(e,) => setName(e.currentTarget.value,)}
                                />
                            </FormField>
                            <FormField label="Enabled" inline>
                                <Toggle checked={isEnabled()} onChange={setIsEnabled} ariaLabel="Enabled" />
                            </FormField>
                        </div>
                        <FormField label="Description">
                            <textarea
                                rows={2}
                                value={description()}
                                onInput={(e,) => setDescription(e.currentTarget.value,)}
                            />
                        </FormField>
                    </FormSection>

                    <FormSection title="Email headers">
                        <FormField
                            label="Subject"
                            hint={`Shown in the recipient's inbox. Supports {{variables}}.`}
                        >
                            <input
                                type="text"
                                value={subject()}
                                onInput={(e,) => setSubject(e.currentTarget.value,)}
                            />
                        </FormField>
                        <FormField
                            label="Preheader"
                            hint="Short preview-pane line shown next to the subject."
                        >
                            <input
                                type="text"
                                value={preheader()}
                                onInput={(e,) => setPreheader(e.currentTarget.value,)}
                            />
                        </FormField>
                    </FormSection>

                    <FormSection title="Sender">
                        <div class="template-settings__row">
                            <FormField label="From name" class="template-settings__field--grow">
                                <input
                                    type="text"
                                    value={fromName()}
                                    onInput={(e,) => setFromName(e.currentTarget.value,)}
                                    placeholder={listDefaults().defaultFromName || 'Defaults to site name'}
                                />
                            </FormField>
                            <FormField label="From email" class="template-settings__field--grow">
                                <input
                                    type="email"
                                    value={fromEmail()}
                                    onInput={(e,) => setFromEmail(e.currentTarget.value,)}
                                    placeholder={listDefaults().defaultFromEmail || 'Defaults to EMAIL_FROM'}
                                />
                            </FormField>
                        </div>
                        <FormField
                            label="Reply-to"
                            hint="Where replies land. Leave blank to use From email."
                        >
                            <input
                                type="email"
                                value={replyTo()}
                                onInput={(e,) => setReplyTo(e.currentTarget.value,)}
                                placeholder={listDefaults().defaultReplyTo || 'Defaults to From email'}
                            />
                        </FormField>
                    </FormSection>
                </div>
            </section>

            <BlockEditor
                title="Content Blocks"
                blocks={blocks()}
                savedBlocks={savedBlocks()}
                onBlocksChange={setBlocks}
            />

            <Show when={!isNew()}>
                <section class="admin-section">
                    <RevisionsPanel
                        entityType="mail_template"
                        entityId={params.id}
                        refreshToken={historyToken()}
                        onRestored={async () => {
                            autoSave.clear();
                            await loadTemplate();
                            // The restored version IS the saved state now.
                            draft.capture(formState(),);
                            setHistoryToken((n,) => n + 1,);
                        }}
                    />
                </section>
            </Show>

            <section class="admin-section variables-reference-section">
                <header class="admin-section__header variables-reference-section__header">
                    <button
                        type="button"
                        class="collapsible-toggle"
                        onClick={() => setVarsRefOpen(!varsRefOpen(),)}
                    >
                        {varsRefOpen() ? '▼' : '▶'} Variables reference ({variableCatalog().length})
                    </button>
                    <Tooltip
                        header="Variables"
                        content={
                            <>
                                <p style={{ margin: '0 0 0.5rem', }}>
                                    Use these <code>{`{{tokens}}`}</code> inside any content
                                    block (Rich Text, Custom HTML, URL Link, etc.) or in the
                                    Subject / Preheader fields. They're replaced with each
                                    recipient's data at send time.
                                </p>
                                <p style={{ margin: 0, }}>
                                    Example: <code>{`Hi {{user.name}}!`}</code> →
                                    <strong> Hi Jane!</strong>
                                </p>
                            </>
                        }
                    />
                </header>
                <Show when={varsRefOpen()}>
                    <table class="admin-table variable-catalog">
                        <thead><tr><th>Variable</th><th>Description</th></tr></thead>
                        <tbody>
                            <For each={variableCatalog()}>
                                {(v,) => (
                                    <tr>
                                        <td><code>{`{{${v.path}}}`}</code></td>
                                        <td>{v.description}</td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </Show>
            </section>

            <Show when={showPreview()}>
                <MailPreviewModal
                    blocks={previewBlocks()}
                    subject={subject()}
                    preheader={preheader()}
                    templateName={name()}
                    onClose={() => setShowPreview(false,)}
                />
            </Show>
        </div>
    );
};

export default MailTemplateEdit;
