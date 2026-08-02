/**
 * Users-feature settings page (`/admin/users/settings`, admin-only).
 *
 * First setting: "Require new users to validate their email before login"
 * (default ON). When on, an optional "Customize Verification Email" panel
 * reuses the block editor + `{{ }}` variable reference — stored standalone in
 * `users_settings` (no Mailing Lists dependency). Empty content → the backend
 * sends a built-in styled default with the verification link.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import type { UsersSettings, } from '@sitesurge/types';
import BlockEditor, { BlockData, } from '../../components/admin/blocks/BlockEditor';
import TemplateReference from '../../components/admin/blocks/TemplateReference';
import { backendToEditor, BackendBlock, editorToBackend, } from '../../components/admin/mail/blockConverters';
import { FormField, } from '../../components/admin/forms';
import Toggle from '../../components/admin/common/Toggle';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';

const AdminUsersSettings: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [requireVerification, setRequireVerification,] = createSignal(true,);
    const [subject, setSubject,] = createSignal('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [customizeOpen, setCustomizeOpen,] = createSignal(false,);
    const [refOpen, setRefOpen,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);

    onMount(async () => {
        try {
            const s = await cms.settings.getUsersSettings() as UsersSettings;
            setRequireVerification(s.requireEmailVerification !== false,);
            setSubject(s.verificationEmail?.subject ?? '',);
            const stored = (s.verificationEmail?.blocks ?? []) as unknown as BackendBlock[];
            setBlocks(backendToEditor(stored,),);
            // Auto-expand the customize panel if the operator already has one.
            if (stored.length > 0 || (s.verificationEmail?.subject ?? '')) setCustomizeOpen(true,);
        } catch { /* error bus */ } finally {
            setLoaded(true,);
        }
    },);

    const save = async (): Promise<void> => {
        setSaving(true,);
        try {
            await cms.settings.usersSettings({
                requireEmailVerification: requireVerification(),
                verificationEmail: {
                    subject: subject(),
                    blocks: editorToBackend(blocks(),) as unknown as Array<Record<string, unknown>>,
                },
            },);
            toast.success('Users settings saved.',);
        } catch { /* error bus */ } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="users-settings-page">
            <Title>Users Settings - Admin</Title>

            <div class="admin-header">
                <A href="/admin/users" class="admin-header__back">← Users</A>
                <h1>Users Settings</h1>
                <div class="admin-header__actions">
                    <button class="btn btn--primary" onClick={save} disabled={saving() || !loaded()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <section class="admin-section">
                    <header class="admin-section__header"><h2>Email verification</h2></header>
                    <div class="form-section">
                        <FormField label="Require new users to validate their email before login" inline>
                            <Toggle
                                checked={requireVerification()}
                                onChange={setRequireVerification}
                                ariaLabel="Require email verification"
                            />
                        </FormField>
                        <p class="form-help-muted">
                            When enabled, a member who signs up must click a verification link emailed
                            to them before they can log in. Staff and Patreon accounts are unaffected.
                        </p>

                        <Show when={requireVerification()}>
                            <button
                                type="button"
                                class="collapsible-toggle"
                                onClick={() => setCustomizeOpen(!customizeOpen(),)}
                            >
                                {customizeOpen() ? '▼' : '▶'} Customize Verification Email
                            </button>

                            <Show when={customizeOpen()}>
                                <div class="users-settings-page__verification">
                                    <FormField
                                        label="Subject"
                                        hint="Supports {{variables}} — e.g. Verify your email for {{site.name}}."
                                    >
                                        <input
                                            type="text"
                                            value={subject()}
                                            onInput={(e,) => setSubject(e.currentTarget.value,)}
                                            placeholder="Verify your email address"
                                        />
                                    </FormField>
                                    <p class="form-help-muted">
                                        Leave the content empty to use the built-in default email. Add blocks
                                        below to fully customize the message — use{' '}
                                        <code>{'{{verification_url}}'}</code> for the confirmation link and{' '}
                                        <code>{'{{user.name}}'}</code> for the recipient's name.
                                    </p>

                                    <BlockEditor
                                        title="Verification Email Content"
                                        blocks={blocks()}
                                        onBlocksChange={setBlocks}
                                    />

                                    <section class="admin-section variables-reference-section">
                                        <header class="admin-section__header variables-reference-section__header">
                                            <button
                                                type="button"
                                                class="collapsible-toggle"
                                                onClick={() => setRefOpen(!refOpen(),)}
                                            >
                                                {refOpen() ? '▼' : '▶'} Variable & Function Reference
                                            </button>
                                        </header>
                                        <Show when={refOpen()}>
                                            <TemplateReference />
                                        </Show>
                                    </section>
                                </div>
                            </Show>
                        </Show>
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default AdminUsersSettings;
