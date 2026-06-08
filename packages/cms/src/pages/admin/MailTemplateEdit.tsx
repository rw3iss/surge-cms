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
import type { MailTemplate, VariableDescriptor, } from '@rw/cms-shared';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import { FormField, FormSection, } from '../../components/admin/forms';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import MailPreviewModal from '../../components/admin/mail/MailPreviewModal';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { cms, } from '../../services/cmsClient';

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
            setVariableCatalog(await cms.mailTemplates.variables() as VariableDescriptor[],);
        } catch { /* ignore */ }

        if (isNew()) return;
        let d: (MailTemplate & { blocks: BackendBlock[]; }) | null = null;
        try {
            d = await cms.mailTemplates.getById(params.id,) as MailTemplate & { blocks: BackendBlock[]; };
        } catch {
            return;
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
                const created = await cms.mailTemplates.create(meta as any,) as MailTemplate;
                if (blocks().length > 0) {
                    await cms.mailTemplates.replaceBlocks(created.id, { blocks: editorToBackend(blocks(),), } as any,);
                }
                navigate(`/admin/mail-templates/${created.id}`,);
            } else {
                await cms.mailTemplates.update(params.id, meta as any,);
                await cms.mailTemplates.replaceBlocks(params.id, { blocks: editorToBackend(blocks(),), } as any,);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed.',);
        } finally { setSaving(false,); }
    };

    const handleDelete = async (): Promise<void> => {
        if (!confirm('Delete this template? This cannot be undone.',)) return;
        await cms.mailTemplates.remove(params.id,);
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
                                    placeholder="Defaults to site name"
                                />
                            </FormField>
                            <FormField label="From email" class="template-settings__field--grow">
                                <input
                                    type="email"
                                    value={fromEmail()}
                                    onInput={(e,) => setFromEmail(e.currentTarget.value,)}
                                    placeholder="Defaults to EMAIL_FROM"
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
                            />
                        </FormField>
                    </FormSection>
                </div>
            </section>

            <BlockEditor
                title="Content Blocks"
                blocks={blocks()}
                onBlocksChange={setBlocks}
            />

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
                    onClose={() => setShowPreview(false,)}
                />
            </Show>
        </div>
    );
};

export default MailTemplateEdit;
