/**
 * Notifications settings panel.
 *
 * Per notification type, an operator toggles email delivery on/off and
 * supplies a comma-separated list of recipient addresses. Only types
 * whose governing feature is enabled are shown. Persisted through
 * PUT /settings (`notifications` key). SMS / push are reserved for later,
 * so today only the email channel is surfaced.
 */
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { NOTIFICATION_TYPES, } from '@sitesurge/types';
import type { NotificationSettings, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { FormCheck, FormField, } from '../../../components/admin/forms';

/** Local editable state for one notification type's email channel. */
interface TypeState {
    enabled: boolean;
    /** Raw comma-separated address string as typed. */
    addresses: string;
}

/** Read a keyed settings row's value (mirrors the General tab helper). */
function getValue(s: any, key: string, fallback: any,): any {
    if (s && s[key] && s[key].value !== undefined) return s[key].value;
    return fallback;
}

/** Split a comma-separated address list into trimmed, non-empty entries. */
function parseAddresses(raw: string,): string[] {
    return raw.split(',',).map((a,) => a.trim()).filter(Boolean,);
}

const NotificationsPanel: Component = () => {
    // Per-type UI state, keyed by notification type key.
    const [state, setState,] = createSignal<Record<string, TypeState>>({},);
    // Which feature flags are enabled (gates which types show).
    const [features, setFeatures,] = createSignal<Record<string, boolean>>({},);
    const [loading, setLoading,] = createSignal(true,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const s = await cms.settings.getAll();
            const stored = getValue(s, 'notifications', {},) as NotificationSettings;

            const next: Record<string, TypeState> = {};
            for (const t of NOTIFICATION_TYPES) {
                const email = stored?.[t.key]?.email;
                next[t.key] = {
                    enabled: email?.enabled ?? false,
                    addresses: (email?.addresses ?? []).join(', ',),
                };
            }
            setState(next,);

            // Feature defaults mirror the General tab: `users` is opt-in
            // (default false); every other module defaults on.
            setFeatures({
                users: getValue(s, 'users_enabled', false,) === true,
                shop: getValue(s, 'shop_enabled', true,) !== false,
                forms: getValue(s, 'forms_enabled', true,) !== false,
                messages: getValue(s, 'messages_enabled', true,) !== false,
            },);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load notification settings',);
        } finally {
            setLoading(false,);
        }
    },);

    /** Types shown = those with no feature, or whose feature is enabled. */
    const shownTypes = () =>
        NOTIFICATION_TYPES.filter((t,) => !t.feature || features()[t.feature]);

    const patch = (key: string, p: Partial<TypeState>,) =>
        setState((s,) => ({ ...s, [key]: { ...s[key], ...p, }, }),);

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        setSuccess(false,);
        try {
            const notifications: NotificationSettings = {};
            for (const t of shownTypes()) {
                const st = state()[t.key];
                notifications[t.key] = {
                    email: {
                        enabled: st?.enabled ?? false,
                        addresses: parseAddresses(st?.addresses ?? '',),
                    },
                };
            }
            await cms.settings.update({ notifications, } as any,);
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
                    <button class="ui-button ui-button--primary" onClick={handleSave} disabled={saving() || loading()}>
                        {saving() ? 'Saving...' : 'Save Notifications'}
                    </button>
                </div>
            </div>

            <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                Choose which events send a notification and who receives them. Enter one or more
                recipient email addresses, separated by commas. Types only appear here when their
                related feature is enabled.
            </p>

            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{error()}</div>
            </Show>
            <Show when={success()}>
                <div class="alert alert--success" style={{ 'margin-bottom': '1rem', }}>
                    Notification settings saved.
                </div>
            </Show>

            <Show when={!loading()} fallback={<p class="form-help-muted">Loading…</p>}>
                <Show
                    when={shownTypes().length}
                    fallback={<p class="form-help-muted">No notification types available — enable a feature first.</p>}
                >
                    <For each={shownTypes()}>
                        {(t,) => (
                            <section class="settings-card" style={{ 'margin-bottom': '1rem', }}>
                                <FormCheck
                                    label={t.label}
                                    tooltip={t.description}
                                    checked={state()[t.key]?.enabled ?? false}
                                    onChange={(next,) => patch(t.key, { enabled: next, },)}
                                />
                                <Show when={state()[t.key]?.enabled}>
                                    <FormField
                                        label="Recipient emails"
                                        hint="Comma-separated list of email addresses."
                                    >
                                        <input
                                            type="text"
                                            value={state()[t.key]?.addresses ?? ''}
                                            onInput={(e,) => patch(t.key, { addresses: e.currentTarget.value, },)}
                                            placeholder="alerts@example.com, ops@example.com"
                                        />
                                    </FormField>
                                </Show>
                            </section>
                        )}
                    </For>
                </Show>
            </Show>
        </div>
    );
};

export default NotificationsPanel;
