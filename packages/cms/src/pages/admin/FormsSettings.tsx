/**
 * Forms-feature settings (`/admin/forms/settings`, admin-only).
 *
 * Currently one section — the emails the forms feature sends. It exists as its
 * own page anyway, matching Users and Shop, so the "where do I configure this
 * feature?" answer is the same everywhere: a Settings button in the feature's
 * header.
 *
 * Note the distinction this page does NOT own: a form's own on-submit "email"
 * action (Forms → edit a form → action `email`) is per-form and configured
 * there. This page is about the staff alert that fires for every submission.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import EmailTemplatesPanel, { type PurposeConfig, } from '../../components/admin/mail/EmailTemplatesPanel';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';

const AdminFormsSettings: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [purposes, setPurposes,] = createSignal<Record<string, PurposeConfig>>({},);

    onMount(async () => {
        try {
            setPurposes((await cms.settings.getMailPurposes()) as Record<string, PurposeConfig> ?? {},);
        } catch { /* error bus */ } finally {
            setLoaded(true,);
        }
    },);

    const save = async (): Promise<void> => {
        setSaving(true,);
        try {
            await cms.settings.setMailPurposes(purposes() as Record<string, unknown>,);
            toast.success('Forms settings saved.',);
        } catch { /* error bus */ } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="forms-settings-page">
            <Title>Forms Settings - Admin</Title>

            <div class="admin-header">
                <A href="/admin/forms" class="admin-header__back">← Forms</A>
                <h1>Forms Settings</h1>
                <div class="admin-header__actions">
                    <button class="ui-button ui-button--primary" onClick={save} disabled={saving() || !loaded()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <section class="admin-section">
                    <header class="admin-section__header"><h2>Email templates</h2></header>
                    <div class="form-section">
                        <p class="form-help-muted">
                            The staff alert sent when a visitor submits any form. A form's own
                            on-submit email action is configured per form, in that form's editor.
                        </p>
                        <EmailTemplatesPanel
                            feature="forms"
                            value={purposes()}
                            onChange={setPurposes}
                        />
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default AdminFormsSettings;
