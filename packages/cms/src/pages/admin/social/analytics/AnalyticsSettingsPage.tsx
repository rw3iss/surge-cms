/**
 * Social → Analytics → Settings: the scheduled DIGEST (when, what it covers,
 * which sections, the AI pool), how it is emailed, and how long digests are
 * kept. Saved as one `social_analytics_settings` row by the API.
 */
import {
    DEFAULT_SOCIAL_ANALYTICS_SETTINGS,
    DIGEST_SECTIONS,
    type DigestSection,
    type SocialAnalyticsSettings,
    type SocialCollectorStatus,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { type Component, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../../components/admin/common/AdminTitle';
import EditorSaveBar from '../../../../components/admin/common/EditorSaveBar';
import Toggle from '../../../../components/admin/common/Toggle';
import { CommitInput, FormField, } from '../../../../components/admin/forms';
import { StableSuspense, } from '../../../../components/common/StableSuspense';
import { useToast, } from '../../../../components/common/toast';
import { cms, } from '../../../../services/cmsClient';
import AnalyticsNav from './AnalyticsNav';
import { invalidRecipients, parseRecipients, periodDescription, scheduleDescription, WEEKDAYS, } from './digestFormat';

type Settings = SocialAnalyticsSettings;

const clone = (s: Settings,): Settings => JSON.parse(JSON.stringify(s,),) as Settings;

const AnalyticsSettingsPage: Component = () => {
    const toast = useToast();
    const [s, setS,] = createSignal<Settings>(clone(DEFAULT_SOCIAL_ANALYTICS_SETTINGS,),);
    const [saved, setSaved,] = createSignal<string>(JSON.stringify(DEFAULT_SOCIAL_ANALYTICS_SETTINGS,),);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const [loaded,] = createResource(async () => {
        const v = await cms.socialAnalytics.settings();
        setS(clone(v,),);
        setSaved(JSON.stringify(v,),);
        return v;
    },);
    const [collectors,] = createResource(() => cms.socialAnalytics.collectors().catch(() => [] as SocialCollectorStatus[]),);

    const dirty = () => JSON.stringify(s(),) !== saved();
    const setDigest = (p: Partial<Settings['digest']>,) => setS((cur,) => ({ ...cur, digest: { ...cur.digest, ...p, }, }));
    const setEmail = (p: Partial<Settings['email']>,) => setS((cur,) => ({ ...cur, email: { ...cur.email, ...p, }, }));

    const badRecipients = () => invalidRecipients(s().email.recipients,);

    const togglePlatform = (platform: string, on: boolean,) => {
        const cur = new Set(s().digest.platforms,);
        if (on) cur.add(platform,);
        else cur.delete(platform,);
        setDigest({ platforms: [...cur,], },);
    };
    const toggleSection = (key: DigestSection, on: boolean,) => {
        const cur = s().digest.sections.filter((k,) => k !== key);
        // Keep the catalogue order, so the digest's section order never depends on clicks.
        const next = on ? DIGEST_SECTIONS.map((d,) => d.key).filter((k,) => k === key || cur.includes(k,)) : cur;
        setDigest({ sections: next, },);
    };

    const save = async () => {
        if (badRecipients().length) {
            setError(`Not an email address: ${badRecipients().join(', ',)}`,);
            return;
        }
        setSaving(true,);
        setError('',);
        try {
            const v = await cms.socialAnalytics.updateSettings({ digest: s().digest, email: s().email, retentionDays: s().retentionDays, },);
            setS(clone(v,),);
            setSaved(JSON.stringify(v,),);
            toast.success('Analytics settings saved',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the settings.',);
        } finally {
            setSaving(false,);
        }
    };

    const revert = () => {
        setS(clone(JSON.parse(saved(),) as Settings,),);
        setError('',);
    };

    const hourOptions = Array.from({ length: 24, }, (_, h,) => h);
    const dayOptions = Array.from({ length: 28, }, (_, i,) => i + 1);

    return (
        <section class="analytics-settings">
            <AdminTitle>Analytics Settings</AdminTitle>
            <AnalyticsNav
                actions={
                    <EditorSaveBar
                        onSave={save}
                        onCancel={revert}
                        saving={saving()}
                        canSave={dirty() && !loaded.loading}
                        cancelLabel="Revert"
                        saveLabel="Save settings"
                    />
                }
            />

            <Show when={error()}><div class="alert alert--error">{error()}</div></Show>

            <StableSuspense fallback={<p class="form-help-muted">Loading…</p>}>
                <Show when={loaded() || loaded.error}>
                    <Show when={loaded.error}>
                        <div class="alert alert--error">Could not load the settings: {(loaded.error as Error)?.message}</div>
                    </Show>

                    {/* ── Digest schedule ── */}
                    <section class="admin-section">
                        <header class="admin-section__header">
                            <h2>Digest</h2>
                            <p class="form-help-muted">
                                A report of your social analytics, generated on a schedule, kept here (Analytics → Digests) and optionally emailed.
                            </p>
                        </header>
                        <Toggle
                            checked={s().digest.enabled}
                            onChange={(v,) => setDigest({ enabled: v, },)}
                            label="Generate digests on a schedule"
                            hint={s().digest.enabled
                                ? `${scheduleDescription(s().digest,)} — covering ${periodDescription(s().digest.frequency,)}.`
                                : 'Off — you can still generate one by hand on the Digests page.'}
                        />
                        <div class="admin-form-row">
                            <FormField label="Frequency">
                                <select value={s().digest.frequency} onChange={(e,) => setDigest({ frequency: e.currentTarget.value as Settings['digest']['frequency'], },)}>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </FormField>
                            <Show when={s().digest.frequency === 'weekly'}>
                                <FormField label="Day">
                                    <select value={String(s().digest.weekday,)} onChange={(e,) => setDigest({ weekday: Number(e.currentTarget.value,), },)}>
                                        <For each={WEEKDAYS}>{(d, i,) => <option value={i()}>{d}</option>}</For>
                                    </select>
                                </FormField>
                            </Show>
                            <Show when={s().digest.frequency === 'monthly'}>
                                <FormField label="Day of month" hint="1–28, so every month has it.">
                                    <select value={String(s().digest.monthDay,)} onChange={(e,) => setDigest({ monthDay: Number(e.currentTarget.value,), },)}>
                                        <For each={dayOptions}>{(d,) => <option value={d}>{d}</option>}</For>
                                    </select>
                                </FormField>
                            </Show>
                            <FormField label="Time">
                                <select value={String(s().digest.hour,)} onChange={(e,) => setDigest({ hour: Number(e.currentTarget.value,), },)}>
                                    <For each={hourOptions}>{(h,) => <option value={h}>{`${h}:00`}</option>}</For>
                                </select>
                            </FormField>
                            <FormField label="Time zone" hint="IANA name, e.g. America/New_York.">
                                <CommitInput value={s().digest.timezone} onCommit={(v,) => setDigest({ timezone: v.trim() || 'America/New_York', },)} placeholder="America/New_York" />
                            </FormField>
                        </div>
                    </section>

                    {/* ── What it covers ── */}
                    <section class="admin-section">
                        <header class="admin-section__header">
                            <h2>Contents</h2>
                            <p class="form-help-muted">Which platforms and sections a digest includes.</p>
                        </header>
                        <FormField label="Platforms" hint="None selected = every platform that has data.">
                            <div class="analytics-settings__toggles">
                                <Show when={(collectors() ?? []).length} fallback={<span class="form-help-muted">Loading platforms…</span>}>
                                    <For each={collectors() ?? []}>
                                        {(c,) => (
                                            <Toggle
                                                checked={s().digest.platforms.includes(c.platform,)}
                                                onChange={(v,) => togglePlatform(c.platform, v,)}
                                                label={c.label}
                                                hint={c.state === 'off' ? 'not connected' : undefined}
                                                size="sm"
                                            />
                                        )}
                                    </For>
                                </Show>
                            </div>
                        </FormField>
                        <FormField label="Sections">
                            <div class="analytics-settings__toggles analytics-settings__toggles--stack">
                                <For each={DIGEST_SECTIONS}>
                                    {(d,) => (
                                        <Toggle
                                            checked={s().digest.sections.includes(d.key,)}
                                            onChange={(v,) => toggleSection(d.key, v,)}
                                            label={d.label}
                                            hint={d.description}
                                        />
                                    )}
                                </For>
                            </div>
                        </FormField>
                        <div class="admin-form-row">
                            <FormField label="Top posts" hint="How many posts the Top posts section lists (1–50).">
                                <CommitInput
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={s().digest.topPosts}
                                    onCommit={(v,) => setDigest({ topPosts: Math.min(50, Math.max(1, Math.round(Number(v,) || 10,),),), },)}
                                />
                            </FormField>
                            <FormField
                                label="AI pool"
                                hint="The claude-broker pool that writes the AI insights. If it has no session, the default pool is used, then the Anthropic API."
                            >
                                <CommitInput value={s().digest.aiPool} onCommit={(v,) => setDigest({ aiPool: v.trim() || 'analytics', },)} placeholder="analytics" />
                            </FormField>
                        </div>
                        <p class="form-help-muted">
                            Pools are set up in <A href="/admin/plugins/claude-broker">Plugins → Claude Broker</A>.
                        </p>
                    </section>

                    {/* ── Email ── */}
                    <section class="admin-section">
                        <header class="admin-section__header">
                            <h2>Email</h2>
                            <p class="form-help-muted">
                                Each new digest is emailed when this is on. In-app and desktop alerts follow the "Social analytics digest" type in{' '}
                                <A href="/admin/settings?tab=notifications">Settings → Notifications</A>.
                            </p>
                        </header>
                        <Toggle checked={s().email.enabled} onChange={(v,) => setEmail({ enabled: v, },)} label="Email each digest" />
                        <div class="admin-form-row">
                            <FormField label="Format">
                                <select value={s().email.format} onChange={(e,) => setEmail({ format: e.currentTarget.value as Settings['email']['format'], },)} disabled={!s().email.enabled}>
                                    <option value="full">Full — the whole digest</option>
                                    <option value="summary">Summary — headline, totals, top 3 posts + a link</option>
                                </select>
                            </FormField>
                            <FormField label="Recipients">
                                <select value={s().email.recipientMode} onChange={(e,) => setEmail({ recipientMode: e.currentTarget.value as Settings['email']['recipientMode'], },)} disabled={!s().email.enabled}>
                                    <option value="augment">These addresses + the notification's email recipients</option>
                                    <option value="override">Only these addresses</option>
                                </select>
                            </FormField>
                        </div>
                        <FormField
                            label="Addresses"
                            hint={s().email.recipientMode === 'augment'
                                ? 'Added to the email recipients of "Social analytics digest" in Settings → Notifications. One per line or comma-separated.'
                                : 'Only these addresses get the digest (the notification type\'s email recipients are not used). One per line or comma-separated.'}
                            error={badRecipients().length ? `Not an email address: ${badRecipients().join(', ',)}` : undefined}
                        >
                            <CommitInput
                                multiline
                                rows={3}
                                value={s().email.recipients.join('\n',)}
                                onCommit={(v,) => setEmail({ recipients: parseRecipients(v,), },)}
                                placeholder="team@example.com"
                                disabled={!s().email.enabled}
                            />
                        </FormField>
                    </section>

                    {/* ── Retention ── */}
                    <section class="admin-section">
                        <header class="admin-section__header">
                            <h2>History</h2>
                            <p class="form-help-muted">How long generated digests (and their data snapshots) are kept. Older ones are deleted daily.</p>
                        </header>
                        <Toggle
                            checked={s().retentionDays === null}
                            onChange={(v,) => setS((cur,) => ({ ...cur, retentionDays: v ? null : 365, }))}
                            label="Keep digests forever"
                        />
                        <Show when={s().retentionDays !== null}>
                            <div class="admin-form-row">
                                <FormField label="Keep for (days)" hint="At least 1 day.">
                                    <CommitInput
                                        type="number"
                                        min={1}
                                        value={s().retentionDays ?? 365}
                                        onCommit={(v,) => setS((cur,) => ({ ...cur, retentionDays: Math.max(1, Math.round(Number(v,) || 1,),), }))}
                                    />
                                </FormField>
                            </div>
                        </Show>
                    </section>
                </Show>
            </StableSuspense>
        </section>
    );
};

export default AnalyticsSettingsPage;
