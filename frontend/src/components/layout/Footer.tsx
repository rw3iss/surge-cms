import { A, } from '@solidjs/router';
import type { SiteFooterColumn, SiteFooterRow, SiteFooterSettings, SiteLayoutItem, } from '@rw/shared';
import { Component, For, Show, } from 'solid-js';
import { colorCssValue, } from '../../services/colorResolver';
import './Footer.scss';

/**
 * Settings-driven footer.
 *
 * The previous implementation hardcoded "Navigate / Legal / Follow Us"
 * columns and an "Independent journalism for the people" tagline,
 * which made the footer look broken on a fresh install where /about,
 * /donate, /privacy etc. don't exist as pages yet. The footer is now
 * fully driven by `SiteFooterSettings` from
 * `/api/v1/settings/site-footer`:
 *   - When `settings.enabled` is false (the default), nothing renders.
 *   - When enabled, the configured rows → columns → items are
 *     rendered. The footer is invisible until the admin opts in via
 *     Settings → Site Footer.
 *
 * The legacy `siteName + tagline + socialLinks + contactEmail` props
 * are still accepted; they're rendered ONLY when the footer is enabled
 * AND no rows are configured (a "first-time-enabled" placeholder so
 * the operator can see the surface before they design it). Once a row
 * is added, the operator's structure is the only thing that renders.
 */

interface FooterProps {
    siteName: string;
    /** Optional tagline. Hidden when undefined/empty. */
    tagline?: string;
    socialLinks: Record<string, string>;
    contactEmail?: string;
    /** Configured footer. Undefined while the resource loads. */
    footer?: SiteFooterSettings | null;
    /** Site gutter width — used by rows that opt into `useGutter`. */
    gutterWidth?: string;
}

const socialIcons: Record<string, string> = {
    patreon: 'P',
    youtube: 'Y',
    instagram: 'I',
    facebook: 'F',
    twitter: 'X',
    tiktok: 'T',
};

// ─── Item renderer ────────────────────────────────────────────────
// Mirrors the per-item rendering in Header.tsx. Kept inline (rather
// than extracted to a shared component) because the header has
// header-specific behaviors like menu dropdowns and active-route
// styling that wouldn't carry over cleanly. If a third surface ever
// needs the same item set, this is the candidate to extract.

function FooterItem(props: { item: SiteLayoutItem; },) {
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
        case 'image':
            return <img src={item().imageUrl} alt="" class="footer__item-img" style={baseStyle()} />;

        case 'image_link':
            return (
                <a
                    href={item().url}
                    target={linkTarget()}
                    rel={linkRel()}
                    class="footer__item-img-link"
                    style={baseStyle()}
                >
                    <img src={item().imageUrl} alt={item().text || ''} />
                </a>
            );

        case 'text':
            return <span class="footer__item-text" style={baseStyle()}>{item().text}</span>;

        case 'text_link':
            // Internal links use <A> for client-side routing; absolute URLs
            // use a regular anchor.
            const url = item().url || '';
            const isInternal = url.startsWith('/',);
            if (isInternal) {
                return (
                    <A href={url} target={linkTarget()} rel={linkRel()} class="footer__item-link" style={baseStyle()}>
                        {item().text}
                    </A>
                );
            }
            return (
                <a href={url} target={linkTarget()} rel={linkRel()} class="footer__item-link" style={baseStyle()}>
                    {item().text}
                </a>
            );

        case 'button':
            return (
                <a
                    href={item().url}
                    target={linkTarget()}
                    rel={linkRel()}
                    class="footer__item-button"
                    style={{
                        ...baseStyle(),
                        'background-color': colorCssValue(item().buttonColor, '#3498cf',),
                        color: colorCssValue(item().textColor, '#fff',),
                    }}
                >
                    {item().text}
                </a>
            );

        case 'gap':
            return <span class="footer__item-gap" style={{ width: item().width || '12px', }} />;

        case 'flex_spacer':
            return <span class="footer__item-flex-spacer" />;

        case 'menu':
            // The menu type is currently a no-op in footer — there's no
            // navigation tree to expand. Render nothing until we ship a
            // dedicated menu picker for the footer.
            return null;
    }
}

// ─── Column renderer ──────────────────────────────────────────────

function FooterColumnRenderer(props: { column: SiteFooterColumn; },) {
    const c = () => props.column;
    const direction = () => c().direction === 'row' ? 'row' : 'column';
    const justify = () => c().alignment ?? 'start';
    const align = () => c().verticalAlignment ?? (direction() === 'column' ? 'start' : 'center');
    const flexGrow = () => c().flex ?? 1;

    const style = () => {
        const s: Record<string, string> = {
            display: 'flex',
            'flex-direction': direction(),
            'justify-content': justify() === 'start' ? 'flex-start' : justify() === 'end' ? 'flex-end' : justify(),
            'align-items': align() === 'start' ? 'flex-start' : align() === 'end' ? 'flex-end' : align(),
            'flex-grow': String(flexGrow(),),
            'flex-basis': '0',
            'min-width': '0',
        };
        if (c().gap) s['gap'] = c().gap!;
        if (c().padding) s['padding'] = c().padding!;
        if (c().margin) s['margin'] = c().margin!;
        return s;
    };

    const items = () => [...c().items,].sort((a, b,) => (a.order ?? 0) - (b.order ?? 0));

    return (
        <div class="footer__column" style={style()}>
            <For each={items()}>
                {(item,) => <FooterItem item={item} />}
            </For>
        </div>
    );
}

// ─── Row renderer ─────────────────────────────────────────────────

function FooterRowRenderer(props: { row: SiteFooterRow; gutterWidth?: string; },) {
    const r = () => props.row;

    const outerStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(r().backgroundColor, '',);
        if (bg) s['background-color'] = bg;
        if (r().padding) s['padding'] = r().padding!;
        if (r().margin) s['margin'] = r().margin!;
        return s;
    };

    const innerStyle = () => {
        const s: Record<string, string> = {
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'stretch',
            width: '100%',
        };
        if (r().gap) s['gap'] = r().gap!;
        if (r().useGutter) {
            // `useGutter` means: render the row in the site's
            // contained-width layout. The cap is the configured
            // max-content-width, NOT the gutter (which is padding,
            // e.g. "10vw"). Confusingly the prop here is named
            // `gutterWidth` but it carries appearance.gutterWidth,
            // which is the page-padding value — using it as max-width
            // squished every footer row to that width (a 10vw gutter
            // produced a 10vw row). Read the CSS vars set by Layout
            // instead so this matches how the rest of the site
            // contains content.
            s['max-width'] = 'var(--site-max-width, 1200px)';
            s['margin'] = '0 auto';
            s['padding-left'] = props.gutterWidth || 'var(--site-gutter, 16px)';
            s['padding-right'] = props.gutterWidth || 'var(--site-gutter, 16px)';
        }
        return s;
    };

    return (
        <div class="footer__row" style={outerStyle()}>
            <div class="footer__row-inner" style={innerStyle()}>
                <For each={r().columns}>
                    {(column,) => <FooterColumnRenderer column={column} />}
                </For>
            </div>
        </div>
    );
}

// ─── First-run fallback ───────────────────────────────────────────
// Shown only when the footer is enabled but the operator hasn't
// configured any rows yet. Gives them a visual confirmation that the
// footer is on while they design it.

function FallbackFooter(props: { siteName: string; tagline?: string; socialLinks: Record<string, string>; contactEmail?: string; },) {
    const socialEntries = () => Object.entries(props.socialLinks,).filter(([, url,],) => url && url.trim());
    return (
        <div class="footer__fallback">
            <div class="footer__brand">
                <h3 class="footer__title">{props.siteName}</h3>
                <Show when={props.tagline?.trim()}>
                    <p class="footer__tagline">{props.tagline}</p>
                </Show>
            </div>
            <Show when={socialEntries().length > 0}>
                <div class="footer__social">
                    <For each={socialEntries()}>
                        {([platform, url,],) => (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class={`footer__social-link footer__social-link--${platform}`}
                                aria-label={`Follow us on ${platform}`}
                            >
                                <span class="footer__social-icon">
                                    {socialIcons[platform] || platform[0].toUpperCase()}
                                </span>
                            </a>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={props.contactEmail}>
                <a href={`mailto:${props.contactEmail}`} class="footer__email">{props.contactEmail}</a>
            </Show>
            <p class="footer__copyright">
                &copy; {new Date().getFullYear()} {props.siteName}.
            </p>
        </div>
    );
}

// ─── Public component ─────────────────────────────────────────────

export const Footer: Component<FooterProps> = (props,) => {
    // Visibility is reactive: must be a tracked accessor (used by <Show>),
    // NOT an early `return null` at the top of the function. The previous
    // version returned null at first render — when `props.footer` was
    // still undefined while the resource loaded — and Solid never
    // re-rendered the component when the resource later resolved, so
    // the footer stayed invisible even after enabling it.
    const visible = () => props.footer != null && props.footer.enabled === true;
    const rows = () => props.footer?.rows ?? [];
    const hasRows = () => rows().length > 0;

    const outerStyle = () => {
        const s: Record<string, string> = {};
        const bg = colorCssValue(props.footer?.backgroundColor, '',);
        if (bg) s['background-color'] = bg;
        if (props.footer?.padding) s['padding'] = props.footer.padding;
        if (props.footer?.margin) s['margin'] = props.footer.margin;
        return s;
    };

    return (
        <Show when={visible()}>
            <footer class="footer" style={outerStyle()}>
                <Show
                    when={hasRows()}
                    fallback={
                        <FallbackFooter
                            siteName={props.siteName}
                            tagline={props.tagline}
                            socialLinks={props.socialLinks}
                            contactEmail={props.contactEmail}
                        />
                    }
                >
                    <For each={rows()}>
                        {(row,) => <FooterRowRenderer row={row} gutterWidth={props.gutterWidth} />}
                    </For>
                </Show>
            </footer>
        </Show>
    );
};
