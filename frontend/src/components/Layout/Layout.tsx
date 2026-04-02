import type { AppearanceSettings, NavigationItem, SiteSettings, } from '@surge/shared';
import { createMemo, createResource, ParentComponent, } from 'solid-js';
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

    const layoutStyle = createMemo(() => {
        const a = appearance();
        const s: Record<string, string> = {};
        if (a?.backgroundColor) {
            s['background-color'] = a.backgroundColor;
            s['--site-bg'] = a.backgroundColor;
        }
        if (a?.fontSize) s['font-size'] = `${a.fontSize}px`;
        if (a?.gutterWidth) s['--site-gutter'] = a.gutterWidth;
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
