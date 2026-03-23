import type { NavigationItem, SiteSettings, } from '@surge/shared';
import { createResource, ParentComponent, } from 'solid-js';
import { fetchNavigation, fetchSettings, } from '../../services/api';
import { Footer, } from './Footer';
import { Header, } from './Header';
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

    return (
        <div class="layout">
            <Header
                navigation={navigation() || []}
                siteName={settings()?.siteName || 'Surge Media'}
                logo={settings()?.logo}
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
