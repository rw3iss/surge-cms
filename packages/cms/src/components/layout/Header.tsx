import { A, useLocation, } from '@solidjs/router';
import { isAdminRole, type NavigationItem, } from '@rw/cms-shared';
import { Component, createEffect, createSignal, For, type JSX, onCleanup, Show, } from 'solid-js';
import { colorCssValue, } from '../../services/colorResolver';
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
    textColor?: string;
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
        const tc = colorCssValue(item().textColor, '',);
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

    const headerClass = () => {
        const base = `header${hasCustomHeader() ? ' header--custom' : ''}`;
        const cls = [base,];
        if (!isStickyEnabled()) cls.push('header--no-sticky',);
        if (isAutoHideEnabled()) {
            cls.push('header--auto-hide',);
            if (hidden()) cls.push('header--auto-hidden',);
        }
        return cls.join(' ',);
    };

    const headerStyle = () => {
        if (!hasCustomHeader()) return {};
        const s: Record<string, string> = {};
        const bg = colorCssValue(props.headerSettings?.backgroundColor, '',);
        if (bg) s['background'] = bg;
        const tc = colorCssValue(props.headerSettings?.textColor, '',);
        if (tc) s['color'] = tc;
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
        return s;
    };

    // Background/color for mobile flyout matches the header's configured background
    const flyoutStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(props.headerSettings?.backgroundColor, '',);
        if (bg) s['background'] = bg;
        const tc = colorCssValue(props.headerSettings?.textColor, '',);
        if (tc) s['color'] = tc;
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
                            style={{ gap: (props.headerSettings as any)?.itemSpacing || undefined, }}
                        >
                            <For each={props.headerSettings!.items}>
                                {(item,) => <HeaderItem item={item} />}
                            </For>
                        </div>
                    </Show>

                    {/* Desktop nav */}
                    <nav class="header__nav">
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

                        <div class="header__actions">
                            <Show when={isFeatureEnabled('shop',)}>
                                <A href="/shop/cart" class="header__cart" aria-label="Cart" onClick={closeMobileMenu}>
                                    <span class="header__cart-icon" aria-hidden="true">🛒</span>
                                    <Show when={cartCount() > 0}>
                                        <span class="header__cart-badge">{cartCount()}</span>
                                    </Show>
                                </A>
                            </Show>
                            <Show
                                when={auth.isAuthenticated}
                                fallback={
                                    <A href="/login" class="header__btn header__btn--primary" onClick={closeMobileMenu}>
                                        Sign In
                                    </A>
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
                                    <span class="header__user-name">{auth.user?.displayName}</span>
                                    <button
                                        class="header__logout-btn"
                                        onClick={() => {
                                            auth.logout();
                                            closeMobileMenu();
                                        }}
                                        title="Sign Out"
                                        aria-label="Sign Out"
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
                                    <A href="/login" class="header__btn header__btn--primary" onClick={closeMobileMenu}>
                                        Sign In
                                    </A>
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
                                        title="Sign Out"
                                        aria-label="Sign Out"
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
