import { Meta, Title, } from '@solidjs/meta';
import type { AppearanceSettings, NavigationItem, } from '@surge/shared';
import { createEffect, createMemo, createResource, ParentComponent, } from 'solid-js';
import { fetchAppearance, fetchNavigation, fetchSiteHeader, } from '../../services/api';
import { DEFAULT_SITE_NAME, loadSiteSettings, } from '../../stores/siteSettings';
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

    // Apply font size to <html> so rem units throughout the site respect it
    createEffect(() => {
        const a = appearance();
        if (a?.fontSize) {
            document.documentElement.style.fontSize = `${a.fontSize}px`;
        }
    },);

    const layoutStyle = createMemo(() => {
        const a = appearance();
        const s: Record<string, string> = {};
        if (a?.backgroundColor) {
            s['background-color'] = a.backgroundColor;
            s['--site-bg'] = a.backgroundColor;
        }
        if (a?.textColor) {
            s['color'] = a.textColor;
            s['--site-text'] = a.textColor;
        }
        if (a?.primaryColor) s['--site-primary'] = a.primaryColor;
        if (a?.linkColor) s['--site-link'] = a.linkColor;
        if (a?.headingColor) s['--site-heading'] = a.headingColor;
        if (a?.borderColor) s['--site-border'] = a.borderColor;
        if (a?.fontFamily) {
            s['font-family'] = a.fontFamily;
            s['--site-font'] = a.fontFamily;
        }
        if (a?.headingFontFamily) s['--site-heading-font'] = a.headingFontFamily;
        if (a?.headingWeight) s['--site-heading-weight'] = a.headingWeight;
        if (a?.lineHeight) {
            s['line-height'] = a.lineHeight;
            s['--site-line-height'] = a.lineHeight;
        }
        if (a?.gutterWidth) s['--site-gutter'] = a.gutterWidth;
        if (a?.borderRadius) s['--site-radius'] = a.borderRadius;
        if (a?.maxContentWidth) s['--site-max-width'] = a.maxContentWidth;
        if (a?.blockPadding) s['--site-block-padding'] = a.blockPadding;
        return s;
    },);

    const dynamicSiteName = () => settings()?.siteName || DEFAULT_SITE_NAME;

    return (
        <div class="layout" style={layoutStyle()}>
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
                socialLinks={settings()?.socialLinks || {}}
                contactEmail={settings()?.contactEmail}
            />
        </div>
    );
};
