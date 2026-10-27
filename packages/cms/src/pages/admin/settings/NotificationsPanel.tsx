/**
 * Settings → Notifications.
 *
 *  1. In-app notifications — the global switch + retention (`notification_options`,
 *     saved by the page Save through `cms.notifications.setOptions`).
 *  2. SMS provider (Twilio) — its own Save + a test text.
 *  3. Per notification TYPE (only types whose feature is on): email, SMS,
 *     in-app (users + roles) and desktop push (to the in-app recipients).
 *     Saved by the page Save through PUT /settings (`notifications` key).
 *
 * Stored config of types not shown (feature off) is kept on save.
 */
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { createStore, produce, } from 'solid-js/store';
import { NOTIFICATION_TYPES, } from '@sitesurge/types';
import type { NotificationSettings, NotificationTypeConfig, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { CommitInput, FormField, } from '../../../components/admin/forms';
import Toggle from '../../../components/admin/common/Toggle';
import NotificationTypeCard, {
    type NotificationTypeDraft, phoneListError, splitList,
} from '../../../components/admin/notifications/NotificationTypeCard';
import SmsProviderSection from '../../../components/admin/notifications/SmsProviderSection';
import { isFeatureEnabled, } from '../../../stores/siteSettings';

/** Read a keyed settings row's value (mirrors the General tab helper). */
function getValue(s: any, key: string, fallback: any,): any {
    if (s && s[key] && s[key].value !== undefined) return s[key].value;
    return fallback;
}

/** Only the per-type objects (the row also carries `updatedAt`, which PUT refuses). */
function typeEntries(raw: unknown,): NotificationSettings {
    const out: NotificationSettings = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v,] of Object.entries(raw as Record<string, unknown>,)) {
        if (v && typeof v === 'object' && !Array.isArray(v,)) out[k] = v as NotificationTypeConfig;
    }
    return out;
}

const toDraft = (c: NotificationTypeConfig | undefined,): NotificationTypeDraft => ({
    email: { enabled: c?.email?.enabled ?? false, addresses: (c?.email?.addresses ?? []).join(', ',), },
    sms: { enabled: c?.sms?.enabled ?? false, addresses: (c?.sms?.addresses ?? []).join(', ',), },
    inApp: { enabled: c?.inApp?.enabled ?? false, userIds: [...(c?.inApp?.userIds ?? []),], roles: [...(c?.inApp?.roles ?? []),], },
    push: { enabled: c?.push?.enabled ?? false, },
});

const fromDraft = (d: NotificationTypeDraft,): NotificationTypeConfig => ({
    email: { enabled: d.email.enabled, addresses: splitList(d.email.addresses,), },
    sms: { enabled: d.sms.enabled, addresses: splitList(d.sms.addresses,), },
    inApp: { enabled: d.inApp.enabled, userIds: [...d.inApp.userIds,], roles: [...d.inApp.roles,], },
    push: { enabled: d.push.enabled, },
});

const NotificationsPanel: Component = () => {
    const [drafts, setDrafts,] = createStore<Record<string, NotificationTypeDraft>>({},);
    const [stored, setStored,] = createSignal<NotificationSettings>({},);
    const [options, setOptions,] = createStore({ inAppEnabled: false, retentionDays: 30, },);
    const [smsConfigured, setSmsConfigured,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(true,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const [s, o,] = await Promise.all([
                cms.settings.getAll(),
                cms.notifications.options().catch(() => null),
            ],);
            const st = typeEntries(getValue(s, 'notifications', {},),);
            setStored(st,);
            const next: Record<string, NotificationTypeDraft> = {};
            for (const t of NOTIFICATION_TYPES) next[t.key] = toDraft(st[t.key],);
            setDrafts(next,);
            if (o) setOptions({ inAppEnabled: !!o.inAppEnabled, retentionDays: o.retentionDays ?? 30, },);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load notification settings',);
        } finally {
            setLoading(false,);
        }
    },);

    /** Types shown = those with no feature, or whose feature is enabled. */
    const shownTypes = () => NOTIFICATION_TYPES.filter((t,) => !t.feature || isFeatureEnabled(t.feature,));

    const patch = (key: string,) => <K extends keyof NotificationTypeDraft>(channel: K, p: Partial<NotificationTypeDraft[K]>,) => {
        setSuccess(false,);
        setDrafts(produce((all,) => { Object.assign(all[key][channel], p,); },),);
    };

    const handleSave = async () => {
        setError('',);
        setSuccess(false,);
        // Refuse bad phone numbers on an enabled SMS channel before anything is written.
        for (const t of shownTypes()) {
            const d = drafts[t.key];
            const bad = d?.sms.enabled ? phoneListError(d.sms.addresses,) : null;
            if (bad) {
                setError(`${t.label}: ${bad}`,);
                return;
            }
        }
        setSaving(true,);
        try {
            const notifications: NotificationSettings = { ...stored(), };
            for (const t of shownTypes()) {
                if (drafts[t.key]) notifications[t.key] = fromDraft(drafts[t.key],);
            }
            await cms.settings.update({ notifications, } as any,);
            setStored(notifications,);
            const o = await cms.notifications.setOptions({
                inAppEnabled: options.inAppEnabled,
                retentionDays: options.retentionDays,
            },);
            setOptions({ inAppEnabled: !!o.inAppEnabled, retentionDays: o.retentionDays ?? options.retentionDays, },);
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save notification settings',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="notifications-panel">
            <div class="admin-header">
                <h2 class="settings-subheading">Notifications</h2>
                <div class="admin-header__actions">
                    <button class="ui-button ui-button--primary" onClick={() => void handleSave()} disabled={saving() || loading()}>
                        {saving() ? 'Saving...' : 'Save Notifications'}
                    </button>
                </div>
            </div>

            <p class="form-help-muted">
                Choose which events send a notification, how, and to whom. Types only appear here when their related feature is
                enabled. The SMS provider has its own Save; everything else is saved with Save Notifications.
            </p>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>
            <Show when={success()}>
                <div class="alert alert--success">Notification settings saved.</div>
            </Show>

            <Show when={!loading()} fallback={<p class="form-help-muted">Loading…</p>}>
                <section class="admin-section">
                    <header class="admin-section__header">
                        <h2>In-app notifications</h2>
                        <p class="form-help-muted">Notifications shown in the admin sidebar to the chosen users and roles.</p>
                    </header>
                    <Toggle
                        label="Show notifications in the admin"
                        checked={options.inAppEnabled}
                        onChange={(v,) => { setSuccess(false,); setOptions('inAppEnabled', v,); }}
                    />
                    <div class="admin-form-row">
                        <FormField label="Keep notifications for (days)" hint="Older notifications are removed automatically.">
                            <CommitInput
                                type="number"
                                min={1}
                                max={3650}
                                value={options.retentionDays}
                                validate={(v,) => {
                                    const n = Number(v,);
                                    return Number.isInteger(n,) && n >= 1 && n <= 3650 ? null : 'Enter a whole number of days (1–3650).';
                                }}
                                onCommit={(v,) => { setSuccess(false,); setOptions('retentionDays', Number(v,),); }}
                            />
                        </FormField>
                    </div>
                </section>

                <SmsProviderSection onSaved={setSmsConfigured} />

                <Show
                    when={shownTypes().length}
                    fallback={<p class="form-help-muted">No notification types available — enable a feature first.</p>}
                >
                    <For each={shownTypes()}>
                        {(t,) => (
                            <Show when={drafts[t.key]}>
                                <NotificationTypeCard
                                    label={t.label}
                                    description={t.description}
                                    typeKey={t.key}
                                    draft={drafts[t.key]}
                                    onPatch={patch(t.key,)}
                                    smsConfigured={smsConfigured()}
                                    inAppEnabled={options.inAppEnabled}
                                />
                            </Show>
                        )}
                    </For>
                </Show>
            </Show>
        </div>
    );
};

export default NotificationsPanel;
