import type { NavigationItem, SiteSettings, } from '@surge/shared';
import { createResource, ParentComponent, } from 'solid-js';
import { fetchNavigation, fetchSettings, fetchSiteHeader, } from '../../services/api';
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

    return (
        <div class="layout">
            <Header
                navigation={navigation() || []}
                siteName={settings()?.siteName || 'Surge Media'}
                logo={settings()?.logo}
                headerSettings={headerSettings()}
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
