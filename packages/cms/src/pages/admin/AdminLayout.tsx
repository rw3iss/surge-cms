import { A, useLocation, useNavigate, } from '@solidjs/router';
import { isAdminRole, isStaffRole, type AppearanceSettings, } from '@sitesurge/types';
import { createEffect, createMemo, createResource, createSignal, For, ParentComponent, Show, } from 'solid-js';
import GlobalSearch from '../../components/admin/common/GlobalSearch';
import SessionExpiredModal from '../../components/auth/SessionExpiredModal';
import SiteLogo from '../../components/common/branding/SiteLogo';
import { cms, } from '../../services/cmsClient';
import { swatchCssVars, } from '../../services/colorResolver';
import { loadSwatches, swatches as swatchesSignal, } from '../../services/siteColors';
import { adminAppearance, adminAppearanceCssVars, loadAdminAppearance, } from '../../stores/adminAppearance';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, loadSiteSettings, siteLogo, siteName, } from '../../stores/siteSettings';
import { ensureFontFaces, } from '../../services/fonts';
import { appearanceCssVars, } from '../../utils/appearanceStyle';
import './AdminLayout.scss';

/** Minimal outline SVG icons for sidebar nav items (16x16 viewBox) */
const ICONS: Record<string, string> = {
    dashboard: '<path d="M3 3h4v5H3V3zm6 0h4v3H9V3zm0 5h4v5H9V8zM3 10h4v3H3v-3z" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    pages: '<path d="M4 2h5l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M9 2v3h3" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    posts: '<path d="M3 3h10v10H3z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M5 6h6M5 8h6M5 10h4" stroke="currentColor" stroke-width="1.2"/>',
    campaigns: '<path d="M8 2a6 6 0 110 12A6 6 0 018 2z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    forms: '<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M5 5h1M5 8h1M5 11h1M8 5h3M8 8h3M8 11h3" stroke="currentColor" stroke-width="1.2"/>',
    media: '<path d="M2 4h12v8H2z" stroke="currentColor" fill="none" stroke-width="1.2"/><circle cx="5" cy="7" r="1.2" stroke="currentColor" fill="none" stroke-width="1"/><path d="M2 10l3-2 2 1 3-3 4 4" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    users: '<circle cx="8" cy="5" r="2.5" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M3 14c0-3 2.5-5 5-5s5 2 5 5" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    messages: '<path d="M2 3h12v8H6l-3 2v-2H2V3z" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    mail: '<rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M2 4l6 5 6-5" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    shop: '<path d="M3 5h10l-.7 7a1 1 0 01-1 .9H4.7a1 1 0 01-1-.9L3 5z" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M5.5 5V4a2.5 2.5 0 015 0v1" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    connections: '<circle cx="5" cy="5" r="2" stroke="currentColor" fill="none" stroke-width="1.2"/><circle cx="11" cy="11" r="2" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M6.5 6.5l3 3" stroke="currentColor" stroke-width="1.2"/>',
    social: '<circle cx="12" cy="4" r="2" stroke="currentColor" fill="none" stroke-width="1.2"/><circle cx="4" cy="8" r="2" stroke="currentColor" fill="none" stroke-width="1.2"/><circle cx="12" cy="12" r="2" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M5.7 7l4.6-2.2M5.7 9l4.6 2.2" stroke="currentColor" stroke-width="1.2"/>',
    settings: '<circle cx="8" cy="8" r="2.5" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" stroke="currentColor" stroke-width="1"/>',
    developer: '<path d="M5 5L2 8l3 3M11 5l3 3-3 3M9 3l-2 10" stroke="currentColor" fill="none" stroke-width="1.2"/>',
    help: '<circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" stroke-width="1.2"/><path d="M6.3 6.2a1.7 1.7 0 013.3.5c0 1.2-1.6 1.4-1.6 2.5" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="11.3" r="0.6" fill="currentColor"/>',
    collapse: '<path d="M11 3L5 8l6 5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    expand: '<path d="M5 3l6 5-6 5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

function NavIcon(props: { name: string; },) {
    return (
        <svg
            class="admin-layout__nav-icon"
            viewBox="0 0 16 16"
            width="18"
            height="18"
            innerHTML={ICONS[props.name] || ''}
        />
    );
}

interface NavItem {
    path: string;
    label: string;
    icon: string;
    end?: boolean;
    sysadminOnly?: boolean;
    /** Only visible to admin/sysadmin — hidden from the `editor` role. */
    adminOnly?: boolean;
    /**
     * Feature key from `SiteFeatures`. When set, the nav item is
     * rendered only when `features[feature].enabled` is true. Items
     * without a feature (Dashboard, Pages, Media, Users, Settings)
     * always render — they're core CMS surfaces.
     */
    feature?: 'posts' | 'campaigns' | 'forms' | 'messages' | 'users' | 'mailing_lists' | 'shop' | 'plugins' | 'social';
}

const NAV_ITEMS: NavItem[] = [
    { path: '/admin', label: 'Dashboard', icon: 'dashboard', end: true, },
    { path: '/admin/pages', label: 'Pages', icon: 'pages', },
    { path: '/admin/posts', label: 'Posts', icon: 'posts', feature: 'posts', },
    { path: '/admin/campaigns', label: 'Campaigns', icon: 'campaigns', feature: 'campaigns', },
    { path: '/admin/forms', label: 'Forms', icon: 'forms', feature: 'forms', },
    { path: '/admin/media', label: 'Media', icon: 'media', },
    { path: '/admin/users', label: 'Users', icon: 'users', feature: 'users', adminOnly: true, },
    { path: '/admin/messages', label: 'Messages', icon: 'messages', feature: 'messages', },
    { path: '/admin/social', label: 'Social', icon: 'social', feature: 'social', adminOnly: true, },
    { path: '/admin/mailing-lists', label: 'Mailing Lists', icon: 'mail', feature: 'mailing_lists', adminOnly: true, },
    { path: '/admin/shop', label: 'Shop', icon: 'shop', feature: 'shop', adminOnly: true, },
    { path: '/admin/plugins', label: 'Plugins', icon: 'developer', feature: 'plugins', adminOnly: true, },
    { path: '/admin/settings', label: 'Settings', icon: 'settings', adminOnly: true, },
    { path: '/admin/help', label: 'Help', icon: 'help', },
];

const COLLAPSED_KEY = 'admin-sidebar-collapsed';

const AdminLayout: ParentComponent = (props,) => {
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen,] = createSignal(false,);
    const [collapsed, setCollapsed,] = createSignal(
        typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY,) === '1',
    );

    createEffect(() => {
        if (!auth.isLoading && !auth.isAuthenticated) {
            navigate(`/login?return=${location.pathname}`,);
        } else if (!auth.isLoading && !isStaffRole(auth.user?.role,)) {
            navigate('/',);
        } else if (
            !auth.isLoading
            && !isAdminRole(auth.user?.role,)
            && NAV_ITEMS.some((i,) => i.adminOnly && location.pathname.startsWith(i.path,))
        ) {
            // Editor reached an admin-only page by URL — send them home.
            navigate('/admin',);
        }
    },);

    createEffect(() => {
        location.pathname;
        setSidebarOpen(false,);
    },);

    // Site appearance settings flow into the admin shell as `--site-*`
    // CSS custom properties so admin chrome (Save buttons, focus rings,
    // active sidebar row, page editor "+ Add Block" trigger, etc.) uses
    // the configured brand color rather than the static fallback.
    const [appearance,] = createResource(async () => {
        try {
            return await cms.settings.getAppearance() as AppearanceSettings;
        } catch {
            return null;
        }
    },);
    // Admin-specific chrome tokens (sidebar bg/text, page bg/text,
    // panel bg). Merged into the same root-element style so a single
    // inline-style block carries both site appearance and admin-chrome
    // overrides — keeping CSS-var resolution simple.
    void loadAdminAppearance();
    // Site swatches feed `--swatch-{id}` CSS custom properties so any
    // `swatch:{id}` color value resolved via `colorCssValue()` updates
    // live when the operator edits the palette. We co-locate them with
    // the existing appearance + admin-appearance vars so the layout
    // root carries one consolidated style block.
    void loadSwatches();
    const layoutStyle = createMemo(() => ({
        ...appearanceCssVars(appearance(), 'admin',),
        ...adminAppearanceCssVars(adminAppearance(),),
        ...swatchCssVars(swatchesSignal(),),
    }),);

    // Belt-and-braces: in addition to the inline `style={...}` on the
    // admin-layout div (which Solid normally handles correctly), also
    // set every CSS custom property imperatively on the same element
    // via setProperty. This guarantees the vars apply even if Solid's
    // style binding misses a key (it has historically been picky about
    // CSS custom properties on object-form style props), and it makes
    // the runtime value debuggable by inspecting the .admin-layout
    // node in DevTools.
    let rootRef: HTMLDivElement | undefined;
    createEffect(() => {
        if (!rootRef) return;
        const style = layoutStyle();
        for (const [key, value,] of Object.entries(style,)) {
            if (key.startsWith('--',)) {
                rootRef.style.setProperty(key, value,);
            } else {
                // Non-var keys (like background-color in public mode) — set via the
                // camelCase property on style. Lowercased dashes work too.
                (rootRef.style as unknown as Record<string, string>)[key] = value;
            }
        }
    },);

    // Eagerly populate the site-settings store on mount so the sidebar
    // logo + name resolve from the same source as the public Header.
    // The public Layout already does this; admin needs its own trigger
    // because users can deep-link straight into /admin without ever
    // touching the public layout.
    void loadSiteSettings();
    // Inject uploaded fonts' @font-face rules so font previews (FontSelect
    // dropdowns, block/header/footer previews) render in the real typefaces
    // anywhere in the admin.
    void ensureFontFaces();

    const isActive = (path: string, end?: boolean,) =>
        end ? location.pathname === path : (location.pathname === path || location.pathname.startsWith(`${path}/`,));

    const handleNavClick = () => setSidebarOpen(false,);

    const toggleCollapsed = () => {
        const next = !collapsed();
        setCollapsed(next,);
        try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0',); } catch { /* ignore */ }
    };

    return (
        <Show when={!auth.isLoading && isStaffRole(auth.user?.role,)} fallback={<div>Loading...</div>}>
            <div
                ref={(el,) => { rootRef = el; }}
                class={`admin-layout ${collapsed() ? 'admin-layout--collapsed' : ''}`}
                style={layoutStyle()}
            >
                <button
                    class={`admin-layout__hamburger ${sidebarOpen() ? 'admin-layout__hamburger--open' : ''}`}
                    onClick={() => setSidebarOpen(!sidebarOpen(),)}
                    aria-label="Toggle navigation"
                >
                    <span />
                    <span />
                    <span />
                </button>
                <Show when={sidebarOpen()}>
                    <div class="admin-layout__overlay" onClick={() => setSidebarOpen(false,)} />
                </Show>
                <aside class={`admin-layout__sidebar ${sidebarOpen() ? 'admin-layout__sidebar--open' : ''}`}>
                    <div class="admin-layout__logo">
                        <A href="/" onClick={handleNavClick}>
                            <SiteLogo
                                size="small"
                                name={siteName()}
                                logoSrc={siteLogo()}
                                compact={collapsed()}
                            />
                        </A>
                    </div>
                    <nav class="admin-layout__nav">
                        <For each={NAV_ITEMS}>
                            {(item,) => (
                                <Show
                                    when={
                                        (!item.sysadminOnly || auth.user?.role === 'sysadmin')
                                        && (!item.adminOnly || isAdminRole(auth.user?.role,))
                                        && (!item.feature || isFeatureEnabled(item.feature,))
                                    }
                                >
                                    <A
                                        href={item.path}
                                        end={item.end}
                                        class={`admin-layout__nav-link ${isActive(item.path, item.end,) ? 'active' : ''}`}
                                        onClick={handleNavClick}
                                        title={collapsed() ? item.label : undefined}
                                    >
                                        <NavIcon name={item.icon} />
                                        <span class="admin-layout__nav-label">{item.label}</span>
                                    </A>
                                </Show>
                            )}
                        </For>
                    </nav>
                    <div class="admin-layout__sidebar-footer">
                        <div class="admin-layout__user">
                            <Show
                                when={!collapsed()}
                                fallback={
                                    <button
                                        class="admin-layout__user-avatar"
                                        onClick={() => auth.logout()}
                                        title={`${auth.user?.displayName} — click to log out`}
                                    >
                                        <Show
                                            when={auth.user?.avatarUrl}
                                            fallback={(auth.user?.displayName || 'U').charAt(0,).toUpperCase()}
                                        >
                                            <img src={auth.user!.avatarUrl!} alt="" class="admin-layout__user-avatar-img" />
                                        </Show>
                                    </button>
                                }
                            >
                                <div class="admin-layout__user-avatar">
                                    <Show
                                        when={auth.user?.avatarUrl}
                                        fallback={(auth.user?.displayName || 'U').charAt(0,).toUpperCase()}
                                    >
                                        <img src={auth.user!.avatarUrl!} alt="" class="admin-layout__user-avatar-img" />
                                    </Show>
                                </div>
                                <div class="admin-layout__user-info">
                                    <span class="admin-layout__user-name">{auth.user?.displayName}</span>
                                    <button class="admin-layout__user-logout" onClick={() => auth.logout()}>
                                        Log out
                                    </button>
                                </div>
                            </Show>
                        </div>
                        <button
                            class="admin-layout__collapse-toggle"
                            onClick={toggleCollapsed}
                            title={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            <NavIcon name={collapsed() ? 'expand' : 'collapse'} />
                        </button>
                    </div>
                </aside>
                <main class="admin-layout__main">
                    {props.children}
                </main>
                <GlobalSearch />
                <SessionExpiredModal />
            </div>
        </Show>
    );
};

export default AdminLayout;
