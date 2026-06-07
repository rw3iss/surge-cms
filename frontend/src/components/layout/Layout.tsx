import { Meta, Title, } from '@solidjs/meta';
import type { AppearanceSettings, NavigationItem, SiteFooterSettings, } from '@rw/cms-shared';
import { createEffect, createMemo, createResource, ParentComponent, } from 'solid-js';
import { fetchAppearance, fetchNavigation, fetchSiteFooter, fetchSiteHeader, } from '../../services/api';
import { swatchCssVars, } from '../../services/colorResolver';
import { fonts as fontsSignal, loadFonts, } from '../../services/fonts';
import { loadSwatches, swatches as swatchesSignal, } from '../../services/siteColors';
import { DEFAULT_SITE_NAME, loadSiteSettings, } from '../../stores/siteSettings';
import { appearanceCssVars, } from '../../utils/appearanceStyle';
import { Footer, } from './Footer';
import { Header, } from './Header';
import type { SiteHeaderSettings, } from './Header';
import './Layout.scss';

export const Layout: ParentComponent = (props,) => {
    const [navigation,] = createResource(async () => {
        const response = await fetchNavigation();
        return response.success ? response.data as NavigationItem[] : [];
    },);

    const [settings,] = createResource(async () => {
        return await loadSiteSettings();
    },);

    const [headerSettings,] = createResource(async () => {
        const response = await fetchSiteHeader();
        if (response.success && response.data) {
            const data = response.data as SiteHeaderSettings;
            if (data.items?.length) return data;
        }
        return null;
    },);

    const [appearance,] = createResource(async () => {
        const response = await fetchAppearance();
        return response.success ? response.data as AppearanceSettings : null;
    },);

    const [footerSettings,] = createResource<SiteFooterSettings | null>(async () => {
        const response = await fetchSiteFooter();
        if (response.success && response.data) return response.data as SiteFooterSettings;
        return null;
    },);

    // Apply font size to <html> so rem units throughout the site respect it
    createEffect(() => {
        const a = appearance();
        if (a?.fontSize) {
            document.documentElement.style.fontSize = `${a.fontSize}px`;
        }
    },);

    // Site swatches feed `--swatch-{id}` CSS custom properties so any
    // `swatch:{id}` color value (used in block styles, header / footer
    // settings, etc) resolves natively in the browser. Editing a
    // swatch updates the var in place and every consumer repaints
    // without component-level subscription.
    void loadSwatches();

    // Operator-uploaded fonts. Each font's binary is fetched once
    // and exposed under its `customId` as a `font-family` token via
    // a single <style> tag in <head>. Anywhere in the public site
    // can then use `font-family: 'fontN'` (block styles, header
    // items, footer items, etc.) and the browser resolves it.
    void loadFonts();
    createEffect(() => {
        const list = fontsSignal();
        if (typeof document === 'undefined') return;
        const tagId = 'site-fonts';
        let tag = document.getElementById(tagId,) as HTMLStyleElement | null;
        if (!tag) {
            tag = document.createElement('style',);
            tag.id = tagId;
            document.head.appendChild(tag,);
        }
        const formatHint = (fmt: string,) => {
            switch (fmt) {
                case 'woff2': return 'woff2';
                case 'woff': return 'woff';
                case 'ttf': return 'truetype';
                case 'otf': return 'opentype';
                case 'eot': return 'embedded-opentype';
                default: return fmt;
            }
        };
        tag.textContent = list.map(f =>
            `@font-face { font-family: '${f.customId}'; src: url('${f.url}') format('${formatHint(f.format,)}'); font-display: swap; }`
        ,).join('\n',);
    },);

    // Mapping from AppearanceSettings → inline `--site-*` vars lives in
    // utils/appearanceStyle.ts so the public site and the admin shell
    // share a single definition. AdminLayout passes 'admin' here for a
    // slightly narrower set (no site-bg/text/font on the root, since
    // admin chrome has its own controlled styling).
    const layoutStyle = createMemo(() => ({
        ...appearanceCssVars(appearance(), 'public',),
        ...swatchCssVars(swatchesSignal(),),
    }),);

    // Same belt-and-braces pattern as AdminLayout: in addition to the
    // inline style binding, write every key imperatively via
    // setProperty so CSS custom properties land even if Solid's
    // object-form style binding skips one. Lets the runtime values be
    // inspected directly on .layout in DevTools too.
    let rootRef: HTMLDivElement | undefined;
    createEffect(() => {
        if (!rootRef) return;
        const style = layoutStyle();
        for (const [key, value,] of Object.entries(style,)) {
            if (key.startsWith('--',)) {
                rootRef.style.setProperty(key, value,);
            } else {
                (rootRef.style as unknown as Record<string, string>)[key] = value;
            }
        }
    },);

    const dynamicSiteName = () => settings()?.siteName || DEFAULT_SITE_NAME;

    return (
        <div ref={(el,) => { rootRef = el; }} class="layout" style={layoutStyle()}>
            {/*
              Baseline tags that every page inherits. Only TRULY site-wide tags
              belong here — anything a page-level <SeoHead> might want to
              override must NOT be set here, because solid-meta's <Meta>
              inserts a separate element per component and the FIRST matching
              one wins when querying document.head (HTML spec / browser
              behavior).

              Title is safe to set here: solid-meta's <Title> uses a stack
              where the most recently mounted one wins, and page-level
              SeoHead's <Title> correctly overrides this fallback.

              Description, og:title, og:type, og:image, twitter:title,
              twitter:description, twitter:image → all page-specific, set by
              SeoHead only.
            */}
            <Title>{dynamicSiteName()}</Title>
            <Meta property="og:site_name" content={dynamicSiteName()} />
            <Meta property="og:locale" content="en_US" />

            <Header
                navigation={navigation() || []}
                siteName={dynamicSiteName()}
                logo={settings()?.logo}
                headerSettings={headerSettings()}
                gutterWidth={appearance()?.gutterWidth}
            />

            <main class="layout__main">
                {props.children}
            </main>

            <Footer
                siteName={dynamicSiteName()}
                tagline={settings()?.siteTagline}
                socialLinks={settings()?.socialLinks || {}}
                contactEmail={settings()?.contactEmail}
                footer={footerSettings()}
                gutterWidth={appearance()?.gutterWidth}
            />
        </div>
    );
};
