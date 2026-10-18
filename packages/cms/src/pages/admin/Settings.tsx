import ReplyTrackingPanel from '../../components/admin/settings/ReplyTrackingPanel';
import { useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, lazy, onMount, Show, } from 'solid-js';
import BackupRestorePanel from '../../components/admin/panels/BackupRestorePanel';
import CmsUpdatePanel from '../../components/admin/panels/CmsUpdatePanel';
import JobManagementPanel from '../../components/admin/panels/JobManagementPanel';
import ServerLogsPanel from '../../components/admin/panels/ServerLogsPanel';
import SitemapPanel from '../../components/admin/panels/SitemapPanel';
import { cms, } from '../../services/cmsClient';
import { FeatureCascadeError, } from '@sitesurge/client';
import { CURRENCIES, isKnownTimeZone, TIMEZONES, } from '@sitesurge/types';
import { reloadSiteSettings, } from '../../stores/siteSettings';
import FeatureToggleRow from '../../components/admin/features/FeatureToggleRow';
import { FormField, } from '../../components/admin/forms';
import { FEATURES, } from '../../config/features';
import AdminTitle from '../../components/admin/common/AdminTitle';
import AdminAppearancePanel from '../../components/admin/settings/appearance/AdminAppearancePanel';
import AppearancePanel from '../../components/admin/settings/appearance/AppearancePanel';
import BrandingMediaField, { type BrandingMediaRef, } from '../../components/admin/settings/appearance/BrandingMediaField';

// HeroContentEditor is now used via the 'carousel' block type, not in Settings.
const SiteHeaderEditor = lazy(() => import('../../components/admin/editors/SiteHeaderEditor'));
const SiteFooterEditor = lazy(() => import('../../components/admin/editors/SiteFooterEditor'));
const ApiKeysPanel = lazy(() => import('../../components/admin/settings/ApiKeysPanel'));
const PermissionsPanel = lazy(() => import('../../components/admin/settings/PermissionsPanel'));
const NotificationsPanel = lazy(() => import('./settings/NotificationsPanel'));
const StripeKeysEditor = lazy(() => import('../../components/admin/StripeKeysEditor'));

// ─── Tabs ───

const TABS = [
    { id: 'general', label: 'General', },
    { id: 'notifications', label: 'Notifications', },
    { id: 'appearance', label: 'Appearance', },
    { id: 'site-header', label: 'Site Header', },
    { id: 'site-footer', label: 'Site Footer', },
    { id: 'payments', label: 'Payments', },
    { id: 'api-keys', label: 'API Keys', },
    { id: 'permissions', label: 'Permissions', },
    { id: 'admin', label: 'Admin', },
] as const;

type TabId = typeof TABS[number]['id'];



// ─── Main Settings Page ───

const AdminSettings: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams<{ tab: string, oauth_success: string, oauth_error: string, }>();
    const [activeTab, setActiveTab,] = createSignal<TabId>(
        (searchParams.tab as TabId) || 'general',
    );

    // Connections moved to Social → Configuration. If an old OAuth callback
    // still lands here, forward it (params preserved) to the new home.
    onMount(() => {
        if (searchParams.oauth_success || searchParams.oauth_error) {
            const qs = new URLSearchParams();
            if (searchParams.oauth_success) qs.set('oauth_success', searchParams.oauth_success,);
            if (searchParams.oauth_error) qs.set('oauth_error', searchParams.oauth_error,);
            window.location.replace(`/admin/social/configuration?${qs.toString()}`,);
        }
    },);

    const handleTabChange = (tab: TabId,) => {
        setActiveTab(tab,);
        setSearchParams({ tab, },);
    };

    const [settings, { refetch, },] = createResource(async () => {
        try {
            return await cms.settings.getAll();
        } catch {
            return {};
        }
    },);

    // Deep links to a section (`/admin/settings?tab=general#features`, e.g. the
    // reply modal's "enable Mailing Lists" link): the section renders only once
    // settings have loaded, so scroll when it appears rather than on mount.
    createEffect(() => {
        const hash = window.location.hash.slice(1,);
        if (!hash || settings.loading || !settings()) return;
        requestAnimationFrame(() => document.getElementById(hash,)?.scrollIntoView({ behavior: 'smooth', block: 'start', },),);
    },);


    const [siteName, setSiteName,] = createSignal('',);
    const [siteDescription, setSiteDescription,] = createSignal('',);
    const [contactEmail, setContactEmail,] = createSignal('',);
    const [analyticsId, setAnalyticsId,] = createSignal('',);
    const [emailFromName, setEmailFromName,] = createSignal('',);
    const [emailFromAddress, setEmailFromAddress,] = createSignal('',);
    // Site-wide authoring defaults. Pre-fill authoring forms (e.g. a new
    // event's timezone) rather than each form guessing.
    const [defaultTimezone, setDefaultTimezone,] = createSignal('',);
    const [defaultCurrency, setDefaultCurrency,] = createSignal('USD',);
    const [adminIdleTimeout, setAdminIdleTimeout,] = createSignal(60,);
    const [historyDays, setHistoryDays,] = createSignal(10,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);

    // Branding state
    const [logo, setLogo,] = createSignal<BrandingMediaRef>({},);
    const [favicon, setFavicon,] = createSignal<BrandingMediaRef>({},);

    // Feature toggles. Each is a boolean signal; the save handler
    // bundles them into the `features` field of PUT /settings, which
    // the backend flattens into individual `<feature>_enabled` rows.
    // Module flags default to true (the row is created by the seeder
    // and the boolean check defaults to true if absent on upgrades).
    const [postsEnabled, setPostsEnabled,] = createSignal(true,);
    const [campaignsEnabled, setCampaignsEnabled,] = createSignal(true,);
    const [formsEnabled, setFormsEnabled,] = createSignal(true,);
    const [messagesEnabled, setMessagesEnabled,] = createSignal(true,);
    // 'users' defaults to false (admin-only install). Admins remain
    // able to sign in regardless — this flag only opens public
    // registration UI and the Users admin sidebar link.
    const [usersEnabled, setUsersEnabled,] = createSignal(false,);

    createEffect(() => {
        const s = settings();
        if (!s) return;
        setSiteName(getValue(s, 'site_name', '',),);
        setSiteDescription(getValue(s, 'site_description', '',),);
        setContactEmail(getValue(s, 'contact_email', '',),);
        const analytics = getValue(s, 'analytics', null,);
        if (analytics && typeof analytics === 'object') {
            setAnalyticsId((analytics as any).googleAnalyticsId || '',);
        }
        const emailDefaults = getValue(s, 'email_defaults', null,);
        if (emailDefaults && typeof emailDefaults === 'object') {
            setEmailFromName((emailDefaults as any).fromName || '',);
            setEmailFromAddress((emailDefaults as any).fromAddress || '',);
        }
        const defaults = getValue(s, 'defaults', null,);
        if (defaults && typeof defaults === 'object') {
            setDefaultTimezone((defaults as any).timezone || '',);
            setDefaultCurrency((defaults as any).currency || 'USD',);
        }
        const adminChannel = getValue(s, 'admin_channel', null,);
        if (adminChannel && typeof adminChannel === 'object' && (adminChannel as any).activeTimeoutSeconds) {
            setAdminIdleTimeout(Number((adminChannel as any).activeTimeoutSeconds,) || 60,);
        }
        const revisionSettings = getValue(s, 'revisions', null,);
        if (revisionSettings && typeof revisionSettings === 'object') {
            // Checked against null rather than truthiness: 0 means "keep
            // everything" and would otherwise be replaced by the default.
            const d = Number((revisionSettings as any).historyDays,);
            if (Number.isFinite(d,) && d >= 0) setHistoryDays(d,);
        }
        // Feature flags — the admin GET /settings returns each as
        // `{ value: boolean, ... }`. `getValue` already unwraps that.
        setPostsEnabled(getValue(s, 'posts_enabled', true,) !== false,);
        setCampaignsEnabled(getValue(s, 'campaigns_enabled', true,) !== false,);
        setFormsEnabled(getValue(s, 'forms_enabled', true,) !== false,);
        setMessagesEnabled(getValue(s, 'messages_enabled', true,) !== false,);
        // Default false on absence (opt-in feature).
        setUsersEnabled(getValue(s, 'users_enabled', false,) === true,);
    },);

    // Load branding on mount
    onMount(async () => {
        try {
            const data = await cms.settings.getSiteBranding() as any;
            if (data) {
                if (data.logo) setLogo(data.logo,);
                if (data.favicon) setFavicon(data.favicon,);
            }
        } catch (e) {
            console.error('Failed to load branding:', e,);
        }
    },);

    function getValue(s: any, key: string, fallback: any,): any {
        if (s[key] && s[key].value !== undefined) return s[key].value;
        return fallback;
    }

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setSaving(true,);
        setSuccess(false,);

        // Feature toggles are now handled inline by FeatureToggleRow's
        // onChange (which calls PUT /settings with a single-feature
        // payload + the dependency planner). The General-tab submit
        // only persists non-feature fields.
        const data: Record<string, any> = {
            siteName: siteName(),
            siteDescription: siteDescription(),
            contactEmail: contactEmail() || undefined,
        };
        // Always send analytics (even empty) so CLEARING the field removes the
        // tag — sending it only when non-empty made a cleared id un-clearable.
        data.analytics = { googleAnalyticsId: analyticsId().trim(), };
        // Always sent, so clearing a field falls back to EMAIL_FROM.
        data.emailDefaults = { fromName: emailFromName().trim(), fromAddress: emailFromAddress().trim(), };
        data.defaults = {
            timezone: defaultTimezone() || undefined,
            currency: defaultCurrency() || 'USD',
        };
        data.adminChannel = { activeTimeoutSeconds: Math.min(3600, Math.max(5, Number(adminIdleTimeout()) || 60,),), };
        // 0 is a real choice here ("keep everything"), so it must survive the
        // fallback that would otherwise turn it back into the default.
        const days = Number(historyDays(),);
        data.revisions = { historyDays: Number.isFinite(days,) && days >= 0 ? Math.min(3650, days,) : 10, };

        try {
            await cms.settings.update(data as any,);

            // Save branding separately
            await cms.settings.siteBranding({
                logo: logo(),
                favicon: favicon(),
            } as any,);

            // Force the public site-settings cache to refetch so the live
            // Header, AdminLayout sidebar, and footer pick up the new
            // logo / name / tagline / description without a page reload.
            await reloadSiteSettings();

            setSuccess(true,);
            refetch();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to save settings.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div>
            <AdminTitle>Settings</AdminTitle>
            <div class="admin-header">
                <h1>Settings</h1>
                <Show when={activeTab() === 'general'}>
                    <div class="admin-header__actions">
                        <button type="submit" form="settings-general-form" class="ui-button ui-button--primary" disabled={saving()}>
                            {saving() ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </Show>
            </div>

            <div class="settings-tabs">
                <For each={TABS}>
                    {(tab,) => (
                        <button
                            class={`settings-tabs__tab ${activeTab() === tab.id ? 'settings-tabs__tab--active' : ''}`}
                            onClick={() => handleTabChange(tab.id,)}
                        >
                            {tab.label}
                        </button>
                    )}
                </For>
            </div>

            <div class="settings-tab-content">
                {/* ─── General Tab ─── */}
                <Show when={activeTab() === 'general'}>
                    <Show when={success()}>
                        <div class="alert alert--success">Settings saved successfully.</div>
                    </Show>

                    <form id="settings-general-form" onSubmit={handleSubmit} class="settings-general">
                        {/* Two-column layout: site identity on the left,
                            branding on the right. Stacks on narrow widths. */}
                        <div class="settings-grid">
                            <section class="settings-card">
                                <h3 class="settings-card__title">Site identity</h3>
                                <FormField label="Site Name">
                                    <input
                                        type="text"
                                        value={siteName()}
                                        onInput={(e,) => setSiteName(e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField label="Site Description">
                                    <textarea
                                        rows={3}
                                        value={siteDescription()}
                                        onInput={(e,) => setSiteDescription(e.currentTarget.value,)}
                                    />
                                </FormField>
                            </section>

                            <section class="settings-card">
                                <h3 class="settings-card__title">Branding</h3>
                                <BrandingMediaField
                                    label="Logo"
                                    value={logo()}
                                    onChange={(val,) => setLogo(val,)}
                                />
                                <BrandingMediaField
                                    label="Favicon"
                                    value={favicon()}
                                    onChange={(val,) => setFavicon(val,)}
                                />
                            </section>
                        </div>

                        {/*
                          Second row mirrors the first .settings-grid so column
                          widths line up: Features (3fr) on the left matches
                          Site identity above, Integrations (2fr) on the right
                          matches Branding above.
                        */}
                        <div class="settings-grid">
                            <section class="settings-card settings-features" id="features">
                                <h3 class="settings-card__title">Features</h3>
                                <p class="settings-card__lede">
                                    Enable or disable site modules. Disabling a module hides its admin sidebar
                                    link and stops surfacing related public links. Existing data is preserved.
                                </p>
                                <For each={FEATURES.filter((f,) => f.key !== 'patreon' && !f.hidden,)}>
                                    {(f,) => (
                                        <FeatureToggleRow
                                            featureKey={f.key}
                                            onChange={async (next, opts,) => {
                                                const payload: Record<string, unknown> = {
                                                    features: { [f.key]: next, },
                                                };
                                                if (opts?.enableDependencies) payload.enableDependencies = true;
                                                if (opts?.disableDependents) payload.disableDependents = true;
                                                let result;
                                                try {
                                                    result = await cms.settings.update(payload as any,);
                                                } catch (e) {
                                                    if (e instanceof FeatureCascadeError) {
                                                        // The dependency planner rejected the toggle.
                                                        // The client-side store usually pre-empts this
                                                        // by opening FeatureDependencyModal first; if a
                                                        // stale store let it through, surface the cascade.
                                                        const r = e.result;
                                                        const chain = r.kind === 'missing_prerequisites'
                                                            ? r.missing : r.dependents;
                                                        alert(`Could not toggle ${f.label}: ${chain.join(', ',)}`,);
                                                    } else {
                                                        alert(e instanceof Error ? e.message : `Could not toggle ${f.label}.`,);
                                                    }
                                                    return;
                                                }
                                                await reloadSiteSettings();
                                                refetch();
                                                // Surface the install (migrations ran) so the
                                                // operator knows the feature's tables are ready.
                                                if (next) {
                                                    const installed = (result?.features ?? []).some(
                                                        (s,) => s.enabled && s.appliedMigrations.length > 0,
                                                    );
                                                    if (installed) alert(`${f.label} installed.`,);
                                                }
                                            }}
                                            onRemove={async () => {
                                                try {
                                                    await cms.settings.uninstallFeature(f.key,);
                                                } catch (e) {
                                                    alert(e instanceof Error ? e.message : `Could not remove ${f.label}.`,);
                                                    return;
                                                }
                                                await reloadSiteSettings();
                                                refetch();
                                            }}
                                        />
                                    )}
                                </For>
                            </section>

                            <div class="settings-grid__col">
                            <section class="settings-card">
                                <h3 class="settings-card__title">Integrations</h3>
                                <p class="settings-card__lede">
                                    Third-party services that plug into the site.
                                </p>
                                <FormField label="Google Analytics ID" hint="Measurement ID (e.g. G-XXXXXXX)">
                                    <input
                                        type="text"
                                        value={analyticsId()}
                                        onInput={(e,) => setAnalyticsId(e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField
                                    label="Page history limit (days)"
                                    hint="How long page and post revisions are kept. Each save stores a full copy of the content, so a shorter window uses less space. The 5 most recent revisions are always kept, whatever their age; 0 keeps everything."
                                >
                                    <input
                                        type="number"
                                        min="0"
                                        max="3650"
                                        value={historyDays()}
                                        onInput={(e,) => setHistoryDays(Number(e.currentTarget.value,),)}
                                    />
                                </FormField>
                                <FormField
                                    label="Admin presence idle timeout (seconds)"
                                    hint="How long before a connected admin/editor shows as idle to others (default 60)."
                                >
                                    <input
                                        type="number"
                                        min="5"
                                        max="3600"
                                        value={adminIdleTimeout()}
                                        onInput={(e,) => setAdminIdleTimeout(Number(e.currentTarget.value,) || 60,)}
                                    />
                                </FormField>
                            </section>

                            <section class="settings-card">
                                <h3 class="settings-card__title">E-mail and Contact</h3>
                                <p class="settings-card__lede">
                                    The sender used for site emails (shop orders, event tickets, notifications) unless a
                                    feature sets its own. Mailing-list sends keep their own sender.
                                </p>
                                <FormField label="Contact Email">
                                    <input
                                        type="email"
                                        value={contactEmail()}
                                        onInput={(e,) => setContactEmail(e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField label="Default From Name" hint="Shown as the sender's name.">
                                    <input
                                        type="text"
                                        placeholder="Surge Media"
                                        value={emailFromName()}
                                        onInput={(e,) => setEmailFromName(e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField
                                    label="Default From Address"
                                    hint="Must be an address your mail provider is allowed to send from. Leave empty to use the server's EMAIL_FROM."
                                >
                                    <input
                                        type="email"
                                        placeholder="noreply@surgemedia.us"
                                        value={emailFromAddress()}
                                        onInput={(e,) => setEmailFromAddress(e.currentTarget.value,)}
                                    />
                                </FormField>
                            </section>
                            </div>

                            <ReplyTrackingPanel />

                            <section class="settings-card">
                                <h3 class="settings-card__title">Defaults</h3>
                                <p class="settings-card__lede">
                                    Used to pre-fill authoring forms — changing them does not alter
                                    existing content.
                                </p>
                                <FormField
                                    label="Default Timezone"
                                    hint="New events start in this zone."
                                >
                                    <select
                                        value={defaultTimezone()}
                                        onChange={(e,) => setDefaultTimezone(e.currentTarget.value,)}
                                    >
                                        <option value="">Not set</option>
                                        <Show when={defaultTimezone() && !isKnownTimeZone(defaultTimezone(),)}>
                                            <option value={defaultTimezone()}>{defaultTimezone()}</option>
                                        </Show>
                                        <For each={TIMEZONES}>
                                            {(tz,) => <option value={tz.value}>{tz.label}</option>}
                                        </For>
                                    </select>
                                </FormField>
                                <FormField
                                    label="Default Currency"
                                    hint="Used for ticket prices and other priced content."
                                >
                                    <select
                                        value={defaultCurrency()}
                                        onChange={(e,) => setDefaultCurrency(e.currentTarget.value,)}
                                    >
                                        <For each={CURRENCIES}>
                                            {(c,) => <option value={c.code}>{c.code} — {c.label}</option>}
                                        </For>
                                    </select>
                                </FormField>
                            </section>
                        </div>

                    </form>
                </Show>

                {/* ─── Notifications Tab ─── */}
                <Show when={activeTab() === 'notifications'}>
                    <NotificationsPanel />
                </Show>

                {/* ─── Appearance Tab ─── */}
                <Show when={activeTab() === 'appearance'}>
                    <AppearancePanel />
                </Show>

                {/* ─── Site Header Tab ─── */}
                <Show when={activeTab() === 'site-header'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Customize the site header with images, links, buttons, and spacers.
                    </p>
                    <SiteHeaderEditor />
                </Show>

                {/* ─── Site Footer Tab ─── */}
                <Show when={activeTab() === 'site-footer'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Build the site footer in rows, columns, and items. The footer is hidden on the public
                        site until you enable it here.
                    </p>
                    <SiteFooterEditor />
                </Show>

                {/* ─── Payments Tab ─── */}
                <Show when={activeTab() === 'payments'}>
                    <h2 class="settings-subheading">Payments (Stripe)</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        These are the site-wide default Stripe keys. They power donations, subscriptions,
                        and shop checkout unless a section overrides them. Keys are stored on the server;
                        the publishable key is public (served to the browser), the secret and webhook keys
                        never leave the server. Any <code>STRIPE_*</code> env vars act as a fallback.
                    </p>
                    <StripeKeysEditor context="default" title="Default keys" />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Donations &amp; campaigns</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        By default donations use the site default keys above. Turn off "Use site default" to
                        route donations/campaigns through a different Stripe account.
                    </p>
                    <StripeKeysEditor
                        context="donations"
                        showUseDefault
                        title="Donation keys"
                    />
                </Show>

                {/* ─── API Keys Tab ─── */}
                <Show when={activeTab() === 'permissions'}>
                    <PermissionsPanel />
                </Show>

                <Show when={activeTab() === 'api-keys'}>
                    <ApiKeysPanel />
                </Show>

                {/* ─── Admin Tab ─── */}
                <Show when={activeTab() === 'admin'}>
                    <h2 class="settings-subheading">Admin Appearance</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Customize the colors used by the admin chrome — sidebar, page area, and panel
                        backgrounds. Leave any field empty to inherit the default theme.
                    </p>
                    <AdminAppearancePanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Admin Operations</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        One-shot maintenance tasks. Each runs immediately when triggered;
                        nothing here is scheduled.
                    </p>
                    <CmsUpdatePanel />
                    <div style={{ height: '0.75rem', }} />
                    <SitemapPanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Backup &amp; Restore</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Download a complete copy of the site database, or replace the live
                        database with one. Restoring is irreversible from here — read the
                        confirmation carefully.
                    </p>
                    <BackupRestorePanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Job Management</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Background jobs registered with the server's cron runner.
                    </p>
                    <JobManagementPanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Server Logs</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Tail of the server's combined log. Expand to load; use Refresh to update.
                    </p>
                    <ServerLogsPanel />
                </Show>
            </div>
        </div>
    );
};

export default AdminSettings;
