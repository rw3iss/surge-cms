/**
 * Mail template create/edit page. Top section: meta (name, description,
 * enabled, subject, preheader, from/reply). Middle: BlockEditor mounted
 * on the template's blocks. Bottom: collapsible Variables reference.
 *
 * The block tree is loaded from `GET /mail-templates/:id` and saved
 * via `PUT /mail-templates/:id/blocks` (transactional replace).
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import {
    Component, createSignal, For, onMount, Show,
} from 'solid-js';
import type { MailTemplate, VariableDescriptor, } from '@rw/shared';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import MailPreviewModal from '../../components/admin/mail/MailPreviewModal';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { mailTemplatesApi, } from '../../services/api';

const MailTemplateEdit: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const isNew = () => params.id === 'new';

    const [name, setName,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [isEnabled, setIsEnabled,] = createSignal(true,);
    const [subject, setSubject,] = createSignal('',);
    const [preheader, setPreheader,] = createSignal('',);
    const [fromName, setFromName,] = createSignal('',);
    const [fromEmail, setFromEmail,] = createSignal('',);
    const [replyTo, setReplyTo,] = createSignal('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [variableCatalog, setVariableCatalog,] = createSignal<VariableDescriptor[]>([],);
    const [varsRefOpen, setVarsRefOpen,] = createSignal(false,);

    onMount(async () => {
        // Load the variable catalog once on mount; cheap, no DB read.
        try {
            const r = await mailTemplatesApi.variables();
            if (r.success && r.data) setVariableCatalog(r.data as VariableDescriptor[],);
        } catch { /* ignore */ }

        if (isNew()) return;
        const res = await mailTemplatesApi.get(params.id,);
        if (res.success && res.data) {
            const d = res.data as MailTemplate & { blocks: BackendBlock[]; };
            setName(d.name,);
            setDescription(d.description ?? '',);
            setIsEnabled(d.isEnabled,);
            setSubject(d.subject ?? '',);
            setPreheader(d.preheader ?? '',);
            setFromName(d.fromName ?? '',);
            setFromEmail(d.fromEmail ?? '',);
            setReplyTo(d.replyTo ?? '',);
            setBlocks(backendToEditor(d.blocks ?? [],),);
        }
    },);

    const handleSave = async (): Promise<void> => {
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
                const r = await mailTemplatesApi.create(meta,);
                if (r.success && r.data) {
                    const created = r.data as MailTemplate;
                    if (blocks().length > 0) {
                        await mailTemplatesApi.saveBlocks(created.id, editorToBackend(blocks(),),);
                    }
                    navigate(`/admin/mail-templates/${created.id}`,);
                } else {
                    setError(typeof r.error === 'string' ? r.error : 'Save failed.',);
                }
            } else {
                const r1 = await mailTemplatesApi.update(params.id, meta,);
                if (!r1.success) {
                    setError(typeof r1.error === 'string' ? r1.error : 'Save failed.',);
                    return;
                }
                await mailTemplatesApi.saveBlocks(params.id, editorToBackend(blocks(),),);
            }
        } finally { setSaving(false,); }
    };

    const handleDelete = async (): Promise<void> => {
        if (!confirm('Delete this template? This cannot be undone.',)) return;
        await mailTemplatesApi.remove(params.id,);
        navigate('/admin/mailing-lists',);
    };

    const previewBlocks = (): unknown[] => editorToBackend(blocks(),);

    return (
        <div class="mail-template-edit-page mailing-list-edit-page">
            <Title>{isNew() ? 'New Template' : name() || 'Edit Template'} - Admin</Title>

            <div class="admin-header">
                <A href="/admin/mailing-lists" class="admin-header__back">← Mailing Lists</A>
                <h1>{isNew() ? 'New Mail Template' : name() || '…'}</h1>
                <div class="admin-header__actions">
                    <Show when={!isNew()}>
                        <button type="button" class="btn btn--secondary" onClick={() => setShowPreview(true,)}>Preview</button>
                        <button type="button" class="btn btn--danger" onClick={handleDelete}>Delete</button>
                    </Show>
                    <Show when={isNew()}>
                        <button type="button" class="btn btn--secondary" onClick={() => setShowPreview(true,)} disabled={blocks().length === 0}>Preview</button>
                    </Show>
                    <button type="button" class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Settings</h2></header>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" value={name()} onInput={(e,) => setName(e.currentTarget.value,)} />
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" checked={isEnabled()} onChange={(e,) => setIsEnabled(e.currentTarget.checked,)} />
                            <span style="margin-left: .5rem">Enabled</span>
                        </label>
                    </div>
                    <div class="form-group form-group--full">
                        <label>Description</label>
                        <textarea rows={2} value={description()} onInput={(e,) => setDescription(e.currentTarget.value,)} />
                    </div>
                    <div class="form-group">
                        <label>Subject <small class="form-help-muted">(supports {`{{variables}}`})</small></label>
                        <input type="text" value={subject()} onInput={(e,) => setSubject(e.currentTarget.value,)} />
                    </div>
                    <div class="form-group">
                        <label>Preheader <small class="form-help-muted">(preview-pane line)</small></label>
                        <input type="text" value={preheader()} onInput={(e,) => setPreheader(e.currentTarget.value,)} />
                    </div>
                    <div class="form-group">
                        <label>From name</label>
                        <input type="text" value={fromName()} onInput={(e,) => setFromName(e.currentTarget.value,)} placeholder="Defaults to site name" />
                    </div>
                    <div class="form-group">
                        <label>From email</label>
                        <input type="email" value={fromEmail()} onInput={(e,) => setFromEmail(e.currentTarget.value,)} placeholder="Defaults to EMAIL_FROM" />
                    </div>
                    <div class="form-group form-group--full">
                        <label>Reply-to</label>
                        <input type="email" value={replyTo()} onInput={(e,) => setReplyTo(e.currentTarget.value,)} />
                    </div>
                </div>
            </section>

            <BlockEditor
                title="Content Blocks"
                blocks={blocks()}
                onBlocksChange={setBlocks}
            />

            <section class="admin-section">
                <header class="admin-section__header">
                    <button
                        type="button"
                        class="collapsible-toggle"
                        onClick={() => setVarsRefOpen(!varsRefOpen(),)}
                    >
                        {varsRefOpen() ? '▼' : '▶'} Variables reference ({variableCatalog().length})
                    </button>
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
                    onClose={() => setShowPreview(false,)}
                />
            </Show>
        </div>
    );
};

export default MailTemplateEdit;
