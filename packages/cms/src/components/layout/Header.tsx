import { A, useLocation, } from '@solidjs/router';
import { isAdminRole, type NavigationItem, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, type JSX, onCleanup, onMount, Show, } from 'solid-js';
import { colorCssValue, } from '../../services/colorResolver';
import { fontStack, } from '../../utils/appearanceStyle';
import { activeHeaderStyle, } from '../../stores/headerStyle';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import { cartCount, } from '../../stores/shopCart';
import SiteLogo from '../common/branding/SiteLogo';
import './Header.scss';

// ─── Site Header Item Types ───

type HeaderItemType = 'image' | 'image_link' | 'text' | 'text_link' | 'button' | 'menu' | 'gap' | 'flex_spacer';

interface SiteHeaderItem {
    id: string;
    type: HeaderItemType;
    text?: string;
    url?: string;
    imageUrl?: string;
    mediaId?: string;
    openInNewTab?: boolean;
    buttonColor?: string;
    fontSize?: string;
    /** CSS font-weight ('100'..'900' or keyword). Empty/undefined → inherit. */
    fontWeight?: string;
    /** Font `customId` from the Font manager. Empty/undefined → header default. */
    fontFamily?: string;
    textColor?: string;
    /** Text color when the active header style is 'alt'. Falls back to
     *  `textColor`. */
    textColorAlt?: string;
    width?: string;
    alignment?: string;
    verticalAlignment?: string;
    margin?: string;
    padding?: string;
    order: number;
    /** Sub-items for a `menu` item — rendered as a hover/focus dropdown. */
    children?: SiteHeaderItem[];
}

export interface SiteHeaderSettings {
    items: SiteHeaderItem[];
    backgroundColor?: string;
    textColor?: string;
    /** Alternate background/text used when a page/post selects the 'alt'
     *  header style. Each falls back to the regular value when empty. */
    backgroundColorAlt?: string;
    textColorAlt?: string;
    /** Default header style for post pages ('default' | 'alt'). */
    defaultPostHeaderStyle?: 'default' | 'alt';
    /** Font `customId` applied to the whole header's text. Empty → site font. */
    defaultFont?: string;
    /** Default text size for the whole header (CSS length). Items override it. */
    defaultFontSize?: string;
    padding?: string;
    margin?: string;
    /** When true (the default), the header pins to the viewport top
     *  via `position: sticky`. When false, it scrolls away with the
     *  page like any other in-flow element. */
    sticky?: boolean;
    /** When true, the header slides up out of view on downward scroll
     *  and slides back in on upward scroll. Combined with `sticky`,
     *  gives a content-priority pattern; standalone (without sticky)
     *  it's effectively a no-op since the header is in flow already. */
    autoHide?: boolean;
    /** When true, horizontal padding follows the site gutter width
     *  instead of the header's own `padding`. */
    applyGutter?: boolean;
    /** Float the header absolutely on top of the page content (a transparent
     *  overlay) instead of sitting in flow above it. */
    floatHeader?: boolean;
    /** Absolutely position the right-side content (cart / admin / user /
     *  logout) so it doesn't push the main header content left. */
    floatRightContent?: boolean;
    /** Show the shopping-cart link (only when the `shop` feature is on).
     *  Default true. */
    showCart?: boolean;
    /** Desktop account-controls layout: `inline` (default) or `menu` (gear
     *  dropdown). Mobile always renders inline. */
    loggedInFormat?: 'inline' | 'menu';
}

interface HeaderProps {
    navigation: NavigationItem[];
    siteName: string;
    logo?: string;
    headerSettings?: SiteHeaderSettings | null;
    gutterWidth?: string;
}

// ─── Internal/external link helper (shared by nav items + menu dropdowns) ───

function HeaderLink(props: {
    item: SiteHeaderItem;
    class?: string;
    style?: Record<string, string>;
    onClick?: () => void;
    children?: JSX.Element;
},) {
    const item = () => props.item;
    const isInternal = () => !item().openInNewTab && !!item().url && !item().url!.startsWith('http',);
    const label = () => props.children ?? item().text;
    return (
        <Show
            when={isInternal()}
            fallback={
                <a
                    href={item().url || '#'}
                    target={item().openInNewTab ? '_blank' : undefined}
                    rel={item().openInNewTab ? 'noopener noreferrer' : undefined}
                    class={props.class}
                    style={props.style}
                    onClick={props.onClick}
                >
                    {label()}
                </a>
            }
        >
            <A href={item().url || '/'} class={props.class} style={props.style} onClick={props.onClick}>
                {label()}
            </A>
        </Show>
    );
}

// Sub-items of a menu, ordered.
function menuChildren(item: SiteHeaderItem,): SiteHeaderItem[] {
    return (item.children ?? []).slice().sort((a, b,) => (a.order ?? 0) - (b.order ?? 0),);
}

// ─── Render a single header item ───

function HeaderItem(props: { item: SiteHeaderItem; },) {
    const item = () => props.item;

    const baseStyle = () => {
        const s: Record<string, string> = {};
        if (item().fontSize) s['font-size'] = item().fontSize!;
        if (item().fontWeight) s['font-weight'] = item().fontWeight!;
        // Per-item font override — beats the header default (set on the header
        // container) which in turn beats the site font.
        const ff = fontStack(item().fontFamily,);
        if (ff) s['font-family'] = ff;
        // In the 'alt' header style, prefer the item's alt text color
        // (falling back to its regular text color when unset).
        const textColorValue = activeHeaderStyle() === 'alt'
            ? (item().textColorAlt || item().textColor)
            : item().textColor;
        const tc = colorCssValue(textColorValue, '',);
        if (tc) s['color'] = tc;
        if (item().width) s['width'] = item().width!;
        if (item().margin) s['margin'] = item().margin!;
        if (item().padding) s['padding'] = item().padding!;
        if (item().alignment) s['text-align'] = item().alignment!;
        return s;
    };

    const linkTarget = () => item().openInNewTab ? '_blank' : undefined;
    const linkRel = () => item().openInNewTab ? 'noopener noreferrer' : undefined;

    switch (item().type) {
        case 'image': {
            const imgStyle = () => ({
                ...baseStyle(),
                'object-fit': 'contain' as const,
            });
            return (
                <img
                    src={item().imageUrl}
                    alt=""
                    class="header__custom-img"
                    style={imgStyle()}
                />
            );
        }

        case 'image_link': {
            const alignMap: Record<string, string> = {
                left: 'flex-start',
                center: 'center',
                right: 'flex-end',
            };
            const linkStyle = () => {
                const hAlign = item().alignment || 'center';
                const s: Record<string, string> = {
                    display: 'flex',
                    'flex-direction': 'column',
                    'align-items': alignMap[hAlign] || 'center',
                };
                if (item().width) s['width'] = item().width!;
                if (item().margin) s['margin'] = item().margin!;
                if (item().padding) s['padding'] = item().padding!;
                return s;
            };
            const imgStyle = () => ({
                display: 'block',
                'max-width': '100%',
                height: 'auto',
            });
            return (
                <a
                    href={item().url || '#'}
                    target={linkTarget()}
                    rel={linkRel()}
                    class="header__custom-image-link"
                    style={linkStyle()}
                >
                    <img src={item().imageUrl} alt="" style={imgStyle()} />
                </a>
            );
        }

        case 'text':
            return (
                <span class="header__custom-text" style={baseStyle()}>
                    {item().text}
                </span>
            );

        case 'text_link':
            return (
                <Show
                    when={!item().openInNewTab && item().url && !item().url!.startsWith('http',)}
                    fallback={
                        <a
                            href={item().url || '#'}
                            target={linkTarget()}
                            rel={linkRel()}
                            class="header__custom-text-link"
                            style={baseStyle()}
                        >
                            {item().text}
                        </a>
                    }
                >
                    <A
                        href={item().url || '/'}
                        class="header__custom-text-link"
                        style={baseStyle()}
                    >
                        {item().text}
                    </A>
                </Show>
            );

        case 'button':
            return (
                <a
                    href={item().url || '#'}
                    target={linkTarget()}
                    rel={linkRel()}
                    class="header__custom-btn"
                    style={{
                        ...baseStyle(),
                        background: colorCssValue(item().buttonColor, '#333',),
                        color: '#fff',
                    }}
                >
                    {item().text}
                </a>
            );

        case 'menu': {
            const kids = () => menuChildren(item(),);
            // A menu with no children behaves like a plain text link.
            return (
                <Show
                    when={kids().length > 0}
                    fallback={
                        <HeaderLink item={item()} class="header__custom-text-link" style={baseStyle()} />
                    }
                >
                    <div class="header__menu">
                        <HeaderLink item={item()} class="header__menu-trigger" style={baseStyle()}>
                            <span>{item().text}</span>
                            <svg
                                class="header__menu-caret"
                                viewBox="0 0 12 12"
                                width="10"
                                height="10"
                                aria-hidden="true"
                            >
                                <path
                                    d="M2 4l4 4 4-4"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </HeaderLink>
                        <div class="header__menu-dropdown" role="menu">
                            <For each={kids()}>
                                {(child,) => <HeaderLink item={child} class="header__menu-link" />}
                            </For>
                        </div>
                    </div>
                </Show>
            );
        }

        case 'gap':
            return (
                <div
                    class="header__custom-gap"
                    style={{ width: item().width || '20px', 'flex-shrink': '0', }}
                />
            );

        case 'flex_spacer':
            return (
                <div
                    class="header__custom-spacer"
                    style={{
                        flex: '1',
                        ...(item().width ? { 'max-width': item().width, } : {}),
                    }}
                />
            );

        default:
            return null;
    }
}

// ─── Mobile flyout nav item ───

function MobileNavItem(props: { item: SiteHeaderItem; onClose: () => void; },) {
    const item = () => props.item;

    if (item().type === 'text') {
        return <span class="header__mobile-flyout-label">{item().text}</span>;
    }

    // Menu with sub-items → parent link followed by indented children.
    const kids = () => menuChildren(item(),);
    return (
        <Show
            when={item().type === 'menu' && kids().length > 0}
            fallback={<HeaderLink item={item()} class="header__nav-link" onClick={props.onClose} />}
        >
            <div class="header__mobile-menu">
                <HeaderLink
                    item={item()}
                    class="header__nav-link header__mobile-menu-parent"
                    onClick={props.onClose}
                />
                <div class="header__mobile-submenu">
                    <For each={kids()}>
                        {(child,) => (
                            <HeaderLink
                                item={child}
                                class="header__nav-link header__mobile-sublink"
                                onClick={props.onClose}
                            />
                        )}
                    </For>
                </div>
            </div>
        </Show>
    );
}

// ─── Logout button (shared by inline actions + the account menu) ───

function LogoutButton(props: { onLogout: () => void; class?: string; },) {
    return (
        <button
            class={props.class ?? 'header__logout-btn'}
            onClick={props.onLogout}
            title="Logout"
            aria-label="Logout"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
        </button>
    );
}

// ─── Account menu (loggedInFormat = 'menu') ───
//
// A gear icon that opens a dropdown with the Admin link (admins only),
// the user identity, and Sign Out — one per column. Closes on outside
// click, or 500ms after the pointer leaves (re-entering cancels the
// timer). Desktop-only: it lives inside `.header__nav`, which is hidden
// on mobile (the mobile flyout renders these controls inline instead).

function AccountMenu(props: { onLogout: () => void; },) {
    const auth = useAuth();
    const [open, setOpen,] = createSignal(false,);
    let rootEl: HTMLDivElement | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    const clearCloseTimer = () => {
        if (closeTimer) {
            clearTimeout(closeTimer,);
            closeTimer = undefined;
        }
    };
    // Hover-off grace period before auto-closing.
    const scheduleClose = () => {
        clearCloseTimer();
        closeTimer = setTimeout(() => setOpen(false,), 500,);
    };

    const onDocClick = (e: MouseEvent,) => {
        if (open() && rootEl && !rootEl.contains(e.target as Node,)) setOpen(false,);
    };
    onMount(() => document.addEventListener('click', onDocClick,),);
    onCleanup(() => {
        document.removeEventListener('click', onDocClick,);
        clearCloseTimer();
    },);

    return (
        <div
            class="header__account-menu"
            ref={(el,) => { rootEl = el; }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
        >
            <button
                type="button"
                class={`header__account-trigger ${open() ? 'header__account-trigger--open' : ''}`}
                aria-label="Account menu"
                aria-haspopup="true"
                aria-expanded={open()}
                onClick={(e,) => { e.stopPropagation(); setOpen(!open(),); }}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
            </button>
            <Show when={open()}>
                <div class="header__account-dropdown" role="menu">
                    <Show when={isAdminRole(auth.user?.role,)}>
                        <A href="/admin" class="header__account-item" role="menuitem" onClick={() => setOpen(false,)}>
                            Admin
                        </A>
                    </Show>
                    <div class="header__account-item header__account-user">
                        <Show when={auth.user?.avatarUrl}>
                            <img src={auth.user?.avatarUrl} alt={auth.user?.displayName} class="header__user-avatar" />
                        </Show>
                        <span class="header__user-name">{auth.user?.displayName}</span>
                    </div>
                    <button
                        type="button"
                        class="header__account-item header__account-logout"
                        role="menuitem"
                        onClick={() => { setOpen(false,); props.onLogout(); }}
                    >
                        Logout
                    </button>
                </div>
            </Show>
        </div>
    );
}

// ─── Header Component ───

export const Header: Component<HeaderProps> = (props,) => {
    const [mobileMenuOpen, setMobileMenuOpen,] = createSignal(false,);
    const location = useLocation();
    const auth = useAuth();

    const isActive = (slug: string,) => {
        const path = location.pathname;
        if (slug === 'home' || slug === '/') {
            return path === '/';
        }
        return path === `/${slug}` || path.startsWith(`/${slug}/`,);
    };

    const toggleMobileMenu = () => setMobileMenuOpen(!mobileMenuOpen(),);
    const closeMobileMenu = () => setMobileMenuOpen(false,);

    const hasCustomHeader = () => props.headerSettings?.items && props.headerSettings.items.length > 0;

    // Items to show in the mobile flyout: text, text_link, button, menu — no spacers/images
    const mobileNavItems = () => {
        if (!hasCustomHeader()) return [];
        return (props.headerSettings?.items ?? [])
            .filter(i => ['text', 'text_link', 'button', 'menu',].includes(i.type,),)
            .toSorted((a, b,) => a.order - b.order,);
    };

    // ─── Sticky / auto-hide behavior ────────────────────────────
    const isStickyEnabled = () => props.headerSettings?.sticky !== false;
    const isAutoHideEnabled = () => props.headerSettings?.autoHide === true;

    const [hidden, setHidden,] = createSignal(false,);

    createEffect(() => {
        if (!isAutoHideEnabled()) {
            setHidden(false,);
            return;
        }
        if (typeof window === 'undefined') return;

        let lastY = window.scrollY;
        const THRESHOLD = 8;
        const TOP_GUARD = 4;

        const onScroll = () => {
            const y = window.scrollY;
            const delta = y - lastY;
            if (Math.abs(delta,) < THRESHOLD) return;
            if (y < TOP_GUARD) {
                setHidden(false,);
            } else if (delta > 0) {
                setHidden(true,);
            } else {
                setHidden(false,);
            }
            lastY = y;
        };

        window.addEventListener('scroll', onScroll, { passive: true, },);
        onCleanup(() => window.removeEventListener('scroll', onScroll,),);
    },);

    const isFloatHeader = () => props.headerSettings?.floatHeader === true;
    const isFloatRightContent = () => props.headerSettings?.floatRightContent === true;

    // Cart shows only when: the shop feature is on, the operator has the
    // 'Show cart link' setting enabled (default true), AND the visitor has at
    // least one item in their cart. An empty cart shows no icon at all.
    const showCart = () =>
        isFeatureEnabled('shop',)
        && props.headerSettings?.showCart !== false
        && cartCount() > 0;
    // Desktop account-controls layout; defaults to the historic inline row.
    const loggedInFormat = () => props.headerSettings?.loggedInFormat === 'menu' ? 'menu' : 'inline';
    // Header 'Item Spacing' setting — also applied to the right-side container
    // (cart / account controls), mirroring the main custom-items row.
    const itemSpacing = () => (props.headerSettings as { itemSpacing?: string; } | null | undefined)?.itemSpacing || undefined;

    const headerClass = () => {
        const base = `header${hasCustomHeader() ? ' header--custom' : ''}`;
        const cls = [base,];
        if (!isStickyEnabled()) cls.push('header--no-sticky',);
        if (isAutoHideEnabled()) {
            cls.push('header--auto-hide',);
            if (hidden()) cls.push('header--auto-hidden',);
        }
        // Float the header as a transparent overlay on top of the content.
        if (isFloatHeader()) cls.push('header--float',);
        // Absolutely position the right-side content so it doesn't push the
        // main header content left.
        if (isFloatRightContent()) cls.push('header--float-right',);
        return cls.join(' ',);
    };

    // Resolve the header's bg/text for the active style — 'alt' uses the
    // alternate colors (each falling back to the regular one when unset).
    const resolvedBg = () => activeHeaderStyle() === 'alt'
        ? (props.headerSettings?.backgroundColorAlt || props.headerSettings?.backgroundColor)
        : props.headerSettings?.backgroundColor;
    const resolvedText = () => activeHeaderStyle() === 'alt'
        ? (props.headerSettings?.textColorAlt || props.headerSettings?.textColor)
        : props.headerSettings?.textColor;

    const headerStyle = () => {
        if (!hasCustomHeader()) return {};
        const s: Record<string, string> = {};
        const bg = colorCssValue(resolvedBg(), '',);
        if (bg) s['background'] = bg;
        const tc = colorCssValue(resolvedText(), '',);
        if (tc) s['color'] = tc;
        // Header default font — applies to the whole header's text; per-item
        // `fontFamily` overrides it via the item's own inline style.
        const ff = fontStack(props.headerSettings?.defaultFont,);
        if (ff) s['font-family'] = ff;
        // Header default text size — per-item `fontSize` overrides via cascade.
        if (props.headerSettings?.defaultFontSize) s['font-size'] = props.headerSettings.defaultFontSize;
        if (props.headerSettings?.margin) s['margin'] = props.headerSettings.margin;
        return s;
    };

    const containerStyle = () => {
        if (!hasCustomHeader()) return {};
        const s: Record<string, string> = {};
        const pad = props.headerSettings?.padding;
        if (pad) {
            const parts = pad.trim().split(/\s+/,);
            const top = parts[0] || '0';
            const right = parts[1] || parts[0] || '0';
            const bottom = parts[2] || parts[0] || '0';
            const left = parts[3] || parts[1] || parts[0] || '0';
            s['padding-top'] = top;
            s['padding-right'] = right;
            s['padding-bottom'] = bottom;
            s['padding-left'] = left;
        }
        if (props.headerSettings?.applyGutter && props.gutterWidth && props.gutterWidth !== '0') {
            s['padding-left'] = props.gutterWidth;
            s['padding-right'] = props.gutterWidth;
        }
        // Expose the resolved right padding so the float-right nav can inset
        // itself to the same gutter/padding as the in-flow content.
        s['--header-pad-right'] = s['padding-right'] || '0';
        return s;
    };

    // Background/color for mobile flyout matches the header's configured background
    const flyoutStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(resolvedBg(), '',);
        if (bg) s['background'] = bg;
        const tc = colorCssValue(resolvedText(), '',);
        if (tc) s['color'] = tc;
        const ff = fontStack(props.headerSettings?.defaultFont,);
        if (ff) s['font-family'] = ff;
        if (props.headerSettings?.defaultFontSize) s['font-size'] = props.headerSettings.defaultFontSize;
        return s;
    };

    // Flyout head padding mirrors the header container's horizontal padding so
    // the logo sits in the exact same position when the flyout opens.
    const flyoutHeadStyle = () => {
        const cs = containerStyle();
        const s: Record<string, string> = {};
        if (cs['padding-left']) s['padding-left'] = cs['padding-left'];
        if (cs['padding-right']) s['padding-right'] = cs['padding-right'];
        return s;
    };

    return (
        <>
            <header class={headerClass()} style={headerStyle()}>
                <div class="header__container" style={containerStyle()}>
                    {/* Non-custom: logo always visible */}
                    <Show when={!hasCustomHeader()}>
                        <A href="/" class="header__logo" onClick={closeMobileMenu}>
                            <SiteLogo name={props.siteName} logoSrc={props.logo} />
                        </A>
                    </Show>

                    {/* Custom header: mobile-only logo (hidden on desktop, custom items handle it) */}
                    <Show when={hasCustomHeader()}>
                        <A href="/" class="header__mobile-logo" onClick={closeMobileMenu}>
                            <SiteLogo name={props.siteName} logoSrc={props.logo} />
                        </A>
                    </Show>

                    {/* Custom header items — hidden on mobile, shown on desktop */}
                    <Show when={hasCustomHeader()}>
                        <div
                            class="header__custom-items"
                            style={{ gap: itemSpacing(), }}
                        >
                            <For each={props.headerSettings!.items}>
                                {(item,) => <HeaderItem item={item} />}
                            </For>
                        </div>
                    </Show>

                    {/* Desktop nav (right-side container: cart / account controls).
                        Honors the header's Item Spacing setting, like the main
                        items row; falls back to the SCSS gap when unset. */}
                    <nav class="header__nav" style={{ gap: itemSpacing(), }}>
                        <Show when={!hasCustomHeader()}>
                            <ul class="header__nav-list">
                                <For each={props.navigation}>
                                    {(item,) => (
                                        <Show when={item.isVisible}>
                                            <li class="header__nav-item">
                                                <Show
                                                    when={item.isExternal}
                                                    fallback={
                                                        <A
                                                            href={item.slug === 'home' ? '/' : `/${item.slug}`}
                                                            class={`header__nav-link ${
                                                                isActive(item.slug,) ? 'header__nav-link--active' : ''
                                                            }`}
                                                            onClick={closeMobileMenu}
                                                        >
                                                            {item.label}
                                                        </A>
                                                    }
                                                >
                                                    <a
                                                        href={item.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        class="header__nav-link"
                                                    >
                                                        {item.label}
                                                    </a>
                                                </Show>
                                            </li>
                                        </Show>
                                    )}
                                </For>
                            </ul>
                        </Show>

                        {/* Cart — rendered BEFORE the admin/account controls,
                            gated by the shop feature + the showCart setting. */}
                        <Show when={showCart()}>
                            <A href="/shop/cart" class="header__cart" aria-label="Cart" onClick={closeMobileMenu}>
                                <span class="header__cart-icon" aria-hidden="true">🛒</span>
                                <Show when={cartCount() > 0}>
                                    <span class="header__cart-badge">{cartCount()}</span>
                                </Show>
                            </A>
                        </Show>

                        {/* Account controls — inline (Admin + user + logout) or a
                            gear dropdown, per the loggedInFormat setting. */}
                        <Show
                            when={auth.isAuthenticated}
                            fallback={
                                // Only surface the public Sign In when the users/members
                                // feature is on — a members-less site (e.g. a pure news
                                // site) shouldn't show it, and it would otherwise collide
                                // with a custom header's own CTA.
                                <Show when={isFeatureEnabled('users',)}>
                                    <A href="/login" class="header__btn header__btn--primary" onClick={closeMobileMenu}>
                                        Login
                                    </A>
                                </Show>
                            }
                        >
                            <Show
                                when={loggedInFormat() === 'menu'}
                                fallback={
                                    <>
                                        <Show when={isAdminRole(auth.user?.role,)}>
                                            <ul class="header__nav-list">
                                                <li class="header__nav-item">
                                                    <A
                                                        href="/admin"
                                                        class={`header__nav-link ${
                                                            isActive('admin',) ? 'header__nav-link--active' : ''
                                                        }`}
                                                        onClick={closeMobileMenu}
                                                    >
                                                        Admin
                                                    </A>
                                                </li>
                                            </ul>
                                        </Show>
                                        <div class="header__actions">
                                            <div class="header__user">
                                                <Show when={auth.user?.avatarUrl}>
                                                    <img
                                                        src={auth.user?.avatarUrl}
                                                        alt={auth.user?.displayName}
                                                        class="header__user-avatar"
                                                    />
                                                </Show>
                                                <span class="header__user-name">{auth.user?.displayName}</span>
                                                <LogoutButton onLogout={() => { auth.logout(); closeMobileMenu(); }} />
                                            </div>
                                        </div>
                                    </>
                                }
                            >
                                <AccountMenu onLogout={() => { auth.logout(); closeMobileMenu(); }} />
                            </Show>
                        </Show>
                    </nav>

                    {/* Hamburger — visible on mobile only */}
                    <button
                        class={`header__mobile-toggle ${mobileMenuOpen() ? 'header__mobile-toggle--open' : ''}`}
                        onClick={toggleMobileMenu}
                        aria-label="Toggle menu"
                        aria-expanded={mobileMenuOpen()}
                    >
                        <span class="header__mobile-toggle-bar" />
                        <span class="header__mobile-toggle-bar" />
                        <span class="header__mobile-toggle-bar" />
                    </button>
                </div>
            </header>

            {/* Mobile flyout — full-screen overlay, sibling of header to avoid transform stacking */}
            <Show when={mobileMenuOpen()}>
                <div class="header__mobile-flyout" style={flyoutStyle()}>
                    {/* Flyout header row */}
                    <div class="header__mobile-flyout-head" style={flyoutHeadStyle()}>
                        <A href="/" class="header__logo" onClick={closeMobileMenu}>
                            <SiteLogo name={props.siteName} logoSrc={props.logo} />
                        </A>
                        <button
                            class="header__mobile-flyout-close"
                            onClick={closeMobileMenu}
                            aria-label="Close menu"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Flyout nav items */}
                    <nav class="header__mobile-flyout-nav">
                        {/* Items from custom header config */}
                        <Show when={hasCustomHeader() && mobileNavItems().length > 0}>
                            <ul class="header__nav-list">
                                <For each={mobileNavItems()}>
                                    {(item,) => (
                                        <li class="header__nav-item">
                                            <MobileNavItem item={item} onClose={closeMobileMenu} />
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>

                        {/* Standard navigation items (non-custom header) */}
                        <Show when={!hasCustomHeader()}>
                            <ul class="header__nav-list">
                                <For each={props.navigation}>
                                    {(item,) => (
                                        <Show when={item.isVisible}>
                                            <li class="header__nav-item">
                                                <Show
                                                    when={item.isExternal}
                                                    fallback={
                                                        <A
                                                            href={item.slug === 'home' ? '/' : `/${item.slug}`}
                                                            class={`header__nav-link ${isActive(item.slug,) ? 'header__nav-link--active' : ''}`}
                                                            onClick={closeMobileMenu}
                                                        >
                                                            {item.label}
                                                        </A>
                                                    }
                                                >
                                                    <a
                                                        href={item.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        class="header__nav-link"
                                                        onClick={closeMobileMenu}
                                                    >
                                                        {item.label}
                                                    </a>
                                                </Show>
                                            </li>
                                        </Show>
                                    )}
                                </For>
                            </ul>
                        </Show>

                        {/* Admin link */}
                        <Show when={auth.isAuthenticated && isAdminRole(auth.user?.role,)}>
                            <ul class="header__nav-list">
                                <li class="header__nav-item">
                                    <A
                                        href="/admin"
                                        class={`header__nav-link ${isActive('admin',) ? 'header__nav-link--active' : ''}`}
                                        onClick={closeMobileMenu}
                                    >
                                        Admin
                                    </A>
                                </li>
                            </ul>
                        </Show>

                        {/* Auth actions */}
                        <div class="header__actions header__mobile-flyout-actions">
                            <Show
                                when={auth.isAuthenticated}
                                fallback={
                                    // Only surface the public Sign In when the users/members
                                    // feature is on — a members-less site (e.g. a pure news
                                    // site) shouldn't show it, and it would otherwise collide
                                    // with a custom header's own CTA.
                                    <Show when={isFeatureEnabled('users',)}>
                                        <A href="/login" class="header__btn header__btn--primary" onClick={closeMobileMenu}>
                                            Login
                                        </A>
                                    </Show>
                                }
                            >
                                <div class="header__user">
                                    <Show when={auth.user?.avatarUrl}>
                                        <img
                                            src={auth.user?.avatarUrl}
                                            alt={auth.user?.displayName}
                                            class="header__user-avatar"
                                        />
                                    </Show>
                                    <span class="header__user-name" style={{ display: 'block', }}>
                                        {auth.user?.displayName}
                                    </span>
                                    <button
                                        class="header__logout-btn"
                                        onClick={() => { auth.logout(); closeMobileMenu(); }}
                                        title="Logout"
                                        aria-label="Logout"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        >
                                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line x1="21" y1="12" x2="9" y2="12" />
                                        </svg>
                                    </button>
                                </div>
                            </Show>
                        </div>
                    </nav>
                </div>
            </Show>
        </>
    );
};
