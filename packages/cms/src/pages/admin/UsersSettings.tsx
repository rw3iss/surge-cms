/**
 * Users-feature settings (`/admin/users/settings`, admin-only).
 *
 * Two sections, chosen at the top:
 *  - **General** — the email-verification requirement.
 *  - **Email templates** — every email the users feature sends (verification,
 *    password reset, password changed, welcome, staff signup alert), driven by
 *    the MAIL_PURPOSES registry via the shared EmailTemplatesPanel.
 *
 * The verification email used to live in `users_settings.verificationEmail`.
 * It now lives in the `mail_purposes` map like every other email; the backend
 * still reads the old location as a fallback so an operator who customised it
 * before this change doesn't silently lose their template.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import type { UsersSettings, } from '@sitesurge/types';
import type { MailingList, } from '@sitesurge/types';
import EmailTemplatesPanel, { type PurposeConfig, } from '../../components/admin/mail/EmailTemplatesPanel';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import { FormField, } from '../../components/admin/forms';
import Toggle from '../../components/admin/common/Toggle';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';

type Section = 'general' | 'emails';

const SECTIONS: { key: Section; label: string; }[] = [
    { key: 'general', label: 'General', },
    { key: 'emails', label: 'Email templates', },
];

const AdminUsersSettings: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [section, setSection,] = createSignal<Section>('general',);

    const [requireVerification, setRequireVerification,] = createSignal(true,);
    const [purposes, setPurposes,] = createSignal<Record<string, PurposeConfig>>({},);
    const [autoAddContacts, setAutoAddContacts,] = createSignal(true,);
    const [autoSubscribe, setAutoSubscribe,] = createSignal(false,);
    const [autoSubscribeListId, setAutoSubscribeListId,] = createSignal('',);
    const [lists, setLists,] = createSignal<MailingList[]>([],);

    const contactsOn = () => isFeatureEnabled('contacts',);
    const listsOn = () => isFeatureEnabled('mailing_lists',);

    onMount(async () => {
        try {
            const [s, mp,] = await Promise.all([
                cms.settings.getUsersSettings() as Promise<UsersSettings>,
                cms.settings.getMailPurposes() as Promise<Record<string, PurposeConfig>>,
            ],);
            setRequireVerification(s.requireEmailVerification !== false,);
            setAutoAddContacts(s.autoAddContacts !== false,);
            setAutoSubscribe(s.autoSubscribe === true,);
            setAutoSubscribeListId(s.autoSubscribeListId ?? '',);
            // Only fetched when the feature is on — the endpoint 404s otherwise.
            if (listsOn()) {
                try { setLists(await cms.mailingLists.list() as MailingList[],); } catch { /* non-fatal */ }
            }

            const map = { ...(mp ?? {}), };
            // One-time adoption of the pre-registry verification email, so the
            // editor shows what the operator wrote instead of an empty box.
            // Saving from here then persists it in the new location.
            const legacyBlocks = (s.verificationEmail?.blocks ?? []) as unknown[];
            const legacySubject = s.verificationEmail?.subject ?? '';
            if (!map.user_verification && (legacyBlocks.length > 0 || legacySubject)) {
                map.user_verification = { subject: legacySubject, blocks: legacyBlocks, };
            }
            setPurposes(map,);
        } catch { /* error bus */ } finally {
            setLoaded(true,);
        }
    },);

    const save = async (): Promise<void> => {
        setSaving(true,);
        try {
            // Both rows are written on every save: the section selector is a
            // view, not a form boundary, so switching sections must never be
            // able to drop the edits made in the other one.
            await Promise.all([
                cms.settings.usersSettings({
                    requireEmailVerification: requireVerification(),
                    autoAddContacts: autoAddContacts(),
                    autoSubscribe: autoSubscribe(),
                    // Null rather than '' so the backend stores an absent value
                    // instead of a list id that can never match.
                    autoSubscribeListId: autoSubscribeListId() || null,
                    // Kept in sync so a rollback still finds the template where
                    // the old code looks for it.
                    verificationEmail: {
                        subject: purposes().user_verification?.subject ?? '',
                        blocks: (purposes().user_verification?.blocks ?? []) as Array<Record<string, unknown>>,
                    },
                },),
                cms.settings.setMailPurposes(purposes() as Record<string, unknown>,),
            ],);
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
                    <button class="ui-button ui-button--primary" onClick={save} disabled={saving() || !loaded()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <div class="settings-tabs">
                    <For each={SECTIONS}>
                        {(t,) => (
                            <button
                                class={`settings-tabs__tab ${section() === t.key ? 'settings-tabs__tab--active' : ''}`}
                                onClick={() => setSection(t.key,)}
                            >
                                {t.label}
                            </button>
                        )}
                    </For>
                </div>

                <Show when={section() === 'general'}>
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
                            <p class="form-help-muted">
                                The wording of that email — and of the password-reset emails — lives under{' '}
                                <strong>Email templates</strong>.
                            </p>
                        </div>
                    </section>

                    <section class="admin-section">
                        <header class="admin-section__header"><h2>New member handling</h2></header>
                        <div class="form-section">
                            <FormField label="Automatically add new users to Contacts" inline>
                                <Toggle
                                    checked={autoAddContacts() && contactsOn()}
                                    onChange={setAutoAddContacts}
                                    disabled={!contactsOn()}
                                    ariaLabel="Automatically add new users to Contacts"
                                />
                            </FormField>
                            <p class="form-help-muted">
                                <Show
                                    when={contactsOn()}
                                    fallback={<>Enable the <strong>Contacts</strong> feature to use this.</>}
                                >
                                    Creates a contact for each new member, or links them to an existing
                                    contact with the same email. Matching is on email, so turning this on
                                    can't produce duplicates.
                                </Show>
                            </p>

                            <FormField label="Automatically add new users to a mailing list" inline>
                                <Toggle
                                    checked={autoSubscribe() && listsOn()}
                                    onChange={setAutoSubscribe}
                                    disabled={!listsOn()}
                                    ariaLabel="Automatically subscribe new users"
                                />
                            </FormField>
                            <Show
                                when={listsOn()}
                                fallback={
                                    <p class="form-help-muted">
                                        Enable the <strong>Mailing Lists</strong> feature to use this.
                                    </p>
                                }
                            >
                                <Show when={autoSubscribe()}>
                                    <FormField
                                        label="Mailing list"
                                        hint="New members are subscribed to this list. Already-subscribed addresses are left alone."
                                    >
                                        <select
                                            value={autoSubscribeListId()}
                                            onChange={(e,) => setAutoSubscribeListId(e.currentTarget.value,)}
                                        >
                                            <option value="">— select a list —</option>
                                            <For each={lists()}>
                                                {(l,) => <option value={l.id}>{l.name}</option>}
                                            </For>
                                        </select>
                                    </FormField>
                                    <Show when={autoSubscribe() && !autoSubscribeListId()}>
                                        <p class="form-help-muted">
                                            ⚠ Pick a list — nothing is subscribed until you do.
                                        </p>
                                    </Show>
                                </Show>
                            </Show>
                        </div>
                    </section>
                </Show>

                <Show when={section() === 'emails'}>
                    <section class="admin-section">
                        <header class="admin-section__header"><h2>Email templates</h2></header>
                        <div class="form-section">
                            <EmailTemplatesPanel
                                feature="users"
                                value={purposes()}
                                onChange={setPurposes}
                            />
                        </div>
                    </section>
                </Show>
            </Show>
        </div>
    );
};

export default AdminUsersSettings;
