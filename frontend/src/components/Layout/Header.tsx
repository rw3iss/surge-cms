import { A, useLocation, } from '@solidjs/router';
import type { NavigationItem, } from '@rw/shared';
import { Component, createEffect, createSignal, For, onCleanup, Show, } from 'solid-js';
import { colorCssValue, } from '../../services/colorResolver';
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
    /** CSS font-weight ('100'..'900' or keyword). Empty/undefined → inherit. */
    fontWeight?: string;
    textColor?: string;
    width?: string;
    alignment?: string;
    verticalAlignment?: string;
    margin?: string;
    padding?: string;
    order: number;
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
}

interface HeaderProps {
    navigation: NavigationItem[];
    siteName: string;
    logo?: string;
    headerSettings?: SiteHeaderSettings | null;
    gutterWidth?: string;
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
            // Make the anchor itself a column-flex so its single child
            // (the image) can be horizontally aligned via align-items.
            // The previous implementation set `margin: auto` on the
            // image and forced `width: 100%`, which left no free
            // horizontal space — so center/right alignment had no
            // visible effect and the image just sat wherever the
            // anchor's natural sizing placed it.
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
            const imgStyle = () => {
                // Let the image keep its natural aspect; cap at the
                // anchor's width so it never overflows. Width can
                // still be forced by the operator via item.width on
                // the anchor (the image fills it via min-width).
                const s: Record<string, string> = {
                    display: 'block',
                    'max-width': '100%',
                    height: 'auto',
                };
                return s;
            };
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

    // ─── Sticky / auto-hide behavior ────────────────────────────
    // Defaults preserve the historic behavior: sticky=on, autoHide=off.
    // When `sticky` is off the header is in flow and scrolls away.
    // When `autoHide` is on we slide the header out of view on
    // downward scroll past a small threshold and restore it on
    // upward scroll. The slide is a CSS transform so the header
    // doesn't reflow surrounding content.
    const isStickyEnabled = () => props.headerSettings?.sticky !== false;
    const isAutoHideEnabled = () => props.headerSettings?.autoHide === true;

    const [hidden, setHidden,] = createSignal(false,);

    createEffect(() => {
        // Only attach the scroll listener when auto-hide is on.
        // Re-evaluating the listener lifecycle whenever the toggle
        // flips lets the operator turn it on/off live without a
        // full page reload.
        if (!isAutoHideEnabled()) {
            setHidden(false,);
            return;
        }
        if (typeof window === 'undefined') return;

        let lastY = window.scrollY;
        const THRESHOLD = 8; // ignore tiny jitter
        const TOP_GUARD = 4; // never hide near the very top

        const onScroll = () => {
            const y = window.scrollY;
            const delta = y - lastY;
            if (Math.abs(delta,) < THRESHOLD) return;
            if (y < TOP_GUARD) {
                // Snap back into view at the top of the page.
                setHidden(false,);
            } else if (delta > 0) {
                // Scrolling down — hide.
                setHidden(true,);
            } else {
                // Scrolling up — show.
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
        // Padding is applied to the container (not the header) so it
        // actually affects the content inside, including auth buttons.
        return s;
    };

    const containerStyle = () => {
        if (!hasCustomHeader()) return {};
        const s: Record<string, string> = {};
        // Parse the padding shorthand into individual sides so nothing
        // can partially override it. CSS specificity of longhands beats
        // shorthands when both appear — using all four longhands avoids
        // that trap entirely.
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
        // Gutter override — takes precedence over padding-left/right
        if (props.headerSettings?.applyGutter && props.gutterWidth && props.gutterWidth !== '0') {
            s['padding-left'] = props.gutterWidth;
            s['padding-right'] = props.gutterWidth;
        }
        return s;
    };

    return (
        <header class={headerClass()} style={headerStyle()}>
            <div class="header__container" style={containerStyle()}>
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
                    <Show when={auth.isAuthenticated && (auth.user?.role === 'admin' || auth.user?.role === 'sysadmin')}>
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
