/**
 * Mailing-list settings (`/admin/mailing-lists/settings`, admin-only).
 *
 * The sender identity for bulk mail, in ONE place. From name / From email /
 * Reply-to previously existed only per template and per send, so every new
 * template started blank and the operator had to retype the list address —
 * or forget to, and have a newsletter go out under the transactional sender,
 * which is both wrong for the reader and bad for deliverability (bulk mail
 * should come from its own subdomain so a complaint can't poison password
 * resets).
 *
 * These are DEFAULTS, applied at SEND time beneath whatever a template or a
 * send specifies. They also drive the placeholder text in those forms, so what
 * the form suggests and what actually ships are the same value.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import type { MailingListsSettings, } from '@sitesurge/types';
import { FormField, } from '../../components/admin/forms';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';

const AdminMailingListsSettings: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);

    const [fromName, setFromName,] = createSignal('',);
    const [fromEmail, setFromEmail,] = createSignal('',);
    const [replyTo, setReplyTo,] = createSignal('',);

    onMount(async () => {
        try {
            const s = await cms.settings.getMailingListsSettings() as MailingListsSettings;
            setFromName(s.defaultFromName ?? '',);
            setFromEmail(s.defaultFromEmail ?? '',);
            setReplyTo(s.defaultReplyTo ?? '',);
        } catch { /* error bus */ } finally {
            setLoaded(true,);
        }
    },);

    /** Blank means "not configured" — the backend falls back to the site name
     *  and the configured sender, so clearing a field is a valid action. */
    const save = async (): Promise<void> => {
        setSaving(true,);
        try {
            await cms.settings.setMailingListsSettings({
                defaultFromName: fromName().trim(),
                defaultFromEmail: fromEmail().trim(),
                defaultReplyTo: replyTo().trim(),
            },);
            toast.success('Mailing list settings saved.',);
        } catch { /* error bus */ } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="mailing-lists-settings-page">
            <Title>Mailing List Settings - Admin</Title>

            <div class="admin-header">
                <A href="/admin/mailing-lists" class="admin-header__back">← Mailing Lists</A>
                <h1>Mailing List Settings</h1>
                <div class="admin-header__actions">
                    <button
                        class="ui-button ui-button--primary"
                        onClick={save}
                        disabled={saving() || !loaded()}
                    >
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <section class="admin-section">
                    <header class="admin-section__header">
                        <h2>Default sender</h2>
                        <p class="form-help-muted">
                            Used for every mailing-list send that doesn't set its own.
                            A template or an individual send can still override any of these.
                        </p>
                    </header>

                    <div class="admin-section__body">
                        <FormField
                            label="From name"
                            hint="Who the message appears to be from. Falls back to the site name."
                        >
                            <input
                                type="text"
                                value={fromName()}
                                placeholder="Frank Scales, Surge Media"
                                onBlur={(e,) => setFromName(e.currentTarget.value,)}
                            />
                        </FormField>

                        <FormField
                            label="From email"
                            hint="Send bulk mail from a dedicated subdomain, so a spam complaint can't affect password resets and receipts."
                        >
                            <input
                                type="email"
                                value={fromEmail()}
                                placeholder="newsletter@lists.example.com"
                                onBlur={(e,) => setFromEmail(e.currentTarget.value,)}
                            />
                        </FormField>

                        <FormField
                            label="Reply-to"
                            hint="Where replies go. Falls back to the From email."
                        >
                            <input
                                type="email"
                                value={replyTo()}
                                placeholder="hello@example.com"
                                onBlur={(e,) => setReplyTo(e.currentTarget.value,)}
                            />
                        </FormField>
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default AdminMailingListsSettings;
