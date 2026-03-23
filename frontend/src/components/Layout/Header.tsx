import { A, useLocation, } from '@solidjs/router';
import type { NavigationItem, } from '@surge/shared';
import { Component, createSignal, For, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import SiteLogo from '../SiteLogo';
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
    textColor?: string;
    width?: string;
    alignment?: string;
    margin?: string;
    padding?: string;
    order: number;
}

export interface SiteHeaderSettings {
    items: SiteHeaderItem[];
    backgroundColor?: string;
    padding?: string;
    margin?: string;
}

interface HeaderProps {
    navigation: NavigationItem[];
    siteName: string;
    logo?: string;
    headerSettings?: SiteHeaderSettings | null;
}

// ─── Render a single header item ───

function HeaderItem(props: { item: SiteHeaderItem; },) {
    const item = () => props.item;

    const baseStyle = () => {
        const s: Record<string, string> = {};
        if (item().fontSize) s['font-size'] = item().fontSize!;
        if (item().textColor) s['color'] = item().textColor!;
        if (item().width) s['width'] = item().width!;
        if (item().margin) s['margin'] = item().margin!;
        if (item().padding) s['padding'] = item().padding!;
        if (item().alignment) s['text-align'] = item().alignment!;
        return s;
    };

    const linkTarget = () => item().openInNewTab ? '_blank' : undefined;
    const linkRel = () => item().openInNewTab ? 'noopener noreferrer' : undefined;

    switch (item().type) {
        case 'image':
            return (
                <img
                    src={item().imageUrl}
                    alt=""
                    class="header__custom-img"
                    style={baseStyle()}
                />
            );

        case 'image_link':
            return (
                <a
                    href={item().url || '#'}
                    target={linkTarget()}
                    rel={linkRel()}
                    class="header__custom-image-link"
                    style={baseStyle()}
                >
                    <img src={item().imageUrl} alt="" />
                </a>
            );

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
                        background: item().buttonColor || '#333',
                        color: '#fff',
                    }}
                >
                    {item().text}
                </a>
            );

        case 'menu':
            // Basic rendering as a text link for now
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

    const toggleMobileMenu = () => {
        setMobileMenuOpen(!mobileMenuOpen(),);
    };

    const closeMobileMenu = () => {
        setMobileMenuOpen(false,);
    };

    const hasCustomHeader = () => props.headerSettings?.items && props.headerSettings.items.length > 0;

    const headerStyle = () => {
        if (!hasCustomHeader()) return {};
        const s: Record<string, string> = {};
        if (props.headerSettings?.backgroundColor) s['background'] = props.headerSettings.backgroundColor;
        if (props.headerSettings?.padding) s['padding'] = props.headerSettings.padding;
        if (props.headerSettings?.margin) s['margin'] = props.headerSettings.margin;
        return s;
    };

    return (
        <header class="header" style={headerStyle()}>
            <div class="header__container">
                <Show when={!hasCustomHeader()}>
                    <A href="/" class="header__logo" onClick={closeMobileMenu}>
                        <SiteLogo name={props.siteName} logoSrc={props.logo} />
                    </A>
                </Show>

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

                <nav class={`header__nav ${mobileMenuOpen() ? 'header__nav--open' : ''}`}>
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

                    {/* Admin link - inline with other nav links, no special styling */}
                    <Show when={auth.isAuthenticated && auth.user?.role === 'admin'}>
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
    );
};
