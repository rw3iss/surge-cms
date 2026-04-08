import type { AppearanceSettings, NavigationItem, SiteSettings, } from '@surge/shared';
import { createEffect, createMemo, createResource, ParentComponent, } from 'solid-js';
import { fetchAppearance, fetchNavigation, fetchSettings, fetchSiteHeader, } from '../../services/api';
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
        const response = await fetchSettings();
        return response.success ? response.data as SiteSettings : null;
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

    return (
        <div class="layout" style={layoutStyle()}>
            <Header
                navigation={navigation() || []}
                siteName={settings()?.siteName || 'Surge Media'}
                logo={settings()?.logo}
                headerSettings={headerSettings()}
                gutterWidth={appearance()?.gutterWidth}
            />

            <main class="layout__main">
                {props.children}
            </main>

            <Footer
                siteName={settings()?.siteName || 'Surge Media'}
                socialLinks={settings()?.socialLinks || {}}
                contactEmail={settings()?.contactEmail}
            />
        </div>
    );
};
